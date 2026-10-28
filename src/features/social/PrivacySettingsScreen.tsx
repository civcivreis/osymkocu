import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Switch, View } from 'react-native';
import { toastError } from '@/src/components/ui/feedbackStore';

import { AppText } from '@/src/components/ui/AppText';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export function PrivacySettingsScreen() {
  const { colors, spacing } = useAppTheme();
  const profile = useAuthStore((s) => s.profile);
  const privateOn = Boolean(profile?.is_private);
  const studyOn = profile?.show_study_status_social !== false;

  const patch = async (next: { is_private?: boolean; show_study_status_social?: boolean }) => {
    if (!profile) return;
    const previous = profile;
    useAuthStore.getState().setProfile({ ...profile, ...next });
    const { error } = await getSupabase().from('profiles').update(next).eq('id', profile.id);
    if (error) {
      useAuthStore.getState().setProfile(previous);
      toastError('Gizlilik ayarı kaydedilemedi.');
    }
  };

  return (
    <Screen scroll>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <AppText variant="subtitle">Gizlilik ayarları</AppText>
        </View>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="subtitle">Gizli hesap</AppText>
              <AppText tone="muted">
                Açınca yeni takipler istek olur. Şimdilik çoğu hesap herkese açık kalabilir.
              </AppText>
            </View>
            <Switch
              value={privateOn}
              onValueChange={(value) => void patch({ is_private: value })}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.surface}
            />
          </View>
        </Card>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="subtitle">Çalışma durumumu Sosyal'de göster</AppText>
              <AppText tone="muted">
                Açıkken diğerleri hangi ders ve konuda çalıştığını görebilir. Kapalıyken canlı durum paylaşılmaz.
              </AppText>
            </View>
            <Switch
              value={studyOn}
              onValueChange={(value) => void patch({ show_study_status_social: value })}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.surface}
            />
          </View>
        </Card>
      </View>
    </Screen>
  );
}
