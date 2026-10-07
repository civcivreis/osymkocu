import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { useProgressInsights } from '@/src/features/progress/useProgressInsights';
import { useWrongAnswers } from '@/src/features/study/usePractice';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export default function NotebookScreen() {
  const { colors, spacing } = useAppTheme();
  const wrongQuery = useWrongAnswers();
  const insights = useProgressInsights();
  const items = wrongQuery.data ?? [];
  const dist = insights.data?.wrong;
  const openCount = dist?.open ?? items.length;
  const masteredCount = dist?.mastered ?? 0;
  const bySubject = dist?.bySubject?.length
    ? dist.bySubject
    : Object.entries(
        items.reduce<Record<string, number>>((acc, item) => {
          const name = item.subjects?.name ?? 'Ders';
          acc[name] = (acc[name] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([name, count]) => ({ name, count }));
  const byTopic = dist?.byTopic ?? [];

  return (
    <Screen scroll>
      <View style={{ gap: spacing.lg }}>
        <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="chevron-back" size={20} color={colors.accent} />
          <AppText tone="accent">Geri</AppText>
        </Pressable>
        <View style={{ gap: 6 }}>
          <AppText variant="display">Yanlışlarım</AppText>
          <AppText tone="muted">Yanlışın kaydı burada. Doğru çözünce öğrenildi olur, sırayla tekrar gelir.</AppText>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Card style={{ flex: 1 }}>
            <AppText variant="title">{openCount}</AppText>
            <AppText variant="caption" tone="muted">
              açık yanlış
            </AppText>
          </Card>
          <Card style={{ flex: 1 }}>
            <AppText variant="title">{masteredCount}</AppText>
            <AppText variant="caption" tone="muted">
              öğrenildi
            </AppText>
          </Card>
        </View>

        {openCount > 0 ? (
          <Button
            label="Yanlışları tekrar et"
            onPress={() => router.push({ pathname: '/practice', params: { mode: 'review' } })}
          />
        ) : null}

        {bySubject.length > 0 ? (
          <View style={{ gap: 8 }}>
            <AppText variant="label" tone="accent">
              Ders dağılımı
            </AppText>
            {bySubject.slice(0, 8).map((row) => (
              <View key={row.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <AppText style={{ flex: 1 }}>{row.name}</AppText>
                <AppText variant="caption" tone="muted">
                  {row.count}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        {byTopic.length > 0 ? (
          <View style={{ gap: 8 }}>
            <AppText variant="label" tone="accent">
              Konu dağılımı
            </AppText>
            {byTopic.slice(0, 8).map((row) => (
              <View key={`${row.subject}-${row.name}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <AppText style={{ flex: 1 }}>
                  {row.name}
                  <AppText variant="caption" tone="muted">
                    {` · ${row.subject}`}
                  </AppText>
                </AppText>
                <AppText variant="caption" tone="muted">
                  {row.count}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        {wrongQuery.isLoading ? (
          <AppText tone="muted">Defter yükleniyor…</AppText>
        ) : items.length === 0 ? (
          <Card>
            <AppText>Henüz açık yanlışın yok. Bir pratik seti çöz.</AppText>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.id}>
              <View style={{ gap: spacing.sm }}>
                <AppText variant="caption" tone="accent">
                  {item.subjects?.name ?? 'Ders'}
                  {item.topics?.name ? ` · ${item.topics.name}` : ''}
                </AppText>
                <AppText variant="subtitle">{item.questions?.stem}</AppText>
                <AppText tone="muted">
                  Senin: {item.user_answer} · Doğru: {item.correct_answer}
                  {item.attempt_count && item.attempt_count > 1 ? ` · ${item.attempt_count} deneme` : ''}
                </AppText>
                {item.explanation ? <AppText tone="muted">{item.explanation}</AppText> : null}
              </View>
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}
