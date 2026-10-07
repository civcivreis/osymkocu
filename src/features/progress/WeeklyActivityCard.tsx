import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { formatStudyHours } from '@/src/features/progress/insights';
import { weekdayLetterIstanbul } from '@/src/features/progress/xp';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

function lastSevenIsos() {
  const today = todayIsoIstanbul();
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${today}T12:00:00+03:00`);
    date.setDate(date.getDate() - (6 - i));
    return todayIsoIstanbul(date);
  });
}

export function WeeklyActivityCard({
  questions,
  ms,
  activeDays,
  bars,
  days,
  questionDelta,
}: {
  questions: number;
  ms: number;
  activeDays: number;
  bars: number[];
  days?: string[];
  questionDelta: number | null;
}) {
  const { colors } = useAppTheme();
  const labels = days?.length === 7 ? days : lastSevenIsos();
  const peak = Math.max(...bars, 1);
  const hasData = questions > 0 || activeDays > 0;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 22,
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 10,
        minHeight: 120,
        shadowColor: '#142033',
        shadowOpacity: 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 1,
      }}>
      <AppText variant="label" tone="accent">
        Bu hafta
      </AppText>
      {hasData ? (
        <>
          <View style={{ flexDirection: 'row' }}>
            <MiniStat value={`${questions}`} hint="soru" />
            <MiniStat value={formatStudyHours(ms)} hint="süre" />
            <MiniStat value={`${activeDays}`} hint="aktif gün" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 44 }}>
            {bars.map((count, index) => (
              <View key={labels[index] ?? index} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <View
                  style={{
                    width: '70%',
                    maxWidth: 14,
                    height: Math.max(4, Math.round((count / peak) * 28)),
                    borderRadius: 4,
                    backgroundColor: count > 0 ? colors.accent : colors.bgMuted,
                  }}
                />
                <AppText variant="caption" tone="muted" style={{ fontSize: 10, lineHeight: 12 }}>
                  {weekdayLetterIstanbul(labels[index] ?? labels[0])}
                </AppText>
              </View>
            ))}
          </View>
          {questionDelta != null ? (
            <AppText variant="caption" tone={questionDelta >= 0 ? 'accent' : 'muted'}>
              Geçen haftaya göre %{Math.abs(questionDelta)} {questionDelta >= 0 ? 'daha fazla' : 'daha az'}
            </AppText>
          ) : null}
        </>
      ) : (
        <AppText variant="caption" tone="muted">
          Bu hafta henüz çalışma yok. Çözünce özet burada durur.
        </AppText>
      )}
    </View>
  );
}

function MiniStat({ value, hint }: { value: string; hint: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 1 }}>
      <AppText variant="label" numberOfLines={1} style={{ fontSize: 15 }}>
        {value}
      </AppText>
      <AppText variant="caption" tone="muted" style={{ fontSize: 11, lineHeight: 14 }}>
        {hint}
      </AppText>
    </View>
  );
}
