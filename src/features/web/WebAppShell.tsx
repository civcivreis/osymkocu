import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { type ReactNode, useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { AppTopBar } from '@/src/components/ui/AppTopBar';
import { useAuthActions } from '@/src/features/auth/useAuth';
import { BrandLogo } from '@/src/components/brand/BrandLogo';
import { APP_NAV, isAppNavActive, MOBILE_TAB_HREFS } from '@/src/features/web/appNav';
import { inboxUnreadTotal, useInbox } from '@/src/features/social/useInbox';
import { useNotifications } from '@/src/features/study/useStudyTogether';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

function go(label: string, href: string, pathname: string) {
  if (__DEV__) {
    console.log('[nav]', { label, target: href, pathname });
    console.log('[nav-click]', label, href);
  }
  router.navigate(href as never);
}

export function WebAppShell({ children }: { children: ReactNode }) {
  const { colors, spacing, radius } = useAppTheme();
  const { showSidebar, compactSidebar, showBottomNav } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const notifications = useNotifications();
  const inbox = useInbox();
  const unreadInbox = inboxUnreadTotal(inbox.data);
  const main = APP_NAV.filter((item) => item.section === 'main');
  const account = APP_NAV.filter((item) => item.section === 'account');
  const mobile = APP_NAV.filter((item) => MOBILE_TAB_HREFS.includes(item.href));

  useEffect(() => {
    if (__DEV__) console.log('[route-after-click]', pathname);
  }, [pathname]);

  const badgeFor = (href: string) => {
    if (href === '/notifications' && notifications.unread > 0) return notifications.unread;
    if (href === '/messages' && unreadInbox > 0) return unreadInbox;
    return 0;
  };

  const navItem = (item: (typeof APP_NAV)[number], compact?: boolean) => {
    const active = isAppNavActive(pathname, item.href);
    const badge = badgeFor(item.href);
    return (
      <Pressable
        key={item.href}
        onPress={() => go(item.label, item.href, pathname)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        style={{
          flexDirection: compact ? 'column' : 'row',
          alignItems: 'center',
          gap: compact ? 2 : 10,
          paddingVertical: compact ? 6 : 10,
          paddingHorizontal: compact ? 4 : 12,
          borderRadius: radius.md,
          backgroundColor: active && !compact ? colors.accentMuted : 'transparent',
        }}>
        <View>
          <Ionicons name={active ? item.iconOn : item.icon} size={compact ? 22 : 20} color={active ? colors.accent : colors.textMuted} />
          {compact && badge > 0 ? (
            <View
              style={{
                position: 'absolute',
                right: -6,
                top: -4,
                minWidth: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <AppText variant="caption" tone="inverse" style={{ fontSize: 9 }}>
                {badge > 9 ? '9+' : badge}
              </AppText>
            </View>
          ) : null}
        </View>
        {compactSidebar && !compact ? null : (
          <AppText
            variant="caption"
            tone={active ? 'accent' : 'muted'}
            numberOfLines={1}
            style={{ fontWeight: active ? '700' : '600', fontSize: compact ? 11 : 13 }}>
            {compact ? (item.short ?? item.label) : item.label}
          </AppText>
        )}
        {!compact && !compactSidebar && badge > 0 ? (
          <View
            style={{
              marginLeft: 'auto',
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 6,
            }}>
            <AppText variant="caption" tone="inverse" style={{ fontSize: 11, fontWeight: '700' }}>
              {badge > 9 ? '9+' : badge}
            </AppText>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      {showSidebar ? (
        <View
          style={{
            width: compactSidebar ? 76 : 252,
            borderRightWidth: 1,
            borderRightColor: colors.border,
            backgroundColor: colors.surface,
            paddingTop: 20,
            paddingHorizontal: compactSidebar ? 8 : 12,
            paddingBottom: 16,
          }}>
          <Pressable onPress={() => go('Ana Sayfa', '/home', pathname)} style={{ paddingHorizontal: compactSidebar ? 4 : 8, paddingBottom: 20 }}>
            <BrandLogo variant={compactSidebar ? 'mark' : 'full'} size={36} width={200} />
          </Pressable>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2 }} showsVerticalScrollIndicator={false}>
            {main.map((item) => navItem(item))}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 10, marginHorizontal: 8 }} />
            {account.map((item) => navItem(item))}
          </ScrollView>
          <Pressable
            onPress={() => void signOut()}
            style={{
              paddingVertical: 10,
              paddingHorizontal: compactSidebar ? 4 : 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              borderRadius: radius.md,
            }}>
            <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
            {compactSidebar ? null : (
              <AppText tone="muted" variant="caption" style={{ fontWeight: '600' }}>
                Çıkış
              </AppText>
            )}
          </Pressable>
        </View>
      ) : null}

      <View style={{ flex: 1, minWidth: 0 }}>
        <AppTopBar />
        <View style={{ flex: 1 }}>{children}</View>
        {showBottomNav ? (
          <View
            style={{
              flexDirection: 'row',
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.tabBar,
              paddingTop: 6,
              paddingBottom: Math.max(insets.bottom, 8),
              paddingHorizontal: spacing[8],
            }}>
            {mobile.map((item) => (
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
