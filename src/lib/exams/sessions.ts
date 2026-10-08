import type { Exam, ExamKind, ExamSession } from '@/src/lib/supabase/types';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';

/** YKS June, KPSS typically September. After that month, that year is no longer offered. */
function typicalMonth(kind: ExamKind): number {
  if (kind === 'tyt' || kind === 'ayt' || kind === 'tyt_ayt') return 6;
  return 9;
}

export function upcomingSessionYears(kind: ExamKind, todayIso = todayIsoIstanbul(), slug?: string): number[] {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const typical = typicalMonth(kind);

  if (kind === 'kpss_onlisans' && slug !== 'kpss_ortaogretim') {
    let first = year % 2 === 0 ? year : year + 1;
    if (first === year && month >= typical) first += 2;
    return [first, first + 2];
  }

  const first = month >= typical ? year + 1 : year;
  return [first, first + 1];
}

export function sessionLabel(exam: Exam, year: number): string {
  if (exam.kind === 'tyt_ayt') return `YKS ${year}`;
  return `${exam.name} ${year}`;
}

export function buildUpcomingSessions(
  exam: Exam,
  stored: Array<Pick<ExamSession, 'id' | 'session_year' | 'exam_date' | 'label'>> = [],
  todayIso = todayIsoIstanbul(),
): ExamSession[] {
  const years = upcomingSessionYears(exam.kind, todayIso, exam.slug);
  const byYear = new Map(stored.map((row) => [row.session_year, row]));

  return years.flatMap((year) => {
    const row = byYear.get(year);
    if (row?.exam_date && row.exam_date < todayIso) return [];
    return [
      {
        id: row?.id ?? `${exam.id}-${year}`,
        exam_id: exam.id,
        session_year: year,
        exam_date: row?.exam_date ?? null,
        label: row?.label ?? sessionLabel(exam, year),
      },
    ];
  });
}
