import { Redirect, Stack } from 'expo-router';
import { Platform } from 'react-native';

import { useAuthStore } from '@/src/stores/authStore';

export default function OnboardingLayout() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const onboarded = Boolean(useAuthStore((s) => s.profile?.onboarding_completed_at));

  if (initialized && !session) {
    return <Redirect href={(Platform.OS === 'web' ? '/' : '/giris') as never} />;
  }

  if (initialized && session && onboarded) {
    return <Redirect href={'/home' as never} />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
