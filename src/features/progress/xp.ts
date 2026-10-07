import { useXpFeedbackStore } from '@/src/features/progress/xpFeedbackStore';
import { useAuthStore } from '@/src/stores/authStore';

export const XP_BASE = 120;
export const XP_GROWTH = 1.16;
export const XP_MAX_LEVEL = 99;

export function getXpForNextLevel(level: number) {
  const safe = Math.max(1, Math.min(XP_MAX_LEVEL, Math.floor(level)));
  return Math.max(1, Math.round(XP_BASE * XP_GROWTH ** (safe - 1)));
}

export function getLevelFromXp(totalXp: number) {
  let remaining = Math.max(0, Math.floor(totalXp));
  let level = 1;
  while (level < XP_MAX_LEVEL) {
    const need = getXpForNextLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return level;
}

export function getLevelProgress(totalXp: number) {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = getLevelFromXp(xp);
  let consumed = 0;
  for (let i = 1; i < level; i += 1) consumed += getXpForNextLevel(i);
  const xpInLevel = Math.max(0, xp - consumed);
  const xpForNext = getXpForNextLevel(level);
  return {
    level,
    totalXp: xp,
    xpInLevel,
    xpForNext,
    ratio: xpForNext > 0 ? Math.min(1, xpInLevel / xpForNext) : 1,
  };
}

export function formatXp(value: number) {
  return Math.max(0, Math.floor(value)).toLocaleString('tr-TR');
}

export type XpAwardResult = {
  awarded?: boolean;
  amount?: number;
  total_xp?: number;
  previous_xp?: number;
  level?: number;
  previous_level?: number;
};

export function applyXpAward(result: XpAwardResult | null | undefined, title: string) {
  if (!result) return;
  const amount = Number(result.amount ?? 0);
  const total = Number(result.total_xp ?? 0);
  const previous = Number(result.previous_xp ?? Math.max(0, total - amount));
  const profile = useAuthStore.getState().profile;
  if (profile && Number.isFinite(total) && total >= 0) {
    useAuthStore.getState().setProfile({ ...profile, current_xp: total });
  }
  const prevLevel = Number(result.previous_level ?? getLevelFromXp(previous));
  const nextLevel = Number(result.level ?? getLevelFromXp(total || previous + amount));
  if (nextLevel > prevLevel) useXpFeedbackStore.getState().showLevelUp(nextLevel);
  if (result.awarded && amount > 0) useXpFeedbackStore.getState().showToast(amount, title);
}

export const WEEKDAY_LETTERS = ['P', 'S', 'Ç', 'P', 'C', 'C', 'P'] as const;

export function weekdayLetterIstanbul(isoDate: string) {
  const day = new Date(`${isoDate}T12:00:00+03:00`).getDay();
  return WEEKDAY_LETTERS[(day + 6) % 7];
}
