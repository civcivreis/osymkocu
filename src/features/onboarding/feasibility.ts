import type { ExamKind } from '@/src/lib/supabase/types';
import { daysUntil } from '@/src/lib/time/greeting';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';

export type FeasibilityStatus = 'realistic' | 'stretch' | 'unrealistic';

export type Feasibility = {
  status: FeasibilityStatus;
  chosen: number;
  suggested: number;
  days: number;
  dailyMinutes: number;
  message: string;
};

function isKpss(kind: ExamKind): boolean {
  return kind === 'kpss_lisans' || kind === 'kpss_onlisans';
}

export function goalOptions(kind: ExamKind): number[] {
  return isKpss(kind) ? [70, 80, 90] : [200, 300, 400];
}

export function formatGoal(score: number): string {
  return `${score}+`;
}

export function typicalExamIso(kind: ExamKind, year: number): string {
  if (isKpss(kind)) return `${year}-09-07`;
  return `${year}-06-15`;
}

export function remainingStudyDays(input: {
  kind: ExamKind;
  examDate: string | null;
  examYear: number | null;
  now?: Date;
}): number {
  const iso =
    input.examDate ??
    (input.examYear != null ? typicalExamIso(input.kind, input.examYear) : todayIsoIstanbul(input.now));
  return Math.max(1, daysUntil(iso, input.now) ?? 1);
}

function hoursNeeded(kind: ExamKind, score: number): number {
  if (isKpss(kind)) {
    if (score <= 70) return 60;
    if (score >= 90) return 280;
    return 60 + ((score - 70) / 10) * 80;
  }
  if (score <= 200) return Math.max(40, 80 - ((200 - score) / 50) * 20);
  if (score <= 300) return 80 + ((score - 200) / 100) * 100;
  if (score >= 400) return 350;
  return 180 + ((score - 300) / 100) * 170;
}

function suggestionLadder(kind: ExamKind): number[] {
  return isKpss(kind) ? [90, 80, 70, 60] : [400, 350, 300, 250, 200, 150];
}

function highestFit(kind: ExamKind, capacityHours: number, ratio: number): number {
  const ladder = suggestionLadder(kind);
  const floor = ladder[ladder.length - 1] ?? 150;
  for (const score of ladder) {
    if (capacityHours >= hoursNeeded(kind, score) * ratio) return score;
  }
  return floor;
}

export function assessFeasibility(input: {
  kind: ExamKind;
  examDate: string | null;
  examYear: number | null;
  dailyMinutes: number;
  chosen: number;
  now?: Date;
}): Feasibility {
  const days = remainingStudyDays(input);
  const dailyMinutes = input.dailyMinutes;
  const chosen = input.chosen;
  const capacityHours = (days * dailyMinutes) / 60;
  const needed = hoursNeeded(input.kind, chosen);

  let status: FeasibilityStatus = 'unrealistic';
  if (capacityHours >= needed) status = 'realistic';
  else if (capacityHours >= needed * 0.65) status = 'stretch';

  const suggested =
    status === 'unrealistic' ? highestFit(input.kind, capacityHours, 1) : chosen;

  const goal = formatGoal(chosen);
  const alt = formatGoal(suggested);
  let message = `Bu tempo ile ${goal} mümkün.`;
  if (status === 'stretch') {
    message = `Zaman dar. ${goal} sıkı ama çıkmışlara yaslanırsak mümkün.`;
  } else if (status === 'unrealistic') {
    message = `Sınava ${days} gün var, günde ${dailyMinutes} dk ile ${goal} tutmaz. Çıkmış konulara odaklanırsak ${alt} daha gerçekçi.`;
  }

  return { status, chosen, suggested, days, dailyMinutes, message };
}
