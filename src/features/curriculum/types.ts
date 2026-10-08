export type ExamCatalog = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type SubjectCatalog = {
  id: string;
  exam_id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type UnitCatalog = {
  id: string;
  subject_id: string;
  code: string | null;
  name: string;
  is_active: boolean;
  sort_order: number;
  canonical_unit_id?: string | null;
};

export type TopicCatalog = {
  id: string;
  unit_id: string;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  content_status: 'empty' | 'queued' | 'generating' | 'pending_validation' | 'published' | string;
  sort_order: number;
  canonical_topic_id?: string | null;
};

export type CurriculumVersionStatus = 'draft' | 'scheduled' | 'active' | 'archived';

export type CurriculumVersion = {
  id: string;
  exam_id: string;
  code: string;
  name: string;
  revision_label: string | null;
  source_note: string | null;
  status: CurriculumVersionStatus | string;
  effective_from: string | null;
  effective_until: string | null;
  is_default: boolean;
  manually_activated: boolean;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  archived_at: string | null;
};

export type ExamTopicMap = {
  id: string;
  curriculum_version_id: string;
  canonical_topic_id: string;
  subject_id: string | null;
  unit_id: string | null;
  topic_id: string | null;
  included: boolean;
  coverage_mode: 'core' | 'core_plus_extension' | 'exam_specific' | string;
  depth_level: 'basic' | 'standard' | 'advanced' | string;
  priority: 'low' | 'normal' | 'high' | string;
  sort_order: number;
  exam_notes: string | null;
};

export type StudentCurriculumRow = {
  curriculum_version_id: string;
  curriculum_name: string;
  revision_label: string | null;
  canonical_topic_id: string;
  subject_name: string;
  unit_name: string;
  topic_name: string;
  coverage_mode: string;
  depth_level: string;
  sort_order: number;
  lesson_id: string | null;
  lesson_title: string | null;
  lesson_slug: string | null;
};

export type ReusableLesson = {
  lesson_id: string;
  title: string;
  status: string;
  lesson_scope: string;
  coverage_depth: string;
  canonical_topic_id: string;
};

export type CurriculumImportSummary = {
  exams_created: number;
  subjects_created: number;
  units_created: number;
  topics_created: number;
  skipped_duplicates: number;
  errors: unknown[];
};
