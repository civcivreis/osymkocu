import { Stack } from 'expo-router';
import { View } from 'react-native';

import { MissingConfigScreen } from '@/src/features/auth/MissingConfigScreen';
import { HostGate } from '@/src/features/web/HostGate';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { AppProviders } from '@/src/providers/AppProviders';
import { useAuthStore } from '@/src/stores/authStore';

export { ErrorBoundary } from 'expo-router';

function RootNavigator() {
  const configured = useAuthStore((s) => s.configured);
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const onboarded = Boolean(profile?.onboarding_completed_at);
  const { colors } = useAppTheme();

  if (!initialized) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  if (!configured) {
    return <MissingConfigScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="gizlilik" />
      <Stack.Screen name="kullanim-kosullari" />
      <Stack.Screen name="iletisim" />
      <Stack.Protected guard={!!session && onboarded}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="admin" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && !onboarded}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <HostGate>
        <RootNavigator />
      </HostGate>
    </AppProviders>
  );
}
