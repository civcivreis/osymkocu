import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  compactCoachContext,
  type CoachAppContext,
  type CoachSide,
} from '@/src/features/teacher/coachLayout';
import type { TeacherMessage } from '@/src/features/teacher/useTeacher';
import { TEACHER_WELCOME } from '@/src/features/teacher/welcome';

type CoachState = {
  open: boolean;
  hydrated: boolean;
  messages: TeacherMessage[];
  side: CoachSide;
  yRatio: number;
  hintsEnabled: boolean;
  routeMeta: Pick<CoachAppContext, 'route' | 'examType'>;
  progressContext: CoachAppContext;
  screenContext: CoachAppContext;
  helpOffer: boolean;
  helpShownIds: string[];
  queuedLesson: string | null;
  coachLocked: boolean;
  questionIdleMs: number;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setMessages: (messages: TeacherMessage[] | ((current: TeacherMessage[]) => TeacherMessage[])) => void;
  hydrate: (messages: TeacherMessage[]) => void;
  setDock: (side: CoachSide, yRatio: number) => void;
  setRouteMeta: (meta: Pick<CoachAppContext, 'route' | 'examType'>) => void;
  setProgressContext: (context: CoachAppContext) => void;
  setScreenContext: (context: CoachAppContext | null) => void;
  setHelpOffer: (helpOffer: boolean) => void;
  markHintShown: (questionId: string) => void;
  setQuestionIdleMs: (ms: number) => void;
  queueLesson: (question: string) => void;
  clearQueuedLesson: () => void;
  setCoachLocked: (coachLocked: boolean) => void;
  setHintsEnabled: (hintsEnabled: boolean) => void;
  contextPayload: () => CoachAppContext;
  reset: () => void;
};

export const useCoachStore = create<CoachState>()(
  persist(
    (set, get) => ({
      open: false,
      hydrated: false,
      messages: [TEACHER_WELCOME],
      side: 'right',
      yRatio: 0.55,
      hintsEnabled: true,
      routeMeta: {},
      progressContext: {},
      screenContext: {},
      helpOffer: false,
      helpShownIds: [],
      queuedLesson: null,
      coachLocked: false,
      questionIdleMs: 0,
      setOpen: (open) => set({ open, helpOffer: open ? false : get().helpOffer }),
      toggleOpen: () => set({ open: !get().open }),
      setMessages: (messages) =>
        set({
          messages: typeof messages === 'function' ? messages(get().messages) : messages,
        }),
      hydrate: (messages) => set({ messages, hydrated: true }),
      setDock: (side, yRatio) => set({ side, yRatio }),
      setRouteMeta: (routeMeta) => set({ routeMeta }),
      setProgressContext: (progressContext) => set({ progressContext }),
      setScreenContext: (context) => {
        const prevId = get().screenContext.questionId;
        const nextId = context?.questionId;
        const sameQuestion = Boolean(nextId && nextId === prevId);
        const answered = Boolean(context?.selectedAnswer || context?.correctAnswer);
        set({
          screenContext: context ?? {},
          helpOffer: answered ? false : sameQuestion ? get().helpOffer : false,
          questionIdleMs: sameQuestion ? get().questionIdleMs : 0,
        });
      },
      setHelpOffer: (helpOffer) => set({ helpOffer }),
      markHintShown: (questionId) =>
        set({
          helpShownIds: [...new Set([...get().helpShownIds, questionId])],
          helpOffer: true,
        }),
      setQuestionIdleMs: (questionIdleMs) => set({ questionIdleMs }),
      queueLesson: (question) => set({ open: true, queuedLesson: question, helpOffer: false }),
      clearQueuedLesson: () => set({ queuedLesson: null }),
      setCoachLocked: (coachLocked) =>
        set({
          coachLocked,
          open: coachLocked ? false : get().open,
          helpOffer: coachLocked ? false : get().helpOffer,
        }),
      setHintsEnabled: (hintsEnabled) => set({ hintsEnabled, helpOffer: hintsEnabled ? get().helpOffer : false }),
      contextPayload: () => {
        const state = get();
        const seconds = Math.floor(state.questionIdleMs / 1000);
        return compactCoachContext({
          ...state.routeMeta,
          ...state.progressContext,
          ...state.screenContext,
          questionElapsedSeconds: seconds > 0 ? seconds : undefined,
        });
      },
      reset: () =>
        set({
          open: false,
          hydrated: false,
          messages: [TEACHER_WELCOME],
          routeMeta: {},
          progressContext: {},
          screenContext: {},
          helpOffer: false,
          helpShownIds: [],
          queuedLesson: null,
          coachLocked: false,
          questionIdleMs: 0,
        }),
    }),
    {
      name: 'kocum.coachFab.side',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        side: state.side,
        yRatio: state.yRatio,
        hintsEnabled: state.hintsEnabled,
      }),
      version: 2,
      migrate: (persisted) => {
        const row = persisted as {
          side?: CoachSide;
          yRatio?: number;
          corner?: string;
          hintsEnabled?: boolean;
        };
        const side: CoachSide =
          row.side === 'left' || row.side === 'right'
            ? row.side
            : row.corner?.endsWith('l')
              ? 'left'
              : 'right';
        const yRatio =
          typeof row.yRatio === 'number'
            ? row.yRatio
            : row.corner?.startsWith('t')
              ? 0.18
              : 0.62;
        return { side, yRatio, hintsEnabled: row.hintsEnabled !== false } as never;
      },
    },
  ),
);

export const useCoach = useCoachStore;
