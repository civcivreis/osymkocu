import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { AppText } from './AppText';

export function Card({
  children,
  style,
  header,
  padded = true,
}: {
  children: ReactNode;
  style?: ViewStyle;
  header?: string;
  padded?: boolean;
}) {
  const { colors, radius, spacing, shadows } = useAppTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding: padded ? spacing[16] : 0,
          gap: header ? spacing[12] : 0,
          ...shadows.sm,
        },
        style,
      ]}>
      {header ? (
        <AppText variant="subtitle" style={{ fontSize: 16 }}>
          {header}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}
