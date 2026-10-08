import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { Screen } from '@/src/components/ui/Screen';
import { SegmentedTabs } from '@/src/components/ui/SegmentedTabs';
import { formatXp } from '@/src/features/progress/xp';
import { useGlobalXpLeaderboard, useWeeklyXpLeaderboard, useXpSummary } from '@/src/features/progress/useXpBoard';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { taggedName } from '@/src/features/social/identity';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export function LeaderboardScreen() {
  const { colors, radius } = useAppTheme();
  const me = useAuthStore((s) => s.session?.user.id);
  const [tab, setTab] = useState<'week' | 'all'>('week');
  const [examOnly, setExamOnly] = useState(false);
  const weekly = useWeeklyXpLeaderboard(40, examOnly);
  const global = useGlobalXpLeaderboard(40, examOnly);
  const mine = useXpSummary();
  const rows = tab === 'week' ? (weekly.data ?? []) : (global.data ?? []);
  const loading = tab === 'week' ? weekly.isLoading : global.isLoading;

  return (
    <Screen scroll>
      <View style={{ gap: 14, paddingBottom: 32, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Pressable onPress={() => router.back()}>
          <AppText tone="accent">Geri</AppText>
        </Pressable>
        <PageHeader title="Sıralama" subtitle="Yalnızca herkese açık isim ve XP." />
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'week', label: 'Haftalık' },
            { value: 'all', label: 'Genel' },
          ]}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => setExamOnly(false)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: !examOnly ? colors.accentMuted : colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <AppText variant="caption">Tümü</AppText>
          </Pressable>
          <Pressable
            onPress={() => setExamOnly(true)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: examOnly ? colors.accentMuted : colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <AppText variant="caption">Benim sınavım</AppText>
          </Pressable>
        </View>
        {mine.data ? (
          <AppText variant="caption" tone="muted">
            Sen: {tab === 'week' ? (mine.data.weekly_rank ? `#${mine.data.weekly_rank}` : '—') : mine.data.global_rank ? `#${mine.data.global_rank}` : '—'} ·{' '}
            {tab === 'week' ? `${formatXp(mine.data.weekly_xp)} XP bu hafta` : `${formatXp(mine.data.total_xp)} XP`}
          </AppText>
        ) : null}
        {loading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
        {!loading && rows.length === 0 ? (
          <AppText tone="muted">{tab === 'week' ? 'Bu hafta sıralama henüz oluşmadı.' : 'Sıralama henüz yok.'}</AppText>
        ) : null}
        {rows.map((row) => {
          const mineRow = row.user_id === me;
          return (
            <Pressable
              key={row.user_id}
              onPress={() => {
                if (!mineRow) router.push({ pathname: '/user', params: { userId: row.user_id } });
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: radius.lg,
                backgroundColor: mineRow ? colors.accentMuted : colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <AppText variant="label" style={{ width: 28 }}>
                {row.rank}
              </AppText>
              <LetterAvatar id={row.user_id} name={row.display_name} size={36} imageUrl={row.avatar_url} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText numberOfLines={1}>{mineRow ? 'Sen' : taggedName(row.display_name, row.display_tag)}</AppText>
                <AppText variant="caption" tone="muted">
                  Seviye {row.level}
                </AppText>
              </View>
              <AppText variant="label">{formatXp(tab === 'week' ? row.weekly_xp ?? 0 : row.total_xp)} XP</AppText>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
