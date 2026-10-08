import { getSupabase } from '@/src/lib/supabase/client';

import type {
  MemoryLesson,
  MemoryLessonCreateInput,
  MemoryLessonMediaMode,
  MemoryLessonQuestion,
  MemoryLessonScene,
} from './types';

const PUBLISHED_FIELDS =
  'id, exam_type, subject, unit, topic, title, slug, description, version, duration_sec, status, thumbnail_key, published_at, created_at, updated_at';

function invokeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const err = (payload as { error?: { message?: string } }).error;
    if (err?.message) return new Error(err.message);
  }
  return new Error(fallback);
}

export async function getPublishedMemoryLessons(): Promise<MemoryLesson[]> {
  const { data, error } = await getSupabase()
    .from('memory_lessons')
    .select(PUBLISHED_FIELDS)
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MemoryLesson[];
}

export async function getMemoryLessonBySlug(slug: string): Promise<MemoryLesson | null> {
  const { data, error } = await getSupabase()
    .from('memory_lessons')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return (data as MemoryLesson | null) ?? null;
}

export async function getMemoryLessonScenes(lessonId: string): Promise<MemoryLessonScene[]> {
  const { data, error } = await getSupabase()
    .from('memory_lesson_scenes')
    .select('*')
    .eq('lesson_id', lessonId)
    .order('scene_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MemoryLessonScene[];
}

export async function getMemoryLessonQuestions(lessonId: string): Promise<MemoryLessonQuestion[]> {
  const { data, error } = await getSupabase()
    .from('memory_lesson_questions')
    .select('*')
    .eq('lesson_id', lessonId)
    .order('question_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MemoryLessonQuestion[];
}

export async function listAdminMemoryLessons(): Promise<MemoryLesson[]> {
  const { data, error } = await getSupabase()
    .from('memory_lessons')
    .select('id, title, subject, topic, exam_type, unit, version, status, created_at, updated_at, slug, generation_status, generation_error, media_generation_status, media_generation_error, pedagogy_score, lesson_scope')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MemoryLesson[];
}

export async function createMemoryLesson(input: MemoryLessonCreateInput): Promise<MemoryLesson> {
  const { data, error } = await getSupabase().functions.invoke('memory-lesson-create', {
    body: input,
  });
  if (error) throw invokeError(data, 'Ders oluşturulamadı.');
  if (data && typeof data === 'object' && 'error' in data) {
    throw invokeError(data, 'Ders oluşturulamadı.');
  }
  const lesson = (data as { lesson?: MemoryLesson } | null)?.lesson;
  if (!lesson) throw new Error('Ders oluşturulamadı.');
  return lesson;
}

export async function testLessonStorage() {
  const invoked = await getSupabase().functions.invoke('lesson-storage-test', { body: {} });
  const payload = invoked.data as
    | { success?: boolean; key?: string; bucket?: string; cleaned?: boolean; error?: { code?: string; message?: string } }
    | null;
  if (invoked.error || payload?.error || !payload?.success) {
    console.warn('[lesson-storage-test]', invoked.error, payload);
    const code = payload?.error?.code ?? '';
    if (code === 'NOT_CONFIGURED') throw new Error('Ders depolama henüz yapılandırılmamış.');
    if (code === 'STORAGE_ERROR') throw new Error('R2 bağlantısı başarısız. Ayarları kontrol et.');
    if (code === 'ADMIN_ONLY') throw new Error('Bu işlem için admin yetkisi gerekir.');
    if (code === 'UNAUTHORIZED') throw new Error('Oturum gerekli.');
    throw new Error('R2 bağlantısı doğrulanamadı.');
  }
  return {
    key: payload.key ?? '',
    bucket: payload.bucket ?? '',
    cleaned: Boolean(payload.cleaned),
  };
}

export async function getAdminMemoryLesson(id: string): Promise<MemoryLesson | null> {
  const { data, error } = await getSupabase().from('memory_lessons').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as MemoryLesson | null) ?? null;
}

export async function generateMemoryLesson(lessonId: string): Promise<MemoryLesson> {
  const invoked = await getSupabase().functions.invoke('memory-lesson-generate', {
    body: { lesson_id: lessonId },
  });
  const payload = invoked.data as { lesson?: MemoryLesson; error?: { code?: string; message?: string } } | null;
  if (invoked.error || payload?.error || !payload?.lesson) {
    console.warn('[memory-lesson-generate]', invoked.error, payload);
    const code = payload?.error?.code ?? '';
    if (code === 'AI_NOT_CONFIGURED') throw new Error('OPENAI_API_KEY sırrı yok.');
    if (code === 'INVALID_PACKAGE') throw new Error('Üretilen paket eksik. Tekrar dene.');
    if (code === 'ADMIN_ONLY') throw new Error('Bu işlem için admin yetkisi gerekir.');
    throw new Error(payload?.error?.message ?? 'İçerik üretilemedi.');
  }
  return payload.lesson;
}

export async function saveMemoryLessonReview(input: {
  lesson: Partial<MemoryLesson> & { id: string };
  scenes: Array<Partial<MemoryLessonScene> & { id: string }>;
  questions: Array<Partial<MemoryLessonQuestion> & { id: string }>;
}) {
  const supabase = getSupabase();
  const { error: lessonError } = await supabase
    .from('memory_lessons')
    .update({
      title: input.lesson.title,
      description: input.lesson.description,
      narration: input.lesson.narration,
      learning_objectives: input.lesson.learning_objectives ?? [],
      memory_hooks: input.lesson.memory_hooks ?? [],
      primary_memory_technique: input.lesson.primary_memory_technique ?? null,
      memory_techniques: input.lesson.memory_techniques ?? [],
      core_facts: input.lesson.core_facts ?? [],
      memory_journey_title: input.lesson.memory_journey_title ?? null,
      memory_journey_summary: input.lesson.memory_journey_summary ?? null,
      minimum_theory: input.lesson.minimum_theory ?? null,
      fast_rule: input.lesson.fast_rule ?? null,
      exam_technique: input.lesson.exam_technique ?? {},
    })
    .eq('id', input.lesson.id);
  if (lessonError) throw lessonError;

  for (const scene of input.scenes) {
    const { error } = await supabase
      .from('memory_lesson_scenes')
      .update({
        caption: scene.caption,
        narration_text: scene.narration_text,
        memory_hook: scene.memory_hook,
        visual_description: scene.visual_description,
        memory_technique: scene.memory_technique ?? null,
        memory_target: scene.memory_target ?? null,
        visual_anchor: scene.visual_anchor ?? null,
        recall_prompt: scene.recall_prompt ?? null,
        reinforcement_note: scene.reinforcement_note ?? null,
        journey_step: scene.journey_step ?? null,
      })
      .eq('id', scene.id);
    if (error) throw error;
  }

  for (const question of input.questions) {
    const { error } = await supabase
      .from('memory_lesson_questions')
      .update({
        question_text: question.question_text,
        options: question.options,
        correct_answer: question.correct_answer,
        explanation: question.explanation,
        question_strategy: question.question_strategy ?? null,
      })
      .eq('id', question.id);
    if (error) throw error;
  }

  await getSupabase().rpc('refresh_memory_lesson_pedagogy', { p_id: input.lesson.id });
}

export async function generateMemoryLessonMedia(input: {
  lessonId: string;
  mode?: MemoryLessonMediaMode;
  sceneId?: string;
}): Promise<MemoryLesson> {
  const invoked = await getSupabase().functions.invoke('memory-lesson-generate-media', {
    body: {
      lesson_id: input.lessonId,
      mode: input.mode ?? 'missing',
      scene_id: input.sceneId,
    },
  });
  const payload = invoked.data as { lesson?: MemoryLesson; error?: { code?: string; message?: string } } | null;
  if (invoked.error || payload?.error || !payload?.lesson) {
    console.warn('[memory-lesson-generate-media]', invoked.error, payload);
    const code = payload?.error?.code ?? '';
    if (code === 'AI_NOT_CONFIGURED') throw new Error('Üretim anahtarı yapılandırılmamış.');
    if (code === 'NO_CONTENT') throw new Error('Önce anlatım ve sahneler üretilmeli.');
    if (code === 'TTS_FAILED') throw new Error('Seslendirme oluşturulamadı.');
    if (code === 'ADMIN_ONLY') throw new Error('Bu işlem için admin yetkisi gerekir.');
    throw new Error(payload?.error?.message ?? 'Medya üretilemedi.');
  }
  return payload.lesson;
}

export async function getLessonMediaUrls(lessonId: string): Promise<Record<string, string>> {
  const invoked = await getSupabase().functions.invoke('memory-lesson-media-url', {
    body: { lesson_id: lessonId },
  });
  const payload = invoked.data as { urls?: Record<string, string>; error?: { message?: string } } | null;
  if (invoked.error || payload?.error || !payload?.urls) {
    console.warn('[memory-lesson-media-url]', invoked.error, payload);
    throw new Error('Önizleme bağlantısı alınamadı.');
  }
  return payload.urls;
}

export async function approveMemoryLesson(id: string) {
  const { error } = await getSupabase().rpc('admin_approve_memory_lesson', { p_id: id });
  if (error) throw error;
}

export async function publishMemoryLesson(id: string) {
  const { error } = await getSupabase().rpc('admin_publish_memory_lesson', { p_id: id });
  if (error) throw error;
}
