export type FactoryJobType = 'full_lesson' | 'text_only' | 'media_only' | 'questions_only' | 'pedagogy_refresh';

export type FactoryJobStatus =
  | 'queued'
  | 'generating_text'
  | 'validating_pedagogy'
  | 'generating_questions'
  | 'generating_media'
  | 'pending_validation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type FactorySettings = {
  production_enabled: boolean;
  max_concurrency: number;
  question_pool_target?: number;
  updated_at?: string;
};

export type FactoryStats = {
  total_topics: number;
  ready: number;
  queued: number;
  generating: number;
  pending_validation: number;
  failed: number;
};

export type QueueEstimate = {
  generate: number;
  reused: number;
  skipped: number;
  queued: number;
  needs_confirm: boolean;
  active_jobs?: number;
  curriculum_version_id?: string;
};

export type FactoryJob = {
  id: string;
  canonical_topic_id: string;
  curriculum_version_id: string | null;
  memory_lesson_id: string | null;
  exam_id: string | null;
  subject_id: string | null;
  unit_id: string | null;
  topic_id: string | null;
  job_type: FactoryJobType | string;
  status: FactoryJobStatus | string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  stage_text_done: boolean;
  stage_pedagogy_done: boolean;
  stage_questions_done: boolean;
  stage_pool_done?: boolean;
  stage_media_done: boolean;
  media_done_count: number;
  media_total_count: number;
  events: { at?: string; code?: string; message?: string }[] | unknown;
  lesson_scope: string;
  coverage_mode: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  topic_name?: string;
  lesson_title?: string;
  exam_name?: string;
  pedagogy_score?: number | null;
};

export type BreakdownSuggestion = {
  id: string;
  session_id: string;
  suggested_name: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'merged' | string;
  merge_into_id: string | null;
  canonical_topic_id: string | null;
  sort_order: number;
};

export type BreakdownSession = {
  id: string;
  source_name: string;
  canonical_unit_id: string | null;
  canonical_topic_id: string | null;
  status: string;
};
