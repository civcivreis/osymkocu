import { View } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function StartupLoading() {
  const { colors } = useAppTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
