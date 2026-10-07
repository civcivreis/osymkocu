import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { landing as T } from '@/src/features/web/landing/tokens';

function DemoChip() {
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: T.orangeSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
      <Text style={{ color: T.orange, fontSize: 10, fontWeight: '700' }}>ÖRNEK ARAYÜZ</Text>
    </View>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        width: '100%',
        backgroundColor: T.paper,
        borderRadius: 20,
        padding: 18,
        gap: 10,
        borderWidth: 1,
        borderColor: T.line,
        shadowColor: T.navy,
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}>
      {children}
    </View>
  );
}

export function HeroProductPreview() {
  return (
    <View
      style={{
        width: '100%',
        maxWidth: 400,
        alignSelf: 'center',
        backgroundColor: T.paper,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: T.line,
        paddingHorizontal: 28,
        paddingVertical: 32,
        alignItems: 'center',
        gap: 10,
        shadowColor: T.navy,
        shadowOpacity: 0.1,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      }}>
      <LetterAvatar id="landing-hero-ayse" name="Ayşe" size={88} />
      <Text style={{ color: T.ink, fontWeight: '800', fontSize: 20, marginTop: 6 }}>Ayşe#1284</Text>
      <Text style={{ color: T.success, fontWeight: '700', fontSize: 15 }}>Birini buldum 👋</Text>
      <Text style={{ color: T.body, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>
        Ayşe de şu anda seninle aynı konuyu çalışıyor.
      </Text>
      <Text style={{ color: T.ink, fontWeight: '800', fontSize: 16, marginTop: 8 }}>Tarih</Text>
      <Text style={{ color: T.body, fontSize: 14, textAlign: 'center' }}>İslamiyet Öncesi Türk Tarihi</Text>
      <View style={{ flexDirection: 'row', gap: 8, width: '100%', marginTop: 10 }}>
        <View
          style={{
            flex: 1,
            minHeight: 46,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: T.line,
            backgroundColor: T.cream,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ color: T.ink, fontWeight: '600' }}>Şimdi değil</Text>
        </View>
        <View
          style={{
            flex: 1,
            minHeight: 46,
            borderRadius: 12,
            backgroundColor: T.orange,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ color: T.white, fontWeight: '700' }}>Birlikte çalış</Text>
        </View>
      </View>
    </View>
  );
}

export function MatchPreview() {
  return (
    <Panel>
      <DemoChip />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: T.orangeSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: T.orange, fontWeight: '800', fontSize: 18 }}>A</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: T.ink, fontWeight: '700', fontSize: 16 }}>Ayşe#1284</Text>
          <Text style={{ color: T.success, fontWeight: '600', fontSize: 13 }}>Birini buldum 👋</Text>
        </View>
      </View>
      <Text style={{ color: T.body, fontSize: 14, lineHeight: 21 }}>Ayşe de şu anda seninle aynı konuyu çalışıyor.</Text>
      <View style={{ backgroundColor: T.cream, borderRadius: 14, padding: 12 }}>
        <Text style={{ color: T.muted, fontSize: 12, fontWeight: '700' }}>KONU</Text>
        <Text style={{ color: T.ink, fontWeight: '700', marginTop: 2 }}>Tarih</Text>
        <Text style={{ color: T.ink }}>İslamiyet Öncesi Türk Tarihi</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: T.body, fontWeight: '600' }}>Şimdi değil</Text>
        </View>
        <View style={{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: T.orange, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: T.white, fontWeight: '700' }}>Birlikte çalış</Text>
        </View>
      </View>
    </Panel>
  );
}

export function ExamPreview() {
  return (
    <View style={{ width: '100%', backgroundColor: T.navyMid, borderRadius: 20, padding: 22, gap: 10 }}>
      <DemoChip />
      <Text style={{ color: T.orangeSoft, fontSize: 12, fontWeight: '700' }}>TYT</Text>
      <Text style={{ color: T.white, fontSize: 22, fontWeight: '800' }}>Ekim Sistem Denemesi</Text>
      <Text style={{ color: '#E2E8F0', fontSize: 15 }}>18 Ekim • 21:00</Text>
      <Text style={{ color: '#E2E8F0', fontSize: 14 }}>120 soru • 165 dk</Text>
      <View style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: T.orange, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 }}>
        <Text style={{ color: T.white, fontWeight: '700' }}>Hatırlat</Text>
      </View>
    </View>
  );
}

export function CoachPreview() {
  return (
    <View style={{ width: '100%', backgroundColor: T.paper, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: T.line }}>
      <View style={{ backgroundColor: T.navy, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="sparkles" size={16} color={T.white} />
        <Text style={{ color: T.white, fontWeight: '700' }}>AI Koç</Text>
      </View>
      <View style={{ padding: 14, gap: 10 }}>
        <DemoChip />
        <View style={{ alignSelf: 'flex-end', backgroundColor: T.orangeSoft, borderRadius: 14, padding: 10 }}>
          <Text style={{ color: T.ink, fontSize: 13 }}>2³ · 2² neden 32?</Text>
        </View>
        <View style={{ alignSelf: 'flex-start', backgroundColor: T.cream, borderRadius: 14, padding: 10 }}>
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
    <Panel>
      <DemoChip />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View>
          <Text style={{ color: T.ink, fontSize: 22, fontWeight: '800' }}>Seviye 7</Text>
          <Text style={{ color: T.body, marginTop: 4 }}>2.480 / 3.000 XP</Text>
        </View>
      </View>
      <View style={{ height: 10, backgroundColor: T.creamDeep, borderRadius: 99, overflow: 'hidden' }}>
        <View style={{ width: '82%', height: '100%', backgroundColor: T.orange }} />
      </View>
      <Text style={{ color: T.muted, fontSize: 12 }}>Haftalık aktivite — örnek</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 72 }}>
        {bars.map((h, i) => (
          <View key={i} style={{ flex: 1, height: 72 * h, backgroundColor: i === 5 ? T.orange : T.orangeSoft, borderRadius: 8 }} />
        ))}
      </View>
    </Panel>
  );
}

export function DevicePair() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
      <View style={{ width: 160, height: 260, borderRadius: 28, backgroundColor: T.navy, padding: 10 }}>
        <View style={{ flex: 1, backgroundColor: T.cream, borderRadius: 18, padding: 10, gap: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: T.ink }}>ÖSYM Koçu</Text>
          <View style={{ height: 36, backgroundColor: T.orangeSoft, borderRadius: 10 }} />
          <View style={{ height: 36, backgroundColor: T.paper, borderRadius: 10, borderWidth: 1, borderColor: T.line }} />
          <View style={{ height: 36, backgroundColor: T.paper, borderRadius: 10, borderWidth: 1, borderColor: T.line }} />
        </View>
      </View>
      <View style={{ flexGrow: 1, minWidth: 240, height: 200, borderRadius: 16, backgroundColor: T.paper, borderWidth: 1, borderColor: T.line, padding: 14, gap: 10 }}>
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
