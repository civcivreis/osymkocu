import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { applyXpAward } from '@/src/features/progress/xp';
import type { SystemExamListItem, SystemExamPlay } from '@/src/features/system-exams/examTime';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

const CLIENT_KEY = 'kocum.systemExamClient';

export async function examClientId() {
  const existing = await AsyncStorage.getItem(CLIENT_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  await AsyncStorage.setItem(CLIENT_KEY, id);
  return id;
}

function rpcMissing(message: string) {
  return /could not find|schema cache|does not exist|function/i.test(message);
}

export function useSystemExams(tab: 'upcoming' | 'live' | 'past') {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['system-exams', tab, userId],
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_system_exams', { p_tab: tab });
      if (error) {
        if (rpcMissing(error.message)) return [] as SystemExamListItem[];
        throw error;
      }
      return (data ?? []) as SystemExamListItem[];
    },
  });
}

export function useUpcomingSystemExam() {
  const query = useSystemExams('upcoming');
  return { ...query, data: query.data?.[0] ?? null };
}

export function useToggleExamSignup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (examId: string) => {
      const { data, error } = await getSupabase().rpc('toggle_system_exam_signup', { p_exam: examId });
      if (error) throw error;
      return data as { reminded: boolean };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['system-exams'] }),
  });
}

export function useStartSystemExam() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (examId: string) => {
      const clientId = await examClientId();
      const { data, error } = await getSupabase().rpc('start_system_exam', {
        p_exam: examId,
        p_client_id: clientId,
      });
      if (error) throw error;
      return data as SystemExamPlay;
    },
    onSuccess: async () => {
      if (userId) await fetchAuthExtras(userId);
    },
  });
}

export function useSystemExamPlay(attemptId: string | null) {
  return useQuery({
    queryKey: ['system-exam-play', attemptId],
    enabled: Boolean(attemptId),
    refetchInterval: (query) => (query.state.data?.attempt.status === 'in_progress' ? 12_000 : false),
    queryFn: async () => {
      const clientId = await examClientId();
      const { data, error } = await getSupabase().rpc('get_system_exam_play', {
        p_attempt: attemptId,
        p_client_id: clientId,
      });
      if (error) throw error;
      return data as SystemExamPlay;
    },
  });
}

export function useSaveSystemExamAnswer() {
  return useMutation({
    mutationFn: async (input: {
      attemptId: string;
      questionId: string;
      option: string | null;
      marked?: boolean;
      index?: number;
    }) => {
      const clientId = await examClientId();
      const { data, error } = await getSupabase().rpc('save_system_exam_answer', {
        p_attempt: input.attemptId,
        p_question: input.questionId,
        p_option: input.option,
        p_marked: input.marked ?? null,
        p_index: input.index ?? null,
        p_client_id: clientId,
      });
      if (error) throw error;
      return data as { ok: boolean; remaining_seconds: number };
    },
  });
}

export function useSubmitSystemExam() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data, error } = await getSupabase().rpc('submit_system_exam', { p_attempt: attemptId });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: async () => {
      applyXpAward({ awarded: true, amount: 25 }, 'Sistem sınavı tamamlandı');
      await client.invalidateQueries({ queryKey: ['system-exams'] });
      if (userId) await fetchAuthExtras(userId);
    },
  });
}

export function useSystemExamResult(attemptId: string | null) {
  return useQuery({
    queryKey: ['system-exam-result', attemptId],
    enabled: Boolean(attemptId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_system_exam_result', { p_attempt: attemptId });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
  });
}

export function useSystemExamLeaderboard(examId: string | null) {
  return useQuery({
    queryKey: ['system-exam-board', examId],
    enabled: Boolean(examId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('system_exam_leaderboard', { p_exam: examId });
      if (error) throw error;
      return data as {
        ready: boolean;
        mine?: number | null;
        top: { rank: number; display_name: string; display_tag?: number | null; score: number; is_me: boolean }[];
        nearby: { rank: number; display_name: string; display_tag?: number | null; score: number; is_me: boolean }[];
      };
    },
  });
}

export function useSystemExamProfileStats(userId: string | null) {
  return useQuery({
    queryKey: ['system-exam-stats', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('system_exam_profile_stats', { p_user: userId });
      if (error) {
        if (rpcMissing(error.message)) return { count: 0, best_percentile: null, last_net: null };
        throw error;
      }
      return data as { count: number; best_percentile: number | null; last_net: number | null };
    },
  });
}

export function useSetExamReminders() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await getSupabase().rpc('set_system_exam_reminders', { p_enabled: enabled });
      if (error) throw error;
    },
    onSuccess: async () => {
      if (userId) await fetchAuthExtras(userId);
    },
  });
}

export function mapExamError(message: string) {
  if (message.includes('EXAM_NOT_LIVE')) return 'Sınav henüz başlamadı veya süresi doldu.';
  if (message.includes('ATTEMPT_ACTIVE_ELSEWHERE')) return 'Bu sınav başka bir cihazda açık.';
  if (message.includes('ATTEMPT_LOCKED')) return 'Sınav kaydı kilitlendi.';
  if (message.includes('EXAM_TIME_UP')) return 'Süre doldu, sınav gönderildi.';
  if (message.includes('ACCOUNT_RESTRICTED')) return 'Hesabın kısıtlı. Sınava giremezsin.';
  if (message.includes('EXAM_HOUR')) return 'Sınav yalnızca 20:00–22:00 arasında yayınlanabilir.';
  if (message.includes('ADMIN_ONLY')) return 'Bu işlem için admin yetkisi gerekir.';
  if (message.includes('EXAM_LOCKED')) return 'Katılım başladı, soru seti kilitli.';
  return message;
}
