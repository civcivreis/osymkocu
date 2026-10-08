import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { StartupLoading } from '@/src/features/auth/StartupLoading';
import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import {
  clearPendingVerifyEmail,
  consumeAuthLinkError,
  isUserEmailVerified,
  paramsFromLocation,
  stripAuthHashFromUrl,
  verifiedHomeHref,
} from '@/src/lib/auth/emailVerification';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

async function waitForSession(ms = 2500) {
  const started = Date.now();
  const supabase = getSupabase();
  while (Date.now() - started < ms) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

export function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  const [failed, setFailed] = useState(false);
  const setEmailLinkError = useAuthStore((s) => s.setEmailLinkError);

  useEffect(() => {
    let cancelled = false;

    const goVerify = () => {
      setEmailLinkError(true);
      setFailed(true);
      router.replace('/verify-email' as never);
    };

    const run = async () => {
      const queryError = Array.isArray(params.error) ? params.error[0] : params.error;
      if (queryError || (Platform.OS === 'web' && consumeAuthLinkError())) {
        stripAuthHashFromUrl();
        goVerify();
        return;
      }

      const supabase = getSupabase();
      const webParams = Platform.OS === 'web' ? paramsFromLocation() : new URLSearchParams();
      const routeCode = Array.isArray(params.code) ? params.code[0] : params.code;
      const code = routeCode || webParams.get('code');

      try {
        if (code) {
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              console.warn('auth callback code', error.message);
              goVerify();
              return;
            }
          }
        }

        let session = (await supabase.auth.getSession()).data.session;
        if (!session) session = await waitForSession();
        if (cancelled) return;

        stripAuthHashFromUrl();

        if (!session?.user) {
          goVerify();
          return;
        }

        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes.user ?? session.user;
        if (!isUserEmailVerified(user)) {
          goVerify();
          return;
        }

        setEmailLinkError(false);
        clearPendingVerifyEmail();
        try {
          await fetchAuthExtras(user.id);
        } catch (error) {
          console.warn('auth callback profile', error);
        }
        if (cancelled) return;
        const onboarded = Boolean(useAuthStore.getState().profile?.onboarding_completed_at);
        router.replace(verifiedHomeHref(onboarded) as never);
      } catch (error) {
        console.warn('auth callback', error);
        if (!cancelled) goVerify();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_description, setEmailLinkError]);

  if (failed) return null;
  return <StartupLoading />;
}
