import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import type { Profile, Subscription, SubscriptionPlan } from '@/src/lib/supabase/types';

type AuthState = {
  configured: boolean;
  initialized: boolean;
  session: Session | null;
  profile: Profile | null;
  subscription: Subscription | null;
  setConfigured: (configured: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setSubscription: (subscription: Subscription | null) => void;
  plan: () => SubscriptionPlan;
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  configured: false,
  initialized: false,
  session: null,
  profile: null,
  subscription: null,
  setConfigured: (configured) => set({ configured }),
  setInitialized: (initialized) => set({ initialized }),
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setSubscription: (subscription) => set({ subscription }),
  plan: () => get().subscription?.plan ?? 'free',
  reset: () =>
    set({
      session: null,
      profile: null,
      subscription: null,
    }),
}));
