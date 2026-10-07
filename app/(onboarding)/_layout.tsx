import { Redirect, Stack } from 'expo-router';
import { Platform } from 'react-native';

import { StartupLoading } from '@/src/features/auth/StartupLoading';
import { isEmailVerified } from '@/src/lib/auth/emailVerification';
import { useAuthStore } from '@/src/stores/authStore';

export default function OnboardingLayout() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const onboarded = Boolean(useAuthStore((s) => s.profile?.onboarding_completed_at));

  if (!initialized) {
    return <StartupLoading />;
  }

  if (!session) {
    return <Redirect href={(Platform.OS === 'web' ? '/' : '/giris') as never} />;
  }

  if (!isEmailVerified(session)) {
    return <Redirect href={'/verify-email' as never} />;
  }

  if (onboarded) {
    return <Redirect href={'/home' as never} />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
