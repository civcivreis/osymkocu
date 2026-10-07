import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, View } from 'react-native';

import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { useNotifications } from '@/src/features/study/useStudyTogether';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { greetingForHour } from '@/src/lib/time/greeting';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

import { AppText } from './AppText';

const TITLES: { test: (path: string) => boolean; title: string }[] = [
  { test: (p) => p === '/home' || p === '/' || p === '/index', title: 'Ana Sayfa' },
  { test: (p) => p === '/study' || p === '/lesson', title: 'Dersler' },
  { test: (p) => p === '/test-merkezi' || p === '/practice' || p === '/notebook', title: 'Test Merkezi' },
  { test: (p) => p.startsWith('/system-exam') || p === '/sistem-sinavlari', title: 'Sistem Sınavları' },
  { test: (p) => p === '/social' || p === '/study-room', title: 'Sosyal Çalışma' },
  { test: (p) => p === '/messages' || p === '/chat' || p === '/group-chat', title: 'Mesajlar' },
  { test: (p) => p === '/notifications', title: 'Bildirimler' },
  { test: (p) => p === '/profile' || p === '/user' || p === '/edit-profile' || p === '/follows', title: 'Profil' },
  { test: (p) => p === '/settings' || p === '/privacy', title: 'Ayarlar' },
  { test: (p) => p === '/teacher', title: 'AI Koç' },
];

export function titleForPath(pathname: string) {
  return TITLES.find((item) => item.test(pathname))?.title ?? 'ÖSYM Koçu';
}

export function AppTopBar() {
  const { colors, spacing } = useAppTheme();
  const { showTopBar, contentMaxWidth, contentPad } = useBreakpoint();
  const pathname = usePathname();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const notifications = useNotifications();
  const name = profile?.display_name || session?.user.user_metadata?.display_name || 'öğrenci';
  const home = pathname === '/home' || pathname === '/' || pathname === '/index';

  if (!showTopBar) return null;

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
      <View
        style={{
          minHeight: 64,
          paddingHorizontal: contentPad,
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing[16],
        }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {home ? (
            <>
              <AppText variant="title" numberOfLines={1}>
                {greetingForHour(new Date().getHours(), String(name))}
              </AppText>
              {profile?.exam_year ? (
                <AppText variant="caption" tone="muted">
                  {profile.exam_year}
                </AppText>
              ) : null}
            </>
          ) : (
            <AppText variant="title" numberOfLines={1}>
              {titleForPath(pathname)}
            </AppText>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={() => router.navigate('/notifications' as never)}
            accessibilityLabel="Bildirimler"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="notifications-outline" size={22} color={colors.navy} />
            {notifications.unread > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  right: 6,
                  top: 6,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  backgroundColor: colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 4,
                }}>
                <AppText variant="caption" tone="inverse" style={{ fontSize: 10 }}>
                  {notifications.unread > 9 ? '9+' : notifications.unread}
                </AppText>
              </View>
            ) : null}
          </Pressable>
          <Pressable onPress={() => router.navigate('/profile' as never)} accessibilityLabel="Profil">
            <LetterAvatar id={session?.user.id ?? 'me'} name={String(name)} size={36} imageUrl={profile?.avatar_url} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
