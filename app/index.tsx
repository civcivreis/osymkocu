import { Redirect } from 'expo-router';
import { Platform } from 'react-native';

import { StartupLoading } from '@/src/features/auth/StartupLoading';
import { LoginScreen } from '@/src/features/auth/LoginScreen';
import { LandingScreen } from '@/src/features/web/LandingScreen';
import { isAdminHost } from '@/src/lib/hosts';
import { useAuthStore } from '@/src/stores/authStore';

function isWebStaticRender() {
  return Platform.OS === 'web' && typeof window === 'undefined';
}

/** Public "/" only. Authenticated home is /home inside (app) — never collide with this route. */
export default function RootIndex() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const onboarded = Boolean(profile?.onboarding_completed_at);

  if (!initialized && !isWebStaticRender()) {
    return <StartupLoading />;
  }

  if (session && !onboarded) {
    return <Redirect href={'/(onboarding)' as never} />;
  }

  if (session && onboarded) {
    return <Redirect href={'/home' as never} />;
  }

  if (Platform.OS === 'web' && isAdminHost()) {
    return <LoginScreen />;
  }

  if (Platform.OS === 'web') {
    return <LandingScreen />;
  }

  return <LoginScreen />;
}
