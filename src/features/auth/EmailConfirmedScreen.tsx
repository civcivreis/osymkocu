import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Screen } from '@/src/components/ui/Screen';
import { BrandLogo } from '@/src/components/brand/BrandLogo';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { fetchAuthExtras, resendSignupEmail } from '@/src/features/auth/useAuth';
import * as Linking from 'expo-linking';

import {
  clearPendingVerifyEmail,
  consumeAuthLinkError,
  isUserEmailVerified,
  paramsFromHref,
  paramsFromLocation,
  readPendingVerifyEmail,
  stripAuthHashFromUrl,
  verifiedHomeHref,
} from '@/src/lib/auth/emailVerification';
import { APP_NAME } from '@/src/lib/brand';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

type Phase = 'working' | 'ok' | 'invalid';

export function EmailConfirmedScreen() {
  const { spacing } = useAppTheme();
  const session = useAuthStore((s) => s.session);
  const onboarded = Boolean(useAuthStore((s) => s.profile?.onboarding_completed_at));
  const [phase, setPhase] = useState<Phase>('working');
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const done = { current: false };

    const fail = () => {
      if (!cancelled) setPhase('invalid');
    };

    const ok = () => {
      if (!cancelled) setPhase('ok');
    };

    const run = async () => {
      if (Platform.OS === 'web' && consumeAuthLinkError()) {
        stripAuthHashFromUrl();
        fail();
        return;
      }

      const supabase = getSupabase();
      const nativeUrl = Platform.OS === 'web' ? null : await Linking.getInitialURL();
      const params = Platform.OS === 'web' ? paramsFromLocation() : paramsFromHref(nativeUrl);
      const code = params.get('code');

      try {
        if (code) {
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              fail();
              return;
            }
          }
        }

        const { data } = await supabase.auth.getSession();
        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes.user ?? data.session?.user;
        stripAuthHashFromUrl();

        if (done.current) return;
        if (user && isUserEmailVerified(user)) {
          done.current = true;
          clearPendingVerifyEmail();
          useAuthStore.getState().setEmailLinkError(false);
          try {
            await fetchAuthExtras(user.id);
          } catch {
            /* profile can load later */
          }
          ok();
          return;
        }

        if (data.session && !isUserEmailVerified(user)) {
          fail();
          return;
        }

        if (!code && !params.get('error')) {
          if (isUserEmailVerified(session?.user)) {
            ok();
            return;
          }
          fail();
          return;
        }
        fail();
      } catch {
        fail();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const email = session?.user.email || readPendingVerifyEmail() || '';

  const sendAgain = async () => {
    if (!email || busy) return;
    setBusy(true);
    setResent(null);
    try {
      await resendSignupEmail(email);
      setResent('Yeni doğrulama bağlantısını gönderdik.');
    } catch (error) {
      setResent(error instanceof Error ? error.message : 'Mail gönderilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll center>
      <SeoHead title={`Üyelik onaylandı | ${APP_NAME}`} path="/email-confirmed" index={false} />
      <View style={{ gap: spacing.xl, width: '100%', maxWidth: 440, alignSelf: 'center', alignItems: 'center' }}>
        <BrandLogo variant="full" width={220} />
        {phase === 'working' ? <AppText tone="muted">Onay kontrol ediliyor…</AppText> : null}

        {phase === 'ok' ? (
          <>
            <AppText variant="display" style={{ textAlign: 'center' }}>
              Üyeliğiniz onaylandı ✓
            </AppText>
            <AppText tone="muted" style={{ textAlign: 'center' }}>
              Artık ÖSYM Koçu hesabınla giriş yapabilirsin.
            </AppText>
            {session ? (
              <Button
                label="Ana Sayfaya Git"
                onPress={() => router.replace(verifiedHomeHref(onboarded) as never)}
              />
            ) : (
              <Button label="Giriş Yap" onPress={() => router.replace('/giris' as never)} />
            )}
          </>
        ) : null}

        {phase === 'invalid' ? (
          <>
            <AppText variant="display" style={{ textAlign: 'center' }}>
              Bağlantı geçersiz
            </AppText>
            <AppText tone="muted" style={{ textAlign: 'center' }}>
              Bu doğrulama bağlantısının süresi dolmuş veya geçersiz.
            </AppText>
            {resent ? (
              <AppText variant="caption" style={{ textAlign: 'center' }}>
                {resent}
              </AppText>
            ) : null}
            <Button
              label="Yeni doğrulama e-postası gönder"
              loading={busy}
              disabled={!email}
              onPress={() => {
                void sendAgain();
              }}
            />
            <Button label="Giriş Yap" variant="ghost" onPress={() => router.replace('/giris' as never)} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
