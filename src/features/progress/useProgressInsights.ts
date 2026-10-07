import { useQuery } from '@tanstack/react-query';

import type { ProgressInsights, WrongInsight } from '@/src/features/progress/insights';
import { getSupabase } from '@/src/lib/supabase/client';
import { isMissingRpcError, isRpcMissing, markRpcMissing } from '@/src/lib/supabase/rpcStatus';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';
import { useAuthStore } from '@/src/stores/authStore';

function emptyInsights(): ProgressInsights {
  return {
    topics: [],
    priorities: [],
    weekly: {
      questions: 0,
      ms: 0,
      accuracy: null,
      activeDays: 0,
      questionDelta: null,
      accuracyDelta: null,
      strongest: null,
      weakest: null,
      bars: [0, 0, 0, 0, 0, 0, 0],
    },
    wrong: { open: 0, mastered: 0, bySubject: [], byTopic: [] },
  };
}

export function useProgressInsights() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useQuery({
    queryKey: ['progress-insights', userId, todayIsoIstanbul()],
    enabled: Boolean(userId),
    retry: (count, error) => count < 1 && !isMissingRpcError(error as { message?: string }),
    queryFn: async () => {
      if (isRpcMissing('get_progress_insights')) return emptyInsights();
      const { data, error } = await getSupabase().rpc('get_progress_insights');
      if (error) {
        if (isMissingRpcError(error)) {
          markRpcMissing('get_progress_insights');
          return emptyInsights();
        }
        throw error;
      }
      const row = (data ?? {}) as Record<string, unknown>;
      const empty = emptyInsights();
      const weekly = (row.weekly ?? {}) as Record<string, unknown>;
      const wrong = (row.wrong ?? {}) as Record<string, unknown>;
      return {
        topics: (row.topics as ProgressInsights['topics']) ?? empty.topics,
        priorities: (row.priorities as ProgressInsights['priorities']) ?? empty.priorities,
        weekly: {
          ...empty.weekly,
          questions: Number(weekly.questions ?? 0),
          ms: Number(weekly.ms ?? 0),
          accuracy: weekly.accuracy == null ? null : Number(weekly.accuracy),
          activeDays: Number(weekly.activeDays ?? weekly.active_days ?? 0),
          questionDelta:
            weekly.questionDelta == null && weekly.question_delta == null
              ? null
              : Number(weekly.questionDelta ?? weekly.question_delta),
          accuracyDelta:
            weekly.accuracyDelta == null && weekly.accuracy_delta == null
              ? null
              : Number(weekly.accuracyDelta ?? weekly.accuracy_delta),
          strongest: (weekly.strongest as string | null) ?? null,
          weakest: (weekly.weakest as string | null) ?? null,
          bars: Array.isArray(weekly.bars) ? weekly.bars.map((n) => Number(n) || 0) : empty.weekly.bars,
        },
        wrong: {
          open: Number(wrong.open ?? 0),
          mastered: Number(wrong.mastered ?? 0),
          bySubject: (wrong.bySubject ?? wrong.by_subject ?? empty.wrong.bySubject) as WrongInsight['bySubject'],
          byTopic: (wrong.byTopic ?? wrong.by_topic ?? empty.wrong.byTopic) as WrongInsight['byTopic'],
        },
      } satisfies ProgressInsights;
    },
  });
}
