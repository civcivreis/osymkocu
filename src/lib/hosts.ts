import { Platform } from 'react-native';

import { ADMIN_DOMAIN, ADMIN_URL, APP_DOMAIN } from '@/src/lib/brand';

function stripHost(value: string) {
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
}

export function currentHostname() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  return stripHost(window.location.hostname);
}

export function isLocalWebHost() {
  const host = currentHostname();
  return (
    !host ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    host.startsWith('192.168.') ||
    host.startsWith('10.')
  );
}

export function isAdminHost() {
  if (Platform.OS !== 'web') return false;
  return currentHostname() === stripHost(ADMIN_DOMAIN);
}

export function isProductionAppHost() {
  if (Platform.OS !== 'web') return false;
  return currentHostname() === stripHost(APP_DOMAIN);
}

/** Production app host must not serve /admin; localhost keeps both for development. */
export function shouldBlockAdminOnAppHost() {
  return isProductionAppHost() && !isAdminHost();
}

export function adminPanelUrl(path = '/admin') {
  const next = path.startsWith('/') ? path : `/${path}`;
  if (isLocalWebHost()) return next;
  return `${ADMIN_URL}${next}`;
}
