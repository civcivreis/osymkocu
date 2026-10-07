import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { formatAvgSeconds, type TopicInsight } from '@/src/features/progress/insights';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function PriorityTopics({
  items,
}: {
  items: { subjectId: string; topicId: string; subject: string; topic: string; accuracy: number; total: number }[];
}) {
  const { colors } = useAppTheme();
  if (items.length === 0) return null;

  return (
    <View
      style={{
        backgroundColor: colors.surfaceMuted,
        borderRadius: 22,
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 10,
      }}>
      <AppText variant="label" tone="accent">
        BU HAFTA ÖNCELİK
      </AppText>
      {items.slice(0, 3).map((row) => (
        <Pressable
          key={`${row.subjectId}-${row.topicId}`}
          onPress={() =>
            router.push({
              pathname: '/lesson',
              params: { subjectId: row.subjectId, name: row.subject, topicId: row.topicId },
            })
          }
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, minHeight: 36, alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText numberOfLines={1}>{row.topic}</AppText>
            <AppText variant="caption" tone="muted">
              {row.subject} · {row.total} soru
            </AppText>
          </View>
          <AppText variant="label" tone="accent">
            %{row.accuracy}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

export function TopicAccuracyRow({ row }: { row: TopicInsight }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText numberOfLines={1}>{row.topic}</AppText>
        <AppText variant="caption" tone="muted">
          {row.subject}
          {row.enough
            ? ` · ${row.correct}D ${row.wrong}Y${row.blank ? ` ${row.blank}B` : ''}`
            : ` · ${row.total} soru`}
        </AppText>
      </View>
      <AppText variant="caption" tone={row.enough && row.accuracy < 70 ? 'accent' : 'muted'}>
        {row.enough ? `%${row.accuracy}` : 'Henüz yeterli veri yok.'}
        {row.enough && formatAvgSeconds(row.avgMs) ? ` · ${formatAvgSeconds(row.avgMs)}` : ''}
      </AppText>
    </View>
  );
}
