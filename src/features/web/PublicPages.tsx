import { Link } from 'expo-router';
import { type ReactNode } from 'react';
import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { APP_NAME, APP_TAGLINE, APP_URL } from '@/src/lib/brand';
import { env } from '@/src/lib/env';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

function PublicFrame({ title, path, children }: { title: string; path: string; children: ReactNode }) {
  const { colors, spacing } = useAppTheme();
  return (
    <Screen scroll>
      <SeoHead title={`${title} | ${APP_NAME}`} path={path} />
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center', gap: spacing.lg, paddingVertical: 12 }}>
        <Link href="/" style={{ color: colors.accent, fontWeight: '600' }}>
          {APP_NAME}
        </Link>
        <AppText variant="title">{title}</AppText>
        {children}
      </View>
    </Screen>
  );
}

export function PrivacyPublicScreen() {
  return (
    <PublicFrame title="Gizlilik" path="/gizlilik">
      <AppText tone="muted">
        {APP_NAME} hesabın Supabase üzerinde tutulur. Telefon uygulaması ve {APP_URL} aynı kullanıcı kaydını, ilerlemeyi ve
        mesajları kullanır.
      </AppText>
      <AppText tone="muted">
        Soru çözümleri, XP, streak ve sosyal içerik senin hesabına bağlıdır. Servis anahtarları tarayıcıya konulmaz; istemci
        yalnızca anonim anahtar ile konuşur.
      </AppText>
      <AppText tone="muted">Medya dosyaları Cloudflare R2 üzerinde, imzalı adreslerle sunulur.</AppText>
    </PublicFrame>
  );
}

export function TermsPublicScreen() {
  return (
    <PublicFrame title="Kullanım koşulları" path="/kullanim-kosullari">
      <AppText tone="muted">
        {APP_NAME} ({APP_TAGLINE}) bir çalışma aracıdır. Sınav sonuçlarını, kontenjanı veya atamayı garanti etmez.
      </AppText>
      <AppText tone="muted">
        Topluluk kurallarına aykırı içerik, taciz ve kopya paylaşımı hesap kısıtlamasına yol açabilir. Sistem sınavları ve
        soru bankası uygulama içi içeriktir; resmi ÖSYM oturumu değildir.
      </AppText>
    </PublicFrame>
  );
}

export function ContactPublicScreen() {
  return (
    <PublicFrame title="İletişim" path="/iletisim">
      <AppText tone="muted">Yazışma: {env.contactEmail}</AppText>
      <AppText tone="muted">Web: {APP_URL}</AppText>
    </PublicFrame>
  );
}
