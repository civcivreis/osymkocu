import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { mapSocialError } from '@/src/features/social/useSocial';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

export type ReactionScope = 'dm' | 'group' | 'room';

export type ReactionRow = {
  id: string;
  scope: ReactionScope;
  message_id: string;
  user_id: string;
  emoji: string;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  mine: boolean;
};

function groupReactions(rows: ReactionRow[], userId?: string) {
  const byMessage = new Map<string, ReactionSummary[]>();
  const counts = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const row of rows) {
    let emojis = counts.get(row.message_id);
    if (!emojis) {
      emojis = new Map();
      counts.set(row.message_id, emojis);
    }
    const current = emojis.get(row.emoji) ?? { count: 0, mine: false };
    current.count += 1;
    if (row.user_id === userId) current.mine = true;
    emojis.set(row.emoji, current);
  }
  for (const [messageId, emojis] of counts) {
    byMessage.set(
      messageId,
      [...emojis.entries()].map(([emoji, value]) => ({ emoji, ...value })),
    );
  }
  return byMessage;
}

export function useMessageReactions(scope: ReactionScope, messageIds: string[]) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  const idsKey = useMemo(() => [...messageIds].sort().join(','), [messageIds]);

  const query = useQuery({
    queryKey: ['message-reactions', scope, idsKey, userId],
    enabled: Boolean(userId && messageIds.length),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('message_reactions')
        .select('id, scope, message_id, user_id, emoji')
        .eq('scope', scope)
        .in('message_id', messageIds);
      if (error) {
        if (/schema cache|could not find|message_reactions/i.test(error.message)) return [] as ReactionRow[];
        throw error;
      }
      return (data ?? []) as ReactionRow[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = getSupabase()
      .channel(`message-reactions-${scope}-${userId.slice(0, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => {
        void client.invalidateQueries({ queryKey: ['message-reactions', scope] });
      })
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [client, scope, userId]);

  const grouped = useMemo(
    () => groupReactions(query.data ?? [], userId),
    [query.data, userId],
  );

  const toggle = useMutation({
    mutationFn: async (input: { messageId: string; emoji: string }) => {
      const { error } = await getSupabase().rpc('toggle_message_reaction', {
        p_scope: scope,
        p_message_id: input.messageId,
        p_emoji: input.emoji,
      });
      if (error) {
        if (/schema cache|could not find|toggle_message_reaction/i.test(error.message)) {
          throw new Error('Tepkiler henüz açık değil. SQL’i yapıştırıp tekrar dene.');
        }
        throw new Error(mapSocialError(error.message));
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['message-reactions', scope] });
    },
  });

  return { grouped, toggle };
}
