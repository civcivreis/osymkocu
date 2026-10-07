import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { clockLabel } from '@/src/features/social/identity';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function UnreadBadge({ count }: { count: number }) {
  const { colors } = useAppTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 10,
        backgroundColor: colors.danger,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <AppText variant="caption" style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800', lineHeight: 14 }}>
        {count > 9 ? '9+' : count}
      </AppText>
    </View>
  );
}

export function InboxRow({
  title,
  preview,
  time,
  unread,
  pinned,
  muted,
  live,
  avatarId,
  avatarName,
  onPress,
  onLongPress,
  onAvatarPress,
}: {
  title: string;
  preview: string;
  time?: string | null;
  unread: number;
  pinned?: boolean;
  muted?: boolean;
  live?: boolean;
  avatarId: string;
  avatarName: string;
  onPress: () => void;
  onLongPress?: () => void;
  onAvatarPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const unreadOn = unread > 0;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 20,
        backgroundColor: unreadOn ? colors.accentMuted : colors.surface,
        borderWidth: 1,
        borderColor: unreadOn ? colors.accent : colors.border,
        shadowColor: '#142033',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}>
      <Pressable onPress={onAvatarPress ?? onPress} hitSlop={6}>
        <View>
          <LetterAvatar id={avatarId} name={avatarName} size={48} />
          {live ? (
            <View
              style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: colors.success,
                borderWidth: 2,
                borderColor: colors.surface,
              }}
            />
          ) : null}
        </View>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <AppText
            variant="subtitle"
            numberOfLines={1}
            style={{ flex: 1, fontWeight: unreadOn ? '800' : '700' }}>
            {title}
          </AppText>
          {pinned ? <Ionicons name="pin" size={13} color={colors.accent} /> : null}
          {muted ? <Ionicons name="notifications-off-outline" size={13} color={colors.textSubtle} /> : null}
          <AppText variant="caption" tone="muted">
            {clockLabel(time)}
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <AppText
            variant="caption"
            tone={unreadOn ? 'primary' : 'muted'}
            numberOfLines={1}
            style={{ flex: 1, fontWeight: unreadOn ? '600' : '400' }}>
            {preview}
          </AppText>
          <UnreadBadge count={unread} />
        </View>
      </View>
    </Pressable>
  );
}
