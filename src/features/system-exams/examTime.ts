export const EXAM_TIME_SLOTS = ['20:00', '20:30', '21:00', '21:30', '22:00'] as const;
export const DEFAULT_EXAM_SLOT = '21:00';

export type SystemExamType = 'tyt' | 'ayt' | 'kpss';
export type SystemExamStatus = 'draft' | 'scheduled' | 'live' | 'finished' | 'cancelled';

export type SystemExamListItem = {
  id: string;
  title: string;
  exam_type: SystemExamType;
  description?: string | null;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  question_count: number;
  status: SystemExamStatus;
  reminded?: boolean;
  attempt_id?: string | null;
  attempt_status?: string | null;
  score?: number | null;
  rank?: number | null;
  total_correct?: number | null;
  total_wrong?: number | null;
  total_blank?: number | null;
  signup_count?: number;
  live_count?: number;
};

export type SystemExamPlayQuestion = {
  id: string;
  sort_order: number;
  stem: string;
  choices: Record<string, string> | null;
  subject_name?: string | null;
  topic_name?: string | null;
  selected_option?: string | null;
  marked_for_review?: boolean;
  image_url?: string | null;
};

export type SystemExamPlay = {
  exam: {
    id: string;
    title: string;
    exam_type: SystemExamType;
    duration_minutes: number;
    question_count: number;
    end_at: string;
  };
  attempt: {
    id: string;
    status: string;
    current_question_index: number;
    remaining_seconds: number;
    started_at: string;
    submitted_at?: string | null;
  };
  questions: SystemExamPlayQuestion[];
};

export function formatIstanbulDateTime(iso: string) {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return { day, time, label: `${day} • ${time}` };
}

export function countdownLabel(startIso: string, now = Date.now()) {
  const diff = Date.parse(startIso) - now;
  if (!Number.isFinite(diff) || diff <= 0) return 'Başladı';
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} gün ${hours} saat kaldı`;
  if (hours > 0) return `${hours} saat ${mins} dk kaldı`;
  return `${Math.max(1, mins)} dk kaldı`;
}

export function clockLabel(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function examTypeLabel(type: string) {
  if (type === 'tyt') return 'TYT';
  if (type === 'ayt') return 'AYT';
  if (type === 'kpss') return 'KPSS';
  return type.toUpperCase();
}

export function defaultDuration(type: SystemExamType) {
  if (type === 'ayt') return 180;
  if (type === 'kpss') return 130;
  return 165;
}

export function buildIstanbulStart(dateIso: string, slot: string) {
  const [hour, minute] = slot.split(':').map(Number);
  return `${dateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`;
}
