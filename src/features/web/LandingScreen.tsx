import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SeoHead } from '@/src/features/seo/SeoHead';
import {
  CoachPreview,
  DevicePair,
  ExamPreview,
  HeroProductPreview,
  MatchPreview,
  ProgressPreview,
} from '@/src/features/web/landing/LandingPreviews';
import { landing as T } from '@/src/features/web/landing/tokens';
import { APP_NAME, APP_TAGLINE } from '@/src/lib/brand';

const SEO_DESCRIPTION =
  'TYT, AYT ve KPSS için test, AI koç, sosyal çalışma, çalışma eşleşmeleri ve sistem sınavları. Aynı hesap telefon ve web’de.';

const NAV = [
  { id: 'ozellikler', label: 'Özellikler' },
  { id: 'nasil', label: 'Nasıl çalışır' },
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

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function Cta({
  label,
  onPress,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'navy';
}) {
  const bg = variant === 'primary' ? T.orange : variant === 'navy' ? T.navy : 'transparent';
  const color = variant === 'ghost' ? T.ink : T.white;
  const borderWidth = variant === 'ghost' ? 1 : 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }) => ({
        minHeight: 48,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: bg,
        borderWidth,
        borderColor: T.line,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.88 : 1,
        transform: [{ translateY: hovered && !pressed ? -1 : 0 }],
      })}>
      <Text style={{ color, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Section({
  id,
  children,
  dark,
  reduced,
}: {
  id?: string;
  children: ReactNode;
  dark?: boolean;
  reduced: boolean;
}) {
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0.35)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.timing(opacity, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [opacity, reduced]);

  return (
    <Animated.View
      nativeID={id}
      style={{
        opacity,
        backgroundColor: dark ? T.navy : 'transparent',
        paddingVertical: 56,
        paddingHorizontal: 20,
      }}>
      <View style={{ maxWidth: T.max, width: '100%', alignSelf: 'center' }}>{children}</View>
    </Animated.View>
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
    <Pressable
      style={({ hovered }) => ({
        flexGrow: 1,
        flexBasis: 280,
        backgroundColor: T.paper,
        borderRadius: 20,
        padding: 20,
        gap: 10,
        borderWidth: 1,
        borderColor: hovered ? T.orangeSoft : T.line,
        shadowColor: T.navy,
        shadowOpacity: hovered ? 0.14 : 0.06,
        shadowRadius: hovered ? 18 : 10,
        shadowOffset: { width: 0, height: hovered ? 10 : 5 },
        transform: [{ translateY: hovered ? -3 : 0 }],
      })}>
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          backgroundColor: T.orangeSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name={icon} size={20} color={T.orange} />
      </View>
      <Text style={{ color: T.ink, fontSize: 18, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: T.muted, fontSize: 14, lineHeight: 21 }}>{body}</Text>
    </Pressable>
  );
}

export function LandingScreen() {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const tablet = width >= 768;
  const reduced = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const [menu, setMenu] = useState(false);
  const heroFade = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.timing(heroFade, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [heroFade, reduced]);

  const scrollTo = (id: string) => {
    setMenu(false);
    const y = offsets.current[id];
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - 72), animated: !reduced });
  };

  const navLinks = useMemo(
    () =>
      NAV.map((item) => (
        <Pressable key={item.id} onPress={() => scrollTo(item.id)} hitSlop={8}>
          <Text style={{ color: T.ink, fontWeight: '600', fontSize: 14 }}>{item.label}</Text>
        </Pressable>
      )),
    [],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.cream }} edges={['top', 'bottom']}>
      <SeoHead path="/" description={SEO_DESCRIPTION} />
      <View
        style={{
          zIndex: 40,
          backgroundColor: 'rgba(246,241,232,0.94)',
          borderBottomWidth: 1,
          borderBottomColor: T.line,
        }}>
        <View
          style={{
            maxWidth: T.max,
            width: '100%',
            alignSelf: 'center',
            minHeight: 64,
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}>
          <Text style={{ color: T.navy, fontSize: 18, fontWeight: '800' }}>{APP_NAME}</Text>
          {tablet ? (
            <View style={{ flexDirection: 'row', gap: 28, flex: 1, justifyContent: 'center' }}>{navLinks}</View>
          ) : (
            <Pressable onPress={() => setMenu((v) => !v)} hitSlop={12} accessibilityLabel="Menü">
              <Ionicons name={menu ? 'close' : 'menu'} size={26} color={T.navy} />
            </Pressable>
          )}
          {tablet ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Cta label="Giriş Yap" variant="ghost" onPress={() => router.push('/giris')} />
              <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
            </View>
          ) : null}
        </View>
        {menu && !tablet ? (
          <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}>
            {navLinks}
            <Cta label="Giriş Yap" variant="ghost" onPress={() => router.push('/giris')} />
            <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
          </View>
        ) : null}
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <Animated.View
          style={{
            opacity: heroFade,
            transform: [{ translateY: heroFade.interpolate({ inputRange: [0, 1], outputRange: reduced ? [0, 0] : [16, 0] }) }],
            paddingHorizontal: 20,
            paddingTop: desktop ? 56 : 28,
            paddingBottom: 36,
            maxWidth: T.max,
            width: '100%',
            alignSelf: 'center',
            flexDirection: desktop ? 'row' : 'column',
            gap: desktop ? 48 : 28,
            alignItems: 'center',
          }}>
          <View style={{ flex: 1, gap: 14, maxWidth: 560 }}>
            <Text style={{ color: T.orange, fontWeight: '800', letterSpacing: 0.8, fontSize: 13 }}>{APP_TAGLINE}</Text>
            <Text style={{ color: T.ink, fontSize: desktop ? 48 : 32, fontWeight: '800', letterSpacing: -1.2, lineHeight: desktop ? 56 : 38 }}>
              Sınava tek başına hazırlanma.
            </Text>
            <Text style={{ color: T.muted, fontSize: 18, lineHeight: 28, maxWidth: 480 }}>
              Test çöz, gelişimini takip et, aynı konuyu çalışan öğrencilerle eşleş ve birlikte ilerle.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
              <Cta label="Nasıl çalışır?" variant="ghost" onPress={() => scrollTo('nasil')} />
            </View>
            <View style={{ gap: 4, marginTop: 8 }}>
              <Text style={{ color: T.muted, fontSize: 13 }}>Web ve mobilde aynı hesap.</Text>
              <Text style={{ color: T.muted, fontSize: 13 }}>İlerlemen her yerde seninle.</Text>
            </View>
          </View>
          <View style={{ flex: 1, width: '100%', maxWidth: 460 }}>
            <HeroProductPreview reducedMotion={reduced} />
          </View>
        </Animated.View>

        <View
          onLayout={(e) => {
            offsets.current.ozellikler = e.nativeEvent.layout.y;
          }}>
          <Section id="ozellikler" reduced={reduced}>
            <Text style={{ color: T.ink, fontSize: 28, fontWeight: '800', marginBottom: 8 }}>Hepsi aynı hesapta</Text>
            <Text style={{ color: T.muted, fontSize: 16, marginBottom: 24, maxWidth: 520 }}>
              Test, koç, eşleşme ve deneme — ayrı uygulamalar değil, tek çalışma alanı.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {FEATURES.map((item) => (
                <FeatureCard key={item.title} {...item} />
              ))}
            </View>
          </Section>
        </View>

        <View
          onLayout={(e) => {
            offsets.current.sosyal = e.nativeEvent.layout.y;
          }}>
          <Section id="sosyal" reduced={reduced}>
            <View style={{ flexDirection: desktop ? 'row' : 'column', gap: 36, alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 12 }}>
                <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800', lineHeight: 38 }}>
                  Seninle aynı konuyu çalışan birini bul.
                </Text>
                <Text style={{ color: T.muted, fontSize: 16, lineHeight: 24 }}>
                  Eşleşme bir gösteri akışı değil; iki taraf da kabul ederse çalışma alanı açılır.
                </Text>
                {[
                  'Aynı konuya çalışan öğrencilerle eşleş',
                  'İki taraf da kabul ederse çalışma alanı açılır',
                  'Soru çözmeye devam ederken yazılı sohbet et',
                  'İstersen eşleşme sistemini kapat',
                ].map((line) => (
                  <View key={line} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Ionicons name="checkmark-circle" size={18} color={T.orange} style={{ marginTop: 2 }} />
                    <Text style={{ color: T.ink, fontSize: 15, flex: 1, lineHeight: 22 }}>{line}</Text>
                  </View>
                ))}
              </View>
              <MatchPreview />
            </View>
          </Section>
        </View>

        <View
          onLayout={(e) => {
            offsets.current.sinavlar = e.nativeEvent.layout.y;
          }}>
          <Section id="sinavlar" dark reduced={reduced}>
            <View style={{ flexDirection: desktop ? 'row' : 'column', gap: 36, alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 12 }}>
                <Text style={{ color: T.white, fontSize: 30, fontWeight: '800' }}>Sistem sınavları</Text>
                <Text style={{ color: 'rgba(255,251,245,0.75)', fontSize: 16, lineHeight: 24 }}>
                  Belirli akşam saatlerinde yapılan ortak denemelere katıl, sonuçlarını analiz et ve sıralamanı gör.
                </Text>
              </View>
              <ExamPreview />
            </View>
          </Section>
        </View>

        <View
          onLayout={(e) => {
            offsets.current.nasil = e.nativeEvent.layout.y;
          }}>
          <Section id="nasil" reduced={reduced}>
            <View style={{ flexDirection: desktop ? 'row' : 'column', gap: 36, alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 12 }}>
                <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800' }}>Takıldığında koçun yanında.</Text>
                <Text style={{ color: T.muted, fontSize: 16, lineHeight: 24 }}>
                  Koç, açık sorunun bağlamını görür. Konuya göre açıklar, plan önerir, zayıf konuyu işaret eder.
                </Text>
                {[
                  'Açık sorunun konusu ve şıklarıyla konuşur',
                  'Konuya göre açıklama — genel sohbet botu değil',
                  'Çalışma planı ve zayıf konu analizi aynı hesapta',
                ].map((line) => (
                  <Text key={line} style={{ color: T.ink, fontSize: 15, lineHeight: 22 }}>
                    · {line}
                  </Text>
                ))}
              </View>
              <CoachPreview />
            </View>
          </Section>
        </View>

        <Section reduced={reduced}>
          <View style={{ flexDirection: desktop ? 'row' : 'column', gap: 36, alignItems: 'center' }}>
            <ProgressPreview />
            <View style={{ flex: 1, gap: 10 }}>
              <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800' }}>Çalıştıkça ilerlemeni gör.</Text>
              <Text style={{ color: T.muted, fontSize: 16, lineHeight: 24 }}>
                XP, streak, haftalık tempo, zayıf konular ve test geçmişi hesabına yazılır. Karttaki sayılar örnek görünüm.
              </Text>
            </View>
          </View>
        </Section>

        <Section reduced={reduced}>
          <Text style={{ color: T.ink, fontSize: 30, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>
            Telefonda başla, bilgisayarda devam et.
          </Text>
          <Text style={{ color: T.muted, fontSize: 16, textAlign: 'center', marginBottom: 28, alignSelf: 'center', maxWidth: 520 }}>
            Aynı hesap: mesajlar, ilerleme, sınavlar ve sosyal aktivite.
          </Text>
          <DevicePair />
        </Section>

        <Section reduced={reduced}>
          <View
            style={{
              backgroundColor: T.navy,
              borderRadius: 28,
              paddingVertical: desktop ? 56 : 36,
              paddingHorizontal: 24,
              alignItems: 'center',
              gap: 12,
              overflow: 'hidden',
            }}>
            <View
              style={{
                position: 'absolute',
                width: 280,
                height: 280,
                borderRadius: 140,
                backgroundColor: T.orangeGlow,
                right: -60,
                top: -80,
              }}
            />
            <Text style={{ color: T.white, fontSize: desktop ? 36 : 28, fontWeight: '800', textAlign: 'center' }}>
              Bugün çalışmaya başla.
            </Text>
            <Text style={{ color: 'rgba(255,251,245,0.75)', fontSize: 16, textAlign: 'center', maxWidth: 480, lineHeight: 24 }}>
              TYT, AYT veya KPSS hedefini seç ve ilerlemeni takip etmeye başla.
            </Text>
            <View style={{ marginTop: 8, minWidth: 200 }}>
              <Cta label="Ücretsiz Başla" onPress={() => router.push('/kayit')} />
            </View>
          </View>
        </Section>

        <View style={{ maxWidth: T.max, width: '100%', alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 28, gap: 10 }}>
          <Text style={{ color: T.navy, fontWeight: '800' }}>{APP_NAME}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
