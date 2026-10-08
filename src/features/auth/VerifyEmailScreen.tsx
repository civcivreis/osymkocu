import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Screen } from '@/src/components/ui/Screen';
import { resendSignupEmail, useAuthActions } from '@/src/features/auth/useAuth';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { BrandLogo } from '@/src/components/brand/BrandLogo';
import {
  clearPendingVerifyEmail,
  isEmailVerified,
  readPendingVerifyEmail,
  verifiedHomeHref,
} from '@/src/lib/auth/emailVerification';
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

const RESEND_COOLDOWN_MS = 60_000;
const resendReadyAt = new Map<string, number>();

function emailFromParams(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return (raw[0] ?? '').trim();
  return (raw ?? '').trim();
}

export function VerifyEmailScreen() {
  const { spacing, colors, radius, shadows } = useAppTheme();
  const { signOut } = useAuthActions();
  const params = useLocalSearchParams<{ email?: string }>();
  const session = useAuthStore((s) => s.session);
  const onboarded = Boolean(useAuthStore((s) => s.profile?.onboarding_completed_at));
  const emailLinkError = useAuthStore((s) => s.emailLinkError);
  const setEmailLinkError = useAuthStore((s) => s.setEmailLinkError);

  const email = useMemo(() => {
    const fromParam = emailFromParams(params.email);
    if (fromParam) return fromParam;
    if (session?.user.email) return session.user.email;
    return readPendingVerifyEmail() ?? '';
  }, [params.email, session?.user.email]);

  const [now, setNow] = useState(() => Date.now());
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendInfo, setResendInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);

  if (email) {
    const key = email.toLowerCase();
    if (!resendReadyAt.has(key)) {
      resendReadyAt.set(key, Date.now() + RESEND_COOLDOWN_MS);
    }
  }

  const remainingSec = useMemo(() => {
    if (!email) return 0;
    const ready = resendReadyAt.get(email.toLowerCase()) ?? 0;
    return Math.max(0, Math.ceil((ready - now) / 1000));
  }, [email, now]);

  useEffect(() => {
    if (remainingSec <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [remainingSec]);

  useEffect(() => {
    if (isEmailVerified(session)) {
      setEmailLinkError(false);
      clearPendingVerifyEmail();
      router.replace(verifiedHomeHref(onboarded) as never);
    }
  }, [onboarded, session, setEmailLinkError]);

  const sendAgain = async () => {
    if (!email || remainingSec > 0 || busy) return;
    setBusy(true);
    setResendError(null);
    setResendInfo(null);
    try {
      await resendSignupEmail(email);
      resendReadyAt.set(email.toLowerCase(), Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
      setEmailLinkError(false);
      setResendInfo('Yeni doğrulama bağlantısını gönderdik.');
    } catch (error) {
      setResendError(error instanceof Error ? error.message : 'Mail gönderilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const goLogin = async () => {
    setSwitching(true);
    try {
      clearPendingVerifyEmail();
      setEmailLinkError(false);
      await signOut();
    } catch {
      /* still leave */
    }
    router.replace('/giris' as never);
  };

  const changeEmail = async () => {
    setSwitching(true);
    try {
      clearPendingVerifyEmail();
      setEmailLinkError(false);
      await signOut();
    } catch {
      /* still leave */
    }
    router.replace('/kayit' as never);
  };

  const expired = emailLinkError;

  return (
    <Screen scroll center>
      <SeoHead title={`E-postanı doğrula | ${APP_NAME}`} path="/verify-email" index={false} />
      <View style={{ gap: spacing.xl, width: '100%', maxWidth: 440, alignSelf: 'center' }}>
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <BrandLogo variant="full" width={220} />
          <AppText variant="display" style={{ textAlign: 'center' }}>
            {expired ? 'Bağlantı geçersiz' : 'E-postanı doğrula'}
          </AppText>
          {expired ? (
            <AppText tone="muted" style={{ textAlign: 'center' }}>
              Doğrulama bağlantısının süresi dolmuş veya geçersiz.
            </AppText>
          ) : (
            <AppText tone="muted" style={{ textAlign: 'center' }}>
              {email
                ? `Doğrulama bağlantısını ${email} adresine gönderdik.`
                : 'Doğrulama bağlantısını kayıt olduğun e-posta adresine gönderdik.'}
            </AppText>
          )}
        </View>

        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.lg,
            gap: spacing.md,
            ...shadows.md,
          }}>
          {email && !expired ? (
            <View
              style={{
                backgroundColor: colors.bgMuted,
                borderRadius: radius.md,
                paddingVertical: 12,
                paddingHorizontal: 14,
              }}>
              <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                Kayıt e-postası
              </AppText>
              <AppText style={{ textAlign: 'center', fontWeight: '700' }}>{email}</AppText>
            </View>
          ) : null}

          {resendError ? (
            <AppText tone="danger" variant="caption" style={{ textAlign: 'center' }}>
              {resendError}
            </AppText>
          ) : null}
          {resendInfo ? (
            <AppText tone="accent" variant="caption" style={{ textAlign: 'center' }}>
              {resendInfo}
            </AppText>
          ) : null}

          <Button
            label={
              expired
                ? 'Yeni doğrulama e-postası gönder'
                : remainingSec > 0
                  ? `Maili tekrar gönder (${remainingSec}s)`
                  : 'Maili tekrar gönder'
            }
            loading={busy}
            disabled={!email || remainingSec > 0}
            onPress={() => {
              void sendAgain();
            }}
          />
          <Button
            label="E-posta adresini değiştir"
            variant="secondary"
            disabled={switching}
            onPress={() => {
              void changeEmail();
            }}
          />
        </View>

        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <Button
            label="Giriş ekranına dön"
            variant="ghost"
            disabled={switching}
            onPress={() => {
              void goLogin();
            }}
          />
          <Button
            label="Farklı hesapla devam et"
            variant="ghost"
            disabled={switching}
            onPress={() => {
              void goLogin();
            }}
          />
        </View>
      </View>
    </Screen>
  );
}
