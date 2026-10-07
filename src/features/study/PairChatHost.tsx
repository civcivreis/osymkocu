import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { RoomChat } from '@/src/features/study/RoomChat';
import { usePairChatStore } from '@/src/features/study/pairChatStore';
import { useStudyRoomMessages } from '@/src/features/study/useStudyTogether';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export function PairChatHost() {
  const pathname = usePathname();
  const session = usePairChatStore((s) => s.session);
  const bump = usePairChatStore((s) => s.bumpUnread);
  const lastCount = useRef(0);
  const chat = useStudyRoomMessages(session?.sessionId ?? null);
  const hidden = pathname === '/system-exam';

  useEffect(() => {
    const count = chat.data?.length ?? 0;
    if (session && count > lastCount.current) bump();
    lastCount.current = count;
  }, [bump, chat.data?.length, session]);

  if (!session || hidden) return null;
  return <PairChatPanel />;
}

function PairChatPanel() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useBreakpoint();
  const session = usePairChatStore((s) => s.session);
  const setExpanded = usePairChatStore((s) => s.setExpanded);
  const end = usePairChatStore((s) => s.end);
  const me = useAuthStore((s) => s.session?.user.id);
  if (!session) return null;

  if (!session.expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        style={{
          position: 'absolute',
          right: 16,
          bottom: Math.max(insets.bottom, 12) + (isDesktop ? 24 : 72),
          minHeight: 44,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor: 'rgba(27,43,68,0.72)',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          zIndex: 40,
        }}>
        <AppText tone="inverse">💬 {session.otherName}</AppText>
        {session.unread > 0 ? (
          <View
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 5,
            }}>
            <AppText variant="caption" tone="inverse">
              {session.unread > 9 ? '9+' : session.unread}
            </AppText>
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: isDesktop ? 0 : undefined,
        left: isDesktop ? undefined : 12,
        right: isDesktop ? 0 : 12,
        bottom: isDesktop ? 0 : Math.max(insets.bottom, 12),
        width: isDesktop ? 340 : undefined,
        maxHeight: isDesktop ? undefined : 320,
        height: isDesktop ? '100%' : undefined,
        borderRadius: isDesktop ? 0 : 20,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        gap: 8,
        zIndex: 40,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AppText variant="subtitle" style={{ flex: 1 }}>
          {session.otherName}
        </AppText>
        <Pressable onPress={() => setExpanded(false)} hitSlop={8}>
          <AppText variant="caption" tone="muted">
            Küçült
          </AppText>
        </Pressable>
      </View>
      <RoomChat sessionId={session.sessionId} me={me} members={[{ user_id: me ?? '', display_name: 'Sen' }, { user_id: session.otherId ?? 'x', display_name: session.otherName }]} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {session.otherId ? (
          <Pressable onPress={() => router.push({ pathname: '/user', params: { userId: session.otherId } })}>
            <AppText variant="caption" tone="accent">
              Profili görüntüle
            </AppText>
          </Pressable>
        ) : null}
        <Pressable onPress={end}>
          <AppText variant="caption" tone="danger">
            Oturumu bitir
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
