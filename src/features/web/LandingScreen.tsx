import { Link, router } from 'expo-router';
import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Screen } from '@/src/components/ui/Screen';
import { APP_BLURB, APP_NAME, APP_TAGLINE } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { SeoHead } from '@/src/features/seo/SeoHead';

const FEATURES = [
  { title: 'AI Koç', body: 'Takıldığın soruda koçun yanında. Aynı hesap, aynı bağlam.' },
  { title: 'Test Merkezi', body: 'Ders ve konu bazlı soru çöz, sonuçların hesabına yazılsın.' },
  { title: 'Sistem Sınavları', body: 'ÖSYM takvimine yakın denemeler, canlı oturum.' },
  { title: 'Çalışma Eşleşmeleri', body: 'Aynı konuyu çalışan öğrencilerle sessiz öneriler.' },
  { title: 'Sosyal Çalışma', body: 'Durum, oda ve takip. Telefonla aynı sosyal grafik.' },
  { title: 'İlerleme Analizi', body: 'Streak, XP ve haftalık çalışma — uydurma istatistik yok.' },
];

export function LandingScreen() {
  const { colors, spacing, radius } = useAppTheme();

  return (
    <Screen scroll>
      <SeoHead path="/" />
      <View style={{ maxWidth: 960, width: '100%', alignSelf: 'center', gap: spacing.xl, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View>
            <AppText variant="subtitle">{APP_NAME}</AppText>
            <AppText variant="caption" tone="muted">
              {APP_TAGLINE}
            </AppText>
          </View>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <Link href="/giris" style={{ color: colors.text, fontWeight: '600' }}>
              Giriş
            </Link>
            <Link href="/kayit" style={{ color: colors.accent, fontWeight: '700' }}>
              Ücretsiz başla
            </Link>
          </View>
        </View>

        <View style={{ gap: spacing.md, paddingVertical: 24 }}>
          <AppText variant="display">{APP_NAME}</AppText>
          <AppText variant="title" tone="accent">
            {APP_TAGLINE}
          </AppText>
          <AppText tone="muted" style={{ maxWidth: 520, lineHeight: 24 }}>
            {APP_BLURB} Telefon uygulamasıyla aynı hesap, aynı ilerleme, aynı mesajlar.
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            <View style={{ minWidth: 180, flexGrow: 1, maxWidth: 240 }}>
              <Button label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
            </View>
            <View style={{ minWidth: 180, flexGrow: 1, maxWidth: 240 }}>
              <Button label="Giriş Yap" variant="secondary" onPress={() => router.push('/giris')} />
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {FEATURES.map((feature) => (
            <View
              key={feature.title}
              style={{
                flexGrow: 1,
                flexBasis: 260,
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 16,
                gap: 6,
              }}>
              <AppText variant="subtitle">{feature.title}</AppText>
              <AppText variant="caption" tone="muted">
                {feature.body}
              </AppText>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 12 }}>
          <Link href="/gizlilik" style={{ color: colors.textMuted }}>
            Gizlilik
          </Link>
          <Link href="/kullanim-kosullari" style={{ color: colors.textMuted }}>
            Kullanım koşulları
          </Link>
          <Link href="/iletisim" style={{ color: colors.textMuted }}>
            İletişim
          </Link>
        </View>
      </View>
    </Screen>
  );
}
