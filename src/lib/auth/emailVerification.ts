import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import type { Session, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { APP_URL } from '@/src/lib/brand';
import { useAuthStore } from '@/src/stores/authStore';

const PENDING_EMAIL_KEY = 'osymkocu.pendingVerifyEmail';
const CONFIRM_PATH = '/email-confirmed';

export function isEmailVerified(session: Session | null | undefined): boolean {
  return isUserEmailVerified(session?.user);
}

export function isUserEmailVerified(user: User | null | undefined): boolean {
  if (!user) return false;
  const confirmedAt = user.email_confirmed_at ?? (user as { confirmed_at?: string | null }).confirmed_at;
  return Boolean(confirmedAt);
}

function productionWebOrigin() {
  return APP_URL.replace(/\/$/, '') || 'https://osymkocu.com';
}

/**
 * Confirmation emails must never point at localhost in production.
 * Local hosts are only used while Metro/Expo is running in __DEV__.
 */
export function emailRedirectTo(): string {
  const origin = productionWebOrigin();
  if (Platform.OS === 'web') {
    if (__DEV__ && typeof window !== 'undefined') {
      const host = window.location.hostname;
      const local = host === 'localhost' || host === '127.0.0.1';
      if (local && process.env.EXPO_PUBLIC_ALLOW_LOCAL_AUTH_REDIRECT === '1') {
        return `${window.location.origin}${CONFIRM_PATH}`;
      }
    }
    return `${origin}${CONFIRM_PATH}`;
  }
  if (__DEV__) return Linking.createURL('email-confirmed');
  return `${origin}${CONFIRM_PATH}`;
}

export function persistPendingVerifyEmail(email: string) {
  const value = email.trim().toLowerCase();
  useAuthStore.getState().setPendingVerifyEmail(value);
  void AsyncStorage.setItem(PENDING_EMAIL_KEY, value);
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

export async function hydratePendingVerifyEmail() {
  if (useAuthStore.getState().pendingVerifyEmail) return;
  const value = await AsyncStorage.getItem(PENDING_EMAIL_KEY);
  if (value) useAuthStore.getState().setPendingVerifyEmail(value);
}

export function clearPendingVerifyEmail() {
  useAuthStore.getState().setPendingVerifyEmail(null);
  void AsyncStorage.removeItem(PENDING_EMAIL_KEY);
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
  return /access_token|refresh_token|error_description|error_code|type=signup|type=email|otp_expired|[?&]code=/.test(
    blob,
  );
}

export function paramsFromHref(href: string | null | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!href) return params;
  const hashAt = href.indexOf('#');
  const queryAt = href.indexOf('?');
  const hash = hashAt >= 0 ? href.slice(hashAt + 1) : '';
  const query = queryAt >= 0 ? href.slice(queryAt + 1, hashAt >= 0 ? hashAt : undefined) : '';
  new URLSearchParams(hash).forEach((value, key) => params.set(key, value));
  new URLSearchParams(query).forEach((value, key) => params.set(key, value));
  return params;
}

export function paramsFromLocation(): URLSearchParams {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return paramsFromHref(window.location.href);
  }
  return new URLSearchParams();
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
  ['error', 'error_code', 'error_description', 'code', 'type'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

export function verifiedHomeHref(onboarded: boolean): '/home' | '/(onboarding)' {
  return onboarded ? '/home' : '/(onboarding)';
}
