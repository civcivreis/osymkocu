import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { UserProfileScreen } from '@/src/features/social/UserProfileScreen';
import { useAuthStore } from '@/src/stores/authStore';

export default function ProfileScreen() {
  const profile = useAuthStore((s) => s.profile);
  if (!profile) {
    return (
      <Screen safeEdges={['top']}>
        <AppText tone="muted">Profil yükleniyor…</AppText>
      </Screen>
    );
  }
  return (
    <Screen scroll safeEdges={['top']}>
      <UserProfileScreen userId={profile.id} embedded />
    </Screen>
  );
}
