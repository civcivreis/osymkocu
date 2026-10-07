import { Link, Stack } from 'expo-router';
import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export default function NotFoundScreen() {
  const { colors, spacing } = useAppTheme();

  return (
    <>
      <Stack.Screen options={{ title: 'Bulunamadı', headerShown: true }} />
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
          <AppText variant="title">Bu ekran yok</AppText>
          <Link href="/" style={{ color: colors.accent, fontSize: 16, fontWeight: '600' }}>
            Ana sayfaya dön
          </Link>
        </View>
      </Screen>
    </>
  );
}
