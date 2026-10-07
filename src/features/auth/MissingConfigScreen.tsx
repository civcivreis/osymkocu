import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function MissingConfigScreen() {
  const { spacing } = useAppTheme();

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.lg }}>
        <AppText variant="display">{APP_NAME}</AppText>
        <AppText tone="muted">
          Uygulama ayağa kalktı ama henüz Supabase anahtarları yok. Auth bu yüzden çalışmaz.
        </AppText>
        <Card>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="subtitle">Kurulum</AppText>
            <AppText>
              Proje köküne `.env` ekle, ardından development sunucusunu yeniden başlat:
            </AppText>
            <AppText variant="caption" tone="muted">
              EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co{'\n'}
              EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
            </AppText>
            <AppText tone="muted">
              SQL dosyasını Supabase SQL Editor’da çalıştırmayı unutma:
              supabase/migrations/0001_init.sql
            </AppText>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
