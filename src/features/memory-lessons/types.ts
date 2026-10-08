export type MemoryLessonStatus =
  | 'draft'
  | 'generating'
  | 'pending_validation'
  | 'approved'
  | 'published'
  | 'archived';

export type MemoryLessonExam = 'tyt' | 'ayt' | 'kpss';
export type MemorySceneAssetType = 'image' | 'video' | 'animation';
export type MemoryQuestionType = 'checkpoint' | 'final';

export type MemoryLesson = {
  id: string;
  exam_type: MemoryLessonExam | string;
  subject: string;
  unit: string;
  topic: string;
  title: string;
  slug: string;
  description: string | null;
  version: number;
  duration_sec: number | null;
  status: MemoryLessonStatus;
  thumbnail_key: string | null;
  narration_key: string | null;
  captions_key: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  exam_id?: string | null;
  subject_id?: string | null;
  unit_id?: string | null;
  topic_id?: string | null;
  narration?: string | null;
  learning_objectives?: string[] | null;
  memory_hooks?: string[] | null;
  generation_model?: string | null;
  generated_at?: string | null;
  prompt_version?: string | null;
  generation_status?: 'idle' | 'generating' | 'succeeded' | 'failed' | string;
  generation_error?: string | null;
  media_generation_status?: 'idle' | 'generating' | 'ready' | 'failed' | string;
  media_generated_at?: string | null;
  media_generation_error?: string | null;
  canonical_topic_id?: string | null;
  lesson_scope?: 'core' | 'exam_extension' | 'exam_specific' | string;
  base_lesson_id?: string | null;
  coverage_depth?: 'basic' | 'standard' | 'advanced' | string;
  primary_memory_technique?: string | null;
  memory_techniques?: string[] | null;
  pedagogy_version?: string | null;
  pedagogy_score?: number | null;
  core_facts?: unknown;
  memory_journey_title?: string | null;
  memory_journey_summary?: string | null;
  pedagogy_issues?: unknown;
  minimum_theory?: string | null;
  fast_rule?: string | null;
  exam_technique?: Record<string, unknown> | null;
  technique_score?: number | null;
  academic_pass?: boolean | null;
};

export type MemoryLessonMediaMode = 'missing' | 'all' | 'narration' | 'scene';

export type MemoryLessonScene = {
  id: string;
  lesson_id: string;
  scene_order: number;
  start_ms: number;
  end_ms: number;
  asset_type: MemorySceneAssetType | string;
  asset_key: string | null;
  caption: string | null;
  narration_text: string | null;
  memory_hook: string | null;
  visual_description?: string | null;
  memory_technique?: string | null;
  memory_target?: string | null;
  visual_anchor?: string | null;
  recall_prompt?: string | null;
  reinforcement_note?: string | null;
  journey_step?: string | null;
  created_at: string;
};

export type MemoryLessonQuestion = {
  id: string;
  lesson_id: string;
  question_type: MemoryQuestionType | string;
  question_order: number;
  question_text: string;
  options: unknown;
  correct_answer: string;
  explanation: string | null;
  related_scene_id: string | null;
  question_set_id?: string | null;
  question_strategy?: string | null;
  technique_role?: string | null;
  trap_type?: string | null;
  created_at: string;
};

export type MemoryLessonCreateInput = {
  exam_id?: string;
  subject_id?: string;
  unit_id?: string;
  topic_id?: string;
  exam_type?: MemoryLessonExam;
  subject?: string;
  unit?: string;
  topic?: string;
  title: string;
  lesson_scope?: 'core' | 'exam_extension' | 'exam_specific';
  coverage_depth?: 'basic' | 'standard' | 'advanced';
  usage_mode?: 'core' | 'core_plus_extension' | 'exam_specific';
  base_lesson_id?: string;
};
