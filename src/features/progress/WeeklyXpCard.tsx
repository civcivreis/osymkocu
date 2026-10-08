import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Card } from '@/src/components/ui/Card';
import { formatXp } from '@/src/features/progress/xp';
import { useWeeklyXpLeaderboard, useXpSummary } from '@/src/features/progress/useXpBoard';
import { taggedName } from '@/src/features/social/identity';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export function WeeklyXpCard({ compact = false }: { compact?: boolean }) {
  const { colors } = useAppTheme();
  const me = useAuthStore((s) => s.session?.user.id);
  const board = useWeeklyXpLeaderboard(compact ? 3 : 5);
  const mine = useXpSummary();
  const rows = board.data ?? [];

  return (
    <Card>
      <View style={{ gap: 10 }}>
        <AppText variant="label" tone="accent">
          {compact ? 'HAFTALIK SIRALAMA' : 'HAFTALIK XP'}
        </AppText>
        {board.isLoading ? <AppText variant="caption" tone="muted">Yükleniyor…</AppText> : null}
        {!board.isLoading && rows.length === 0 ? (
          <AppText variant="caption" tone="muted">
            Bu hafta sıralama henüz oluşmadı.
          </AppText>
        ) : null}
        {rows.map((row) => (
          <Pressable
            key={row.user_id}
            onPress={() => {
              if (row.user_id !== me) router.push({ pathname: '/user', params: { userId: row.user_id } });
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }}>
            <AppText variant="caption" style={{ width: 22, fontWeight: '700' }}>
              {row.rank}.
            </AppText>
            <AppText variant="caption" style={{ flex: 1 }} numberOfLines={1}>
              {row.user_id === me ? 'Sen' : taggedName(row.display_name, row.display_tag)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {formatXp(row.weekly_xp ?? 0)} XP
            </AppText>
          </Pressable>
        ))}
        {mine.data ? (
          <View style={{ paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
            <AppText variant="caption">
              Sen: {mine.data.weekly_rank ? `#${mine.data.weekly_rank}` : '—'} · Bu hafta {formatXp(mine.data.weekly_xp)} XP
            </AppText>
          </View>
        ) : null}
        <Pressable onPress={() => router.push('/siralama')} style={{ minHeight: 32, justifyContent: 'center' }}>
          <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
            Tüm sıralamayı gör
          </AppText>
        </Pressable>
      </View>
    </Card>
  );
}
