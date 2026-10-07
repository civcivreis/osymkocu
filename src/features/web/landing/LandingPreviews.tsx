import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Text, View } from 'react-native';

import { landing as T } from '@/src/features/web/landing/tokens';

function DemoChip() {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: T.orangeSoft,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
      }}>
      <Text style={{ color: T.orange, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>ÖRNEK ARAYÜZ</Text>
    </View>
  );
}

function MiniCard({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: T.paper,
        borderRadius: 16,
        padding: 12,
        gap: 6,
        borderWidth: 1,
        borderColor: accent ? T.orangeSoft : T.line,
        shadowColor: T.navy,
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }}>
      {children}
    </View>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={{ color: T.muted, fontSize: 11, fontWeight: '600' }}>{children}</Text>;
}

export function HeroProductPreview({ reducedMotion }: { reducedMotion: boolean }) {
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reducedMotion]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  return (
    <Animated.View style={{ transform: [{ translateY }], gap: 10 }}>
      <MiniCard accent>
        <DemoChip />
        <Text style={{ color: T.ink, fontSize: 16, fontWeight: '700' }}>Bugünkü plan</Text>
        <Text style={{ color: T.muted, fontSize: 13 }}>Tarih · İslamiyet Öncesi Türk Tarihi</Text>
        <View style={{ height: 8, backgroundColor: T.creamDeep, borderRadius: 99, overflow: 'hidden', marginTop: 4 }}>
          <View style={{ width: '62%', height: '100%', backgroundColor: T.orange, borderRadius: 99 }} />
        </View>
        <Text style={{ color: T.muted, fontSize: 12 }}>Haftalık tempo — örnek çubuk</Text>
      </MiniCard>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <MiniCard>
            <Label>EŞLEŞME</Label>
            <Text style={{ color: T.ink, fontWeight: '700' }}>Aynı konu</Text>
            <Text style={{ color: T.muted, fontSize: 12 }}>İki taraf kabul ederse oda açılır</Text>
          </MiniCard>
        </View>
        <View style={{ flex: 1 }}>
          <MiniCard>
            <Label>SİSTEM SINAVI</Label>
            <Text style={{ color: T.ink, fontWeight: '700' }}>21:00</Text>
            <Text style={{ color: T.muted, fontSize: 12 }}>Akşam slotu · hatırlat</Text>
          </MiniCard>
        </View>
      </View>

      <MiniCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.navy, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="sparkles" size={14} color={T.white} />
          </View>
          <Text style={{ color: T.ink, fontWeight: '700', flex: 1 }}>AI Koç</Text>
        </View>
        <View style={{ backgroundColor: T.cream, borderRadius: 12, padding: 10 }}>
          <Text style={{ color: T.muted, fontSize: 13, lineHeight: 18 }}>
            Bu soru üslü sayılar. Tabanlar eşitse üsler toplanır — açıkla, ezberletme.
          </Text>
        </View>
      </MiniCard>
    </Animated.View>
  );
}

export function MatchPreview() {
  return (
    <View
      style={{
        backgroundColor: T.paper,
        borderRadius: 22,
        padding: 20,
        gap: 14,
        borderWidth: 1,
        borderColor: T.line,
        shadowColor: T.navy,
        shadowOpacity: 0.1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        maxWidth: 420,
        width: '100%',
      }}>
      <DemoChip />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: T.orangeSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: T.orange, fontWeight: '800', fontSize: 18 }}>A</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: T.ink, fontWeight: '700', fontSize: 16 }}>Ayşe#1284</Text>
          <Text style={{ color: T.success, fontWeight: '600', fontSize: 13 }}>Birini buldum 👋</Text>
        </View>
      </View>
      <Text style={{ color: T.muted, fontSize: 14, lineHeight: 21 }}>
        Ayşe de şu anda seninle aynı konuyu çalışıyor.
      </Text>
      <View style={{ backgroundColor: T.cream, borderRadius: 14, padding: 12 }}>
        <Text style={{ color: T.muted, fontSize: 12, fontWeight: '600' }}>KONU</Text>
        <Text style={{ color: T.ink, fontWeight: '700', marginTop: 2 }}>Tarih</Text>
        <Text style={{ color: T.ink }}>İslamiyet Öncesi Türk Tarihi</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: T.muted, fontWeight: '600' }}>Şimdi değil</Text>
        </View>
        <View style={{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: T.orange, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: T.white, fontWeight: '700' }}>Birlikte çalış</Text>
        </View>
      </View>
    </View>
  );
}

export function ExamPreview() {
  return (
    <View
      style={{
        backgroundColor: T.navyMid,
        borderRadius: 22,
        padding: 22,
        gap: 10,
        maxWidth: 420,
        width: '100%',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
      }}>
      <DemoChip />
      <Text style={{ color: T.orangeSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>TYT</Text>
      <Text style={{ color: T.white, fontSize: 22, fontWeight: '800' }}>Ekim Sistem Denemesi</Text>
      <Text style={{ color: 'rgba(255,251,245,0.72)', fontSize: 15 }}>18 Ekim • 21:00</Text>
      <Text style={{ color: 'rgba(255,251,245,0.72)', fontSize: 14 }}>120 soru • 165 dk</Text>
      <View
        style={{
          marginTop: 8,
          alignSelf: 'flex-start',
          backgroundColor: T.orange,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 12,
        }}>
        <Text style={{ color: T.white, fontWeight: '700' }}>Hatırlat</Text>
      </View>
    </View>
  );
}

export function CoachPreview() {
  return (
    <View
      style={{
        backgroundColor: T.paper,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: T.line,
        maxWidth: 380,
        width: '100%',
        shadowColor: T.navy,
        shadowOpacity: 0.1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}>
      <View style={{ backgroundColor: T.navy, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="sparkles" size={16} color={T.white} />
        <Text style={{ color: T.white, fontWeight: '700' }}>AI Koç</Text>
      </View>
      <View style={{ padding: 14, gap: 10 }}>
        <DemoChip />
        <View style={{ alignSelf: 'flex-end', backgroundColor: T.orangeSoft, borderRadius: 14, padding: 10, maxWidth: '88%' }}>
          <Text style={{ color: T.ink, fontSize: 13 }}>2³ · 2² neden 32?</Text>
        </View>
        <View style={{ alignSelf: 'flex-start', backgroundColor: T.cream, borderRadius: 14, padding: 10, maxWidth: '92%' }}>
          <Text style={{ color: T.ink, fontSize: 13, lineHeight: 19 }}>
            Aynı tabanlı çarpma: üsler toplanır. 2⁵ = 32. Bu sorunun konusu üslü sayılar.
          </Text>
        </View>
      </View>
    </View>
  );
}

export function ProgressPreview() {
  const bars = [0.35, 0.55, 0.4, 0.7, 0.5, 0.85, 0.6];
  return (
    <View
      style={{
        backgroundColor: T.paper,
        borderRadius: 22,
        padding: 20,
        gap: 12,
        borderWidth: 1,
        borderColor: T.line,
        maxWidth: 420,
        width: '100%',
      }}>
      <DemoChip />
      <Text style={{ color: T.ink, fontSize: 20, fontWeight: '800' }}>Seviye 7</Text>
      <Text style={{ color: T.muted }}>2.480 / 3.000 XP</Text>
      <View style={{ height: 10, backgroundColor: T.creamDeep, borderRadius: 99, overflow: 'hidden' }}>
        <View style={{ width: '82%', height: '100%', backgroundColor: T.orange }} />
      </View>
      <Text style={{ color: T.muted, fontSize: 12 }}>Haftalık aktivite — örnek</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 72 }}>
        {bars.map((h, i) => (
          <View key={i} style={{ flex: 1, height: 72 * h, backgroundColor: i === 5 ? T.orange : T.orangeSoft, borderRadius: 8 }} />
        ))}
      </View>
    </View>
  );
}

export function DevicePair() {
  return (
    <View style={{ flexDirection: Platform.OS === 'web' ? 'row' : 'column', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 160,
          height: 280,
          borderRadius: 28,
          backgroundColor: T.navy,
          padding: 10,
          borderWidth: 4,
          borderColor: '#0E1728',
        }}>
        <View style={{ flex: 1, backgroundColor: T.cream, borderRadius: 18, padding: 10, gap: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: T.ink }}>ÖSYM Koçu</Text>
          <View style={{ height: 36, backgroundColor: T.orangeSoft, borderRadius: 10 }} />
          <View style={{ height: 36, backgroundColor: T.paper, borderRadius: 10, borderWidth: 1, borderColor: T.line }} />
          <View style={{ height: 36, backgroundColor: T.paper, borderRadius: 10, borderWidth: 1, borderColor: T.line }} />
        </View>
      </View>
      <View
        style={{
          width: 320,
          maxWidth: '100%',
          height: 200,
          borderRadius: 16,
          backgroundColor: T.paper,
          borderWidth: 1,
          borderColor: T.line,
          padding: 14,
          gap: 10,
          shadowColor: T.navy,
          shadowOpacity: 0.1,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
        }}>
        <Text style={{ fontWeight: '800', color: T.ink }}>Masaüstü çalışma</Text>
        <View style={{ flexDirection: 'row', gap: 8, flex: 1 }}>
          <View style={{ width: 72, backgroundColor: T.navy, borderRadius: 10 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 18, width: '70%', backgroundColor: T.creamDeep, borderRadius: 6 }} />
            <View style={{ flex: 1, backgroundColor: T.cream, borderRadius: 10 }} />
          </View>
        </View>
      </View>
    </View>
  );
}
