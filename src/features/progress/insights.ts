export type TopicInsight = {
  subjectId: string;
  topicId: string;
  subject: string;
  topic: string;
  total: number;
  correct: number;
  wrong: number;
  blank: number;
  avgMs: number;
  accuracy: number;
  recentAccuracy: number | null;
  enough: boolean;
};

export type PriorityTopic = {
  subjectId: string;
  topicId: string;
  subject: string;
  topic: string;
  accuracy: number;
  total: number;
};

export type WeeklyInsight = {
  questions: number;
  ms: number;
  accuracy: number | null;
  activeDays: number;
  questionDelta: number | null;
  accuracyDelta: number | null;
  strongest: string | null;
  weakest: string | null;
  bars: number[];
};

export type WrongInsight = {
  open: number;
  mastered: number;
  bySubject: { name: string; count: number }[];
  byTopic: { name: string; count: number; subject: string }[];
};

export type ProgressInsights = {
  topics: TopicInsight[];
  priorities: PriorityTopic[];
  weekly: WeeklyInsight;
  wrong: WrongInsight;
};

export function formatStudyHours(ms: number) {
  const hours = ms / 3_600_000;
  if (hours < 0.1) return `${Math.max(0, Math.round(ms / 60000))} dk`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0) return `${m} dk`;
  return m > 0 ? `${h} sa ${m} dk` : `${h} saat`;
}

export function formatAvgSeconds(ms: number) {
  if (!ms || ms <= 0) return null;
  return `${Math.max(1, Math.round(ms / 1000))} sn`;
}
