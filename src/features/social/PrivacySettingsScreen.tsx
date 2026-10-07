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

  const onToggle = async (value: boolean) => {
    if (!profile) return;
    useAuthStore.getState().setProfile({ ...profile, is_private: value });
    const { error } = await getSupabase().from('profiles').update({ is_private: value }).eq('id', profile.id);
    if (error) {
      useAuthStore.getState().setProfile({ ...profile, is_private: !value });
      toastError('Gizlilik için supabase/migrations/0021_follows.sql dosyasını SQL Editor’da çalıştır.');
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
              onValueChange={(value) => void onToggle(value)}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.surface}
            />
          </View>
        </Card>
      </View>
    </Screen>
  );
}
