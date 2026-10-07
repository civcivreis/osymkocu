import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { useExamBanner, useStartExamLobby } from '@/src/features/study/useStudyTogether';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export function ExamLobbyBanner() {
  const { colors, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const me = useAuthStore((s) => s.session?.user.id);
  const banner = useExamBanner();
  const start = useStartExamLobby();
  const [now, setNow] = useState(0);
  const pushed = useRef<string | null>(null);
  const data = banner.data;

  useEffect(() => {
    if (!data?.starts_at) return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [data?.starts_at]);

  useEffect(() => {
    if (!data) return;
    if (data.status === 'countdown' && pathname !== '/study-room' && pushed.current !== data.session_id) {
      pushed.current = data.session_id;
      router.push({ pathname: '/study-room', params: { sessionId: data.session_id } });
    }
  }, [data, pathname]);

  if (!data || pathname === '/study-room') return null;

  const left = data.capacity - data.member_count;
  const seconds = data.starts_at ? Math.max(0, Math.ceil((new Date(data.starts_at).getTime() - now) / 1000)) : 0;
  const host = data.host_id === me;
  const line =
    data.status === 'countdown'
      ? `${data.subject_name} ${seconds} sn sonra başlıyor`
      : left <= 0
        ? `${data.subject_name} · salon doldu`
        : left <= 5
          ? `${data.subject_name} · son ${left} kişi`
          : `${data.subject_name} · ${data.member_count}/${data.capacity} · üye bekleniyor`;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 6,
        left: 12,
        right: 12,
        zIndex: 60,
      }}>
      <Pressable
        onPress={() => router.push({ pathname: '/study-room', params: { sessionId: data.session_id } })}
        style={{
          backgroundColor: colors.navy,
          borderRadius: radius.md,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 4,
        }}>
        <AppText variant="caption" style={{ color: '#F4F1EA' }}>
          {line}
        </AppText>
        <AppText variant="caption" style={{ color: '#C9D0DA' }}>
          İlerlemenizin kaydedilebilmesi için sınav sırasında uygulamayı kapatmayın.
        </AppText>
        {host && data.status === 'waiting' && data.member_count >= 2 ? (
          <Pressable
            onPress={() => void start.mutateAsync(data.session_id)}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <AppText variant="caption" tone="accent">
              Odayı başlat
            </AppText>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
}
