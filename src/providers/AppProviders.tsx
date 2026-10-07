import { QueryClientProvider } from '@tanstack/react-query';
import { type Session } from '@supabase/supabase-js';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';

import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { FeedbackHost } from '@/src/components/ui/FeedbackHost';
import { XpFeedbackHost } from '@/src/features/progress/XpFeedbackHost';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { isSupabaseConfigured } from '@/src/lib/env';
import { queryClient } from '@/src/lib/query/client';
import { getSupabase } from '@/src/lib/supabase/client';
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

    const applySession = async (session: Session | null) => {
      setSession(session);
      if (session?.user) {
        try {
          await fetchAuthExtras(session.user.id);
          AnalyticsProvider.identify(session.user.id, { email: session.user.email });
        } catch (error) {
          console.warn('Profil yüklenemedi', error);
        }
      } else {
        reset();
        setSession(null);
      }
    };

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        await applySession(data.session);
      })
      .catch((error) => {
        console.warn('Oturum okunamadı', error);
      })
      .finally(() => {
        setInitialized(true);
        SplashScreen.hideAsync().catch(() => undefined);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
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

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppThemeProvider>
        <AuthBootstrap>
          {children}
          <XpFeedbackHost />
          <FeedbackHost />
        </AuthBootstrap>
      </AppThemeProvider>
    </QueryClientProvider>
  );
}
