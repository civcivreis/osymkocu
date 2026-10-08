import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { Screen } from '@/src/components/ui/Screen';
import { SegmentedTabs } from '@/src/components/ui/SegmentedTabs';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { usePublicExamCatalog } from '@/src/features/curriculum/useCurriculum';
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { useStudentLessonCards } from './useMemoryLessonPlayer';

type LessonMode = 'recommended' | 'official' | 'weak' | 'frequency';

function statusLabel(row: { lesson_id: string | null; narration_completed?: boolean | null; last_position_ms?: number | null }) {
  if (!row.lesson_id) return null;
  if (row.narration_completed) return 'Tamamlandı';
  if ((row.last_position_ms ?? 0) > 2000) return 'Devam Ediyor';
  return 'Başlamadı';
}

function reasonLabel(code?: string | null) {
  if (code === 'review_due') return 'Tekrar zamanı';
  if (code === 'prerequisite') return 'Önce bunu tamamla';
  if (code === 'resume') return 'Devam et';
  if (code === 'weakness') return 'Zayıf olduğun konu';
  return 'Sonraki konu';
}

export function MemoryLessonsScreen() {
  const { colors, radius, spacing } = useAppTheme();
  const exams = usePublicExamCatalog();
  const [examId, setExamId] = useState<string | null>(null);
  const [mode, setMode] = useState<LessonMode>('recommended');
  const selected = useMemo(() => (exams.data ?? []).find((row) => row.id === examId) ?? null, [examId, exams.data]);
  const cards = useStudentLessonCards(examId, mode);
  const frequencyEmpty = mode === 'frequency' && !cards.isLoading && (cards.data ?? []).length === 0;
  const rows = cards.data ?? [];
  const emptyMapped = Boolean(examId) && !cards.isLoading && rows.length === 0;

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

        {selected ? null : <AppText tone="muted">Sınavını seç. Müfredat yılı seçmen gerekmez.</AppText>}
        {selected ? (
          <SegmentedTabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: 'recommended', label: 'Önerilen Sıra' },
              { value: 'official', label: 'Müfredat Sırası' },
              { value: 'weak', label: 'Zayıf Olduğum Konular' },
              { value: 'frequency', label: 'En Çok Çıkanlar' },
            ]}
          />
        ) : null}
        {cards.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
        {cards.isError ? <AppText tone="danger">Müfredat alınamadı.</AppText> : null}
        {frequencyEmpty ? <AppText tone="muted">Veri hazırlanıyor.</AppText> : null}
        {emptyMapped && mode !== 'frequency' ? <AppText tone="muted">Bu müfredatta henüz konu eşlemesi yok.</AppText> : null}

        {rows.map((row) => {
          const status = statusLabel(row);
          return (
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
              {status ? <AppText variant="caption">{status}</AppText> : <AppText variant="caption">Bu konu için ders henüz yayınlanmadı.</AppText>}
              {row.prereq_title ? (
                <AppText variant="caption" tone="muted">
                  Önce: {row.prereq_title}
                </AppText>
              ) : row.reason_code ? (
                <AppText variant="caption" tone="muted">{reasonLabel(row.reason_code)}</AppText>
              ) : null}
              {row.mastery_score != null ? (
                <AppText variant="caption" tone="muted">
                  Mastery: {Math.round(Number(row.mastery_score) * 100)}%
                </AppText>
              ) : null}
              {row.review_due ? <AppText variant="caption">Tekrar: Bugün</AppText> : null}
              {row.lesson_id && examId ? (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/dersler/hafiza/[lessonId]',
                      params: { lessonId: row.lesson_id!, examCatalogId: examId },
                    })
                  }
                  style={{ marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#C45C26' }}>
                  <AppText tone="inverse">{(row.last_position_ms ?? 0) > 2000 && !row.narration_completed ? 'Devam et' : 'Dersi aç'}</AppText>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
