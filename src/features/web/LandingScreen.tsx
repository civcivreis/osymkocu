import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useHydrated } from '@/src/lib/layout/useHydrated';

import { SeoHead } from '@/src/features/seo/SeoHead';
import { BrandLogo } from '@/src/components/brand/BrandLogo';
import { LandingContainer } from '@/src/features/web/landing/LandingContainer';
import {
  CoachPreview,
  DevicePair,
  ExamPreview,
  HeroProductPreview,
  MatchPreview,
  ProgressPreview,
} from '@/src/features/web/landing/LandingPreviews';
import { landing as T, landingSectionY } from '@/src/features/web/landing/tokens';
import { APP_TAGLINE } from '@/src/lib/brand';

const SEO_DESCRIPTION =
  'TYT, AYT ve KPSS için test, AI koç, sosyal çalışma, çalışma eşleşmeleri ve sistem sınavları. Aynı hesap telefon ve web’de.';

const NAV = [
  { id: 'ozellikler', label: 'Özellikler' },
  { id: 'sinavlar', label: 'Sistem Sınavları' },
  { id: 'sosyal', label: 'Sosyal Çalışma' },
] as const;

const FEATURES = [
  { icon: 'sparkles' as const, title: 'AI Koç', body: 'Açık sorunun konusuyla konuşur. Ezber cümlesi değil, adım adım açıklama.' },
  { icon: 'grid-outline' as const, title: 'Test Merkezi', body: 'Ders ve konu seç, çöz, sonucu hesabına yazılsın.' },
  { icon: 'school-outline' as const, title: 'Sistem Sınavları', body: 'Akşam slotlarında ortak deneme. Analiz ve sıra senin panelinde.' },
  { icon: 'people-outline' as const, title: 'Çalışma Eşleşmeleri', body: 'Aynı konuyu çalışan birini bul. İkiniz de kabul edince oda açılır.' },
  { icon: 'chatbubbles-outline' as const, title: 'Sosyal Çalışma', body: 'Durum, oda ve mesajlar. Telefonla aynı sosyal grafik.' },
  { icon: 'stats-chart-outline' as const, title: 'İlerleme Analizi', body: 'XP, streak, zayıf konu ve test geçmişi. Uydurma metrik yok.' },
];

function useLandingWidth() {
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();
  if (Platform.OS === 'web' && !hydrated) return 1280;
  return width > 0 ? width : 1280;
}

function Cta({
  label,
  onPress,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: variant === 'primary' ? T.orange : T.white,
        borderWidth: variant === 'ghost' ? 1 : 0,
        borderColor: T.line,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.9 : 1,
      })}>
      <Text style={{ color: variant === 'primary' ? T.white : T.ink, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Band({
  children,
  bg,
  width,
  id,
  onY,
}: {
  children: ReactNode;
  bg: string;
  width: number;
  id?: string;
  onY?: (y: number) => void;
}) {
  return (
    <View
      nativeID={id}
      onLayout={(e) => onY?.(e.nativeEvent.layout.y)}
      style={{ backgroundColor: bg, paddingVertical: landingSectionY(width) }}>
      <LandingContainer width={width}>{children}</LandingContainer>
    </View>
  );
}

function Split({
  desktop,
  reverse,
  text,
  visual,
}: {
  desktop: boolean;
  reverse?: boolean;
  text: ReactNode;
  visual: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: desktop ? (reverse ? 'row-reverse' : 'row') : 'column',
        gap: desktop ? 40 : 28,
        alignItems: desktop ? 'center' : 'stretch',
      }}>
      <View style={{ flex: 1.05, gap: 14 }}>{text}</View>
      <View style={{ flex: 0.95, width: '100%' }}>{visual}</View>
    </View>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 168,
        backgroundColor: T.paper,
        borderRadius: 18,
        padding: 18,
        gap: 10,
        borderWidth: 1,
        borderColor: T.line,
        shadowColor: T.navy,
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.orangeSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={T.orange} />
      </View>
      <Text style={{ color: T.ink, fontSize: 17, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: T.body, fontSize: 14, lineHeight: 21 }}>{body}</Text>
    </View>
  );
}

export function LandingScreen() {
  const width = useLandingWidth();
  const desktop = width >= 1024;
  const tablet = width >= 768;
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const [menu, setMenu] = useState(false);

  const scrollTo = (id: string) => {
    setMenu(false);
    const y = offsets.current[id];
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const navLinks = NAV.map((item) => (
    <Pressable key={item.id} onPress={() => scrollTo(item.id)} hitSlop={8}>
      <Text style={{ color: T.ink, fontWeight: '600', fontSize: 14 }}>{item.label}</Text>
    </Pressable>
  ));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.cream }} edges={['top', 'bottom']}>
      <SeoHead path="/" description={SEO_DESCRIPTION} />
      <View style={{ backgroundColor: T.cream, borderBottomWidth: 1, borderBottomColor: T.line }}>
        <LandingContainer width={width}>
          <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flexShrink: 0, justifyContent: 'center' }}>
              <BrandLogo variant="full" />
            </View>
            {tablet ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, flexShrink: 1 }}>
                {navLinks}
                <Cta label="Giriş Yap" variant="ghost" onPress={() => router.push('/giris')} />
                <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
              </View>
            ) : (
              <Pressable onPress={() => setMenu((v) => !v)} hitSlop={12} accessibilityLabel="Menü">
                <Ionicons name={menu ? 'close' : 'menu'} size={26} color={T.navy} />
              </Pressable>
            )}
          </View>
          {menu && !tablet ? (
            <View style={{ paddingBottom: 16, gap: 14 }}>
              {navLinks}
              <Cta label="Giriş Yap" variant="ghost" onPress={() => router.push('/giris')} />
              <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
            </View>
          ) : null}
        </LandingContainer>
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
        <View style={{ backgroundColor: T.cream }}>
          <LandingContainer width={width}>
            <View
              style={{
                minHeight: desktop ? 640 : undefined,
                paddingVertical: desktop ? 48 : 32,
                flexDirection: desktop ? 'row' : 'column',
                gap: desktop ? 48 : 28,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <View style={{ flex: 1, gap: 14 }}>
                <Text style={{ color: T.orange, fontWeight: '800', letterSpacing: 0.6, fontSize: 13 }}>{APP_TAGLINE}</Text>
                <Text style={{ color: T.ink, fontSize: desktop ? 46 : 32, fontWeight: '800', letterSpacing: -1, lineHeight: desktop ? 54 : 38 }}>
                  Sınava tek başına hazırlanma.
                </Text>
                <Text style={{ color: T.body, fontSize: 17, lineHeight: 26 }}>
                  Test çöz, gelişimini takip et, aynı konuyu çalışan öğrencilerle eşleş ve birlikte ilerle.
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                  <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
                  <Cta label="Giriş Yap" variant="ghost" onPress={() => router.push('/giris')} />
                </View>
                <Text style={{ color: T.muted, fontSize: 13, marginTop: 4 }}>Web ve mobilde aynı hesap.</Text>
              </View>
              <View style={{ flex: 1, width: '100%' }}>
                <HeroProductPreview />
              </View>
            </View>
          </LandingContainer>
        </View>

        <Band id="ozellikler" bg={T.paper} width={width} onY={(y) => { offsets.current.ozellikler = y; }}>
          <Text style={{ color: T.ink, fontSize: 28, fontWeight: '800' }}>Hepsi aynı hesapta</Text>
          <Text style={{ color: T.body, fontSize: 16, lineHeight: 24, marginTop: 10, marginBottom: 40 }}>
            Test, koç, eşleşme ve deneme — ayrı uygulamalar değil, tek çalışma alanı.
          </Text>
          {desktop ? (
            <View style={{ gap: 24 }}>
              {[0, 1].map((row) => (
                <View key={row} style={{ flexDirection: 'row', gap: 24 }}>
                  {FEATURES.slice(row * 3, row * 3 + 3).map((item) => (
                    <View key={item.title} style={{ flex: 1 }}>
                      <FeatureCard {...item} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: tablet ? 'row' : 'column', flexWrap: 'wrap', gap: 24 }}>
              {FEATURES.map((item) => (
                <View key={item.title} style={{ flexGrow: 1, flexBasis: tablet ? 280 : '100%', maxWidth: tablet ? '48%' : '100%' }}>
                  <FeatureCard {...item} />
                </View>
              ))}
            </View>
          )}
        </Band>

        <Band id="sosyal" bg={T.cream} width={width} onY={(y) => { offsets.current.sosyal = y; }}>
          <Split
            desktop={desktop}
            text={
              <>
                <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800', lineHeight: 38 }}>Seninle aynı konuyu çalışan birini bul.</Text>
                <Text style={{ color: T.body, fontSize: 16, lineHeight: 24 }}>
                  Eşleşme bir gösteri akışı değil; iki taraf da kabul ederse çalışma alanı açılır.
                </Text>
                {['Aynı konuya çalışan öğrencilerle eşleş', 'İki taraf da kabul ederse çalışma alanı açılır', 'Soru çözmeye devam ederken yazılı sohbet et'].map(
                  (line) => (
                    <View key={line} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <Ionicons name="checkmark-circle" size={18} color={T.orange} style={{ marginTop: 2 }} />
                      <Text style={{ color: T.ink, fontSize: 15, flex: 1, lineHeight: 22 }}>{line}</Text>
                    </View>
                  ),
                )}
              </>
            }
            visual={<MatchPreview />}
          />
        </Band>

        <Band id="sinavlar" bg={T.navy} width={width} onY={(y) => { offsets.current.sinavlar = y; }}>
          <Split
            desktop={desktop}
            reverse
            text={
              <>
                <Text style={{ color: T.white, fontSize: 30, fontWeight: '800' }}>Sistem sınavları</Text>
                <Text style={{ color: '#E2E8F0', fontSize: 16, lineHeight: 24 }}>
                  Belirli akşam saatlerinde yapılan ortak denemelere katıl, sonuçlarını analiz et ve sıralamanı gör.
                </Text>
              </>
            }
            visual={<ExamPreview />}
          />
        </Band>

        <Band bg={T.paper} width={width}>
          <Split
            desktop={desktop}
            text={
              <>
                <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800' }}>Takıldığında koçun yanında.</Text>
                <Text style={{ color: T.body, fontSize: 16, lineHeight: 24 }}>
                  Koç, açık sorunun bağlamını görür. Konuya göre açıklar, plan önerir, zayıf konuyu işaret eder.
                </Text>
                {['Açık sorunun konusu ve şıklarıyla konuşur', 'Konuya göre açıklama — genel sohbet botu değil', 'Çalışma planı ve zayıf konu analizi aynı hesapta'].map(
                  (line) => (
                    <Text key={line} style={{ color: T.ink, fontSize: 15, lineHeight: 22 }}>
                      · {line}
                    </Text>
                  ),
                )}
              </>
            }
            visual={<CoachPreview />}
          />
        </Band>

        <Band bg={T.cream} width={width}>
          <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800' }}>Çalıştıkça ilerlemeni gör.</Text>
          <Text style={{ color: T.body, fontSize: 16, lineHeight: 24, marginTop: 10, marginBottom: 32 }}>
            XP, streak, haftalık tempo, zayıf konular ve test geçmişi hesabına yazılır. Karttaki sayılar örnek görünüm.
          </Text>
          <ProgressPreview />
        </Band>

        <Band bg={T.paper} width={width}>
          <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800', textAlign: 'center' }}>Telefonda başla, bilgisayarda devam et.</Text>
          <Text style={{ color: T.body, fontSize: 16, textAlign: 'center', marginTop: 10, marginBottom: 32, alignSelf: 'center' }}>
            Aynı hesap: mesajlar, ilerleme, sınavlar ve sosyal aktivite.
          </Text>
          <DevicePair />
        </Band>

        <Band bg={T.cream} width={width}>
          <View style={{ backgroundColor: T.navy, borderRadius: 24, paddingVertical: desktop ? 56 : 36, paddingHorizontal: 24, alignItems: 'center', gap: 12 }}>
            <Text style={{ color: T.white, fontSize: desktop ? 34 : 26, fontWeight: '800', textAlign: 'center' }}>Bugün çalışmaya başla.</Text>
            <Text style={{ color: '#E2E8F0', fontSize: 16, textAlign: 'center', maxWidth: 480, lineHeight: 24 }}>
              TYT, AYT veya KPSS hedefini seç ve ilerlemeni takip etmeye başla.
            </Text>
            <View style={{ marginTop: 8 }}>
              <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
            </View>
          </View>
        </Band>

        <View style={{ backgroundColor: T.cream, paddingBottom: 32, paddingTop: 8 }}>
          <LandingContainer width={width}>
            <BrandLogo variant="full" width={tablet ? 220 : 188} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
              <Link href="/gizlilik" style={{ color: T.muted, fontWeight: '600' }}>
                Gizlilik
              </Link>
              <Link href="/kullanim-kosullari" style={{ color: T.muted, fontWeight: '600' }}>
                Kullanım koşulları
              </Link>
              <Link href="/iletisim" style={{ color: T.muted, fontWeight: '600' }}>
                İletişim
              </Link>
            </View>
          </LandingContainer>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
