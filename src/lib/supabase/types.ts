export type ExamKind = 'tyt' | 'ayt' | 'tyt_ayt' | 'kpss_onlisans' | 'kpss_lisans';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type TaskStatus = 'pending' | 'completed' | 'skipped';
export type SubscriptionPlan = 'free' | 'pro';
export type LeagueTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type ThemePreference = 'light' | 'dark' | 'system';

export type Profile = {
  id: string;
  display_name: string;
  display_tag?: number | null;
  avatar_url: string | null;
  auto_match?: boolean;
  match_notify?: boolean;
  match_same_topic?: boolean;
  match_same_subject?: boolean;
  is_private?: boolean;
  exam_id: string | null;
  target_score: number | null;
  exam_date: string | null;
  exam_year: number | null;
  daily_minutes: number | null;
  onboarding_completed_at: string | null;
  theme_preference: ThemePreference;
  app_role?: 'user' | 'moderator' | 'admin' | 'super_admin';
  account_status?: 'active' | 'warned' | 'restricted' | 'banned';
  system_exam_reminders?: boolean;
  last_active_at?: string | null;
  web_push_enabled?: boolean;
  current_xp: number;
  league_tier: LeagueTier;
  created_at: string;
  updated_at: string;
};

export type Exam = {
  id: string;
  slug: string;
  name: string;
  kind: ExamKind;
};

export type ExamSession = {
  id: string;
  exam_id: string;
  session_year: number;
  exam_date: string | null;
  label: string;
};

export type Subject = {
  id: string;
  exam_id: string;
  slug: string;
  name: string;
  sort_order: number;
};

export type StudyTask = {
  id: string;
  plan_id: string;
  user_id: string;
  title: string;
  subject_id: string | null;
  topic_id: string | null;
  question_count: number | null;
  status: TaskStatus;
  sort_order: number;
  completed_at: string | null;
  kind?: 'subject' | 'review' | 'mock';
};

export type StudyPlan = {
  id: string;
  user_id: string;
  plan_date: string;
  target_questions: number;
  target_minutes: number;
  generated_by: string;
  summary: string | null;
  study_tasks: StudyTask[];
};

export type Streak = {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_completed_date: string | null;
  freeze_count: number;
};

export type Question = {
  id: string;
  exam_id: string;
  subject_id: string;
  topic_id: string | null;
  stem: string;
  choices: Record<string, string>;
  difficulty: Difficulty;
  subject_name?: string;
  topic_name?: string;
  exam_slug?: string;
  image_url?: string | null;
};

export type AttemptResult = {
  is_correct: boolean;
  correct_choice: string;
  explanation: string;
  xp_awarded: number;
  difficulty: Difficulty;
  mastered?: boolean;
};

export type WrongAnswer = {
  id: string;
  question_id: string;
  subject_id: string;
  topic_id: string | null;
  user_answer: string | null;
  correct_answer: string | null;
  explanation: string | null;
  next_review_at: string;
  created_at: string;
  attempt_count?: number;
  mastered?: boolean;
  last_attempt_at?: string;
  questions: { stem: string; choices: Record<string, string>; difficulty: Difficulty } | null;
  subjects: { name: string } | null;
  topics: { name: string } | null;
};

export type Subscription = {
  user_id: string;
  plan: SubscriptionPlan;
  provider: string | null;
  provider_id: string | null;
  expires_at: string | null;
};
