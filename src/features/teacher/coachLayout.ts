export const COACH_FAB_SIZE = 56;
export const COACH_FAB_MARGIN = 12;
export const COACH_HELP_NUDGE_SECONDS = 10;
export const TAB_BAR_BODY_HEIGHT = 62;
export const COACH_PANEL_GUTTER = 12;
export const COACH_PANEL_MAX_WIDTH = 560;

export type CoachSide = 'left' | 'right';

export type CoachAppContext = {
  route?: string;
  examType?: string;
  subject?: string;
  topic?: string;
  lessonId?: string;
  questionId?: string;
  questionText?: string;
  questionOptions?: Record<string, string> | null;
  selectedAnswer?: string | null;
  correctAnswer?: string | null;
  explanation?: string | null;
  questionElapsedSeconds?: number;
  lessonProgress?: string;
  imageUrl?: string | null;
  imagePath?: string | null;
  mediaId?: string | null;
  weakTopics?: string;
  openWrongs?: number;
  planPct?: number;
  weeklySummary?: string;
};

export type ActiveCoachQuestion = {
  id: string;
  stem: string;
  choices: Record<string, string> | null;
};

const CONTEXT_KEYS: (keyof CoachAppContext)[] = [
  'route',
  'examType',
  'subject',
  'topic',
  'lessonId',
  'questionId',
  'questionText',
  'questionOptions',
  'selectedAnswer',
  'correctAnswer',
  'explanation',
  'questionElapsedSeconds',
  'lessonProgress',
  'imageUrl',
  'imagePath',
  'mediaId',
  'weakTopics',
  'openWrongs',
  'planPct',
  'weeklySummary',
];

export function compactCoachContext(input: CoachAppContext): CoachAppContext {
  const out: CoachAppContext = {};
  for (const key of CONTEXT_KEYS) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export function tabBarPad(bottomInset: number) {
  return Math.max(bottomInset, 10) + 10;
}

export function tabBarHeight(bottomInset: number) {
  return TAB_BAR_BODY_HEIGHT + tabBarPad(bottomInset);
}

export function coachBottomOffset(bottomInset: number, onTabs: boolean, extra = 0) {
  return onTabs ? tabBarHeight(bottomInset) + extra : Math.max(bottomInset, 12);
}

export function edgeX(side: CoachSide, width: number) {
  return side === 'left' ? COACH_FAB_MARGIN : width - COACH_FAB_SIZE - COACH_FAB_MARGIN;
}

export function yBounds(height: number, topInset: number, bottomOffset: number) {
  const minY = topInset + 8;
  const maxY = Math.max(minY, height - COACH_FAB_SIZE - bottomOffset - 8);
  return { minY, maxY };
}

export function clampY(y: number, height: number, topInset: number, bottomOffset: number) {
  const { minY, maxY } = yBounds(height, topInset, bottomOffset);
  return Math.min(maxY, Math.max(minY, y));
}

export function yFromRatio(ratio: number, height: number, topInset: number, bottomOffset: number) {
  const { minY, maxY } = yBounds(height, topInset, bottomOffset);
  const t = Math.min(1, Math.max(0, ratio));
  return minY + t * (maxY - minY);
}

export function ratioFromY(y: number, height: number, topInset: number, bottomOffset: number) {
  const { minY, maxY } = yBounds(height, topInset, bottomOffset);
  const span = Math.max(1, maxY - minY);
  return Math.min(1, Math.max(0, (y - minY) / span));
}

export function snapSide(x: number, width: number): CoachSide {
  return x + COACH_FAB_SIZE / 2 < width / 2 ? 'left' : 'right';
}
