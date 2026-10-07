import { Stack } from 'expo-router';
import { View } from 'react-native';

import { MissingConfigScreen } from '@/src/features/auth/MissingConfigScreen';
import { HostGate } from '@/src/features/web/HostGate';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { AppProviders } from '@/src/providers/AppProviders';
import { useAuthStore } from '@/src/stores/authStore';

export { ErrorBoundary } from 'expo-router';

/** Fallback must be (auth), never a public legal page. */
export const unstable_settings = {
  anchor: '(auth)',
  initialRouteName: '(auth)',
};

function startupGroup(session: boolean, onboarded: boolean) {
  if (session && onboarded) return '(app)';
  if (session) return '(onboarding)';
  return '(auth)';
}

function StartupLoading() {
  const { colors } = useAppTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}

function RootNavigator() {
  const configured = useAuthStore((s) => s.configured);
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const onboarded = Boolean(profile?.onboarding_completed_at);
  const hasSession = Boolean(session);

  if (!initialized) {
    return <StartupLoading />;
  }

  if (!configured) {
    return <MissingConfigScreen />;
  }

  return (
    <Stack
      initialRouteName={startupGroup(hasSession, onboarded)}
      screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Protected guard={!hasSession}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={hasSession && !onboarded}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={hasSession && onboarded}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="admin" />
      </Stack.Protected>
      <Stack.Screen name="gizlilik" />
      <Stack.Screen name="kullanim-kosullari" />
      <Stack.Screen name="iletisim" />
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
