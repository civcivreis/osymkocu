import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import type { ReactionSummary } from '@/src/features/social/useMessageReactions';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function ReactionBar({
  items,
  align,
  onPress,
}: {
  items: ReactionSummary[];
  align?: 'left' | 'right';
  onPress?: (emoji: string) => void;
}) {
  const { colors } = useAppTheme();
  if (items.length === 0) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 4,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        maxWidth: '100%',
      }}>
      {items.map((item) => (
        <Pressable
          key={item.emoji}
          onPress={() => onPress?.(item.emoji)}
          style={{
            minHeight: 28,
            height: 30,
            paddingHorizontal: 8,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: item.mine ? colors.accentMuted : colors.bgMuted,
            borderWidth: 1,
            borderColor: item.mine ? colors.accent : colors.border,
          }}>
          <AppText style={{ fontSize: 13, lineHeight: 16 }}>{item.emoji}</AppText>
          <AppText variant="caption" style={{ fontWeight: '700', color: item.mine ? colors.accent : colors.textMuted }}>
            {item.count}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
