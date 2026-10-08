import { APP_DOMAIN, APP_URL } from '@/src/lib/brand';

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '',
  appDownloadUrl: process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL?.trim() ?? '',
  contactEmail: process.env.EXPO_PUBLIC_CONTACT_EMAIL?.trim() || `iletisim@${APP_DOMAIN}`,
};

export function isSupabaseConfigured(): boolean {
  return env.supabaseUrl.startsWith('https://') && env.supabaseAnonKey.length > 20;
}

export function emailConfirmedUrl(): string {
  return `${APP_URL.replace(/\/$/, '')}/auth/callback`;
}
