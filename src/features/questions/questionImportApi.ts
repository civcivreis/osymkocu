import { getSupabase } from '@/src/lib/supabase/client';

import type { ImportQuestionRow, ParsedPackage } from './questionPackageParse';

export type BankTopic = {
  id: string;
  name: string;
  sort_order: number;
  canonical_topic_id: string | null;
  created_by_import?: boolean;
  content_status?: string;
  question_count: number;
};

export type BankUnit = {
  id: string;
  name: string;
  sort_order: number;
  created_by_import?: boolean;
  topics: BankTopic[];
};

export type BankSubject = {
  id: string;
  name: string;
  code: string;
  sort_order: number;
  created_by_import?: boolean;
  units: BankUnit[];
};

export type BankExam = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  subjects: BankSubject[];
};

export type ImportResult = {
  batch_id: string;
  imported: number;
  new_topics: number;
  reused_topics: number;
  duplicates_skipped: number;
  invalid: number;
  needs_mapping: number;
};

export type ImportBatch = {
  id: string;
  file_name: string;
  package_name: string | null;
  package_version: string | null;
  created_by: string | null;
  total_rows: number;
  inserted_count: number;
  duplicate_count: number;
  invalid_count: number;
  mapping_count: number;
  created_topics: number;
  reused_topics: number;
  status: string;
  created_at: string;
  summary: Record<string, unknown>;
};

export async function getQuestionBankTree(): Promise<BankExam[]> {
  const { data, error } = await getSupabase().rpc('admin_question_bank_tree');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as BankExam[];
}

export async function importQuestionPackage(input: {
  fileName: string;
  pack: ParsedPackage;
  rows: ImportQuestionRow[];
}): Promise<ImportResult> {
  const { data, error } = await getSupabase().rpc('admin_import_question_package', {
    p_payload: {
      file_name: input.fileName,
      package_name: input.pack.package_name,
      package_version: input.pack.package_version,
      allow_published: false,
      rows: input.rows,
    },
  });
  if (error) throw error;
  return data as ImportResult;
}

export async function listQuestionImports(): Promise<ImportBatch[]> {
  const { data, error } = await getSupabase()
    .from('question_import_batches')
    .select(
      'id, file_name, package_name, package_version, created_by, total_rows, inserted_count, duplicate_count, invalid_count, mapping_count, created_topics, reused_topics, status, created_at, summary',
    )
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []) as ImportBatch[];
}

export async function listImportItems(batchId: string) {
  const { data, error } = await getSupabase()
    .from('question_import_items')
    .select('id, row_index, outcome, detail, question_id')
    .eq('batch_id', batchId)
    .order('row_index')
    .limit(400);
  if (error) throw error;
  return data ?? [];
}

export function previewStats(rows: ImportQuestionRow[], tree: BankExam[]) {
  const exams = new Set<string>();
  const subjects = new Set<string>();
  const themes = new Set<string>();
  const topics = new Set<string>();
  let invalid = 0;
  let needsMapping = 0;
  let newNodes = 0;
  let reused = 0;
  const topicIndex = new Map<string, boolean>();
  tree.forEach((exam) => {
    exam.subjects.forEach((subject) => {
      subject.units.forEach((unit) => {
        unit.topics.forEach((topic) => {
          topicIndex.set(`${norm(exam.code)}|${norm(subject.name)}|${norm(unit.name)}|${norm(topic.name)}`, true);
          if (topic.canonical_topic_id) topicIndex.set(norm(topic.name), true);
        });
      });
    });
  });
  const examCodes = new Map(tree.map((exam) => [norm(exam.code), exam]));
  tree.forEach((exam) => examCodes.set(norm(exam.name), exam));

  rows.forEach((row) => {
    row.exam_codes.forEach((code) => exams.add(code));
    if (row.subject) subjects.add(row.subject);
    if (row.main_theme) themes.add(row.main_theme);
    if (row.topic) topics.add(row.topic);
    if (row.invalid_reason) {
      invalid += 1;
      return;
    }
    const matchedExams = row.exam_codes.map((code) => {
      const hits = tree.filter((exam) => norm(exam.code) === norm(code) || norm(exam.name) === norm(code));
      return hits.length === 1 ? hits[0] : null;
    });
    if (matchedExams.some((item) => !item) || !row.exam_codes.length) {
      needsMapping += 1;
      return;
    }
    const key = `${norm(matchedExams[0]!.code)}|${norm(row.subject)}|${norm(row.main_theme || row.subject)}|${norm(row.topic)}`;
    if (topicIndex.has(key) || topicIndex.has(norm(row.topic))) reused += 1;
    else newNodes += 1;
  });

  const stems = new Map<string, number>();
  rows.forEach((row) => {
    const key = `${norm(row.question_text)}|${norm(row.topic)}`;
    stems.set(key, (stems.get(key) ?? 0) + 1);
  });
  const duplicatePreview = [...stems.values()].filter((count) => count > 1).length;

  return {
    exams: [...exams],
    subjects: [...subjects],
    themes: [...themes],
    topics: [...topics],
    total: rows.length,
    invalid,
    needsMapping,
    newNodes,
    reused,
    duplicatePreview,
  };
}

function norm(value: string) {
  return value.trim().toLocaleLowerCase('tr');
}
