import type { MemoryLessonQuestion } from './types';

export const DEFAULT_NEXT_COUNTDOWN = 10;
export const MAX_RETRY = 3;

export type CorrectAction = 'resume' | 'next';
export type WrongAction = 'show_detail_then_retry' | 'retry';

export type LessonCue = {
  appear_at_ms: number;
  event_type: string;
  questionText: string;
  choices: Record<string, string>;
  correct: string;
  onCorrect: CorrectAction;
  onWrong: WrongAction;
  resume_ms: number;
  explanation: string;
  retryRequired: boolean;
};

export function optionList(question: { options?: unknown } | null | undefined) {
  const raw = question?.options;
  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      if (typeof item === 'string') return { key: String.fromCharCode(65 + index), text: item };
      const rec = item as { key?: string; text?: string };
      return { key: rec.key ?? String.fromCharCode(65 + index), text: rec.text ?? '' };
    });
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, string>).map(([key, text]) => ({ key, text: String(text) }));
  }
  return [] as { key: string; text: string }[];
}

export function cueAsQuestion(cue: LessonCue, lessonId: string): MemoryLessonQuestion {
  return {
    id: `cue-${cue.appear_at_ms}`,
    lesson_id: lessonId,
    question_type: 'checkpoint',
    question_order: 1,
    question_text: cue.questionText,
    options: cue.choices,
    correct_answer: cue.correct,
    explanation: cue.explanation,
    related_scene_id: null,
    wrong_feedback: cue.onWrong === 'retry' ? 'hap' : 'detail',
    created_at: new Date().toISOString(),
  };
}

export function parseCuePayload(row: { event_type?: string; appear_at_ms?: number; payload?: unknown }): LessonCue {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const choices = (payload.choices ?? {}) as Record<string, string>;
  const onCorrect = payload.on_correct === 'next' ? 'next' : 'resume';
  const onWrong = payload.on_wrong === 'retry' ? 'retry' : 'show_detail_then_retry';
  const resume = Number(payload.resume_ms ?? row.appear_at_ms ?? 0);
  return {
    appear_at_ms: Number(row.appear_at_ms ?? 0),
    event_type: String(row.event_type ?? 'question'),
    questionText: String(payload.text ?? payload.question ?? ''),
    choices: {
      A: String(choices.A ?? ''),
      B: String(choices.B ?? ''),
      C: String(choices.C ?? ''),
      D: String(choices.D ?? ''),
    },
    correct: String(payload.correct ?? 'B'),
    onCorrect,
    onWrong,
    resume_ms: Number.isFinite(resume) ? resume : 0,
    explanation: String(payload.explanation ?? ''),
    retryRequired: payload.retry_required !== false,
  };
}
