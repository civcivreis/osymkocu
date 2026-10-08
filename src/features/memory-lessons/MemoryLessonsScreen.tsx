import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { Screen } from '@/src/components/ui/Screen';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { useActiveCurriculumVersion, usePublicExamCatalog, useStudentCurriculum } from '@/src/features/curriculum/useCurriculum';
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function MemoryLessonsScreen() {
  const { colors, radius, spacing } = useAppTheme();
  const exams = usePublicExamCatalog();
  const [examId, setExamId] = useState<string | null>(null);
  const selected = useMemo(() => (exams.data ?? []).find((row) => row.id === examId) ?? null, [examId, exams.data]);
  const active = useActiveCurriculumVersion(examId);
  const curriculum = useStudentCurriculum(examId);
  const rows = curriculum.data ?? [];
  const noVersion = Boolean(examId) && !curriculum.isLoading && !active.data;
  const emptyMapped = Boolean(examId) && !curriculum.isLoading && Boolean(active.data) && rows.length === 0;

  const revision = active.data?.revision_label ? ` · ${active.data.revision_label}` : '';

  return (
    <Screen scroll>
      <SeoHead title={`Hafıza Dersleri | ${APP_NAME}`} path="/dersler/hafiza" index={false} />
      <View style={{ gap: spacing.lg, paddingBottom: 48 }}>
        <PageHeader title="Hafıza Dersleri" subtitle="Görsel anlatım ve hafıza teknikleriyle öğren." />
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <AppText tone="accent">Derslere dön</AppText>
        </Pressable>

        <AppText variant="caption" tone="muted">Sınav</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(exams.data ?? []).map((row) => (
            <Pressable
              key={row.id}
              onPress={() => setExamId(row.id)}
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

        {selected ? (
          <AppText tone="muted">
            Güncel Müfredat{revision}
          </AppText>
        ) : (
          <AppText tone="muted">Sınavını seç. Müfredat yılı seçmen gerekmez.</AppText>
        )}

        {curriculum.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
        {curriculum.isError ? <AppText tone="danger">Müfredat alınamadı.</AppText> : null}
        {noVersion ? <AppText>Güncel müfredat henüz tanımlanmadı.</AppText> : null}
        {emptyMapped ? (
          <AppText tone="muted">Bu müfredatta henüz konu eşlemesi yok.</AppText>
        ) : null}

        {rows.map((row) => (
          <View
            key={`${row.canonical_topic_id}-${row.lesson_id ?? 'none'}`}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: spacing.lg,
              gap: 4,
            }}>
            <AppText variant="subtitle">{row.lesson_title ?? row.topic_name}</AppText>
            <AppText variant="caption" tone="muted">
              {row.subject_name} · {row.unit_name} · {row.topic_name}
            </AppText>
            {!row.lesson_id ? <AppText variant="caption">Bu konu için ders henüz yayınlanmadı.</AppText> : null}
            {row.lesson_id && examId ? (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/practice',
                    params: {
                      examCatalogId: examId,
                      canonicalTopicId: row.canonical_topic_id,
                      lessonId: row.lesson_id,
                      setType: 'lesson_final',
                      count: '10',
                    },
                  })
                }
                style={{ marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#C45C26' }}>
                <AppText tone="inverse">10 Soruyla Pekiştir</AppText>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}
