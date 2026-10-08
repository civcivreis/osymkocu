import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { usePublicExamCatalog, useStudentCurriculum } from '@/src/features/curriculum/useCurriculum';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function CurriculumPracticePicker() {
  const { colors, radius } = useAppTheme();
  const exams = usePublicExamCatalog();
  const [examId, setExamId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const curriculum = useStudentCurriculum(examId);

  const tree = useMemo(() => {
    const subjects = new Map<string, Map<string, { topicId: string; name: string }[]>>();
    for (const row of curriculum.data ?? []) {
      if (!subjects.has(row.subject_name)) subjects.set(row.subject_name, new Map());
      const units = subjects.get(row.subject_name)!;
      if (!units.has(row.unit_name)) units.set(row.unit_name, []);
      units.get(row.unit_name)!.push({ topicId: row.canonical_topic_id, name: row.topic_name });
    }
    return subjects;
  }, [curriculum.data]);

  const start = (count: number, mixed: boolean) => {
    if (!examId) return;
    router.push({
      pathname: '/practice',
      params: mixed
        ? { examCatalogId: examId, setType: 'mixed', count: String(count), mode: 'mixed' }
        : { examCatalogId: examId, canonicalTopicId: topicId ?? '', setType: 'topic_pool', count: String(count) },
    });
  };

  return (
    <View style={{ gap: 10 }}>
      <AppText variant="label" tone="accent">
        MÜFREDAT TESTİ
      </AppText>
      <AppText variant="caption" tone="muted">
        Yalnızca aktif müfredattaki yayınlanmış sorular.
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(exams.data ?? []).map((row) => (
          <Pressable
            key={row.id}
            onPress={() => {
              setExamId(row.id);
              setTopicId(null);
            }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: examId === row.id ? '#F3E0D4' : colors.surface,
            }}>
            <AppText>{row.name}</AppText>
          </Pressable>
        ))}
      </View>
      {examId ? (
        <View style={{ gap: 8 }}>
          {[...tree.entries()].map(([subject, units]) => (
            <View key={subject} style={{ gap: 4 }}>
              <AppText variant="subtitle">{subject}</AppText>
              {[...units.entries()].map(([unit, topics]) => (
                <View key={unit} style={{ paddingLeft: 8, gap: 4 }}>
                  <AppText variant="caption" tone="muted">
                    {unit}
                  </AppText>
                  {topics.map((topic) => (
                    <Pressable
                      key={topic.topicId}
                      onPress={() => setTopicId(topic.topicId)}
                      style={{
                        padding: 8,
                        borderRadius: radius.md,
                        backgroundColor: topicId === topic.topicId ? '#F3E0D4' : colors.surface,
                      }}>
                      <AppText>{topic.name}</AppText>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable
          disabled={!examId || !topicId}
          onPress={() => start(10, false)}
          style={{ opacity: examId && topicId ? 1 : 0.45, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#C45C26' }}>
          <AppText tone="inverse">10 Soru</AppText>
        </Pressable>
        <Pressable
          disabled={!examId || !topicId}
          onPress={() => start(20, false)}
          style={{ opacity: examId && topicId ? 1 : 0.45, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#C45C26' }}>
          <AppText tone="inverse">20 Soru</AppText>
        </Pressable>
        <Pressable
          disabled={!examId}
          onPress={() => start(10, true)}
          style={{ opacity: examId ? 1 : 0.45, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
          <AppText>Karışık Test</AppText>
        </Pressable>
      </View>
    </View>
  );
}
