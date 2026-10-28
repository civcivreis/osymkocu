import { getSupabase } from '@/src/lib/supabase/client';

import { getLessonMediaUrls, getMemoryLessonBySlug, getMemoryLessonQuestions, getMemoryLessonScenes } from './memoryLessonApi';
import type { MemoryLesson, MemoryLessonQuestion, MemoryLessonScene } from './types';

export type LessonProgressRow = {
  last_position_ms: number;
  completion_percent: number;
  completed: boolean;
  narration_completed?: boolean;
  checkpoint_correct?: number;
  checkpoint_total?: number;
};

export type CheckpointAnswerRow = {
  checkpoint_question_id: string;
  selected_answer: string;
  correct: boolean;
};

export type ReviewQueueItem = {
  id: string;
  lesson_id: string;
  canonical_topic_id: string;
  review_type: string;
  scheduled_at: string;
  status: string;
  lesson_title?: string;
  topic?: string;
  subject?: string;
};

export type StudentLessonCard = {
  canonical_topic_id: string;
  subject_name: string;
  unit_name: string;
  topic_name: string;
  sort_order: number;
  lesson_id: string | null;
  lesson_title: string | null;
  lesson_slug: string | null;
  narration_completed?: boolean | null;
  last_position_ms?: number | null;
  mastery_score?: number | null;
  next_review_at?: string | null;
  review_due?: boolean;
  recommended_rank?: number | null;
  reason_code?: string | null;
  prereq_title?: string | null;
  frequency_ready?: boolean;
};

export type ReviewAnchor = {
  id: string;
  lesson_id: string;
  scene_id: string | null;
  code: string;
  memory_target: string;
  visual_anchor: string;
  recall_prompt: string | null;
  sort_order: number;
};

export async function getPublishedMemoryLesson(id: string): Promise<MemoryLesson | null> {
  const { data, error } = await getSupabase()
    .from('memory_lessons')
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw error;
  return (data as MemoryLesson | null) ?? null;
}

export async function getPublishedMemoryLessonBySlug(slug: string): Promise<MemoryLesson | null> {
  const lesson = await getMemoryLessonBySlug(slug);
  if (!lesson || lesson.status !== 'published') return null;
  return lesson;
}

export async function getStudentLessonMediaUrls(lessonId: string) {
  return getLessonMediaUrls(lessonId);
}

export async function getReviewAnchors(lessonId: string): Promise<ReviewAnchor[]> {
  const { data, error } = await getSupabase()
    .from('memory_lesson_review_anchors')
    .select('id, lesson_id, scene_id, code, memory_target, visual_anchor, recall_prompt, sort_order')
    .eq('lesson_id', lessonId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as ReviewAnchor[];
}

export async function getLessonProgress(lessonId: string): Promise<LessonProgressRow | null> {
  const { data, error } = await getSupabase()
    .from('memory_lesson_progress')
    .select('last_position_ms, completion_percent, completed, narration_completed, checkpoint_correct, checkpoint_total')
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (error) throw error;
  return (data as LessonProgressRow | null) ?? null;
}

export async function getCheckpointAnswers(lessonId: string): Promise<CheckpointAnswerRow[]> {
  const { data, error } = await getSupabase()
    .from('memory_lesson_checkpoint_answers')
    .select('checkpoint_question_id, selected_answer, correct')
    .eq('lesson_id', lessonId);
  if (error) throw error;
  return (data ?? []) as CheckpointAnswerRow[];
}

export async function touchLessonProgress(lessonId: string, positionMs: number, durationMs?: number) {
  const { error } = await getSupabase().rpc('touch_memory_lesson_progress', {
    p_lesson: lessonId,
    p_position_ms: positionMs,
    p_duration_ms: durationMs ?? null,
  });
  if (error) throw error;
}

export async function submitCheckpoint(input: {
  lessonId: string;
  questionId: string;
  answer: string;
  anchorId?: string | null;
}) {
  const { data, error } = await getSupabase().rpc('submit_lesson_checkpoint', {
    p_lesson: input.lessonId,
    p_question: input.questionId,
    p_answer: input.answer,
    p_anchor: input.anchorId ?? null,
  });
  if (error) throw error;
  return data as {
    duplicate?: boolean;
    retry?: boolean;
    correct: boolean;
    selected_answer: string;
    correct_answer: string;
    explanation?: string | null;
  };
}

export async function completeNarration(lessonId: string) {
  const { data, error } = await getSupabase().rpc('complete_memory_lesson_narration', { p_lesson: lessonId });
  if (error) throw error;
  return data as { ok?: boolean; xp?: { awarded?: boolean; amount?: number } };
}

export async function completeLessonFinal(input: {
  lessonId: string;
  correct: number;
  total: number;
  objectives: { id?: string; title?: string; correct: number; attempted: number }[];
  anchors: { visual_anchor: string; correct: number; attempted: number }[];
}) {
  const { data, error } = await getSupabase().rpc('complete_memory_lesson_final', {
    p_lesson: input.lessonId,
    p_correct: input.correct,
    p_total: input.total,
    p_objectives: input.objectives,
    p_anchors: input.anchors,
  });
  if (error) throw error;
  return data as { accuracy?: number; scheduled?: boolean };
}

export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const { data, error } = await getSupabase().rpc('get_student_review_queue');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ReviewQueueItem[];
}

export async function completeReview(id: string) {
  const { data, error } = await getSupabase().rpc('complete_memory_review', { p_id: id });
  if (error) throw error;
  return data as { ok?: boolean; already?: boolean; xp?: { awarded?: boolean; amount?: number } };
}

export async function getStudentLessonCards(examId: string, mode = 'recommended'): Promise<StudentLessonCard[]> {
  const { data, error } = await getSupabase().rpc('get_student_lesson_cards', {
    p_exam_id: examId,
    p_mode: mode,
  });
  if (error) throw error;
  const payload = data && typeof data === 'object' && 'topics' in (data as object) ? (data as { topics: unknown }).topics : data;
  return (Array.isArray(payload) ? payload : []) as StudentLessonCard[];
}

export async function getLessonPrereqWarning(lessonId: string) {
  const { data, error } = await getSupabase().rpc('get_lesson_prereq_warning', { p_lesson: lessonId });
  if (error) throw error;
  return (data as { prereq_title?: string } | null) ?? null;
}

export async function getTodayStudyRecommendations(examId: string) {
  const { data, error } = await getSupabase().rpc('get_today_study_recommendations', { p_exam_id: examId });
  if (error) throw error;
  const items = (data as { items?: StudentLessonCard[] } | null)?.items;
  return Array.isArray(items) ? items : [];
}

export type PackageReview = {
  packageId: string;
  title: string;
  isLast: boolean;
  position: number;
  total: number;
  questions: MemoryLessonQuestion[];
};

async function questionsForLessonIds(lessonIds: string[], limit = 5): Promise<MemoryLessonQuestion[]> {
  if (!lessonIds.length) return [];
  const { data: questions } = await getSupabase()
    .from('memory_lesson_questions')
    .select('*')
    .in('lesson_id', lessonIds)
    .order('question_order', { ascending: true });
  const picked: MemoryLessonQuestion[] = [];
  const seen = new Set<string>();
  for (const q of (questions ?? []) as MemoryLessonQuestion[]) {
    if (seen.has(q.lesson_id)) continue;
    seen.add(q.lesson_id);
    picked.push(q);
    if (picked.length >= limit) break;
  }
  return picked;
}

export async function getPackageReviewForLesson(lessonId: string): Promise<PackageReview | null> {
  const supabase = getSupabase();
  const { data: lesson, error: lessonError } = await supabase
    .from('memory_lessons')
    .select('id, canonical_topic_id, unit_id, topic_id')
    .eq('id', lessonId)
    .maybeSingle();
  if (lessonError || !lesson) return null;

  if (lesson.canonical_topic_id) {
    const { data: membership } = await supabase
      .from('lesson_package_items')
      .select('package_id, sort_order')
      .eq('canonical_topic_id', lesson.canonical_topic_id)
      .maybeSingle();
    if (membership) {
      const { data: items } = await supabase
        .from('lesson_package_items')
        .select('canonical_topic_id, sort_order')
        .eq('package_id', membership.package_id)
        .order('sort_order', { ascending: true });
      const list = items ?? [];
      const index = list.findIndex((row) => row.canonical_topic_id === lesson.canonical_topic_id);
      const position = index + 1;
      const total = list.length;
      const isLast = total > 0 && index === total - 1;
      const { data: pack } = await supabase
        .from('lesson_packages')
        .select('id, title, review_question_count, status')
        .eq('id', membership.package_id)
        .maybeSingle();
      const title = pack?.title ?? 'Paket';
      if (!isLast || pack?.status !== 'published') {
        return { packageId: membership.package_id, title, isLast, position, total, questions: [] };
      }
      const topicIds = list.map((row) => row.canonical_topic_id);
      const { data: lessons } = await supabase
        .from('memory_lessons')
        .select('id, canonical_topic_id')
        .eq('status', 'published')
        .in('canonical_topic_id', topicIds);
      const questions = await questionsForLessonIds(
        (lessons ?? []).map((row) => row.id),
        Number(pack.review_question_count ?? 5),
      );
      return { packageId: pack.id, title, isLast: true, position, total, questions };
    }
  }

  if (!lesson.unit_id) return { packageId: lesson.unit_id ?? lessonId, title: 'Paket', isLast: false, position: 1, total: 1, questions: [] };
  const { data: siblings } = await supabase
    .from('memory_lessons')
    .select('id, topic_id, created_at')
    .eq('unit_id', lesson.unit_id)
    .eq('status', 'published')
    .order('created_at', { ascending: true });
  const list = siblings ?? [];
  const index = list.findIndex((row) => row.id === lessonId);
  if (index < 0) return null;
  const packStart = Math.floor(index / 5) * 5;
  const pack = list.slice(packStart, packStart + 5);
  const position = index - packStart + 1;
  const total = pack.length;
  const isLast = position === total;
  if (!isLast) {
    return { packageId: `${lesson.unit_id}-${packStart}`, title: 'Paket', isLast: false, position, total, questions: [] };
  }
  const questions = await questionsForLessonIds(pack.map((row) => row.id), 5);
  return { packageId: `${lesson.unit_id}-${packStart}`, title: 'Paket', isLast: true, position, total, questions };
}

export async function getLessonCues(lessonId: string) {
  const { data, error } = await getSupabase()
    .from('lesson_timeline_events')
    .select('event_type, appear_at_ms, payload')
    .eq('lesson_id', lessonId)
    .order('appear_at_ms');
  if (error) throw error;
  return data ?? [];
}

export async function getNextLessonCountdown(): Promise<number> {
  const { data } = await getSupabase().from('app_runtime_settings').select('*').eq('id', 1).maybeSingle();
  const value = Number((data as { default_next_lesson_countdown?: number } | null)?.default_next_lesson_countdown);
  return Number.isFinite(value) && value >= 5 && value <= 30 ? value : 10;
}

export async function getNextPublishedLesson(lessonId: string, examId: string) {
  const { data, error } = await getSupabase().rpc('get_next_published_memory_lesson', {
    p_lesson: lessonId,
    p_exam_id: examId,
  });
  if (error) throw error;
  return (data as { lesson_id: string; lesson_title: string; topic_name: string; canonical_topic_id: string } | null) ?? null;
}

export async function logLessonStarted(lessonId: string) {
  await getSupabase().rpc('log_memory_lesson_started', { p_lesson: lessonId }).then(() => undefined, () => undefined);
}

export async function loadPlayerPackage(lessonId: string) {
  const [lesson, scenes, questions, anchors, progress, answers] = await Promise.all([
    getPublishedMemoryLesson(lessonId),
    getMemoryLessonScenes(lessonId),
    getMemoryLessonQuestions(lessonId),
    getReviewAnchors(lessonId),
    getLessonProgress(lessonId),
    getCheckpointAnswers(lessonId),
  ]);
  return { lesson, scenes, questions, anchors, progress, answers };
}

export function checkpointQuestions(questions: MemoryLessonQuestion[]) {
  return questions.filter((row) => row.question_type === 'checkpoint').sort((a, b) => a.question_order - b.question_order);
}

export function sceneAtPosition(scenes: MemoryLessonScene[], positionMs: number) {
  const ordered = [...scenes].sort((a, b) => a.start_ms - b.start_ms);
  if (!ordered.length) return null;
  return ordered.find((scene) => positionMs >= scene.start_ms && positionMs < scene.end_ms) ?? ordered[ordered.length - 1];
}
