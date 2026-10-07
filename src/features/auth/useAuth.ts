import { useCallback } from 'react';

import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { emailRedirectTo, isUserEmailVerified, persistPendingVerifyEmail } from '@/src/lib/auth/emailVerification';
import { getSupabase } from '@/src/lib/supabase/client';
import type { Profile, Subscription } from '@/src/lib/supabase/types';
import { useAuthStore } from '@/src/stores/authStore';

export const EMAIL_NOT_CONFIRMED = 'EMAIL_NOT_CONFIRMED';

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login')) return 'E-posta veya şifre hatalı.';
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'Bu e-posta ile zaten bir hesap var.';
  }
  if (lower.includes('email not confirmed')) return EMAIL_NOT_CONFIRMED;
  if (lower.includes('password')) return 'Şifre kurallarını kontrol et.';
  if (lower.includes('rate')) return 'Çok fazla deneme. Biraz sonra tekrar dene.';
  return message;
}

export async function fetchAuthExtras(userId: string) {
  const supabase = getSupabase();
  const [{ data: profile, error: profileError }, { data: subscription, error: subError }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle(),
    ]);

  if (profileError) throw profileError;
  if (subError) throw subError;

  useAuthStore.getState().setProfile((profile as Profile | null) ?? null);
  useAuthStore.getState().setSubscription((subscription as Subscription | null) ?? null);
  if (profile) {
    void supabase.rpc('touch_last_active');
    void supabase.rpc('sync_my_exam_reminders');
  }
}

/** Local JWT can survive after auth.users was deleted. Confirm the user still exists. */
export async function sessionUserExists() {
  const { data, error } = await getSupabase().auth.getUser();
  if (error || !data.user) return false;
  return true;
}

export async function resendSignupEmail(email: string) {
  const { error } = await getSupabase().auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: emailRedirectTo() },
  });
  if (error) {
    const lower = error.message.toLowerCase();
    if (lower.includes('rate') || lower.includes('seconds')) {
      throw new Error('Çok sık denendi. Bir dakika bekleyip tekrar dene.');
    }
    throw new Error('Doğrulama maili gönderilemedi. Biraz sonra tekrar dene.');
  }
}

export function useAuthActions() {
  const reset = useAuthStore((s) => s.reset);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) {
      const mapped = mapAuthError(error.message);
      if (mapped === EMAIL_NOT_CONFIRMED) {
        persistPendingVerifyEmail(email);
        throw new Error(EMAIL_NOT_CONFIRMED);
      }
      throw new Error(mapped);
    }
    if (data.user && !isUserEmailVerified(data.user)) {
      persistPendingVerifyEmail(data.user.email ?? email);
      throw new Error(EMAIL_NOT_CONFIRMED);
    }
    if (data.user) {
      await fetchAuthExtras(data.user.id);
      AnalyticsProvider.identify(data.user.id, { email: data.user.email });
    }
  }, []);

  const signUp = useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      const { data, error } = await getSupabase().auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { display_name: input.displayName },
          emailRedirectTo: emailRedirectTo(),
        },
      });
      if (error) throw new Error(mapAuthError(error.message));
      const identities = data.user?.identities ?? [];
      if (data.user && identities.length === 0) {
        throw new Error(mapAuthError('already registered'));
      }
      AnalyticsProvider.track('signup_completed');
      const verified = isUserEmailVerified(data.user) || isUserEmailVerified(data.session?.user);
      if (data.session?.user && verified) {
        await fetchAuthExtras(data.session.user.id);
        AnalyticsProvider.identify(data.session.user.id, { email: data.session.user.email });
      }
      if (!verified) {
        persistPendingVerifyEmail(input.email);
      }
      return { needsEmailConfirmation: !verified };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    AnalyticsProvider.reset();
    reset();
  }, [reset]);

  const deleteAccount = useCallback(async () => {
    const { error } = await getSupabase().functions.invoke('delete-account');
    if (error) {
      throw new Error('Hesap silme henüz sunucuda tanımlı değil veya başarısız oldu.');
    }
    AnalyticsProvider.reset();
    reset();
  }, [reset]);

  return { signIn, signUp, signOut, deleteAccount };
}
