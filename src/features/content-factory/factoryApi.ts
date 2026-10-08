import { getSupabase } from '@/src/lib/supabase/client';

import type {
  BreakdownSession,
  BreakdownSuggestion,
  FactoryJob,
  FactorySettings,
  FactoryStats,
  QueueEstimate,
} from './types';

function invokeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const err = (payload as { error?: { message?: string } }).error;
    if (err?.message) return new Error(err.message);
  }
  return new Error(fallback);
}

export async function getFactorySettings(): Promise<FactorySettings> {
  const { data, error } = await getSupabase().rpc('admin_factory_get_settings');
  if (error) throw error;
  return data as FactorySettings;
}

export async function setFactoryPoolTarget(target: number) {
  const { data, error } = await getSupabase().rpc('admin_factory_set_pool_target', { p_target: target });
  if (error) throw error;
  return data as FactorySettings;
}

export async function setFactoryProduction(enabled: boolean, maxConcurrency?: number) {
  const { data, error } = await getSupabase().rpc('admin_factory_set_production', {
    p_enabled: enabled,
    p_max_concurrency: maxConcurrency ?? null,
  });
  if (error) throw error;
  return data as FactorySettings;
}

export async function getFactoryStats(): Promise<FactoryStats> {
  const { data, error } = await getSupabase().rpc('admin_factory_stats');
  if (error) throw error;
  return data as FactoryStats;
}

export async function previewOrQueueMissing(input: {
  examId?: string | null;
  versionId?: string | null;
  subjectId?: string | null;
  unitId?: string | null;
  enqueue?: boolean;
  confirm?: boolean;
}): Promise<QueueEstimate> {
  const { data, error } = await getSupabase().rpc('admin_queue_missing_content', {
    p_exam_id: input.examId ?? null,
    p_curriculum_version_id: input.versionId ?? null,
    p_subject_id: input.subjectId ?? null,
    p_unit_id: input.unitId ?? null,
    p_enqueue: Boolean(input.enqueue),
    p_confirm: Boolean(input.confirm),
  });
  if (error) throw error;
  return data as QueueEstimate;
}

export async function queueTestTopic() {
  const { data, error } = await getSupabase().rpc('admin_queue_test_topic');
  if (error) throw error;
  return data as { action: string; job_id?: string };
}

export async function listFactoryJobs(): Promise<FactoryJob[]> {
  const { data, error } = await getSupabase()
    .from('content_generation_jobs')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as FactoryJob[];
}

export async function listCanonicalTopics() {
  const { data, error } = await getSupabase()
    .from('canonical_topics')
    .select('id, name, slug, canonical_unit_id')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listCanonicalUnits() {
  const { data, error } = await getSupabase()
    .from('canonical_units')
    .select('id, name, slug, canonical_subject_id')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function retryFactoryJob(id: string) {
  const { data, error } = await getSupabase().rpc('admin_factory_retry_job', { p_id: id });
  if (error) throw error;
  return data;
}

export async function cancelFactoryJob(id: string) {
  const { data, error } = await getSupabase().rpc('admin_factory_cancel_job', { p_id: id });
  if (error) throw error;
  return data;
}

export async function retryFailedJobs(versionId?: string | null) {
  const { data, error } = await getSupabase().rpc('admin_factory_retry_failed', {
    p_curriculum_version_id: versionId ?? null,
  });
  if (error) throw error;
  return data as { retried: number };
}

export async function tickFactoryProcess() {
  const invoked = await getSupabase().functions.invoke('content-factory-process', { body: {} });
  if (invoked.error) throw invokeError(invoked.data, invoked.error.message);
  return invoked.data as { paused?: boolean; processed?: unknown[]; concurrency?: number };
}

export async function suggestTopicBreakdown(input: {
  source_name: string;
  canonical_unit_id?: string | null;
  canonical_topic_id?: string | null;
}) {
  const invoked = await getSupabase().functions.invoke('content-factory-breakdown', { body: input });
  if (invoked.error) throw invokeError(invoked.data, 'Alt konu önerisi alınamadı.');
  return invoked.data as { session: BreakdownSession; suggestions: BreakdownSuggestion[]; queued: boolean };
}

export async function listBreakdownSessions() {
  const { data, error } = await getSupabase()
    .from('topic_breakdown_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as BreakdownSession[];
}

export async function listBreakdownSuggestions(sessionId: string) {
  const { data, error } = await getSupabase()
    .from('topic_breakdown_suggestions')
    .select('*')
    .eq('session_id', sessionId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as BreakdownSuggestion[];
}

export async function updateSuggestion(id: string, patch: Partial<BreakdownSuggestion> & { suggested_name?: string }) {
  const { error } = await getSupabase().from('topic_breakdown_suggestions').update(patch).eq('id', id);
  if (error) throw error;
}

export async function approveSuggestion(id: string) {
  const { data, error } = await getSupabase().rpc('admin_approve_breakdown_suggestion', { p_id: id });
  if (error) throw error;
  return data;
}

export async function addBreakdownSuggestion(sessionId: string, name: string) {
  const { error } = await getSupabase().from('topic_breakdown_suggestions').insert({
    session_id: sessionId,
    suggested_name: name.trim(),
    status: 'pending',
    sort_order: 99,
  });
  if (error) throw error;
}

export async function queueSingleTopic(input: {
  canonical_topic_id: string;
  curriculum_version_id?: string | null;
  topic_id?: string | null;
  subject_id?: string | null;
  unit_id?: string | null;
  exam_id?: string | null;
}) {
  const { data, error } = await getSupabase()
    .from('content_generation_jobs')
    .insert({
      canonical_topic_id: input.canonical_topic_id,
      curriculum_version_id: input.curriculum_version_id ?? null,
      topic_id: input.topic_id ?? null,
      subject_id: input.subject_id ?? null,
      unit_id: input.unit_id ?? null,
      exam_id: input.exam_id ?? null,
      job_type: 'full_lesson',
      status: 'queued',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as FactoryJob;
}
