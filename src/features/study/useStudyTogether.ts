import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { retainChannel } from '@/src/lib/realtime/retainChannel';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

export type AppNotification = {
  id: string;
  kind:
    | 'study_invite'
    | 'study_accepted'
    | 'study_ended'
    | 'study_offer'
    | 'study_match_found'
    | 'study_match_accepted'
    | 'study_match_declined'
    | 'study_request'
    | 'study_request_accepted'
    | 'study_request_declined'
    | 'race_invite'
    | 'race_accepted'
    | 'exam_lobby'
    | 'exam_started'
    | 'room_kicked'
    | 'room_invite'
    | 'follow'
    | 'new_follower'
    | 'post_like'
    | 'post_comment'
    | 'system_exam_reminder'
    | 'system_exam_live'
    | 'admin_broadcast'
    | 'account_warning'
    | 'message'
    | 'system';
  payload: {
    invite_id?: string;
    offer_id?: string;
    session_id?: string;
    from_user?: string;
    from_name?: string;
    from_tag?: number;
    subject_id?: string;
    subject_name?: string;
    topic_name?: string;
    exam_id?: string;
    title?: string;
    body?: string;
    slot?: string;
    status?: string;
    expires_at?: string;
    post_id?: string;
  };
  read_at: string | null;
  created_at: string;
};

export type StudyRoomState = {
  id: string;
  subject_id: string;
  subject_name: string | null;
  status: 'waiting' | 'countdown' | 'active' | 'reveal' | 'ended';
  mode: 'study' | 'race' | 'exam' | 'test';
  host_id: string | null;
  title: string | null;
  chat_enabled: boolean;
  capacity: number;
  member_count: number;
  starts_at: string | null;
  question_deadline: string | null;
  current_index: number;
  total: number;
  question: {
    id: string;
    stem: string;
    choices: Record<string, string> | null;
    difficulty: string;
    correct_choice: string | null;
    explanation: string | null;
  } | null;
  answers: {
    user_id: string;
    selected_choice: string;
    is_correct: boolean | null;
  }[];
  members: { user_id: string; display_name: string }[];
  scores: { user_id: string; display_name: string; correct: number }[];
};

export type StudyRoomMessage = {
  id: string;
  session_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function mapStudyError(message: string): string {
  if (message.includes('REACTION_LIMIT')) return 'Bu mesaja en fazla 3 tepki verebilirsin.';
  if (message.includes('BAD_EMOJI')) return 'Bu tepki kullanılamıyor.';
  if (message.includes('PENDING_EXISTS')) return 'Bu kişiyle zaten bekleyen bir istek var.';
  if (message.includes('NO_QUESTIONS')) return 'Bu derste henüz soru yok.';
  if (message.includes('EXPIRED')) return 'İstek süresi doldu.';
  if (message.includes('BLOCKED')) return 'Bu kişiyle çalışma kapalı.';
  if (message.includes('SUBJECT_NOT_FOUND')) return 'Ders bulunamadı.';
  if (message.includes('FULL')) return 'Oda doldu.';
  if (message.includes('ROOM_BANNED')) return 'Bu odaya 30 dakika giremezsin.';
  if (message.includes('ROOM_KICKED')) return 'Topluluk kuralları nedeniyle bu odadan çıkarıldın.';
  if (message.includes('MESSAGE_BLOCKED')) return 'Bu içerik topluluk kurallarına uygun değil.';
  if (message.includes('REPORT_COOLDOWN')) return 'Şikâyeti biraz sonra tekrar dene.';
  if (message.includes('SELF_REPORT')) return 'Kendini şikâyet edemezsin.';
  if (message.includes('NOT_IN_ROOM')) return 'Bu odada değilsin.';
  if (message.includes('NEED_TWO')) return 'En az 2 kişi lazım.';
  if (message.includes('ALREADY_STARTED')) return 'Sınav başlamış.';
  if (message.includes('INVALID_CAPACITY')) return 'Oda 2, 5 veya 10 kişilik olmalı.';
  if (message.includes('INVALID_MODE')) return 'Ders, test veya sınav odası seç.';
  if (message.includes('BOT_NO_STUDY')) return 'Şu an müsait değil. Sınav veya yarışma odasına katıl.';
  if (message.includes('BAD_PASSWORD')) return 'Oda şifresi yanlış.';
  if (message.includes('PRIVATE_ROOM')) return 'Bu oda özel. Şifre veya davet gerekir.';
  return message;
}

export function useNotifications() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const rpc = await getSupabase().rpc('list_my_notifications');
      if (!rpc.error && Array.isArray(rpc.data)) {
        return (rpc.data as AppNotification[]).map((row) => ({
          ...row,
          payload: row.payload ?? {},
        }));
      }
      const { data, error } = await getSupabase()
        .from('notifications')
        .select('id, kind, payload, read_at, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) {
        if (/schema cache|does not exist|permission/i.test(error.message)) return [] as AppNotification[];
        throw error;
      }
      return ((data ?? []) as AppNotification[]).map((row) => ({ ...row, payload: row.payload ?? {} }));
    },
  });

  const unread = (query.data ?? []).filter((item) => !item.read_at).length;

  const markRead = useMutation({
    mutationFn: async (id?: string) => {
      let q = getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId!);
      if (id) q = q.eq('id', id);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return { ...query, unread, markRead };
}

export function useRequestStudy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { otherId: string; subjectId: string; postId?: string | null; topicId?: string | null }) => {
      const { data, error } = await getSupabase().rpc('request_study', {
        p_other: input.otherId,
        p_subject_id: input.subjectId,
        p_post_id: input.postId ?? null,
        p_topic_id: input.topicId ?? null,
      });
      if (error) throw new Error(mapStudyError(error.message));
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useRequestRace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { otherId: string; subjectId: string }) => {
      const { data, error } = await getSupabase().rpc('request_race', {
        p_other: input.otherId,
        p_subject_id: input.subjectId,
      });
      if (error) throw new Error(mapStudyError(error.message));
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useCreateOpenRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      subjectId: string;
      kind: 'study' | 'test' | 'exam';
      capacity: 2 | 5 | 10;
      title?: string;
      password?: string;
      isPrivate?: boolean;
      chatEnabled?: boolean;
    }) => {
      const { data, error } = await getSupabase().rpc('create_open_room', {
        p_subject_id: input.subjectId,
        p_kind: input.kind,
        p_capacity: input.capacity,
        p_title: input.title ?? null,
        p_password: input.password ?? null,
        p_is_private: input.isPrivate ?? false,
        p_chat_enabled: input.chatEnabled ?? true,
      });
      if (error) throw new Error(mapStudyError(error.message));
      return data as string;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['social-posts'] });
      void client.invalidateQueries({ queryKey: ['exam-banner'] });
      void client.invalidateQueries({ queryKey: ['open-rooms'] });
    },
  });
}

export function useCreateExamLobby() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { subjectId: string; capacity: 5 | 10 }) => {
      const { data, error } = await getSupabase().rpc('create_exam_lobby', {
        p_subject_id: input.subjectId,
        p_capacity: input.capacity,
      });
      if (error) throw new Error(mapStudyError(error.message));
      return data as string;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['social-posts'] });
      void client.invalidateQueries({ queryKey: ['exam-banner'] });
      void client.invalidateQueries({ queryKey: ['open-rooms'] });
    },
  });
}

export function useJoinExamLobby() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { sessionId: string; password?: string }) => {
      const sessionId = typeof input === 'string' ? input : input.sessionId;
      const password = typeof input === 'string' ? undefined : input.password;
      const { data, error } = await getSupabase().rpc('join_exam_lobby', {
        p_session_id: sessionId,
        p_password: password ?? null,
      });
      if (error) throw new Error(mapStudyError(error.message));
      return data as StudyRoomState;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['exam-banner'] });
      void client.invalidateQueries({ queryKey: ['open-rooms'] });
      void client.invalidateQueries({ queryKey: ['study-room'] });
    },
  });
}

export function useStartExamLobby() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await getSupabase().rpc('start_exam_lobby', { p_session_id: sessionId });
      if (error) throw new Error(mapStudyError(error.message));
      return data as StudyRoomState;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['exam-banner'] }),
  });
}

export function useExamBanner() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['exam-banner', userId],
    enabled: Boolean(userId),
    refetchInterval: 4000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('my_exam_banner');
      if (error) throw error;
      return (data ?? null) as null | {
        session_id: string;
        status: string;
        mode: string;
        host_id: string;
        capacity: number;
        member_count: number;
        subject_name: string;
        starts_at: string | null;
      };
    },
  });
  useEffect(() => {
    if (!userId) return;
    return retainChannel(`exam-banner:${userId}`, (channel) =>
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'study_sessions' }, () => {
        void client.invalidateQueries({ queryKey: ['exam-banner', userId] });
      }),
    );
  }, [client, userId]);
  return query;
}

export function useRespondStudy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inviteId: string; accept: boolean }) => {
      const { data, error } = await getSupabase().rpc('respond_study', {
        p_invite_id: input.inviteId,
        p_accept: input.accept,
      });
      if (error) throw new Error(mapStudyError(error.message));
      return data as string | null;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useStudyRoom(sessionId: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();

  const query = useQuery({
    queryKey: ['study-room', sessionId],
    enabled: Boolean(sessionId),
    refetchInterval: 2000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_study_room', { p_session_id: sessionId });
      if (error) throw new Error(mapStudyError(error.message));
      const room = (data ?? {}) as StudyRoomState;
      return {
        ...room,
        mode: room.mode ?? 'study',
        title: room.title ?? null,
        chat_enabled: room.chat_enabled !== false,
        capacity: room.capacity ?? 2,
        member_count: room.member_count ?? room.members?.length ?? 0,
        scores: room.scores ?? [],
        answers: room.answers ?? [],
        members: room.members ?? [],
      };
    },
  });

  useEffect(() => {
    if (!sessionId) return;
    return retainChannel(`study-room:${sessionId}`, (channel) =>
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'study_sessions', filter: `id=eq.${sessionId}` },
          () => {
            void client.invalidateQueries({ queryKey: ['study-room', sessionId] });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'study_session_answers', filter: `session_id=eq.${sessionId}` },
          () => {
            void client.invalidateQueries({ queryKey: ['study-room', sessionId] });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'study_session_members', filter: `session_id=eq.${sessionId}` },
          () => {
            void client.invalidateQueries({ queryKey: ['study-room', sessionId] });
          },
        ),
    );
  }, [client, sessionId]);

  const submit = useMutation({
    mutationFn: async (choice: string) => {
      const { data, error } = await getSupabase().rpc('submit_room_answer', {
        p_session_id: sessionId,
        p_choice: choice,
      });
      if (error) throw new Error(mapStudyError(error.message));
      return data as StudyRoomState;
    },
    onSuccess: (data) => client.setQueryData(['study-room', sessionId], data),
  });

  const advance = useMutation({
    mutationFn: async () => {
      const { data, error } = await getSupabase().rpc('advance_room_question', { p_session_id: sessionId });
      if (error) throw new Error(mapStudyError(error.message));
      return data as StudyRoomState;
    },
    onSuccess: (data) => client.setQueryData(['study-room', sessionId], data),
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await getSupabase().rpc('leave_study_session', { p_session_id: sessionId });
      if (error) throw error;
    },
  });

  return { ...query, submit, advance, leave, userId };
}

export function useStudyRoomMessages(sessionId: string | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['study-room-messages', sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('study_session_messages')
        .select('id, session_id, sender_id, body, created_at')
        .eq('session_id', sessionId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as StudyRoomMessage[];
    },
  });

  useEffect(() => {
    if (!sessionId) return;
    return retainChannel(`study-chat:${sessionId}`, (channel) =>
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'study_session_messages', filter: `session_id=eq.${sessionId}` },
        () => {
          void client.invalidateQueries({ queryKey: ['study-room-messages', sessionId] });
        },
      ),
    );
  }, [client, sessionId]);

  const send = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await getSupabase().rpc('send_room_message', {
        p_session_id: sessionId,
        p_body: body.trim(),
      });
      if (error) throw new Error(mapStudyError(error.message));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['study-room-messages', sessionId] }),
  });

  return { ...query, send };
}

export function useReportRoomUser() {
  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      reportedUserId: string;
      reason: 'kufur' | 'taciz' | 'spam' | 'uygunsuz' | 'diger';
      messageId?: string | null;
    }) => {
      const { error } = await getSupabase().rpc('report_room_user', {
        p_session_id: input.sessionId,
        p_reported: input.reportedUserId,
        p_reason: input.reason,
        p_message_id: input.messageId ?? null,
      });
      if (error) throw new Error(mapStudyError(error.message));
    },
  });
}
