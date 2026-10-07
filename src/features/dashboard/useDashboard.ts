import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { applyXpAward, type XpAwardResult } from '@/src/features/progress/xp';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { getSupabase } from '@/src/lib/supabase/client';
import type { Exam, Streak, StudyPlan, StudyTask } from '@/src/lib/supabase/types';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';
import { useAuthStore } from '@/src/stores/authStore';

type PlanRow = Omit<StudyPlan, 'study_tasks'> & {
  study_tasks: StudyTask[] | null;
};

async function fetchTodayPlan(userId: string): Promise<StudyPlan | null> {
  const today = todayIsoIstanbul();
  const supabase = getSupabase();

  const load = async () => {
    const { data, error } = await supabase
      .from('study_plans')
      .select(
        'id, user_id, plan_date, target_questions, target_minutes, generated_by, summary, study_tasks(*)',
      )
      .eq('user_id', userId)
      .eq('plan_date', today)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as PlanRow;
    const tasks = [...(row.study_tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    return { ...row, study_tasks: tasks };
  };

  const existing = await load();
  if (existing) return existing;

  const { error } = await supabase.rpc('generate_today_plan');
  if (error) throw error;
  return load();
}

export function useTodayPlan() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useQuery({
    queryKey: ['today-plan', userId, todayIsoIstanbul()],
    enabled: Boolean(userId),
    queryFn: () => fetchTodayPlan(userId!),
  });
}

export function useStreak() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useQuery({
    queryKey: ['streak', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('streaks')
        .select('user_id, current_streak, longest_streak, last_completed_date, freeze_count')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Streak | null) ?? null;
    },
  });
}

export function useExamName() {
  const examId = useAuthStore((s) => s.profile?.exam_id);

  return useQuery({
    queryKey: ['exam-name', examId],
    enabled: Boolean(examId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('exams')
        .select('name')
        .eq('id', examId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as Pick<Exam, 'name'> | null)?.name) ?? null;
    },
  });
}

export function useCompleteTask() {
  const client = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (taskId: string) => {
      const { data, error } = await getSupabase().rpc('complete_study_task', { p_task_id: taskId });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      AnalyticsProvider.track('study_task_completed');
      const payload = data as { task?: XpAwardResult; daily?: unknown } | null;
      applyXpAward(payload?.task, 'Görev tamamlandı');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['today-plan'] }),
        client.invalidateQueries({ queryKey: ['streak'] }),
      ]);
      if (userId) {
        await fetchAuthExtras(userId);
      }
    },
  });
}

export function useTodayAttempts() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const today = todayIsoIstanbul();

  return useQuery({
    queryKey: ['today-attempts', userId, today],
    enabled: Boolean(userId),
    queryFn: async () => {
      const start = `${today}T00:00:00+03:00`;
      const supabase = getSupabase();
      const primary = await supabase
        .from('question_attempts')
        .select('id, mode, questions(subject_id)')
        .eq('user_id', userId!)
        .gte('created_at', start);
      if (!primary.error) {
        return (primary.data ?? []) as Array<{
          id: string;
          mode: string | null;
          questions: { subject_id: string } | { subject_id: string }[] | null;
        }>;
      }
      const fallback = await supabase
        .from('question_attempts')
        .select('id, questions(subject_id)')
        .eq('user_id', userId!)
        .gte('created_at', start);
      if (fallback.error) throw fallback.error;
      return (fallback.data ?? []).map((row) => ({ ...row, mode: 'practice' })) as Array<{
        id: string;
        mode: string | null;
        questions: { subject_id: string } | { subject_id: string }[] | null;
      }>;
    },
  });
}

export function taskSolvedCount(
  task: StudyTask,
  attempts: Array<{
    id: string;
    mode: string | null;
    questions: { subject_id: string } | { subject_id: string }[] | null;
  }>,
) {
  const subjectOf = (row: (typeof attempts)[number]) => {
    const q = row.questions;
    if (!q) return null;
    return Array.isArray(q) ? q[0]?.subject_id : q.subject_id;
  };

  if (task.kind === 'review' || (!task.subject_id && task.title.toLowerCase().includes('yanlış'))) {
    return attempts.filter((row) => row.mode === 'review').length;
  }
  if (task.kind === 'mock' || (!task.subject_id && task.title.toLowerCase().includes('deneme'))) {
    return attempts.length;
  }
  if (task.subject_id) {
    return attempts.filter((row) => subjectOf(row) === task.subject_id).length;
  }
  return 0;
}

export function planProgress(
  plan: StudyPlan | null,
  attempts: Array<{ id: string }> = [],
) {
  const tasks = plan?.study_tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'completed');
  const doneQuestions = attempts.length;
  const targetQuestions = plan?.target_questions ?? 0;
  const ratio = tasks.length === 0 ? 0 : completed.length / tasks.length;
  return {
    doneQuestions,
    targetQuestions,
    completedCount: completed.length,
    totalCount: tasks.length,
    allDone: tasks.length > 0 && completed.length === tasks.length,
    ratio: targetQuestions > 0 ? Math.min(1, doneQuestions / targetQuestions) : ratio,
  };
}

function isoDaysAgo(days: number) {
  const today = todayIsoIstanbul();
  const date = new Date(`${today}T12:00:00+03:00`);
  date.setDate(date.getDate() - days);
  return todayIsoIstanbul(date);
}

export function useWeeklyStats() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useQuery({
    queryKey: ['weekly-stats', userId, todayIsoIstanbul()],
    enabled: Boolean(userId),
    queryFn: async () => {
      const from = `${isoDaysAgo(13)}T00:00:00+03:00`;
      const { data, error } = await getSupabase()
        .from('question_attempts')
        .select('id, created_at, time_spent_ms')
        .eq('user_id', userId!)
        .gte('created_at', from);
      if (error) throw error;
      const rows = (data ?? []) as { id: string; created_at: string; time_spent_ms?: number | null }[];
      const byDay = new Map<string, { count: number; ms: number }>();
      for (const row of rows) {
        const day = todayIsoIstanbul(new Date(row.created_at));
        const current = byDay.get(day) ?? { count: 0, ms: 0 };
        current.count += 1;
        current.ms += row.time_spent_ms ?? 0;
        byDay.set(day, current);
      }
      const thisDays = Array.from({ length: 7 }, (_, i) => isoDaysAgo(6 - i));
      const prevDays = Array.from({ length: 7 }, (_, i) => isoDaysAgo(13 - i));
      const sum = (days: string[]) =>
        days.reduce(
          (acc, day) => {
            const row = byDay.get(day);
            return { count: acc.count + (row?.count ?? 0), ms: acc.ms + (row?.ms ?? 0), active: acc.active + (row?.count ? 1 : 0) };
          },
          { count: 0, ms: 0, active: 0 },
        );
      const current = sum(thisDays);
      const previous = sum(prevDays);
      const bars = thisDays.map((day) => byDay.get(day)?.count ?? 0);
      const delta =
        previous.count > 0 ? Math.round(((current.count - previous.count) / previous.count) * 100) : null;
        return { current, previous, bars, days: thisDays, delta };
    },
  });
}
