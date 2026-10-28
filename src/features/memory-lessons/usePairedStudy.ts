import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { usePairChatStore } from '@/src/features/study/pairChatStore';
import { retainChannel } from '@/src/lib/realtime/retainChannel';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

export type PairQuestionState = {
  question_key: string;
  locked: boolean;
  waiting: boolean;
  revealed: boolean;
  mine_correct: boolean | null;
  other_correct: boolean | null;
  other_choice: string | null;
  submitted_at: string | null;
  wait_seconds: number;
  both_correct: boolean;
  partner_id: string | null;
};

export type PairMemberStatus = {
  user_id: string;
  display_name: string;
  presence: string;
  last_seen_at: string;
  stale: boolean;
  disconnected: boolean;
};

export function usePairedStudy(questionKey: string | null) {
  const sessionId = usePairChatStore((s) => s.session?.sessionId ?? null);
  const otherName = usePairChatStore((s) => s.session?.otherName ?? 'Arkadaşın');
  const otherId = usePairChatStore((s) => s.session?.otherId);
  const solo = usePairChatStore((s) => Boolean(s.session?.solo));
  const me = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();

  const settings = useQuery({
    queryKey: ['pair-study-settings'],
    queryFn: async () => {
      const { data } = await getSupabase()
        .from('app_runtime_settings')
        .select(
          'pair_match_enabled, paired_question_wait_seconds, pair_reconnect_grace_seconds, pair_study_events_enabled, pair_motivation_enabled, match_search_seconds',
        )
        .eq('id', 1)
        .maybeSingle();
      return data as {
        pair_match_enabled?: boolean;
        paired_question_wait_seconds?: number;
        pair_reconnect_grace_seconds?: number;
        pair_study_events_enabled?: boolean;
        pair_motivation_enabled?: boolean;
        match_search_seconds?: number;
      } | null;
    },
    staleTime: 30_000,
  });

  const state = useQuery({
    queryKey: ['pair-question', sessionId, questionKey],
    enabled: Boolean(sessionId && questionKey),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('pair_question_state', {
        p_session: sessionId,
        p_question_key: questionKey,
      });
      if (error) throw error;
      return data as PairQuestionState;
    },
  });

  const members = useQuery({
    queryKey: ['pair-members', sessionId],
    enabled: Boolean(sessionId),
    refetchInterval: 12_000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('pair_member_status', { p_session: sessionId });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as PairMemberStatus[];
    },
  });

  useEffect(() => {
    if (!sessionId) return;
    const beat = () => void getSupabase().rpc('heartbeat_pair_session', { p_session: sessionId, p_presence: 'active' });
    void beat();
    const timer = setInterval(beat, 12_000);
    const release = retainChannel(`pair-locks:${sessionId}`, (channel) =>
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'study_pair_question_locks', filter: `session_id=eq.${sessionId}` },
          () => {
            void client.invalidateQueries({ queryKey: ['pair-question', sessionId] });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'study_session_members', filter: `session_id=eq.${sessionId}` },
          () => {
            void client.invalidateQueries({ queryKey: ['pair-members', sessionId] });
          },
        ),
    );
    return () => {
      clearInterval(timer);
      release();
    };
  }, [client, sessionId]);

  const submit = useMutation({
    mutationFn: async (input: { questionKey: string; choice: string; correct: boolean }) => {
      const { data, error } = await getSupabase().rpc('submit_pair_answer', {
        p_session: sessionId,
        p_question_key: input.questionKey,
        p_choice: input.choice,
        p_correct: input.correct,
      });
      if (error) throw error;
      return data as PairQuestionState;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['pair-question', sessionId] });
      void client.invalidateQueries({ queryKey: ['study-room-messages', sessionId] });
    },
  });

  const postEvent = useMutation({
    mutationFn: async (input: { event: string; body: string; metadata?: Record<string, unknown> }) => {
      if (!sessionId) return;
      const { error } = await getSupabase().rpc('post_study_event', {
        p_session: sessionId,
        p_event: input.event,
        p_body: input.body,
        p_metadata: input.metadata ?? {},
      });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['study-room-messages', sessionId] }),
  });

  const leave = useMutation({
    mutationFn: async () => {
      if (!sessionId) return;
      await getSupabase().rpc('leave_pair_study', { p_session: sessionId });
    },
    onSettled: () => usePairChatStore.getState().end(),
  });

  const partner = (members.data ?? []).find((row) => row.user_id !== me);
  const waitSeconds = state.data?.wait_seconds ?? settings.data?.paired_question_wait_seconds ?? 75;

  return {
    sessionId,
    otherName,
    otherId,
    paired: Boolean(sessionId) && !solo,
    state: state.data,
    partner,
    waitSeconds,
    matchEnabled: settings.data?.pair_match_enabled !== false,
    submit,
    postEvent,
    leave,
    refetch: state.refetch,
  };
}
