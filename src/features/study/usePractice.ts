import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { applyXpAward, getLevelFromXp, type XpAwardResult } from '@/src/features/progress/xp';
import { useXpFeedbackStore } from '@/src/features/progress/xpFeedbackStore';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { choiceKeys, shuffle } from '@/src/lib/practice/shuffle';
import { getSupabase } from '@/src/lib/supabase/client';
import type { AttemptResult, Question, Subject, WrongAnswer } from '@/src/lib/supabase/types';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';
import { useAuthStore } from '@/src/stores/authStore';

function nestName(value: { name?: string; slug?: string } | { name?: string; slug?: string }[] | null | undefined) {
  if (!value) return undefined;
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? row?.slug;
}

function mapQuestion(row: Question & {
  subjects?: { name?: string } | { name?: string }[] | null;
  topics?: { name?: string } | { name?: string }[] | null;
  exams?: { slug?: string } | { slug?: string }[] | null;
}): Question {
  return {
    ...row,
    subject_name: nestName(row.subjects) ?? row.subject_name,
    topic_name: nestName(row.topics) ?? row.topic_name,
    exam_slug: nestName(row.exams) ?? row.exam_slug,
  };
}

const QUESTION_SELECT =
  'id, exam_id, subject_id, topic_id, stem, choices, difficulty, image_url, subjects(name), topics(name), exams(slug)';
const QUESTION_SELECT_FALLBACK =
  'id, exam_id, subject_id, topic_id, stem, choices, difficulty, subjects(name), topics(name), exams(slug)';
function missingImageCol(message: string) {
  return /image_url/i.test(message);
}

export function useStudySubjects(examId: string | null) {
  return useQuery({
    queryKey: ['study-subjects', examId],
    enabled: Boolean(examId),
    queryFn: async () => {
      const supabase = getSupabase();
      const { data: exam, error: examError } = await supabase
        .from('exams')
        .select('id, slug, kind')
        .eq('id', examId!)
        .maybeSingle();
      if (examError) throw examError;

      let subjectQuery = supabase
        .from('subjects')
        .select('id, exam_id, slug, name, sort_order')
        .order('sort_order');

      if (exam?.kind === 'tyt_ayt') {
        const { data: related, error } = await supabase.from('exams').select('id').in('slug', ['tyt', 'ayt']);
        if (error) throw error;
        subjectQuery = subjectQuery.in(
          'exam_id',
          (related ?? []).map((row) => row.id),
        );
      } else {
        subjectQuery = subjectQuery.eq('exam_id', examId!);
      }

      const { data: subjects, error: subjectError } = await subjectQuery;
      if (subjectError) throw subjectError;

      const { data: questions, error: questionError } = await supabase
        .from('questions')
        .select('id, subject_id')
        .eq('is_published', true);
      if (questionError) throw questionError;

      const counts = new Map<string, number>();
      for (const row of questions ?? []) {
        counts.set(row.subject_id, (counts.get(row.subject_id) ?? 0) + 1);
      }

      return ((subjects ?? []) as Subject[]).map((subject) => ({
        ...subject,
        questionCount: counts.get(subject.id) ?? 0,
      }));
    },
  });
}

export function usePracticeQuestions(input: { subjectId?: string; review?: boolean; mixed?: boolean }) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const examId = useAuthStore((s) => s.profile?.exam_id);

  return useQuery({
    queryKey: ['practice-questions', input.subjectId, input.review, input.mixed, examId, userId],
    enabled: Boolean(input.review || input.subjectId || (input.mixed && examId)),
    queryFn: async () => {
      const supabase = getSupabase();

      if (input.mixed) {
        const { data: exam, error: examError } = await supabase
          .from('exams')
          .select('id, kind')
          .eq('id', examId!)
          .maybeSingle();
        if (examError) throw examError;
        let examIds = [examId!];
        if (exam?.kind === 'tyt_ayt') {
          const { data: related, error } = await supabase.from('exams').select('id').in('slug', ['tyt', 'ayt']);
          if (error) throw error;
          examIds = (related ?? []).map((row) => row.id);
        }
        const withImage = await supabase
          .from('questions')
          .select(QUESTION_SELECT)
          .eq('is_published', true)
          .in('exam_id', examIds)
          .limit(80);
        const mixedRows =
          withImage.error && missingImageCol(withImage.error.message)
            ? await supabase
                .from('questions')
                .select(QUESTION_SELECT_FALLBACK)
                .eq('is_published', true)
                .in('exam_id', examIds)
                .limit(80)
            : withImage;
        if (mixedRows.error) throw mixedRows.error;
        return shuffle((mixedRows.data ?? []).map((row) => mapQuestion(row as never))).slice(0, 10);
      }

      if (input.review) {
        const primary = await supabase
          .from('wrong_answers')
          .select(
            'question_id, next_review_at, mastered, questions(id, exam_id, subject_id, topic_id, stem, choices, difficulty, subjects(name), topics(name), exams(slug))',
          )
          .eq('user_id', userId!)
          .eq('mastered', false)
          .order('next_review_at');
        const { data, error } = primary.error
          ? await supabase
              .from('wrong_answers')
              .select(
                'question_id, next_review_at, questions(id, exam_id, subject_id, topic_id, stem, choices, difficulty, subjects(name), topics(name), exams(slug))',
              )
              .eq('user_id', userId!)
              .order('next_review_at')
          : primary;
        if (error) throw error;
        const now = Date.now();
        const mapped = (data ?? []).map((row) => {
          const due = Date.parse(String((row as { next_review_at?: string }).next_review_at ?? '')) <= now;
          const questions = (row as { questions?: Question | Question[] | null }).questions;
          const list = Array.isArray(questions) ? questions : questions ? [questions] : [];
          return list.map((item) => ({ due, question: mapQuestion(item as never) }));
        }).flat();
        const due = shuffle(mapped.filter((row) => row.due).map((row) => row.question));
        const later = shuffle(mapped.filter((row) => !row.due).map((row) => row.question));
        return [...due, ...later].slice(0, 10);
      }

      const withImage = await supabase
        .from('questions')
        .select(QUESTION_SELECT)
        .eq('is_published', true)
        .eq('subject_id', input.subjectId!)
        .limit(40);
      const subjectRows =
        withImage.error && missingImageCol(withImage.error.message)
          ? await supabase
              .from('questions')
              .select(QUESTION_SELECT_FALLBACK)
              .eq('is_published', true)
              .eq('subject_id', input.subjectId!)
              .limit(40)
          : withImage;
      if (subjectRows.error) throw subjectRows.error;
      return shuffle((subjectRows.data ?? []).map((row) => mapQuestion(row as never))).slice(0, 10);
    },
  });
}

export function useSubjectTopics(subjectId: string | null) {
  return useQuery({
    queryKey: ['subject-topics', subjectId],
    enabled: Boolean(subjectId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('topics')
        .select('id, subject_id, slug, name, sort_order')
        .eq('subject_id', subjectId!)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as { id: string; subject_id: string; slug: string; name: string; sort_order: number }[];
    },
  });
}

export function useWrongAnswers() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useQuery({
    queryKey: ['wrong-answers', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const primary = await getSupabase()
        .from('wrong_answers')
        .select(
          'id, question_id, subject_id, topic_id, user_answer, correct_answer, explanation, next_review_at, created_at, attempt_count, mastered, last_attempt_at, questions(stem, choices, difficulty), subjects(name), topics(name)',
        )
        .eq('user_id', userId!)
        .eq('mastered', false)
        .order('next_review_at', { ascending: true });
      if (!primary.error) return (primary.data ?? []) as unknown as WrongAnswer[];
      const { data, error } = await getSupabase()
        .from('wrong_answers')
        .select(
          'id, question_id, subject_id, topic_id, user_answer, correct_answer, explanation, next_review_at, created_at, questions(stem, choices, difficulty), subjects(name), topics(name)',
        )
        .eq('user_id', userId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as WrongAnswer[];
    },
  });
}

export function useCompleteLessonTopic() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (topicId: string) => {
      const { data, error } = await getSupabase().rpc('complete_lesson_topic', { p_topic_id: topicId });
      if (error) throw error;
      return data as XpAwardResult;
    },
    onSuccess: async (result) => {
      applyXpAward(result, 'Konu tamamlandı');
      if (userId) await fetchAuthExtras(userId);
    },
  });
}

export function useCompletePracticeSet() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (input: { setId: string; questionIds: string[] }) => {
      const { data, error } = await getSupabase().rpc('complete_practice_set', {
        p_set_id: input.setId,
        p_question_ids: input.questionIds,
      });
      if (error) throw error;
      return data as XpAwardResult;
    },
    onSuccess: async (result) => {
      applyXpAward(result, 'Test tamamlandı');
      if (userId) await fetchAuthExtras(userId);
    },
  });
}
export function useSubmitAttempt() {
  const client = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (input: { questionId: string; choice: string; timeSpentMs: number; mode?: 'practice' | 'review' }) => {
      const { data, error } = await getSupabase().rpc('submit_question_attempt', {
        p_question_id: input.questionId,
        p_selected_choice: input.choice,
        p_time_spent_ms: input.timeSpentMs,
        p_mode: input.mode ?? 'practice',
      });
      if (error) throw error;
      return data as AttemptResult;
    },
    onSuccess: async (result) => {
      AnalyticsProvider.track('question_answered', { correct: result.is_correct });
      if (!result.is_correct) AnalyticsProvider.track('wrong_question_saved');
      if (result.mastered) AnalyticsProvider.track('wrong_question_mastered');
      const prevXp = useAuthStore.getState().profile?.current_xp ?? 0;
      await Promise.all([
        client.invalidateQueries({ queryKey: ['wrong-answers'] }),
        client.invalidateQueries({ queryKey: ['study-subjects'] }),
        client.invalidateQueries({ queryKey: ['today-plan'] }),
        client.invalidateQueries({ queryKey: ['today-attempts'] }),
        client.invalidateQueries({ queryKey: ['streak'] }),
        client.invalidateQueries({ queryKey: ['study-hub'] }),
        client.invalidateQueries({ queryKey: ['progress-insights'] }),
        client.invalidateQueries({ queryKey: ['weekly-stats'] }),
      ]);
      if (userId) await fetchAuthExtras(userId);
      const nextXp = useAuthStore.getState().profile?.current_xp ?? prevXp;
      const nextLevel = getLevelFromXp(nextXp);
      if (nextLevel > getLevelFromXp(prevXp)) {
        useXpFeedbackStore.getState().showLevelUp(nextLevel);
      }
    },
  });
}

export function sortedChoices(choices: Record<string, string> | null | undefined) {
  return choiceKeys
    .filter((key) => Boolean(choices?.[key]))
    .map((key) => ({ key, label: choices![key] }));
}

export const LAST_LESSON_KEY = 'kocum.lastLesson';

export type LastLesson = {
  subjectId: string;
  subjectName: string;
  topicId?: string | null;
  topicName?: string | null;
};

export async function saveLastLesson(value: LastLesson) {
  await AsyncStorage.setItem(LAST_LESSON_KEY, JSON.stringify(value));
}

type HubTopic = { id: string; subject_id: string; name: string };
type HubAttempt = {
  id: string;
  is_correct: boolean | null;
  selected_choice: string | null;
  time_spent_ms: number | null;
  created_at: string;
  subject_id: string | null;
  topic_id: string | null;
};

function embedSubjectTopic(questions: unknown): { subject_id: string | null; topic_id: string | null } {
  const row = Array.isArray(questions) ? questions[0] : questions;
  if (!row || typeof row !== 'object') return { subject_id: null, topic_id: null };
  const item = row as { subject_id?: string | null; topic_id?: string | null };
  return { subject_id: item.subject_id ?? null, topic_id: item.topic_id ?? null };
}

export function useStudyHub(examId: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const subjectsQuery = useStudySubjects(examId);
  const subjects = subjectsQuery.data ?? [];
  const subjectIds = subjects.map((row) => row.id).join(',');

  const hubQuery = useQuery({
    queryKey: ['study-hub', userId, examId, subjectIds],
    enabled: Boolean(userId && examId && subjects.length),
    queryFn: async () => {
      const supabase = getSupabase();
      const ids = subjects.map((row) => row.id);
      const { data: topicRows, error: topicError } = await supabase
        .from('topics')
        .select('id, subject_id, name')
        .in('subject_id', ids)
        .order('sort_order');
      if (topicError) throw topicError;
      const topics = (topicRows ?? []) as HubTopic[];
      const topicById = new Map(topics.map((row) => [row.id, row]));
      const topicsBySubject = new Map<string, HubTopic[]>();
      for (const topic of topics) {
        const list = topicsBySubject.get(topic.subject_id) ?? [];
        list.push(topic);
        topicsBySubject.set(topic.subject_id, list);
      }

      let attempts: HubAttempt[] = [];
      const nested = await supabase
        .from('question_attempts')
        .select('id, is_correct, selected_choice, time_spent_ms, created_at, questions(subject_id, topic_id)')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false });

      const nestedRows = nested.error
        ? (
            await supabase
              .from('question_attempts')
              .select('id, is_correct, time_spent_ms, created_at, questions(subject_id, topic_id)')
              .eq('user_id', userId!)
              .order('created_at', { ascending: false })
          ).data
        : nested.data;

      attempts = (nestedRows ?? []).map((row) => {
        const embed = embedSubjectTopic((row as { questions?: unknown }).questions);
        return {
          id: row.id as string,
          is_correct: (row as { is_correct?: boolean | null }).is_correct ?? null,
          selected_choice: (row as { selected_choice?: string | null }).selected_choice ?? null,
          time_spent_ms: (row as { time_spent_ms?: number | null }).time_spent_ms ?? null,
          created_at: row.created_at as string,
          subject_id: embed.subject_id,
          topic_id: embed.topic_id,
        };
      });

      const todayStart = `${todayIsoIstanbul()}T00:00:00+03:00`;
      const todayAttempts = attempts.filter((row) => row.created_at >= todayStart);
      const todayTopicIds = new Set(
        todayAttempts.map((row) => row.topic_id).filter((id): id is string => Boolean(id)),
      );
      const todaySubjects = new Set(
        todayAttempts.map((row) => row.subject_id).filter((id): id is string => Boolean(id)),
      );
      const todayMinutes = Math.round(todayAttempts.reduce((sum, row) => sum + (row.time_spent_ms ?? 0), 0) / 60000);
      const todayCorrect = todayAttempts.filter((row) => row.is_correct === true).length;
      const todayWrong = todayAttempts.filter((row) => row.is_correct === false).length;
      const todayBlank = todayAttempts.filter((row) => !row.selected_choice).length;
      const todayAccuracy =
        todayAttempts.length > 0 ? Math.round((todayCorrect / todayAttempts.length) * 100) : null;

      const attemptedTopicsBySubject = new Map<string, Set<string>>();
      const lastTopicBySubject = new Map<string, string>();
      for (const row of attempts) {
        if (!row.subject_id) continue;
        const topic = row.topic_id ? topicById.get(row.topic_id) : undefined;
        if (topic && topic.subject_id === row.subject_id) {
          const set = attemptedTopicsBySubject.get(row.subject_id) ?? new Set<string>();
          set.add(topic.id);
          attemptedTopicsBySubject.set(row.subject_id, set);
          if (!lastTopicBySubject.has(row.subject_id)) lastTopicBySubject.set(row.subject_id, topic.id);
        }
      }

      let lastLesson: LastLesson | null = null;
      try {
        const raw = await AsyncStorage.getItem(LAST_LESSON_KEY);
        if (raw) lastLesson = JSON.parse(raw) as LastLesson;
      } catch {
        lastLesson = null;
      }
      if (!lastLesson && attempts[0]?.subject_id) {
        const subject = subjects.find((row) => row.id === attempts[0].subject_id);
        const topic = attempts[0].topic_id ? topicById.get(attempts[0].topic_id) : undefined;
        if (subject) {
          lastLesson = {
            subjectId: subject.id,
            subjectName: subject.name,
            topicId: topic?.id ?? null,
            topicName: topic?.name ?? null,
          };
        }
      }

      const subjectStats = subjects.map((subject) => {
        const subjectTopics = topicsBySubject.get(subject.id) ?? [];
        const attempted = attemptedTopicsBySubject.get(subject.id)?.size ?? 0;
        const lastId = lastTopicBySubject.get(subject.id);
        const ratio = subjectTopics.length > 0 ? attempted / subjectTopics.length : 0;
        return {
          ...subject,
          topicCount: subjectTopics.length,
          completedTopics: Math.min(attempted, subjectTopics.length),
          completion: ratio,
          lastTopicName: lastId ? topicById.get(lastId)?.name ?? null : null,
          topics: subjectTopics,
        };
      });

      const tracked = subjectStats.filter((row) => row.topicCount > 0);
      const totalTopics = tracked.reduce((sum, row) => sum + row.topicCount, 0);
      const completedTopics = tracked.reduce((sum, row) => sum + row.completedTopics, 0);
      const trackedIds = new Set(tracked.map((row) => row.id));
      const trackedAttempts = attempts.filter((row) => row.subject_id && trackedIds.has(row.subject_id));
      const totalMs = trackedAttempts.reduce((sum, row) => sum + (row.time_spent_ms ?? 0), 0);
      const hasDuration = trackedAttempts.some((row) => row.time_spent_ms != null);

      return {
        topics,
        today: {
          topicCount: todayTopicIds.size || todaySubjects.size,
          questions: todayAttempts.length,
          minutes: todayMinutes,
          correct: todayCorrect,
          wrong: todayWrong,
          blank: todayBlank,
          accuracy: todayAccuracy,
        },
        overall: {
          totalTopics,
          completedTopics,
          ratio: totalTopics > 0 ? completedTopics / totalTopics : 0,
          questions: trackedAttempts.length,
          ms: hasDuration ? totalMs : null,
        },
        lastLesson,
        subjectStats,
      };
    },
  });

  return { subjectsQuery, hubQuery };
}
