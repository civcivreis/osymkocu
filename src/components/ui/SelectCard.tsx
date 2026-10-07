import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Props = {
  title: string;
  subtitle?: string;
  selected?: boolean;
  leading?: ReactNode;
  onPress: () => void;
  onIdentityPress?: () => void;
};

export function SelectCard({ title, subtitle, selected, leading, onPress, onIdentityPress }: Props) {
  const { colors, radius, spacing } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={{
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentMuted : colors.surface,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {leading ? (
          <Pressable
            onPress={onIdentityPress ?? onPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${title} profili`}>
            {leading}
          </Pressable>
        ) : null}
        <View style={{ gap: 4, flex: 1 }}>
          <Pressable onPress={onIdentityPress ?? onPress} hitSlop={4}>
            <AppText variant="subtitle" tone={selected ? 'accent' : 'primary'}>
              {title}
            </AppText>
          </Pressable>
          {subtitle ? (
            <AppText variant="caption" tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
