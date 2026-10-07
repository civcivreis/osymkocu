import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { mapSocialError } from '@/src/features/social/useSocial';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

export type ProfilePost = {
  id: string;
  body: string;
  kind: string;
  created_at: string;
  subject_name?: string | null;
  like_count?: number;
  comment_count?: number;
};

export type ProfileCard = {
  id: string;
  display_name: string;
  display_tag?: number | null;
  bio?: string | null;
  exam_id?: string | null;
  exam_name?: string | null;
  exam_year?: number | null;
  target_score?: number | null;
  current_xp: number;
  is_private?: boolean;
  is_bot?: boolean;
  avatar_url?: string | null;
  streak: number;
  follower_count: number;
  following_count: number;
  i_follow: boolean;
  follow_pending: boolean;
  follows_me: boolean;
  has_story: boolean;
  week_questions: number;
  week_ms: number;
  week_active: number;
  week_correct: number;
  top_subject?: string | null;
  subjects: { id: string; name: string }[];
  posts: ProfilePost[];
};

export type FollowRow = {
  id: string;
  display_name: string;
  display_tag?: number | null;
  exam_name?: string | null;
  focus?: string | null;
  i_follow: boolean;
  follow_pending: boolean;
};

export function followLabel(card: Pick<ProfileCard, 'i_follow' | 'follow_pending' | 'follows_me'>) {
  if (card.follow_pending) return 'İstek gitti';
  if (card.i_follow && card.follows_me) return 'Karşılıklı takip';
  if (card.i_follow) return 'Takiptesin ✓';
  return 'Takip et';
}

export function formatStudyDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours <= 0) return `${mins} dk`;
  if (mins === 0) return `${hours} sa`;
  return `${hours} sa ${mins} dk`;
}

export function useProfileCard(userId: string | null) {
  const me = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['profile-card', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_profile_card', { p_user: userId });
      if (error) throw error;
      const row = data as ProfileCard;
      const extra = await getSupabase()
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId!)
        .maybeSingle();
      return {
        ...row,
        avatar_url: (extra.data as { avatar_url?: string | null } | null)?.avatar_url ?? row.avatar_url ?? null,
        subjects: row.subjects ?? [],
        posts: row.posts ?? [],
      };
    },
  });

  useEffect(() => {
    if (!userId || !me) return;
    const channel = getSupabase()
      .channel(`follows-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_follows' }, () => {
        void client.invalidateQueries({ queryKey: ['profile-card', userId] });
        void client.invalidateQueries({ queryKey: ['follow-list'] });
      })
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [client, me, userId]);

  return query;
}

export function useFollowUser() {
  const me = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (otherId: string) => {
      const { data, error } = await getSupabase().rpc('follow_user', { p_other: otherId });
      if (error) throw new Error(mapSocialError(error.message));
      return String(data ?? 'active');
    },
    onMutate: async (otherId) => {
      await client.cancelQueries({ queryKey: ['profile-card', otherId] });
      const previous = client.getQueryData<ProfileCard>(['profile-card', otherId]);
      if (previous) {
        client.setQueryData<ProfileCard>(['profile-card', otherId], {
          ...previous,
          i_follow: !previous.is_private,
          follow_pending: Boolean(previous.is_private),
          follower_count: previous.is_private ? previous.follower_count : previous.follower_count + 1,
        });
      }
      return { previous };
    },
    onError: (_error, otherId, ctx) => {
      if (ctx?.previous) client.setQueryData(['profile-card', otherId], ctx.previous);
    },
    onSettled: (_data, _error, otherId) => {
      void client.invalidateQueries({ queryKey: ['profile-card', otherId] });
      void client.invalidateQueries({ queryKey: ['profile-card', me] });
      void client.invalidateQueries({ queryKey: ['follow-list'] });
    },
  });
}

export function useUnfollowUser() {
  const me = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (otherId: string) => {
      const { error } = await getSupabase().rpc('unfollow_user', { p_other: otherId });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onMutate: async (otherId) => {
      await client.cancelQueries({ queryKey: ['profile-card', otherId] });
      const previous = client.getQueryData<ProfileCard>(['profile-card', otherId]);
      if (previous) {
        client.setQueryData<ProfileCard>(['profile-card', otherId], {
          ...previous,
          i_follow: false,
          follow_pending: false,
          follower_count: Math.max(
            0,
            previous.follower_count - (previous.i_follow && !previous.follow_pending ? 1 : 0),
          ),
        });
      }
      return { previous };
    },
    onError: (_error, otherId, ctx) => {
      if (ctx?.previous) client.setQueryData(['profile-card', otherId], ctx.previous);
    },
    onSettled: (_data, _error, otherId) => {
      void client.invalidateQueries({ queryKey: ['profile-card', otherId] });
      void client.invalidateQueries({ queryKey: ['profile-card', me] });
      void client.invalidateQueries({ queryKey: ['follow-list'] });
    },
  });
}

export function useFollowList(userId: string | null, dir: 'followers' | 'following', search: string) {
  return useQuery({
    queryKey: ['follow-list', userId, dir, search],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_follows', {
        p_user: userId,
        p_dir: dir,
        p_search: search.trim(),
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as FollowRow[];
    },
  });
}
