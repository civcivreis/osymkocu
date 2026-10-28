import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { getSupabase } from '@/src/lib/supabase/client';

export type AppAnnouncement = {
  id: string;
  title: string;
  body: string;
  bullets: string[];
  platforms: string[];
  display_mode: string;
  primary_label: string;
  secondary_label: string | null;
};

export type AppReleaseStatus = {
  action: 'none' | 'optional' | 'force';
  title?: string;
  release_notes?: string | null;
  store_url?: string | null;
  latest_version?: string;
};

export function installedAppVersion() {
  return String(Constants.expoConfig?.version ?? '1.0.0');
}

export function currentPlatform() {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export async function fetchContentRevision(): Promise<number> {
  const { data, error } = await getSupabase().rpc('get_content_revision');
  if (error) return 0;
  return Number(data ?? 0) || 0;
}

export async function fetchActiveAnnouncements(): Promise<AppAnnouncement[]> {
  const { data, error } = await getSupabase().rpc('get_active_announcements');
  if (error || !Array.isArray(data)) return [];
  return (data as AppAnnouncement[]).filter((row) => {
    const platforms = row.platforms ?? ['all'];
    return platforms.includes('all') || platforms.includes(currentPlatform());
  });
}

export async function dismissAnnouncement(id: string) {
  const { error } = await getSupabase().rpc('dismiss_announcement', { p_id: id });
  if (error) throw error;
}

export async function fetchAppReleaseStatus(): Promise<AppReleaseStatus> {
  const { data, error } = await getSupabase().rpc('get_app_release_status', {
    p_platform: currentPlatform(),
    p_version: installedAppVersion(),
  });
  if (error || !data || typeof data !== 'object') return { action: 'none' };
  return data as AppReleaseStatus;
}

export function versionLess(a: string, b: string) {
  const pa = a.split('.').map((n) => Number(n.replace(/\D/g, '')) || 0);
  const pb = b.split('.').map((n) => Number(n.replace(/\D/g, '')) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}
