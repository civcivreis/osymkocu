import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { RoomChat } from '@/src/features/study/RoomChat';
import { useStudyRoomMessages } from '@/src/features/study/useStudyTogether';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function RoomChatSheet({
  sessionId,
  me,
  members,
  landscape,
}: {
  sessionId: string;
  me?: string;
  members: { user_id: string; display_name: string }[];
  landscape: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  const chat = useStudyRoomMessages(sessionId);
  const [size, setSize] = useState<'closed' | 'half' | 'full'>('closed');
  const [seen, setSeen] = useState(0);
  const count = chat.data?.length ?? 0;
  const unread = size === 'closed' ? Math.max(0, count - seen) : 0;
  const close = () => {
    setSeen(count);
    setSize('closed');
  };

  if (landscape) {
    return (
      <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
        <RoomChat sessionId={sessionId} me={me} members={members} hideTitle />
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => {
          setSeen(count);
          setSize('half');
        }}
        accessibilityRole="button"
        accessibilityLabel="Sohbet"
        style={({ pressed }) => ({
          minHeight: 48,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.85 : 1,
        })}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
        <AppText variant="label">Sohbet ({unread > 0 ? unread : count})</AppText>
      </Pressable>

      <Modal visible={size !== 'closed'} transparent animationType="fade" onRequestClose={close}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityLabel="Kapat"
            onPress={close}
            style={{ flex: 1, backgroundColor: 'rgba(14,21,32,0.45)' }}
          />
          <View
            style={{
              height: size === 'full' ? '92%' : '50%',
              backgroundColor: colors.bg,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 12,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 10),
            }}>
            <Pressable
              onPress={() => setSize((current) => (current === 'full' ? 'half' : 'full'))}
              style={{ alignItems: 'center', paddingVertical: 6 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <AppText variant="subtitle">Sohbet</AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable
                  onPress={() => setSize((current) => (current === 'full' ? 'half' : 'full'))}
                  hitSlop={10}
                  style={{
                    minHeight: 36,
                    paddingHorizontal: 10,
                    borderRadius: radius.md,
                    justifyContent: 'center',
                    backgroundColor: colors.surfaceMuted,
                  }}>
                  <AppText variant="caption">{size === 'full' ? 'Yarı' : 'Tam'}</AppText>
                </Pressable>
                <Pressable onPress={close} hitSlop={10} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>
            </View>
            <View style={{ flex: 1, minHeight: 0 }}>
              <RoomChat sessionId={sessionId} me={me} members={members} hideTitle />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
