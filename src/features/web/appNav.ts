import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

type Ion = ComponentProps<typeof Ionicons>['name'];

export type AppNavItem = {
  href: string;
  label: string;
  short?: string;
  icon: Ion;
  iconOn: Ion;
  badge?: 'messages' | 'notifications';
  section: 'main' | 'account';
};

export const APP_NAV: AppNavItem[] = [
  { href: '/home', label: 'Ana Sayfa', icon: 'home-outline', iconOn: 'home', section: 'main' },
  { href: '/study', label: 'Dersler', short: 'Ders', icon: 'book-outline', iconOn: 'book', section: 'main' },
  { href: '/test-merkezi', label: 'Test Merkezi', icon: 'grid-outline', iconOn: 'grid', section: 'main' },
  { href: '/sistem-sinavlari', label: 'Sistem Sınavları', short: 'Sınav', icon: 'school-outline', iconOn: 'school', section: 'main' },
  { href: '/social', label: 'Sosyal', icon: 'people-outline', iconOn: 'people', section: 'main' },
  { href: '/messages', label: 'Mesajlar', icon: 'chatbubbles-outline', iconOn: 'chatbubbles', badge: 'messages', section: 'main' },
  { href: '/notifications', label: 'Bildirimler', icon: 'notifications-outline', iconOn: 'notifications', badge: 'notifications', section: 'main' },
  { href: '/profile', label: 'Profil', icon: 'person-outline', iconOn: 'person', section: 'account' },
  { href: '/settings', label: 'Ayarlar', icon: 'settings-outline', iconOn: 'settings', section: 'account' },
];

export const MOBILE_TAB_HREFS = ['/home', '/study', '/social', '/messages', '/profile'];

export function isAppNavActive(pathname: string, href: string) {
  if (href === '/home') return pathname === '/home' || pathname === '/' || pathname === '/index';
  if (href === '/sistem-sinavlari') {
    return pathname === '/sistem-sinavlari' || pathname.startsWith('/system-exam');
  }
  if (href === '/test-merkezi') {
    return pathname === '/test-merkezi' || pathname === '/practice' || pathname === '/notebook';
  }
  if (href === '/study') return pathname === '/study' || pathname === '/lesson';
  if (href === '/messages') return pathname === '/messages' || pathname === '/chat' || pathname === '/group-chat';
  if (href === '/profile') return pathname === '/profile' || pathname === '/user' || pathname === '/edit-profile';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function titleForPath(pathname: string) {
  if (isAppNavActive(pathname, '/')) return 'Ana Sayfa';
  if (isAppNavActive(pathname, '/study')) return 'Dersler';
  if (isAppNavActive(pathname, '/test-merkezi')) return 'Test Merkezi';
  if (isAppNavActive(pathname, '/sistem-sinavlari')) return 'Sistem Sınavları';
  if (isAppNavActive(pathname, '/social')) return 'Sosyal';
  if (isAppNavActive(pathname, '/messages')) return 'Mesajlar';
  if (isAppNavActive(pathname, '/notifications')) return 'Bildirimler';
  if (isAppNavActive(pathname, '/profile')) return 'Profil';
  if (pathname === '/settings' || pathname.startsWith('/settings')) return 'Ayarlar';
  if (pathname === '/privacy') return 'Gizlilik';
  return 'ÖSYM Koçu';
}
