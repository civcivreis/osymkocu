import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { CardGrid } from '@/src/components/ui/CardGrid';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { Screen } from '@/src/components/ui/Screen';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { usePublicExamCatalog } from '@/src/features/curriculum/useCurriculum';
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

import { useStudentLessonCards } from './useMemoryLessonPlayer';
import type { StudentLessonCard } from './playerApi';

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function MemoryLessonsScreen() {
  const { colors, radius, spacing } = useAppTheme();
  const exams = usePublicExamCatalog();
  const profileExam = useAuthStore((s) => s.profile?.exam_id);
  const [examId, setExamId] = useState<string | null>(profileExam ?? null);
  const [subject, setSubject] = useState<string | null>(null);
  const [unit, setUnit] = useState<string | null>(null);
  const cards = useStudentLessonCards(examId, 'official');
  const rows = cards.data ?? [];

  const subjects = useMemo(() => unique(rows.map((row) => row.subject_name)), [rows]);
  const units = useMemo(
    () => unique(rows.filter((row) => row.subject_name === subject).map((row) => row.unit_name)),
    [rows, subject],
  );
  const topics = useMemo(
    () => rows.filter((row) => row.subject_name === subject && row.unit_name === unit),
    [rows, subject, unit],
  );

  const openLesson = (row: StudentLessonCard) => {
    if (!row.lesson_id || !examId) return;
    router.push({
      pathname: '/dersler/hafiza/[lessonId]',
      params: { lessonId: row.lesson_id, examCatalogId: examId },
    });
  };

  return (
    <Screen scroll>
      <SeoHead title={`Dersler | ${APP_NAME}`} path="/dersler/hafiza" index={false} />
      <View style={{ gap: spacing.lg, paddingBottom: 48 }}>
        <PageHeader title="Ders" subtitle="Dersi ve konuyu seç. Kısa hap bilgiyle ilerle." />
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <AppText tone="accent">Derslere dön</AppText>
        </Pressable>

        <AppText variant="caption" tone="muted">
          Sınav
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(exams.data ?? []).map((row) => (
            <Pressable
              key={row.id}
              onPress={() => {
                setExamId(row.id);
                setSubject(null);
                setUnit(null);
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: examId === row.id ? '#F3E0D4' : colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <AppText>{row.name}</AppText>
            </Pressable>
          ))}
        </View>

        {cards.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
        {cards.isError ? <AppText tone="danger">Müfredat alınamadı.</AppText> : null}
        {examId && !cards.isLoading && rows.length === 0 ? (
          <AppText tone="muted">Bu bölüm hazırlanıyor.</AppText>
        ) : null}

        {examId && !subject ? (
          <CardGrid>
            {subjects.map((name) => (
              <Pressable
                key={name}
                onPress={() => setSubject(name)}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.lg,
                }}>
                <AppText variant="subtitle">{name}</AppText>
              </Pressable>
            ))}
          </CardGrid>
        ) : null}

        {subject && !unit ? (
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => setSubject(null)}>
              <AppText tone="accent">← {subject}</AppText>
            </Pressable>
            <CardGrid>
              {units.map((name) => (
                <Pressable
                  key={name}
                  onPress={() => setUnit(name)}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: spacing.lg,
                  }}>
                  <AppText variant="subtitle">{name}</AppText>
                </Pressable>
              ))}
            </CardGrid>
            {units.length === 0 ? <AppText tone="muted">Bu bölüm hazırlanıyor.</AppText> : null}
          </View>
        ) : null}

        {subject && unit ? (
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => setUnit(null)}>
              <AppText tone="accent">
                ← {unit}
              </AppText>
            </Pressable>
            <CardGrid>
              {topics.map((row) => (
                <View
                  key={`${row.canonical_topic_id}-${row.lesson_id ?? 'none'}`}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: spacing.lg,
                    gap: 8,
                  }}>
                  <AppText variant="subtitle">{row.topic_name}</AppText>
                  {row.lesson_id ? (
                    <Pressable
                      onPress={() => openLesson(row)}
                      style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#C45C26' }}>
                      <AppText tone="inverse">{row.narration_completed ? 'Tekrar et' : 'Dersi aç'}</AppText>
                    </Pressable>
                  ) : (
                    <AppText variant="caption" tone="muted">
                      Bu bölüm hazırlanıyor.
                    </AppText>
                  )}
                </View>
              ))}
            </CardGrid>
            {topics.length === 0 ? <AppText tone="muted">Bu bölüm hazırlanıyor.</AppText> : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
