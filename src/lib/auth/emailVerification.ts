import type { Session, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { APP_URL } from '@/src/lib/brand';
import { useAuthStore } from '@/src/stores/authStore';

const PENDING_EMAIL_KEY = 'osymkocu.pendingVerifyEmail';

export function isEmailVerified(session: Session | null | undefined): boolean {
  return isUserEmailVerified(session?.user);
}

export function isUserEmailVerified(user: User | null | undefined): boolean {
  if (!user) return false;
  const confirmedAt = user.email_confirmed_at ?? (user as { confirmed_at?: string | null }).confirmed_at;
  return Boolean(confirmedAt);
}

/** Confirmation emails land on the public website so the hash session can be parsed. Native scheme is unchanged. */
export function emailRedirectTo(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return APP_URL;
}

export function persistPendingVerifyEmail(email: string) {
  const value = email.trim().toLowerCase();
  useAuthStore.getState().setPendingVerifyEmail(value);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(PENDING_EMAIL_KEY, value);
    } catch {
      /* private mode */
    }
  }
}

export function readPendingVerifyEmail(): string | null {
  const fromStore = useAuthStore.getState().pendingVerifyEmail;
  if (fromStore) return fromStore;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      return window.sessionStorage.getItem(PENDING_EMAIL_KEY);
    } catch {
      return null;
    }
  }
  return null;
}

export function clearPendingVerifyEmail() {
  useAuthStore.getState().setPendingVerifyEmail(null);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function hasAuthRedirectPayload(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const blob = `${window.location.hash}${window.location.search}`;
  return /access_token|refresh_token|error_description|error_code|type=signup|type=email|otp_expired/i.test(
    blob,
  );
}

function paramsFromLocation(): URLSearchParams {
  const params = new URLSearchParams();
  if (typeof window === 'undefined') return params;
  const hash = window.location.hash.replace(/^#/, '');
  const search = window.location.search.replace(/^\?/, '');
  const fromHash = new URLSearchParams(hash);
  const fromSearch = new URLSearchParams(search);
  fromHash.forEach((value, key) => params.set(key, value));
  fromSearch.forEach((value, key) => params.set(key, value));
  return params;
}

export function consumeAuthLinkError(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const params = paramsFromLocation();
  const error = params.get('error') || params.get('error_code') || '';
  const description = params.get('error_description') || '';
  const combined = `${error} ${description}`.toLowerCase();
  if (!error && !description) return false;
  const invalid =
    /otp_expired|expired|invalid|access_denied|flow_state|token|mismatch|not_found/.test(combined) ||
    Boolean(error);
  if (invalid) {
    useAuthStore.getState().setEmailLinkError(true);
  }
  return invalid;
}

export function stripAuthHashFromUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash && !/error|access_token|code=/.test(window.location.search)) return;
  const url = new URL(window.location.href);
  url.hash = '';
  ['error', 'error_code', 'error_description', 'code'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

export function verifiedHomeHref(onboarded: boolean): '/home' | '/(onboarding)' {
  return onboarded ? '/home' : '/(onboarding)';
}
