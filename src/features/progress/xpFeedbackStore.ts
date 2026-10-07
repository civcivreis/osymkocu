import { create } from 'zustand';

type XpToast = {
  xp: number;
  title: string;
};

type XpFeedbackState = {
  toast: XpToast | null;
  levelUp: number | null;
  showToast: (xp: number, title: string) => void;
  showLevelUp: (level: number) => void;
  clearToast: () => void;
  clearLevelUp: () => void;
};

export const useXpFeedbackStore = create<XpFeedbackState>((set) => ({
  toast: null,
  levelUp: null,
  showToast: (xp, title) => set({ toast: { xp, title } }),
  showLevelUp: (level) => set({ levelUp: level }),
  clearToast: () => set({ toast: null }),
  clearLevelUp: () => set({ levelUp: null }),
}));
