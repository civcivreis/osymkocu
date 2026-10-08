import { useQuery } from '@tanstack/react-query';

import { fetchGlobalXpLeaderboard, fetchUserXpSummary, fetchWeeklyXpLeaderboard } from '@/src/features/progress/xpBoard';
import { useAuthStore } from '@/src/stores/authStore';

export function useWeeklyXpLeaderboard(limit = 5, examOnly = false) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const examId = useAuthStore((s) => s.profile?.exam_id);
  return useQuery({
    queryKey: ['xp-weekly-board', userId, limit, examOnly ? examId : null],
    enabled: Boolean(userId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => fetchWeeklyXpLeaderboard(limit, examOnly ? examId : null),
  });
}

export function useGlobalXpLeaderboard(limit = 20, examOnly = false) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const examId = useAuthStore((s) => s.profile?.exam_id);
  return useQuery({
    queryKey: ['xp-global-board', userId, limit, examOnly ? examId : null],
    enabled: Boolean(userId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => fetchGlobalXpLeaderboard(limit, examOnly ? examId : null),
  });
}

export function useXpSummary(userId?: string | null) {
  const me = useAuthStore((s) => s.session?.user.id);
  const id = userId ?? me;
  return useQuery({
    queryKey: ['xp-summary', id],
    enabled: Boolean(id),
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: () => fetchUserXpSummary(id),
  });
}
