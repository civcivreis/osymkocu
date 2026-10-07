import { View } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function ProgressBar({ value, height = 8 }: { value: number; height?: number }) {
  const { colors, radius } = useAppTheme();
  const width = Math.max(0, Math.min(100, Math.round(value * 100)));

  return (
    <View
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: colors.bgMuted,
        overflow: 'hidden',
      }}>
      <View
        style={{
          width: `${width}%`,
          height: '100%',
          backgroundColor: colors.accent,
        }}
      />
    </View>
  );
}
