import { getSupabase } from '@/src/lib/supabase/client';

import type { GuidedNext, TimelineEvent } from './types';

export async function startGuidedSession(examId: string | null, mode: 'solo' | 'friend' = 'solo') {
  const { data, error } = await getSupabase().rpc('start_guided_session', { p_exam: examId, p_mode: mode });
  if (error) throw error;
  return data as { session: { id: string }; display_name: string };
}

export async function fetchGuidedNext(sessionId: string) {
  const { data, error } = await getSupabase().rpc('study_session_next', { p_session: sessionId });
  if (error) throw error;
  return data as GuidedNext;
}

export async function actGuided(sessionId: string, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await getSupabase().rpc('study_session_act', {
    p_session: sessionId,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw error;
  return data as GuidedNext;
}

export async function recordGuidedAttempt(input: {
  sessionId: string;
  selected: string;
  correctAnswer: string;
  isCorrect: boolean;
  memoryQuestionId?: string | null;
  questionId?: string | null;
  lessonId?: string | null;
  pattern?: string | null;
  ms?: number;
}) {
  const { data, error } = await getSupabase().rpc('record_guided_attempt', {
    p_session: input.sessionId,
    p_selected: input.selected,
    p_correct_answer: input.correctAnswer,
    p_is_correct: input.isCorrect,
    p_memory_question: input.memoryQuestionId ?? null,
    p_question: input.questionId ?? null,
    p_lesson: input.lessonId ?? null,
    p_pattern: input.pattern ?? null,
    p_objective: input.pattern ?? null,
    p_ms: input.ms ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; correct: boolean; xp?: { awarded?: boolean; amount?: number } };
}

export async function fetchLessonTimeline(lessonId: string) {
  await getSupabase().rpc('ensure_lesson_timeline', { p_lesson: lessonId });
  const { data, error } = await getSupabase()
    .from('lesson_timeline_events')
    .select('id, lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, related_question_id')
    .eq('lesson_id', lessonId)
    .order('appear_at_ms', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TimelineEvent[];
}

export async function saveStudyPrefs(patch: Record<string, unknown>) {
  const { data, error } = await getSupabase().rpc('save_study_preferences', { p_patch: patch });
  if (error) throw error;
  return data;
}
