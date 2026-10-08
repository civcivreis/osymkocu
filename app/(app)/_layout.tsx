import { Redirect, Stack } from 'expo-router';
import { Platform, View } from 'react-native';

import { StartupLoading } from '@/src/features/auth/StartupLoading';
import { CoachHost } from '@/src/features/teacher/CoachHost';
import { MatchInviteHost } from '@/src/features/study/MatchInviteHost';
import { PairChatHost } from '@/src/features/study/PairChatHost';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { WebAppShell } from '@/src/features/web/WebAppShell';
import { isEmailVerified } from '@/src/lib/auth/emailVerification';
import { useAuthStore } from '@/src/stores/authStore';

export default function AppGroupLayout() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const onboarded = Boolean(profile?.onboarding_completed_at);

  if (!initialized) {
    return <StartupLoading />;
  }

  if (!session) {
    return <Redirect href={'/giris' as never} />;
  }

  if (!isEmailVerified(session)) {
    return <Redirect href={'/verify-email' as never} />;
  }

  if (!onboarded) {
    return <Redirect href={'/(onboarding)' as never} />;
  }

  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="teacher" />
      <Stack.Screen name="practice" />
      <Stack.Screen name="notebook" />
      <Stack.Screen name="lesson" />
      <Stack.Screen name="dersler" />
      <Stack.Screen name="chat" />
      <Stack.Screen name="group-chat" />
      <Stack.Screen name="mesajlar" />
      <Stack.Screen name="user" />
      <Stack.Screen name="follows" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="study-room" />
      <Stack.Screen name="system-exams" />
      <Stack.Screen name="sistem-sinavlari" />
      <Stack.Screen name="test-merkezi" />
      <Stack.Screen name="siralama" />
      <Stack.Screen name="system-exam" />
      <Stack.Screen name="system-exam-result" />
    </Stack>
  );

  return (
    <View style={{ flex: 1 }}>
      <SeoHead title="ÖSYM Koçu" path="/home" index={false} />
      {Platform.OS === 'web' ? <WebAppShell>{stack}</WebAppShell> : stack}
      <CoachHost />
      <PairChatHost />
      <MatchInviteHost />
    </View>
  );
}
