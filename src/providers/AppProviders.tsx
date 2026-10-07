import { QueryClientProvider } from '@tanstack/react-query';
import { type Session } from '@supabase/supabase-js';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';

import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { FeedbackHost } from '@/src/components/ui/FeedbackHost';
import { XpFeedbackHost } from '@/src/features/progress/XpFeedbackHost';
import { useNotificationRealtime } from '@/src/features/study/useNotificationRealtime';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import {
  consumeAuthLinkError,
  isUserEmailVerified,
  stripAuthHashFromUrl,
} from '@/src/lib/auth/emailVerification';
import { isSupabaseConfigured } from '@/src/lib/env';
import { queryClient } from '@/src/lib/query/client';
import { releaseUserChannels } from '@/src/lib/realtime/retainChannel';
import { getSupabase } from '@/src/lib/supabase/client';
import { clearRpcMissing } from '@/src/lib/supabase/rpcStatus';
import { AppThemeProvider } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function AuthBootstrap({ children }: { children: ReactNode }) {
  const setConfigured = useAuthStore((s) => s.setConfigured);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const setSession = useAuthStore((s) => s.setSession);
  const reset = useAuthStore((s) => s.reset);
  const initialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    const configured = isSupabaseConfigured();
    setConfigured(configured);

    if (!configured) {
      setInitialized(true);
      SplashScreen.hideAsync().catch(() => undefined);
      return;
    }

    const supabase = getSupabase();
    consumeAuthLinkError();
    let dropping = false;

    const clearClientAuth = (previousId?: string) => {
      if (previousId) releaseUserChannels(previousId);
      clearRpcMissing();
      queryClient.clear();
      AnalyticsProvider.reset();
      reset();
      setSession(null);
    };

    const dropGhostSession = async (previousId?: string) => {
      if (dropping) return;
      dropping = true;
      try {
        clearClientAuth(previousId);
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      } finally {
        dropping = false;
      }
    };

    const applySession = async (session: Session | null) => {
      if (dropping) return;
      const previousId = useAuthStore.getState().session?.user.id;

      if (!session?.user) {
        if (previousId) clearClientAuth(previousId);
        else {
          reset();
          setSession(null);
        }
        return;
      }

      const { data: userRes, error: userError } = await supabase.auth.getUser();
      if (dropping) return;
      if (userError || !userRes.user) {
        const msg = (userError?.message ?? '').toLowerCase();
        if (msg.includes('email not confirmed')) {
          setSession(session);
          return;
        }
        await dropGhostSession(previousId ?? session.user.id);
        return;
      }

      if (previousId && previousId !== userRes.user.id) {
        releaseUserChannels(previousId);
        clearRpcMissing();
      }
      setSession({ ...session, user: userRes.user });
      if (isUserEmailVerified(userRes.user)) {
        useAuthStore.getState().setEmailLinkError(false);
      }
      try {
        await fetchAuthExtras(userRes.user.id);
        AnalyticsProvider.identify(userRes.user.id, { email: userRes.user.email });
      } catch (error) {
        console.warn('Profil yüklenemedi', error);
      }
    };

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        await applySession(data.session);
        stripAuthHashFromUrl();
      })
      .catch((error) => {
        console.warn('Oturum okunamadı', error);
      })
      .finally(() => {
        stripAuthHashFromUrl();
        setInitialized(true);
        SplashScreen.hideAsync().catch(() => undefined);
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if (dropping) return;
      void applySession(session);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [reset, setConfigured, setInitialized, setSession]);

  useEffect(() => {
    if (initialized) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [initialized]);

  return <>{children}</>;
}

function NotificationRealtimeHost() {
  useNotificationRealtime();
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  useFonts({
    ionicons: require('../../assets/fonts/Ionicons.ttf'),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <AppThemeProvider>
        <AuthBootstrap>
          <NotificationRealtimeHost />
          {children}
          <XpFeedbackHost />
          <FeedbackHost />
        </AuthBootstrap>
      </AppThemeProvider>
    </QueryClientProvider>
  );
}
