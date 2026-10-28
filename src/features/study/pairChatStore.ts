import { create } from 'zustand';

export type PairChatSession = {
  sessionId: string;
  otherName: string;
  otherId?: string;
  unread: number;
  expanded: boolean;
  solo?: boolean;
};

type PairChatState = {
  session: PairChatSession | null;
  attach: (input: { sessionId: string; otherName: string; otherId?: string }) => void;
  bumpUnread: () => void;
  clearUnread: () => void;
  setExpanded: (expanded: boolean) => void;
  markSolo: () => void;
  end: () => void;
};

export const usePairChatStore = create<PairChatState>((set, get) => ({
  session: null,
  attach: (input) =>
    set({
      session: {
        sessionId: input.sessionId,
        otherName: input.otherName,
        otherId: input.otherId,
        unread: 0,
        expanded: false,
        solo: false,
      },
    }),
  bumpUnread: () => {
    const current = get().session;
    if (!current || current.expanded) return;
    set({ session: { ...current, unread: current.unread + 1 } });
  },
  clearUnread: () => {
    const current = get().session;
    if (!current) return;
    set({ session: { ...current, unread: 0 } });
  },
  setExpanded: (expanded) => {
    const current = get().session;
    if (!current) return;
    set({ session: { ...current, expanded, unread: expanded ? 0 : current.unread } });
  },
  markSolo: () => {
    const current = get().session;
    if (!current) return;
    set({ session: { ...current, solo: true } });
  },
  end: () => set({ session: null }),
}));
