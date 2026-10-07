import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { MissingConfigScreen } from '@/src/features/auth/MissingConfigScreen';
import { StartupLoading } from '@/src/features/auth/StartupLoading';
import { HostGate } from '@/src/features/web/HostGate';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { AppProviders } from '@/src/providers/AppProviders';
import { useAuthStore } from '@/src/stores/authStore';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  anchor: 'index',
  initialRouteName: 'index',
};

function isWebStaticRender() {
  return Platform.OS === 'web' && typeof window === 'undefined';
}

function startupGroup(session: boolean, onboarded: boolean) {
  if (session && onboarded) return '(app)';
  if (session) return '(onboarding)';
  return 'index';
}

function RootNavigator() {
  const configured = useAuthStore((s) => s.configured);
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const onboarded = Boolean(profile?.onboarding_completed_at);
  const hasSession = Boolean(session);
  const { colors } = useAppTheme();
  const [webHydrated, setWebHydrated] = useState(false);
  useEffect(() => {
    setWebHydrated(true);
  }, []);
  const staticWeb = isWebStaticRender() || (Platform.OS === 'web' && !webHydrated);
  const ready = initialized || staticWeb;

  if (initialized && !configured) {
    return <MissingConfigScreen />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {!ready ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 20 }}>
          <StartupLoading />
        </View>
      ) : null}
      <Stack
        initialRouteName={startupGroup(hasSession, onboarded)}
        screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!hasSession}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={hasSession && !onboarded}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        {/* Always registered so /study etc. exist. Guard lives in (app)/_layout — never fall through to /gizlilik. */}
        <Stack.Screen name="(app)" />
        <Stack.Protected guard={hasSession && onboarded}>
          <Stack.Screen name="admin" />
        </Stack.Protected>
        <Stack.Screen name="gizlilik" />
        <Stack.Screen name="kullanim-kosullari" />
        <Stack.Screen name="iletisim" />
      </Stack>
    </View>
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
