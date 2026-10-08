import { getSupabase } from '@/src/lib/supabase/client';

function invokeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const err = (payload as { error?: { message?: string } }).error;
    if (err?.message) return new Error(err.message);
  }
  return new Error(fallback);
}

export async function getTopicQuestionSummary(canonicalTopicId: string) {
  const { data, error } = await getSupabase().rpc('admin_topic_question_summary', { p_canonical_topic_id: canonicalTopicId });
  if (error) throw error;
  return data as {
    lesson: string;
    total: number;
    easy: number;
    medium: number;
    hard: number;
    approved: number;
    needs_review: number;
    generated: number;
    published: number;
    final_count: number;
    checkpoint_count: number;
    pool_count: number;
    pool_target: number;
    objectives: { id: string; title: string; count: number }[];
  };
}

export async function listTopicQuestions(canonicalTopicId: string, status?: string | null) {
  const { data, error } = await getSupabase().rpc('admin_list_topic_questions', {
    p_canonical_topic_id: canonicalTopicId,
    p_status: status ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    stem: string;
    choices: Record<string, string> | null;
    correct_choice: string | null;
    explanation: string | null;
    difficulty: string;
    question_strategy: string | null;
    question_status: string;
    source_type: string;
    image_url: string | null;
    set_type: string | null;
    is_published: boolean;
  }>;
}

export async function setQuestionStatus(id: string, status: string) {
  const { data, error } = await getSupabase().rpc('admin_set_question_status', { p_id: id, p_status: status });
  if (error) throw error;
  return data;
}

export async function generateTopicQuestions(input: {
  mode: 'topic_pool' | 'exam_specific' | 'missing_coverage' | 'lesson_sync';
  canonical_topic_id: string;
  curriculum_version_id?: string | null;
  exam_catalog_id?: string | null;
  memory_lesson_id?: string | null;
  count?: number;
}) {
  const invoked = await getSupabase().functions.invoke('question-generate', { body: input });
  if (invoked.error) throw invokeError(invoked.data, 'Soru üretilemedi.');
  return invoked.data as { inserted?: number; skipped?: number; published?: boolean };
}

export async function getCurriculumPracticeQuestions(input: {
  examCatalogId: string;
  canonicalTopicId?: string | null;
  setType?: string;
  limit?: number;
  memoryLessonId?: string | null;
}) {
  const { data, error } = await getSupabase().rpc('get_curriculum_practice_questions', {
    p_exam_catalog_id: input.examCatalogId,
    p_canonical_topic_id: input.canonicalTopicId ?? null,
    p_set_type: input.setType ?? 'topic_pool',
    p_limit: input.limit ?? 10,
    p_memory_lesson_id: input.memoryLessonId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    stem: string;
    choices: Record<string, string>;
    correct_choice: string;
    explanation: string | null;
    difficulty: string;
    image_url: string | null;
    canonical_topic_id: string;
    topic_name: string;
    learning_objective_id?: string | null;
    objective_title?: string | null;
    question_strategy?: string | null;
  }>;
}
