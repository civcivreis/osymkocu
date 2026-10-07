import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAuthActions } from '@/src/features/auth/useAuth';
import { useInbox, inboxUnreadTotal } from '@/src/features/social/useInbox';
import { useNotifications } from '@/src/features/study/useStudyTogether';
import { APP_NAME, APP_TAGLINE } from '@/src/lib/brand';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

const MAIN_LINKS = [
  { href: '/', label: 'Ana Sayfa', icon: 'home-outline' as const, iconOn: 'home' as const },
  { href: '/study', label: 'Dersler', icon: 'book-outline' as const, iconOn: 'book' as const },
  { href: '/test-merkezi', label: 'Test Merkezi', icon: 'grid-outline' as const, iconOn: 'grid' as const },
  { href: '/sistem-sinavlari', label: 'Sistem Sınavları', icon: 'school-outline' as const, iconOn: 'school' as const },
  { href: '/social', label: 'Sosyal', icon: 'people-outline' as const, iconOn: 'people' as const },
  { href: '/messages', label: 'Mesajlar', icon: 'chatbubbles-outline' as const, iconOn: 'chatbubbles' as const },
  { href: '/notifications', label: 'Bildirimler', icon: 'notifications-outline' as const, iconOn: 'notifications' as const },
  { href: '/profile', label: 'Profil', icon: 'person-outline' as const, iconOn: 'person' as const },
];

const BOTTOM_MOBILE = MAIN_LINKS.filter((item) =>
  ['/', '/study', '/social', '/messages', '/profile'].includes(item.href),
);

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname === '/index';
  if (href === '/sistem-sinavlari') {
    return pathname === '/sistem-sinavlari' || pathname.startsWith('/system-exam');
  }
  if (href === '/test-merkezi') {
    return pathname === '/test-merkezi' || pathname === '/practice' || pathname === '/notebook';
  }
  if (href === '/study') {
    return pathname === '/study' || pathname === '/lesson';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WebAppShell({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  const { showSidebar, showBottomNav, isDesktop } = useBreakpoint();
  const pathname = usePathname();
  const profile = useAuthStore((s) => s.profile);
  const { signOut } = useAuthActions();
  const notifications = useNotifications();
  const inbox = useInbox();
  const unreadInbox = inboxUnreadTotal(inbox.data);
  const name = profile?.display_name ?? 'Öğrenci';

  const navItem = (item: (typeof MAIN_LINKS)[number], compact?: boolean) => {
    const active = isActive(pathname, item.href);
    const badge =
      item.href === '/notifications' && notifications.unread > 0
        ? notifications.unread
        : item.href === '/messages' && unreadInbox > 0
          ? unreadInbox
          : 0;
    return (
      <Pressable
        key={item.href + item.label}
        onPress={() => router.push(item.href as never)}
        style={{
          flexDirection: compact ? 'column' : 'row',
          alignItems: 'center',
          gap: compact ? 2 : 10,
          paddingVertical: compact ? 6 : 10,
          paddingHorizontal: compact ? 4 : 12,
          borderRadius: 12,
          backgroundColor: active && !compact ? colors.accentMuted : 'transparent',
        }}>
        <Ionicons
          name={active ? item.iconOn : item.icon}
          size={compact ? 22 : 20}
          color={active ? colors.accent : colors.textMuted}
        />
        <AppText
          variant="caption"
          tone={active ? 'accent' : 'muted'}
          numberOfLines={1}
          style={{ fontWeight: active ? '700' : '500' }}>
          {compact && item.label === 'Sistem Sınavları' ? 'Sınav' : item.label}
        </AppText>
        {!compact && badge > 0 ? (
          <AppText variant="caption" tone="accent">
            {badge > 9 ? '9+' : badge}
          </AppText>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      {showSidebar ? (
        <View
          style={{
            width: isDesktop ? 240 : 200,
            borderRightWidth: 1,
            borderRightColor: colors.border,
            backgroundColor: colors.surface,
            paddingTop: 20,
            paddingHorizontal: 12,
            paddingBottom: 16,
            justifyContent: 'space-between',
          }}>
          <View style={{ gap: 4 }}>
            <View style={{ paddingHorizontal: 12, paddingBottom: 16, gap: 2 }}>
              <AppText variant="subtitle">{APP_NAME}</AppText>
              <AppText variant="caption" tone="muted">
                {APP_TAGLINE}
              </AppText>
            </View>
            <ScrollView style={{ maxHeight: 520 }}>{MAIN_LINKS.map((item) => navItem(item))}</ScrollView>
          </View>
          <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
            <Pressable
              onPress={() => router.push('/settings')}
              style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
              <AppText>Ayarlar</AppText>
            </Pressable>
            <Pressable onPress={() => void signOut()} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
              <AppText tone="muted">Çıkış</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        {isDesktop ? (
          <View
            style={{
              minHeight: 56,
              paddingHorizontal: 24,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
            <AppText variant="subtitle">Hoş geldin, {name}</AppText>
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="notifications-outline" size={22} color={colors.text} />
              {notifications.unread > 0 ? (
                <AppText variant="caption" tone="accent">
                  {notifications.unread > 9 ? '9+' : notifications.unread}
                </AppText>
              ) : null}
            </Pressable>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>{children}</View>
        {showBottomNav ? (
          <View
            style={{
              flexDirection: 'row',
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.tabBar,
              paddingVertical: 6,
              paddingHorizontal: 4,
            }}>
            {BOTTOM_MOBILE.map((item) => (
              <View key={item.href} style={{ flex: 1 }}>
                {navItem(item, true)}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
