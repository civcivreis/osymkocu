export type DecomposeMatchAction = 'use_existing' | 'create';

export type DecompositionItem = {
  id: string;
  selected: boolean;
  title: string;
  description?: string;
  estimated_minutes: number;
  estimated_core_fact_count: number;
  estimated_scene_count?: number;
  independent_entity_count?: number;
  importance?: string;
  reason?: string;
  memory_journey_feasibility?: string;
  too_broad?: boolean;
  learning_objectives?: string[];
  match_status?: 'NEW' | 'MATCH_EXISTING' | string;
  matched_canonical_topic_id?: string | null;
  matched_title?: string | null;
  match_action?: DecomposeMatchAction | string;
  should_have_own_lesson?: boolean;
  item_order: number;
};

export type DecompositionProposal = {
  id: string;
  mode: 'unit' | 'topic' | string;
  status: string;
  curriculum_version_id: string | null;
  exam_id: string | null;
  subject_id: string | null;
  unit_id: string | null;
  canonical_topic_id: string | null;
  canonical_unit_id: string | null;
  title: string | null;
  ai_payload: Record<string, unknown>;
  items: DecompositionItem[];
  coverage_warnings: unknown;
  missing_areas: unknown;
  possible_duplicates: unknown;
  created_at: string;
  updated_at: string;
};

export type CanonicalTopicMeta = {
  id: string;
  name: string;
  too_broad: boolean;
  keep_single_override: boolean;
  analysis_status: string;
  estimated_minutes: number | null;
  estimated_core_fact_count: number | null;
  memory_journey_feasibility: string | null;
  objective_count?: number;
};
