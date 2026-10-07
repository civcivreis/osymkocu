import { useLocalSearchParams, router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { taggedName } from '@/src/features/social/identity';
import { useSystemExamLeaderboard, useSystemExamResult } from '@/src/features/system-exams/useSystemExams';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function SystemExamResultScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams<{ attemptId?: string; examId?: string }>();
  const resultQuery = useSystemExamResult(String(params.attemptId ?? '') || null);
  const boardQuery = useSystemExamLeaderboard(String(params.examId ?? '') || null);
  const result = resultQuery.data as
    | {
        exam?: { title?: string; finished?: boolean };
        attempt?: {
          total_correct?: number;
          total_wrong?: number;
          total_blank?: number;
          score?: number;
          rank?: number | null;
          percentile?: number | null;
          duration_seconds?: number;
        };
        by_subject?: { name: string; correct: number; wrong: number; blank: number }[];
        by_topic?: { name: string; subject: string; correct: number; wrong: number; blank: number }[];
      }
    | undefined;
  const attempt = result?.attempt;
  const minutes = Math.round((attempt?.duration_seconds ?? 0) / 60);

  return (
    <Screen scroll>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Pressable onPress={() => router.replace('/system-exams')}>
          <AppText tone="accent">Sistem sınavlarına dön</AppText>
        </Pressable>
        <AppText variant="title">{result?.exam?.title ?? 'Sonuç'}</AppText>
        {resultQuery.isLoading ? <AppText tone="muted">Hesaplanıyor…</AppText> : null}
        {attempt ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 8 }}>
            <Row label="Doğru" value={`${attempt.total_correct ?? 0}`} />
            <Row label="Yanlış" value={`${attempt.total_wrong ?? 0}`} />
            <Row label="Boş" value={`${attempt.total_blank ?? 0}`} />
            <Row label="Net" value={`${attempt.score ?? 0}`} />
            <Row label="Süre" value={`${minutes} dk`} />
            {attempt.percentile != null ? <Row label="Yüzdelik" value={`%${attempt.percentile}`} /> : null}
            {attempt.rank != null ? <Row label="Sıralama" value={`${attempt.rank}`} /> : null}
            {!result?.exam?.finished ? (
              <AppText variant="caption" tone="muted">
                Sıralama sınav süresi bitince açıklanır.
              </AppText>
            ) : null}
          </View>
        ) : null}

        {(result?.by_subject ?? []).length > 0 ? (
          <View style={{ gap: 6 }}>
            <AppText variant="subtitle">Dersler</AppText>
            {result!.by_subject!.map((row) => (
              <AppText key={row.name} variant="caption">
                {row.name}: {row.correct}D {row.wrong}Y {row.blank}B
              </AppText>
            ))}
          </View>
        ) : null}
        {(result?.by_topic ?? []).slice(0, 8).length > 0 ? (
          <View style={{ gap: 6 }}>
            <AppText variant="subtitle">Konular</AppText>
            {result!.by_topic!.slice(0, 8).map((row) => (
              <AppText key={`${row.subject}-${row.name}`} variant="caption">
                {row.name}: {row.correct}D {row.wrong}Y {row.blank}B
              </AppText>
            ))}
          </View>
        ) : null}

        {boardQuery.data?.ready ? (
          <View style={{ gap: 8 }}>
            <AppText variant="subtitle">Sıralama</AppText>
            {boardQuery.data.mine ? (
              <AppText variant="caption" tone="accent">
                Senin sıran: {boardQuery.data.mine}
              </AppText>
            ) : null}
            {(boardQuery.data.top ?? []).slice(0, 20).map((row) => (
              <AppText key={`t-${row.rank}`} variant="caption" tone={row.is_me ? 'accent' : 'primary'}>
                {row.rank}. {taggedName(row.display_name, row.display_tag)} · {row.score} net
              </AppText>
            ))}
            {(boardQuery.data.nearby ?? []).length > 0 ? (
              <>
                <AppText variant="caption" tone="muted">
                  Yakınındakiler
                </AppText>
                {boardQuery.data.nearby.map((row) => (
                  <AppText key={`n-${row.rank}`} variant="caption" tone={row.is_me ? 'accent' : 'primary'}>
                    {row.rank}. {taggedName(row.display_name, row.display_tag)} · {row.score} net
                  </AppText>
                ))}
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <AppText tone="muted">{label}</AppText>
      <AppText variant="label">{value}</AppText>
    </View>
  );
}
