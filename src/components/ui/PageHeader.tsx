import { type ReactNode } from 'react';
import { View } from 'react-native';

import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { AppText } from './AppText';

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const { showTopBar } = useBreakpoint();
  const { spacing } = useAppTheme();
  if (showTopBar) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[12] }}>
      <View style={{ flex: 1, gap: 4 }}>
        <AppText variant="display">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}
