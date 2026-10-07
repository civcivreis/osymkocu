import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTodayPlan } from '@/src/features/dashboard/useDashboard';
import { useProgressInsights } from '@/src/features/progress/useProgressInsights';
import { ExamLobbyBanner } from '@/src/features/study/ExamLobbyBanner';
import { CoachFab } from '@/src/features/teacher/CoachFab';
import { CoachOverlay } from '@/src/features/teacher/CoachOverlay';
import { COACH_HELP_NUDGE_SECONDS, coachBottomOffset } from '@/src/features/teacher/coachLayout';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { useTeacher } from '@/src/features/teacher/useTeacher';
import { TEACHER_WELCOME } from '@/src/features/teacher/welcome';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

const TAB_PATHS = new Set(['/home', '/study', '/social', '/messages', '/profile']);

export function CoachHost() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const userId = useAuthStore((s) => s.session?.user.id);
  const examId = useAuthStore((s) => s.profile?.exam_id);
  const teacher = useTeacher();
  const planQuery = useTodayPlan();
  const insightsQuery = useProgressInsights();
  const hydrated = useCoachStore((s) => s.hydrated);
  const hintsEnabled = useCoachStore((s) => s.hintsEnabled);
  const questionId = useCoachStore((s) => s.screenContext.questionId);
  const selectedAnswer = useCoachStore((s) => s.screenContext.selectedAnswer);
  const onTabs = TAB_PATHS.has(pathname);
  const examLock = pathname === '/system-exam';
  const extraFab = pathname === '/study' ? 10 : 0;
  const bottomOffset = coachBottomOffset(insets.bottom, onTabs, extraFab);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!userId) {
      useCoachStore.getState().reset();
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || teacher.historyLoading || hydrated) return;
    useCoachStore.getState().hydrate(teacher.history.length ? teacher.history : [TEACHER_WELCOME]);
  }, [hydrated, teacher.history, teacher.historyLoading, userId]);

  useEffect(() => {
    let examType: string | undefined;
    const apply = (slug?: string) => {
      useCoachStore.getState().setRouteMeta({ route: pathname, examType: slug });
    };
    if (!examId) {
      apply(undefined);
      return;
    }
    void getSupabase()
      .from('exams')
      .select('slug')
      .eq('id', examId)
      .maybeSingle()
      .then(({ data }) => {
        examType = data?.slug;
        apply(examType);
      });
  }, [examId, pathname]);

  useEffect(() => {
    const insights = insightsQuery.data;
    const plan = planQuery.data;
    const weak = (insights?.priorities ?? [])
      .map((row) => `${row.topic} (${row.subject}, %${row.accuracy})`)
      .join('; ');
    const weekly = insights?.weekly;
    const weeklySummary =
      weekly && weekly.questions > 0
        ? `${weekly.questions} soru, ${weekly.activeDays} gün${weekly.accuracy != null ? `, %${weekly.accuracy}` : ''}${
            weekly.weakest ? `, zayıf ${weekly.weakest}` : ''
          }`
        : undefined;
    const tasks = plan?.study_tasks ?? [];
    const done = tasks.filter((task) => task.status === 'completed').length;
    useCoachStore.getState().setProgressContext({
      weakTopics: weak || undefined,
      openWrongs: insights?.wrong.open || undefined,
      planPct: tasks.length ? Math.round((done / tasks.length) * 100) : undefined,
      weeklySummary,
    });
  }, [insightsQuery.data, planQuery.data]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const store = useCoachStore.getState();
    store.setQuestionIdleMs(0);
    if (!questionId || selectedAnswer || !hintsEnabled) {
      store.setHelpOffer(false);
      return undefined;
    }
    if (store.helpShownIds.includes(questionId)) return undefined;

    let elapsed = 0;
    let last = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      const state = useCoachStore.getState();
      const paused =
        appState.current !== 'active' ||
        state.open ||
        state.coachLocked ||
        Boolean(state.screenContext.selectedAnswer) ||
        state.screenContext.questionId !== questionId;
      if (!paused) {
        elapsed += now - last;
        state.setQuestionIdleMs(elapsed);
        if (elapsed >= COACH_HELP_NUDGE_SECONDS * 1000) {
          if (!state.helpShownIds.includes(questionId)) {
            state.markHintShown(questionId);
          }
          clearInterval(tick);
        }
      }
      last = now;
    }, 250);

    return () => clearInterval(tick);
  }, [hintsEnabled, questionId, selectedAnswer]);

  if (!userId || examLock) return null;

  return (
    <>
      <ExamLobbyBanner />
      <CoachFab bottomOffset={bottomOffset} />
      <CoachOverlay bottomOffset={bottomOffset} />
    </>
  );
}
