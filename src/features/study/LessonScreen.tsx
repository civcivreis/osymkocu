import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Screen } from '@/src/components/ui/Screen';
import { SelectCard } from '@/src/components/ui/SelectCard';
import { TextField } from '@/src/components/ui/TextField';
import { saveLastLesson, useCompleteLessonTopic, useSubjectTopics } from '@/src/features/study/usePractice';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function LessonScreen() {
  const { spacing } = useAppTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ subjectId?: string; name?: string; topicId?: string }>();
  const subjectId = String(params.subjectId ?? '');
  const name = String(params.name ?? 'Ders');
  const topics = useSubjectTopics(subjectId || null);
  const finishLesson = useCompleteLessonTopic();
  const [picked, setPicked] = useState(params.topicId ? String(params.topicId) : null);
  const [note, setNote] = useState('');

  const rows =
    (topics.data ?? []).length > 0
      ? topics.data!
      : subjectId
        ? [{ id: subjectId, name, slug: 'genel', subject_id: subjectId, sort_order: 0 }]
        : [];

  const active = rows.find((row) => row.id === picked) ?? rows[0] ?? null;

  const activeId = active?.id;
  const activeName = active?.name;

  useEffect(() => {
    if (subjectId) AnalyticsProvider.track('lesson_started');
  }, [subjectId]);

  useEffect(() => {
    if (!subjectId || !activeId || !activeName) return;
    void saveLastLesson({
      subjectId,
      subjectName: name,
      topicId: activeId,
      topicName: activeName,
    }).then(() => queryClient.invalidateQueries({ queryKey: ['study-hub'] }));
  }, [activeId, activeName, name, queryClient, subjectId]);

  const notesQuery = useQuery({
    queryKey: ['lesson-note', active?.id],
    enabled: Boolean(active?.id),
    queryFn: async () => (await AsyncStorage.getItem(`kocum.lessonNotes.${active!.id}`)) ?? '',
  });
  const text = note || notesQuery.data || '';

  useEffect(() => {
    if (!active) {
      useCoachStore.getState().setScreenContext(null);
      return;
    }
    useCoachStore.getState().setScreenContext({
      subject: name,
      topic: active.name,
      lessonId: active.id,
      lessonProgress: `${active.name} konusu açık`,
    });
    return () => {
      useCoachStore.getState().setScreenContext(null);
    };
  }, [active, name]);

  return (
    <Screen scroll>
      <View style={{ gap: spacing.lg, paddingBottom: 28 }}>
        <View style={{ gap: 6 }}>
          <AppText variant="display">{name}</AppText>
          <AppText tone="muted">Konuyu oku, notunu yaz. Test için Ders sekmesinden çıkıp Test’e geç.</AppText>
        </View>

        {topics.isLoading ? <AppText tone="muted">Konular yükleniyor…</AppText> : null}

        {(topics.data ?? []).length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            {rows.map((topic) => (
              <SelectCard
                key={topic.id}
                title={topic.name}
                subtitle={picked === topic.id || (!picked && topic.id === active?.id) ? 'Açık konu' : 'Okumak için dokun'}
                selected={topic.id === active?.id}
                onPress={() => {
                  setPicked(topic.id);
                  setNote('');
                }}
              />
            ))}
          </View>
        ) : (
          <AppText tone="muted">Bu derste konu listesi yok. Koç yine anlatabilir.</AppText>
        )}

        {active ? (
          <View style={{ gap: spacing.sm }}>
            <AppText variant="subtitle">{active.name}</AppText>
            <AppText>
              {active.name} konusunu dinlemek için Koç’u aç. Anladığın yerleri aşağıya yaz; bu not telefonda kalır.
            </AppText>
            <Button
              label="Koç anlatsın"
              onPress={() =>
                useCoachStore
                  .getState()
                  .queueLesson(
                    `${name} / ${active.name} konusunu sınav öğrencisine ders gibi anlat. Kısa başlıklar, sonra sade örnek. Soru uydurma.`,
                  )
              }
            />
            <Button
              label="Konuyu tamamladım"
              variant="secondary"
              loading={finishLesson.isPending}
              onPress={() => {
                if (!active) return;
                void finishLesson.mutateAsync(active.id).catch((error: unknown) => {
                  toastError(error);
                });
              }}
            />
            <Button
              label="Bu dersten test çöz"
              variant="secondary"
              onPress={() => router.push({ pathname: '/practice', params: { subjectId } })}
            />
            <TextField
              label="Notların"
              value={text}
              onChangeText={(value) => {
                setNote(value);
                if (active) void AsyncStorage.setItem(`kocum.lessonNotes.${active.id}`, value);
              }}
              placeholder="Dinlerken yaz"
              multiline
            />
          </View>
        ) : null}

        <Button label="Geri" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
