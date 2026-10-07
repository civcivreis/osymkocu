import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors, radius, spacing } = useAppTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding: spacing.lg,
        },
        style,
      ]}>
      {children}
    </View>
  );
}
