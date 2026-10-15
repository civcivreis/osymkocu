export type CoachAction =
  | 'greet'
  | 'prefs'
  | 'how_we_study'
  | 'show_plan'
  | 'play_lesson'
  | 'next_lesson'
  | 'start_test'
  | 'repeat_wrong_question'
  | 'needs_review'
  | 'show_result'
  | 'start_break'
  | 'complete_session'
  | string;

export type GuidedNext = {
  next_action: CoachAction;
  payload: Record<string, unknown>;
  session: {
    id: string;
    status: string;
    current_step: string;
    current_lesson_id?: string | null;
    completed_lessons: number;
    questions_answered: number;
    correct_count: number;
    wrong_count: number;
    breaks_taken: number;
    session_goal_minutes: number;
    xp_awarded: number;
    started_at: string;
    resume_state?: Record<string, unknown>;
  };
  preferences: {
    break_frequency_lessons: number;
    preferred_break_minutes: number;
    preferred_session_minutes: number;
    coach_autonomy_level: string;
    greet_completed_at?: string | null;
    how_we_study_completed_at?: string | null;
    auto_next_lesson?: boolean;
    preferred_playback_rate?: number;
    captions_enabled?: boolean;
  };
  plan?: {
    id: string;
    planned_items: Array<Record<string, unknown>>;
    target_minutes: number;
    status: string;
  } | null;
  display_name: string;
  elapsed_minutes: number;
  fatigue?: boolean;
};

export type TimelineEvent = {
  id: string;
  lesson_id: string;
  event_type: string;
  card_type: string | null;
  appear_at_ms: number;
  pause_audio: boolean;
  payload: Record<string, unknown>;
  related_question_id?: string | null;
};
