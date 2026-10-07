import { create } from 'zustand';

import type { MatchOffer } from '@/src/features/study/useStudyPresence';

export type IncomingStudyMatch = {
  variant: 'auto' | 'manual';
  requestId: string;
  userId: string;
  displayName: string;
  displayTag?: number | null;
  avatarUrl?: string | null;
  subjectName?: string | null;
  topicName?: string | null;
  waiting?: boolean;
  expired?: boolean;
};

function fromOffer(offer: MatchOffer): IncomingStudyMatch {
  return {
    variant: 'auto',
    requestId: offer.id,
    userId: offer.other_id,
    displayName: offer.other_name,
    displayTag: offer.other_tag,
    avatarUrl: offer.other_avatar,
    subjectName: offer.subject_name,
    topicName: offer.topic_name,
    waiting: offer.my_yes === true,
    expired: offer.expired || offer.status === 'expired',
  };
}

type State = {
  incoming: IncomingStudyMatch | null;
  setOffer: (offer: MatchOffer | null) => void;
  setIncoming: (incoming: IncomingStudyMatch | null) => void;
  clear: (id?: string) => void;
};

export const useMatchInviteStore = create<State>((set, get) => ({
  incoming: null,
  setOffer: (offer) => {
    if (!offer || offer.status !== 'pending' || offer.expired) {
      const current = get().incoming;
      if (current?.variant === 'auto' && offer && current.requestId === offer.id) {
        set({ incoming: null });
      }
      return;
    }
    set({ incoming: fromOffer(offer) });
  },
  setIncoming: (incoming) => set({ incoming }),
  clear: (id) => {
    const current = get().incoming;
    if (!id || current?.requestId === id) set({ incoming: null });
  },
}));
