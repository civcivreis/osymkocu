import { getSupabase } from '@/src/lib/supabase/client';

import type {
  CurriculumImportSummary,
  CurriculumVersion,
  ExamCatalog,
  ExamTopicMap,
  ReusableLesson,
  StudentCurriculumRow,
  SubjectCatalog,
  TopicCatalog,
  UnitCatalog,
} from './types';

function asList<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function listExamCatalog(): Promise<ExamCatalog[]> {
  const { data, error } = await getSupabase()
    .from('exam_catalog')
    .select('id, code, name, is_active, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return asList<ExamCatalog>(data);
}

export async function listSubjectCatalog(examId: string): Promise<SubjectCatalog[]> {
  const { data, error } = await getSupabase()
    .from('subject_catalog')
    .select('id, exam_id, code, name, is_active, sort_order')
    .eq('exam_id', examId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return asList<SubjectCatalog>(data);
}

export async function listUnitCatalog(subjectId: string): Promise<UnitCatalog[]> {
  const { data, error } = await getSupabase()
    .from('unit_catalog')
    .select('id, subject_id, code, name, is_active, sort_order, canonical_unit_id')
    .eq('subject_id', subjectId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return asList<UnitCatalog>(data);
}

export async function listCanonicalTopicSegments(canonicalTopicId: string) {
  const { data, error } = await getSupabase()
    .from('canonical_topic_segments')
    .select('id, title, segment_order')
    .eq('canonical_topic_id', canonicalTopicId)
    .order('segment_order', { ascending: true });
  if (error) throw error;
  return asList<{ id: string; title: string; segment_order: number }>(data);
}

export async function listTopicCatalog(unitId: string): Promise<TopicCatalog[]> {
  const { data, error } = await getSupabase()
    .from('topic_catalog')
    .select('id, unit_id, code, name, description, is_active, content_status, sort_order, canonical_topic_id')
    .eq('unit_id', unitId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return asList<TopicCatalog>(data);
}

export async function createExamCatalog(input: { code: string; name: string }) {
  const { data, error } = await getSupabase()
    .from('exam_catalog')
    .insert({
      code: input.code.trim().toUpperCase().replace(/\s+/g, '_'),
      name: input.name.trim().replace(/\s+/g, ' '),
    })
    .select('id, code, name, is_active, sort_order')
    .single();
  if (error) throw error;
  return data as ExamCatalog;
}

export async function createSubjectCatalog(input: { exam_id: string; name: string; code?: string }) {
  const name = input.name.trim().replace(/\s+/g, ' ');
  let code = input.code?.trim().toUpperCase().replace(/\s+/g, '_');
  if (!code) {
    const generated = await getSupabase().rpc('catalog_code_from_name', { p_name: name });
    code = String(generated.data ?? 'DERS');
  }
  const { data, error } = await getSupabase()
    .from('subject_catalog')
    .insert({
      exam_id: input.exam_id,
      name,
      code,
    })
    .select('id, exam_id, code, name, is_active, sort_order')
    .single();
  if (error) throw error;
  return data as SubjectCatalog;
}

export async function createUnitCatalog(input: { subject_id: string; name: string }) {
  const { data, error } = await getSupabase()
    .from('unit_catalog')
    .insert({
      subject_id: input.subject_id,
      name: input.name.trim().replace(/\s+/g, ' '),
    })
    .select('id, subject_id, code, name, is_active, sort_order')
    .single();
  if (error) throw error;
  return data as UnitCatalog;
}

export async function createTopicCatalog(input: { unit_id: string; name: string }) {
  const { data, error } = await getSupabase()
    .from('topic_catalog')
    .insert({
      unit_id: input.unit_id,
      name: input.name.trim().replace(/\s+/g, ' '),
      content_status: 'empty',
    })
    .select('id, unit_id, code, name, description, is_active, content_status, sort_order')
    .single();
  if (error) throw error;
  return data as TopicCatalog;
}

export async function updateCatalogName(table: 'exam_catalog' | 'subject_catalog' | 'unit_catalog' | 'topic_catalog', id: string, name: string) {
  const { error } = await getSupabase()
    .from(table)
    .update({ name: name.trim().replace(/\s+/g, ' ') })
    .eq('id', id);
  if (error) throw error;
}

export async function setCatalogActive(
  table: 'exam_catalog' | 'subject_catalog' | 'unit_catalog' | 'topic_catalog',
  id: string,
  isActive: boolean,
) {
  const { error } = await getSupabase().from(table).update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function syncCurriculum(examId?: string | null, force = false) {
  const { data, error } = await getSupabase().rpc('admin_curriculum_sync', {
    p_exam_id: examId ?? null,
    p_force: force,
  });
  if (error) throw error;
  return data as {
    unchanged: number;
    proposals: number;
    baselines_accepted?: number;
    needs_review?: number;
    ai_called: boolean;
    fetched_remote: boolean;
  };
}

export type CurriculumProposalRow = {
  id: string;
  exam_id: string;
  exam_name: string;
  status: string;
  diff: Record<string, unknown>;
  created_at: string;
};

const REVIEW_REASONS: Record<string, string> = {
  exam_unidentified: 'Sınav tanımlanamadı',
  source_unknown: 'Kaynak bilinmiyor',
  source_untrusted: 'Kaynak güvenilir değil',
  source_conflict: 'Kaynak çelişkisi',
  duplicate_subjects: 'Çakışan dersler',
  ambiguous_canonical: 'Belirsiz konu eşlemesi',
  empty_structure: 'Boş veya geçersiz müfredat yapısı',
  structural_update: 'Yapısal müfredat değişikliği',
};

function changeTypeOf(diff: Record<string, unknown> | null | undefined): string {
  return String(diff?.change_type ?? diff?.result ?? '');
}

export function formatCurriculumSyncToast(result: {
  unchanged: number;
  proposals: number;
  baselines_accepted?: number;
  needs_review?: number;
}): string {
  const baseline = result.baselines_accepted ?? 0;
  const review = result.needs_review ?? 0;
  const parts = [
    baseline ? `${baseline} ilk müfredat oluşturuldu` : null,
    `${result.unchanged} değişmedi`,
    review ? `${review} inceleme bekliyor` : null,
    !baseline && !review && result.proposals ? `${result.proposals} öneri` : null,
  ].filter(Boolean);
  return `Senkron: ${parts.join(' · ')}`;
}

export function formatCurriculumProposalLine(row: CurriculumProposalRow): string {
  const change = changeTypeOf(row.diff);
  const reasonKey = String(row.diff?.reason ?? '');
  const reason = REVIEW_REASONS[reasonKey] ?? (reasonKey || null);
  const isFirst = change === 'INITIAL_BASELINE' || change === 'NEW_OR_FIRST_SNAPSHOT';

  if (isFirst && (row.status === 'applied' || row.diff?.auto_accepted === true)) {
    return `${row.exam_name} · İlk müfredat oluşturuldu`;
  }
  if (isFirst && row.status !== 'needs_review' && row.status !== 'rejected') {
    return `${row.exam_name} · İlk müfredat hazırlanıyor`;
  }
  if (row.status === 'needs_review' || row.status === 'draft') {
    const kind =
      change === 'SOURCE_CONFLICT'
        ? 'Kaynak çelişkisi'
        : change === 'REMOVED'
          ? 'Kaldırılan konular'
          : change === 'AMBIGUOUS'
            ? 'Belirsiz eşleme'
            : change === 'UPDATED'
              ? 'Yapısal güncelleme'
              : change === 'ADDED'
                ? 'Yeni konular'
                : isFirst
                  ? 'İlk müfredat incelemesi'
                  : change || row.status;
    return reason ? `${row.exam_name} · İnceleme: ${reason}` : `${row.exam_name} · İnceleme: ${kind}`;
  }
  if (change === 'UNCHANGED') {
    return `${row.exam_name} · Değişiklik yok`;
  }
  return `${row.exam_name} · ${row.status}${change ? ` · ${change}` : ''}`;
}

export async function listCurriculumProposals(examId?: string | null) {
  const { data, error } = await getSupabase().rpc('admin_list_curriculum_proposals', {
    p_exam_id: examId ?? null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CurriculumProposalRow[];
}

export async function curriculumDiff(fromId: string, toId: string) {
  const { data, error } = await getSupabase().rpc('admin_curriculum_diff', {
    p_from: fromId,
    p_to: toId,
  });
  if (error) throw error;
  return data as { added: number; removed: number; unchanged: number; changed_scope: number };
}

export async function importCurriculum(items: unknown): Promise<CurriculumImportSummary> {
  const { data, error } = await getSupabase().rpc('admin_import_curriculum', { p_items: items });
  if (error) throw error;
  return data as CurriculumImportSummary;
}

export async function listActiveExamCatalog(): Promise<ExamCatalog[]> {
  const { data, error } = await getSupabase()
    .from('exam_catalog')
    .select('id, code, name, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return asList<ExamCatalog>(data);
}

export async function getActiveCurriculumVersion(examId: string): Promise<CurriculumVersion | null> {
  const { data, error } = await getSupabase().rpc('get_active_curriculum_version', { p_exam_id: examId });
  if (error) throw error;
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as CurriculumVersion | undefined) ?? null;
  return data as CurriculumVersion;
}

export async function getStudentCurriculum(examId: string): Promise<StudentCurriculumRow[]> {
  const { data, error } = await getSupabase().rpc('get_student_curriculum', { p_exam_id: examId });
  if (error) throw error;
  return asList<StudentCurriculumRow>(data);
}

export async function listCurriculumVersions(examId: string): Promise<CurriculumVersion[]> {
  const { data, error } = await getSupabase()
    .from('curriculum_versions')
    .select('*')
    .eq('exam_id', examId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return asList<CurriculumVersion>(data);
}

export async function listExamTopicMap(versionId: string): Promise<ExamTopicMap[]> {
  const { data, error } = await getSupabase()
    .from('exam_topic_map')
    .select('*')
    .eq('curriculum_version_id', versionId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return asList<ExamTopicMap>(data);
}

export async function createCurriculumVersion(input: { exam_id: string; code: string; name: string; revision_label?: string }) {
  const { data, error } = await getSupabase().rpc('admin_create_curriculum_version', {
    p_exam_id: input.exam_id,
    p_code: input.code,
    p_name: input.name,
    p_revision_label: input.revision_label ?? null,
  });
  if (error) throw error;
  return data as CurriculumVersion;
}

export async function activateCurriculumVersion(id: string) {
  const { data, error } = await getSupabase().rpc('admin_set_active_curriculum_version', { p_id: id });
  if (error) throw error;
  return data as CurriculumVersion;
}

export async function scheduleCurriculumVersion(id: string, from: string | null, until: string | null) {
  const { data, error } = await getSupabase().rpc('admin_schedule_curriculum_version', {
    p_id: id,
    p_from: from,
    p_until: until,
  });
  if (error) throw error;
  return data as CurriculumVersion;
}

export async function archiveCurriculumVersion(id: string) {
  const { data, error } = await getSupabase().rpc('admin_archive_curriculum_version', { p_id: id });
  if (error) throw error;
  return data as CurriculumVersion;
}

export async function duplicateCurriculumVersion(id: string) {
  const { data, error } = await getSupabase().rpc('admin_duplicate_curriculum_version', {
    p_id: id,
    p_code: null,
    p_name: null,
  });
  if (error) throw error;
  return data as CurriculumVersion;
}

export async function findReusableLessons(topicId: string): Promise<ReusableLesson[]> {
  const { data, error } = await getSupabase().rpc('admin_find_reusable_lessons', { p_topic_id: topicId });
  if (error) throw error;
  return asList<ReusableLesson>(data);
}

export async function attachMemoryLesson(lessonId: string, examId: string, usageMode = 'core') {
  const { data, error } = await getSupabase().rpc('admin_attach_memory_lesson', {
    p_lesson_id: lessonId,
    p_exam_id: examId,
    p_usage_mode: usageMode,
  });
  if (error) throw error;
  return data;
}
