import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { chatPreview } from '@/src/features/social/chatMedia';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

export type SocialProfile = {
  id: string;
  display_name: string;
  display_tag?: number | null;
  bio?: string | null;
  current_xp: number;
  exam_id: string | null;
  exam_year: number | null;
  target_score: number | null;
};

export type SocialPost = {
  id: string;
  user_id: string;
  body: string;
  kind: string;
  created_at: string;
  subject_id: string | null;
  session_id?: string | null;
  capacity?: number | null;
  duration_minutes?: number | null;
  expires_at?: string | null;
  display_name?: string | null;
  display_tag?: number | null;
  subject_name?: string | null;
  current_xp?: number | null;
  is_bot?: boolean;
  goal_label?: string | null;
  like_count?: number;
  comment_count?: number;
  liked_by_me?: boolean;
  comment_preview?: PostComment[];
  profiles?: SocialProfile | SocialProfile[] | null;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  parent_id?: string | null;
  display_name?: string;
  display_tag?: number | null;
  is_bot?: boolean;
  like_count?: number;
  liked_by_me?: boolean;
};

export type OpenRoom = {
  id: string;
  mode: 'exam' | 'race' | 'study' | 'test';
  status: string;
  capacity: number;
  host_id: string | null;
  subject_id: string | null;
  subject_name: string | null;
  title?: string | null;
  is_private?: boolean;
  has_password?: boolean;
  chat_enabled?: boolean;
  member_count: number;
  created_at?: string | null;
};

export type GroupMessage = {
  id: string;
  slug: string;
  sender_id: string;
  body: string;
  created_at: string;
  display_name?: string;
  display_tag?: number | null;
  is_bot?: boolean;
  reply_to_id?: string | null;
  reply_name?: string | null;
  reply_body?: string | null;
  kind?: 'text' | 'image';
  image_path?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  media_id?: string | null;
};

export type StoryItem = {
  id: string;
  user_id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  expires_at: string;
  display_name: string;
  display_tag?: number | null;
};

function decodeBase64(value: string) {
  const chars = globalThis.atob(value);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i += 1) bytes[i] = chars.charCodeAt(i);
  return bytes;
}

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  requester_name?: string;
};

export type DmConversation = {
  id: string;
  user_a: string;
  user_b: string;
  initiated_by: string;
  accepted_at: string | null;
  created_at: string;
};

export type DmMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  kind?: 'text' | 'image';
  image_path?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  media_id?: string | null;
};

function asProfile(value: SocialProfile | SocialProfile[] | null | undefined): SocialProfile | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function postAuthor(post: SocialPost): SocialProfile | null {
  const nested = asProfile(post.profiles ?? null);
  if (nested) return nested;
  if (post.display_name) {
    return {
      id: post.user_id,
      display_name: post.display_name,
      display_tag: post.display_tag ?? null,
      current_xp: post.current_xp ?? 0,
      exam_id: null,
      exam_year: null,
      target_score: null,
    };
  }
  return null;
}

export function mapSocialError(message: string): string {
  if (message.includes('IMAGE_RESTRICTED')) return 'Şu an fotoğraf gönderemezsin. Bir süre sonra dene.';
  if (message.includes('IMAGE_MODERATION_UNAVAILABLE') || message.includes('moderation_unavailable')) {
    return 'Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.';
  }
  if (message.includes('IMAGE_REJECTED') || message.includes('IMAGE_NOT_APPROVED') || message.includes('unsafe_content')) {
    return 'Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi.';
  }
  if (message.includes('MESSAGE_BLOCKED')) return 'Bu içerik topluluk kurallarına uygun değil.';
  if (message.includes('REPORT_COOLDOWN')) return 'Şikâyeti biraz sonra tekrar dene.';
  if (message.includes('SELF_FOLLOW')) return 'Kendini takip edemezsin.';
  if (message.includes('WAIT_ACCEPT')) return 'Karşı taraf ilk mesajı kabul etmeden yeniden yazamazsın.';
  if (message.includes('BLOCKED')) return 'Bu kişiyle iletişim kapalı.';
  if (message.includes('EMPTY_MESSAGE')) return 'Boş mesaj gönderilemez.';
  if (message.includes('INVALID_DM') || message.includes('INVALID_FRIEND')) return 'Geçersiz istek.';
  if (message.includes('BOT_NO_FRIEND')) return 'Bu profil arkadaşlık isteği kabul etmiyor.';
  if (message.includes('BOT_NO_DM')) return 'Bu kişi mesaj kabul etmiyor.';
  if (message.includes('BOT_NO_STUDY')) return 'Şu an müsait değil. Sınav veya yarışma odasına katıl.';
  if (message.includes('INVALID_DURATION')) return 'Süre 30 dk, 1 sa, 2 sa veya 4 sa olmalı.';
  if (message.includes('REACTION_LIMIT')) return 'Bu mesaja en fazla 3 tepki verebilirsin.';
  if (message.includes('BAD_EMOJI')) return 'Bu tepki kullanılamıyor.';
  if (message.includes('SLOW_MODE')) return 'Grupta 10 saniyede bir mesaj yazabilirsin.';
  return message;
}

export function useSocialPreview() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['social-preview', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_social_feed');
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as SocialPost[];
      return rows.filter((row) => row.kind !== 'exam_lobby').slice(0, 2);
    },
  });
}

export function useSocialPosts() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['social-posts', userId],
    enabled: Boolean(userId),
    refetchInterval: 45000,
    queryFn: async () => {
      const supabase = getSupabase();
      await supabase.rpc('pulse_bots');
      const feed = await supabase.rpc('get_social_feed');
      if (!feed.error && feed.data) {
        return (Array.isArray(feed.data) ? feed.data : []) as SocialPost[];
      }
      const blocksRes = await supabase.from('user_blocks').select('blocked_id').eq('blocker_id', userId!);
      const primary = await supabase
        .from('social_posts')
        .select(
          'id, user_id, body, kind, created_at, subject_id, session_id, capacity, duration_minutes, expires_at, profiles(id, display_name, display_tag, current_xp, exam_id, exam_year, target_score)',
        )
        .order('created_at', { ascending: false })
        .limit(50);
      if (primary.error) throw primary.error;
      const blocked = new Set((blocksRes.data ?? []).map((row) => row.blocked_id));
      const now = Date.now();
      return ((primary.data ?? []) as SocialPost[]).filter((post) => {
        if (blocked.has(post.user_id)) return false;
        if (post.expires_at && new Date(post.expires_at).getTime() < now) return false;
        return true;
      });
    },
  });
}

export function useFriendships() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['friendships', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('friendships')
        .select('id, requester_id, addressee_id, status');
      if (error) throw error;
      const rows = (data ?? []) as Friendship[];
      const ids = [...new Set(rows.flatMap((row) => [row.requester_id, row.addressee_id]))];
      if (ids.length === 0) return rows;
      const { data: people } = await getSupabase()
        .from('profiles')
        .select('id, display_name, display_tag')
        .in('id', ids);
      const names = new Map(
        ((people ?? []) as { id: string; display_name: string; display_tag?: number | null }[]).map((item) => [
          item.id,
          item,
        ]),
      );
      return rows.map((row) => ({
        ...row,
        requester_name: names.get(row.requester_id)?.display_name,
      }));
    },
  });
}

export function usePeople(search: string) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const examId = useAuthStore((s) => s.profile?.exam_id);
  const term = search.trim();

  return useQuery({
    queryKey: ['social-people', userId, examId, term],
    enabled: Boolean(userId),
    queryFn: async () => {
      const listed = await getSupabase().rpc('list_human_profiles', {
        p_exam: examId ?? null,
        p_search: term,
      });
      if (!listed.error && listed.data) {
        return (Array.isArray(listed.data) ? listed.data : []) as SocialProfile[];
      }
      let query = getSupabase()
        .from('profiles')
        .select('id, display_name, display_tag, current_xp, exam_id, exam_year, target_score')
        .neq('id', userId!)
        .limit(20);
      if (term.length >= 2) {
        query = query.ilike('display_name', `%${term}%`);
      } else if (examId) {
        query = query.eq('exam_id', examId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SocialProfile[];
    },
  });
}

export function useFriendXpBoard() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const friendships = useFriendships();

  return useQuery({
    queryKey: ['friend-xp', userId, friendships.data],
    enabled: Boolean(userId) && friendships.isSuccess,
    queryFn: async () => {
      const ids = new Set<string>([userId!]);
      for (const row of friendships.data ?? []) {
        if (row.status !== 'accepted') continue;
        ids.add(row.requester_id === userId ? row.addressee_id : row.requester_id);
      }
      const { data, error } = await getSupabase()
        .from('profiles')
        .select('id, display_name, current_xp')
        .in('id', [...ids]);
      if (error) throw error;
      return ((data ?? []) as Pick<SocialProfile, 'id' | 'display_name' | 'current_xp'>[]).sort(
        (a, b) => b.current_xp - a.current_xp,
      );
    },
  });
}

export function useConversations() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['dm-conversations', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('dm_conversations')
        .select('id, user_a, user_b, initiated_by, accepted_at, created_at')
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as DmConversation[];
      if (rows.length === 0) return [];
      const otherIds = rows.map((row) => (row.user_a === userId ? row.user_b : row.user_a));
      const peopleReq = supabase.from('profiles').select('id, display_name, display_tag, current_xp, exam_id, exam_year, target_score').in('id', otherIds);
      const mediaReq = supabase
        .from('dm_messages')
        .select('id, conversation_id, sender_id, body, created_at, kind, image_path, media_id')
        .in('conversation_id', rows.map((row) => row.id))
        .order('created_at', { ascending: false });
      const [{ data: people }, mediaRes] = await Promise.all([peopleReq, mediaReq]);
      const messages =
        mediaRes.error && /kind|image_path|media_id/i.test(mediaRes.error.message)
          ? (
              await supabase
                .from('dm_messages')
                .select('id, conversation_id, sender_id, body, created_at')
                .in('conversation_id', rows.map((row) => row.id))
                .order('created_at', { ascending: false })
            ).data
          : mediaRes.data;
      const profileMap = new Map(((people ?? []) as SocialProfile[]).map((item) => [item.id, item]));
      const lastMap = new Map<string, DmMessage>();
      for (const message of (messages ?? []) as DmMessage[]) {
        if (!lastMap.has(message.conversation_id)) lastMap.set(message.conversation_id, message);
      }
      return rows.map((row) => {
        const otherId = row.user_a === userId ? row.user_b : row.user_a;
        return {
          conversation: row,
          other: profileMap.get(otherId) ?? null,
          lastMessage: lastMap.get(row.id) ?? null,
        };
      });
    },
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['dm-messages', conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const full = await getSupabase()
        .from('dm_messages')
        .select('id, conversation_id, sender_id, body, created_at, kind, image_path, image_width, image_height, media_id')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true });
      const { data, error } =
        full.error && /kind|image_path|media_id/i.test(full.error.message)
          ? await getSupabase()
              .from('dm_messages')
              .select('id, conversation_id, sender_id, body, created_at')
              .eq('conversation_id', conversationId!)
              .order('created_at', { ascending: true })
          : full;
      if (error) throw error;
      return (data ?? []) as DmMessage[];
    },
  });
}

export function useConversationWith(otherId: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['dm-with', userId, otherId],
    enabled: Boolean(userId && otherId),
    queryFn: async () => {
      const a = userId! < otherId! ? userId! : otherId!;
      const b = userId! < otherId! ? otherId! : userId!;
      const { data, error } = await getSupabase()
        .from('dm_conversations')
        .select('id, user_a, user_b, initiated_by, accepted_at, created_at')
        .eq('user_a', a)
        .eq('user_b', b)
        .maybeSingle();
      if (error) throw error;
      return (data as DmConversation | null) ?? null;
    },
  });
}

export function usePublishPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      body: string;
      subjectId?: string | null;
      minutes?: 30 | 60 | 120 | 240;
      intent?: 'status' | 'study_partner' | 'goal';
      goal?: string;
    }) => {
      const kind =
        input.intent === 'study_partner' ? 'ask' : input.intent === 'goal' ? 'activity' : 'status';
      const args: {
        p_body: string;
        p_subject_id: string | null;
        p_minutes: number;
        p_kind?: string;
        p_goal?: string;
      } = {
        p_body: input.body.trim(),
        p_subject_id: input.subjectId ?? null,
        p_minutes: input.minutes ?? 60,
      };
      if (kind !== 'status') args.p_kind = kind;
      if (input.goal) args.p_goal = input.goal;
      const { error } = await getSupabase().rpc('publish_status', args);
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['social-posts'] }),
  });
}

export function useOpenRooms() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['open-rooms', userId],
    enabled: Boolean(userId),
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_open_rooms');
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as OpenRoom[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = getSupabase()
      .channel(`open-rooms-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_session_members' }, () => {
        void client.invalidateQueries({ queryKey: ['open-rooms'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_sessions' }, () => {
        void client.invalidateQueries({ queryKey: ['open-rooms'] });
      })
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [client, userId]);

  return query;
}

export function useTogglePostLike() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await getSupabase().rpc('toggle_post_like', { p_post: postId });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['social-posts'] }),
  });
}

export function useAddPostComment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { postId: string; body: string; parentId?: string | null }) => {
      const args: { p_post: string; p_body: string; p_parent?: string } = {
        p_post: input.postId,
        p_body: input.body,
      };
      if (input.parentId) args.p_parent = input.parentId;
      const { error } = await getSupabase().rpc('add_post_comment', args);
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['social-posts'] });
      void client.invalidateQueries({ queryKey: ['post-comments'] });
    },
  });
}

export function usePostComments(postId: string | null) {
  return useQuery({
    queryKey: ['post-comments', postId],
    enabled: Boolean(postId),
    refetchInterval: postId ? 12000 : false,
    queryFn: async () => {
      const supabase = getSupabase();
      const userId = useAuthStore.getState().session?.user.id;
      const { data, error } = await supabase
        .from('post_comments')
        .select('id, post_id, user_id, body, created_at, parent_id')
        .eq('post_id', postId!)
        .lte('created_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(80);
      if (error) throw error;
      const rows = (data ?? []) as PostComment[];
      const userIds = [...new Set(rows.map((row) => row.user_id))];
      const commentIds = rows.map((row) => row.id);
      if (userIds.length === 0) return rows;
      const [{ data: people }, likesRes] = await Promise.all([
        supabase.from('profiles').select('id, display_name, display_tag, is_bot').in('id', userIds),
        commentIds.length
          ? supabase.from('post_comment_likes').select('comment_id, user_id').in('comment_id', commentIds)
          : Promise.resolve({ data: [] as { comment_id: string; user_id: string }[] }),
      ]);
      const names = new Map(
        (
          (people ?? []) as {
            id: string;
            display_name: string;
            display_tag?: number | null;
            is_bot?: boolean;
          }[]
        ).map((item) => [item.id, item]),
      );
      const likeRows = (likesRes.data ?? []) as { comment_id: string; user_id: string }[];
      const likeCount = new Map<string, number>();
      const liked = new Set<string>();
      for (const row of likeRows) {
        likeCount.set(row.comment_id, (likeCount.get(row.comment_id) ?? 0) + 1);
        if (row.user_id === userId) liked.add(row.comment_id);
      }
      return rows.map((row) => ({
        ...row,
        display_name: names.get(row.user_id)?.display_name,
        display_tag: names.get(row.user_id)?.display_tag,
        is_bot: names.get(row.user_id)?.is_bot,
        like_count: likeCount.get(row.id) ?? 0,
        liked_by_me: liked.has(row.id),
      }));
    },
  });
}

export function useToggleCommentLike() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await getSupabase().rpc('toggle_comment_like', { p_comment: commentId });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['post-comments'] }),
  });
}

export function useMyExamGroups() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['exam-groups', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('exam_chat_members')
        .select('slug')
        .eq('user_id', userId!);
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.slug as string));
    },
  });
}

export function useJoinExamGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      const { error } = await getSupabase().rpc('join_exam_group', { p_slug: slug });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['exam-groups'] }),
  });
}

export function useGroupMessages(slug: string | null) {
  return useQuery({
    queryKey: ['group-messages', slug],
    enabled: Boolean(slug),
    refetchInterval: 4000,
    queryFn: async () => {
      const supabase = getSupabase();
      await supabase.rpc('pulse_exam_chats');
      void supabase.rpc('cleanup_chat_image_uploads');
      const withMedia = await supabase
        .from('exam_chat_messages')
        .select('id, slug, sender_id, body, created_at, reply_to_id, kind, image_path, image_width, image_height, media_id')
        .eq('slug', slug!)
        .lte('created_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(80);
      const withReply =
        withMedia.error && /kind|image_path|media_id/i.test(withMedia.error.message)
          ? await supabase
              .from('exam_chat_messages')
              .select('id, slug, sender_id, body, created_at, reply_to_id')
              .eq('slug', slug!)
              .lte('created_at', new Date().toISOString())
              .order('created_at', { ascending: true })
              .limit(80)
          : withMedia;
      const result =
        withReply.error && /reply_to_id/i.test(withReply.error.message)
          ? await supabase
              .from('exam_chat_messages')
              .select('id, slug, sender_id, body, created_at')
              .eq('slug', slug!)
              .lte('created_at', new Date().toISOString())
              .order('created_at', { ascending: true })
              .limit(80)
          : withReply;
      if (result.error) throw result.error;
      const rows = (result.data ?? []) as GroupMessage[];
      const ids = [...new Set(rows.map((row) => row.sender_id))];
      if (ids.length === 0) return rows;
      const { data: people } = await supabase
        .from('profiles')
        .select('id, display_name, display_tag, is_bot')
        .in('id', ids);
      const names = new Map(
        (
          (people ?? []) as {
            id: string;
            display_name: string;
            display_tag?: number | null;
            is_bot?: boolean;
          }[]
        ).map((item) => [item.id, item]),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      return rows.map((row) => {
        const reply = row.reply_to_id ? byId.get(row.reply_to_id) : undefined;
        return {
          ...row,
          display_name: names.get(row.sender_id)?.display_name,
          display_tag: names.get(row.sender_id)?.display_tag,
          is_bot: names.get(row.sender_id)?.is_bot,
          reply_name: reply ? names.get(reply.sender_id)?.display_name ?? reply.display_name : undefined,
          reply_body: reply ? chatPreview(reply) || reply.body : undefined,
        };
      });
    },
  });
}

export function useSendGroupMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      slug: string;
      body: string;
      mediaId?: string | null;
      imagePath?: string | null;
      width?: number | null;
      height?: number | null;
      replyTo?: string | null;
    }) => {
      const args: Record<string, unknown> = { p_slug: input.slug, p_body: input.body };
      if (input.mediaId) {
        args.p_media_id = input.mediaId;
        args.p_image_width = input.width ?? null;
        args.p_image_height = input.height ?? null;
      } else if (input.imagePath) {
        args.p_image_path = input.imagePath;
        args.p_image_width = input.width ?? null;
        args.p_image_height = input.height ?? null;
      }
      if (input.replyTo) args.p_reply_to = input.replyTo;
      const first = await getSupabase().rpc('send_group_message', args);
      if (first.error && (input.mediaId || input.imagePath) && /schema cache|could not find|p_image|p_media/i.test(first.error.message)) {
        throw new Error('Fotoğraf henüz açık değil. SQL’i yapıştırıp tekrar dene.');
      }
      if (first.error) throw new Error(mapSocialError(first.error.message));
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['group-messages'] });
      void client.invalidateQueries({ queryKey: ['group-rooms'] });
      void client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}

export function useGroupRooms() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['group-rooms', userId],
    enabled: Boolean(userId),
    refetchInterval: 8000,
    queryFn: async () => {
      const supabase = getSupabase();
      await supabase.rpc('ensure_my_exam_groups');
      const { data, error } = await supabase
        .from('exam_chat_messages')
        .select('id, slug, sender_id, body, created_at')
        .in('slug', ['tyt', 'ayt', 'kpss'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const last = new Map<string, GroupMessage>();
      for (const row of (data ?? []) as GroupMessage[]) {
        if (!last.has(row.slug)) last.set(row.slug, row);
      }
      return last;
    },
  });
}

export function useStories() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['stories', userId],
    enabled: Boolean(userId),
    refetchInterval: 60000,
    queryFn: async () => {
      const supabase = getSupabase();
      try {
        await supabase.functions.invoke('ai', { body: { action: 'pulseBotStory', payload: {} } });
      } catch {
        // Bot görseli yoksa akış yine açılır.
      }
      const { data, error } = await supabase.rpc('get_stories');
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as StoryItem[];
    },
  });
}

export function usePublishStory() {
  const client = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (input: { base64: string; caption?: string }) => {
      if (!userId) throw new Error('UNAUTHORIZED');
      const path = `${userId}/${Date.now()}.jpg`;
      const { error: uploadError } = await getSupabase().storage.from('stories').upload(path, decodeBase64(input.base64), {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data } = getSupabase().storage.from('stories').getPublicUrl(path);
      const { error } = await getSupabase().rpc('publish_story', {
        p_image_url: data.publicUrl,
        p_caption: input.caption ?? '',
      });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['stories'] }),
  });
}

export function useRequestFriend() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (otherId: string) => {
      const { data, error } = await getSupabase().rpc('request_friend', { p_other: otherId });
      if (error) throw new Error(mapSocialError(error.message));
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['friendships'] }),
  });
}

export function useRespondFriend() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { otherId: string; accept: boolean }) => {
      const { error } = await getSupabase().rpc('respond_friend', {
        p_other: input.otherId,
        p_accept: input.accept,
      });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['friendships'] }),
  });
}

export function useBlockUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (otherId: string) => {
      const { error } = await getSupabase().rpc('block_user', { p_other: otherId });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['friendships'] });
      void client.invalidateQueries({ queryKey: ['social-posts'] });
      void client.invalidateQueries({ queryKey: ['dm-conversations'] });
      void client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}

export function useReportUser() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (input: { otherId: string; reason: string }) => {
      const { error } = await getSupabase().from('reports').insert({
        reporter_user_id: userId,
        reported_user_id: input.otherId,
        reason: input.reason,
      });
      if (error) throw error;
    },
  });
}

export function useReportContent() {
  return useMutation({
    mutationFn: async (input: {
      type: 'status' | 'room_message' | 'comment' | 'group_message' | 'dm_message';
      contentId: string;
      reason: 'kufur' | 'taciz' | 'spam' | 'uygunsuz' | 'diger' | 'cinsel' | 'siddet';
    }) => {
      const { error } = await getSupabase().rpc('report_content', {
        p_type: input.type,
        p_content_id: input.contentId,
        p_reason: input.reason,
      });
      if (error) throw new Error(mapSocialError(error.message));
    },
  });
}

export function useDeleteOwnPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await getSupabase().rpc('delete_own_post', { p_post: postId });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['social-posts'] }),
  });
}

export function useUpdateOwnPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { postId: string; body: string }) => {
      const { error } = await getSupabase().rpc('update_own_post', {
        p_post: input.postId,
        p_body: input.body,
      });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['social-posts'] }),
  });
}

export function useSendDm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      otherId: string;
      body: string;
      mediaId?: string | null;
      imagePath?: string | null;
      width?: number | null;
      height?: number | null;
    }) => {
      const args: Record<string, unknown> = { p_other: input.otherId, p_body: input.body };
      if (input.mediaId) {
        args.p_media_id = input.mediaId;
        args.p_image_width = input.width ?? null;
        args.p_image_height = input.height ?? null;
      } else if (input.imagePath) {
        args.p_image_path = input.imagePath;
        args.p_image_width = input.width ?? null;
        args.p_image_height = input.height ?? null;
      }
      const { data, error } = await getSupabase().rpc('send_dm', args);
      if (error && (input.mediaId || input.imagePath) && /schema cache|could not find|p_image|p_media/i.test(error.message)) {
        throw new Error('Fotoğraf henüz açık değil. SQL’i yapıştırıp tekrar dene.');
      }
      if (error) throw new Error(mapSocialError(error.message));
      return data as string;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dm-conversations'] });
      void client.invalidateQueries({ queryKey: ['dm-with'] });
      void client.invalidateQueries({ queryKey: ['dm-messages'] });
      void client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}

export function useDeleteOwnChatMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scope: 'dm' | 'group'; id: string }) => {
      const { error } = await getSupabase().rpc('delete_own_chat_message', {
        p_scope: input.scope,
        p_id: input.id,
      });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dm-messages'] });
      void client.invalidateQueries({ queryKey: ['group-messages'] });
      void client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}

export function useAcceptDm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await getSupabase().rpc('accept_dm', { p_conversation_id: conversationId });
      if (error) throw new Error(mapSocialError(error.message));
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dm-conversations'] });
      void client.invalidateQueries({ queryKey: ['dm-with'] });
      void client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}

export function usePublicProfile(userId: string | null) {
  return useQuery({
    queryKey: ['public-profile', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, display_tag, current_xp, exam_id, exam_year, exam_date, target_score, daily_minutes, league_tier, bio')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      let examName: string | null = null;
      if (data.exam_id) {
        const exam = await supabase.from('exams').select('name').eq('id', data.exam_id).maybeSingle();
        examName = (exam.data as { name?: string } | null)?.name ?? null;
      }
      return {
        ...(data as SocialProfile & {
          exam_date: string | null;
          daily_minutes: number | null;
          league_tier: string | null;
        }),
        exam_name: examName,
      };
    },
  });
}

export function useUserPosts(userId: string | null) {
  return useQuery({
    queryKey: ['user-posts', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('social_posts')
        .select('id, user_id, body, kind, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as Pick<SocialPost, 'id' | 'user_id' | 'body' | 'kind' | 'created_at'>[];
    },
  });
}

export function friendState(
  friendships: Friendship[] | undefined,
  me: string | undefined,
  otherId: string,
): 'none' | 'incoming' | 'outgoing' | 'friends' {
  const row = (friendships ?? []).find(
    (item) =>
      (item.requester_id === me && item.addressee_id === otherId) ||
      (item.requester_id === otherId && item.addressee_id === me),
  );
  if (!row || !me) return 'none';
  if (row.status === 'accepted') return 'friends';
  if (row.requester_id === me) return 'outgoing';
  return 'incoming';
}

export function useGroupMembers(slug: string | null) {
  return useQuery({
    queryKey: ['group-members', slug],
    enabled: Boolean(slug),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('exam_chat_members')
        .select('user_id, joined_at')
        .eq('slug', slug!)
        .limit(24);
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.user_id as string);
      if (ids.length === 0) return [];
      const profiles = await getSupabase()
        .from('profiles')
        .select('id, display_name, display_tag')
        .in('id', ids);
      const byId = new Map((profiles.data ?? []).map((row) => [row.id as string, row]));
      return (data ?? []).map((row) => {
        const profile = byId.get(row.user_id as string);
        return {
          user_id: row.user_id as string,
          display_name: (profile?.display_name as string | undefined) ?? 'Öğrenci',
          display_tag: (profile?.display_tag as number | null | undefined) ?? null,
        };
      });
    },
  });
}
