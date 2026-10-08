import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminChip, adminChipOn, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import {
  useActiveCurriculumVersion,
  useCurriculumMutations,
  useExamCatalog,
  useReusableLessons,
  useSubjectCatalog,
  useTopicCatalog,
  useUnitCatalog,
} from '@/src/features/curriculum/useCurriculum';
import { useCreateMemoryLesson } from '@/src/features/memory-lessons/useMemoryLessons';

type CreateMode = 'reuse' | 'extension' | 'exam_specific';

export function AdminNewLessonModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateMemoryLesson();
  const exams = useExamCatalog();
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>('reuse');
  const subjects = useSubjectCatalog(examId);
  const units = useUnitCatalog(subjectId);
  const topics = useTopicCatalog(unitId);
  const reusable = useReusableLessons(topicId);
  const curriculumMutations = useCurriculumMutations();
  const active = useActiveCurriculumVersion(examId);
  const selectedTopic = useMemo(
    () => (topics.data ?? []).find((row) => row.id === topicId) ?? null,
    [topicId, topics.data],
  );
  const recommended = reusable.data?.[0] ?? null;

  useEffect(() => {
    if (!open) {
      setExamId(null);
      setSubjectId(null);
      setUnitId(null);
      setTopicId(null);
      setCreateMode('reuse');
    }
  }, [open]);

  const submit = () => {
    if (!examId || !subjectId || !unitId || !topicId || !selectedTopic) {
      toastError('Sınav, müfredat, ders, ünite ve konu seç.');
      return;
    }
    if (createMode === 'reuse' && recommended) {
      void curriculumMutations.attachLesson
        .mutateAsync({ lessonId: recommended.lesson_id, examId, usageMode: 'core' })
        .then(() => {
          toastSuccess('Mevcut ders bu müfredata bağlandı');
          onClose();
          router.push(`/admin/hafiza-dersleri/${recommended.lesson_id}` as never);
        })
        .catch((error: unknown) => {
          toastError(mapAdminError(error instanceof Error ? error.message : 'Ders bağlanamadı.'));
        });
      return;
    }
    void create
      .mutateAsync({
        exam_id: examId,
        subject_id: subjectId,
        unit_id: unitId,
        topic_id: topicId,
        title: selectedTopic.name,
        lesson_scope: createMode === 'extension' ? 'exam_extension' : createMode === 'exam_specific' ? 'exam_specific' : 'core',
        usage_mode: createMode === 'extension' ? 'core_plus_extension' : createMode === 'exam_specific' ? 'exam_specific' : 'core',
        base_lesson_id: createMode === 'extension' ? recommended?.lesson_id : undefined,
      })
      .then((lesson) => {
        toastSuccess('Taslak ders oluşturuldu');
        onClose();
        router.push(`/admin/hafiza-dersleri/${lesson.id}` as never);
      })
      .catch((error: unknown) => {
        toastError(mapAdminError(error instanceof Error ? error.message : 'Ders oluşturulamadı.'));
      });
  };

  const busy = create.isPending || curriculumMutations.attachLesson.isPending;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.4)', justifyContent: 'center', padding: 16 }}>
        <Pressable
          onPress={() => undefined}
          style={{
            maxWidth: 720,
            width: '100%',
            maxHeight: '90%',
            alignSelf: 'center',
            backgroundColor: '#FFFCF7',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: '#E4DDD0',
            padding: 20,
          }}>
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <AppText variant="title">Yeni Ders</AppText>
            <AppText variant="caption" tone="muted">
              Sınav → Aktif müfredat → Ders → Ünite → Konu
            </AppText>

            <AppText variant="label">Sınav</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(exams.data ?? [])
                .filter((row) => row.is_active)
                .map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => {
                      setExamId(row.id);
                      setSubjectId(null);
                      setUnitId(null);
                      setTopicId(null);
                    }}
                    style={[adminChip, examId === row.id && adminChipOn]}>
                    <AppText>{row.name}</AppText>
                  </Pressable>
                ))}
            </View>

            {examId ? (
              <View style={{ backgroundColor: '#F6F1E8', borderRadius: 12, padding: 12 }}>
                <AppText variant="label">Aktif Müfredat</AppText>
                <AppText>
                  {active.data ? `${active.data.name}${active.data.revision_label ? ` · ${active.data.revision_label}` : ''}` : 'Aktif müfredat yok'}
                </AppText>
              </View>
            ) : null}

            {examId ? (
              <>
                <AppText variant="label">Ders</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(subjects.data ?? [])
                    .filter((row) => row.is_active)
                    .map((row) => (
                      <Pressable
                        key={row.id}
                        onPress={() => {
                          setSubjectId(row.id);
                          setUnitId(null);
                          setTopicId(null);
                        }}
                        style={[adminChip, subjectId === row.id && adminChipOn]}>
                        <AppText>{row.name}</AppText>
                      </Pressable>
                    ))}
                </View>
              </>
            ) : null}

            {subjectId ? (
              <>
                <AppText variant="label">Ünite</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(units.data ?? [])
                    .filter((row) => row.is_active)
                    .map((row) => (
                      <Pressable
                        key={row.id}
                        onPress={() => {
                          setUnitId(row.id);
                          setTopicId(null);
                        }}
                        style={[adminChip, unitId === row.id && adminChipOn]}>
                        <AppText>{row.name}</AppText>
                      </Pressable>
                    ))}
                </View>
              </>
            ) : null}

            {unitId ? (
              <>
                <AppText variant="label">Konu</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(topics.data ?? [])
                    .filter((row) => row.is_active)
                    .map((row) => (
                      <Pressable key={row.id} onPress={() => setTopicId(row.id)} style={[adminChip, topicId === row.id && adminChipOn]}>
                        <AppText>{row.name}</AppText>
                      </Pressable>
                    ))}
                </View>
              </>
            ) : null}

            {selectedTopic ? (
              <View style={{ backgroundColor: '#F6F1E8', borderRadius: 12, padding: 12, gap: 4 }}>
                <AppText variant="label">Kanonik konu</AppText>
                <AppText>{selectedTopic.name}</AppText>
                {selectedTopic.description ? <AppText variant="caption">{selectedTopic.description}</AppText> : null}
                <AppText variant="caption" tone="muted">
                  {selectedTopic.canonical_topic_id ? `canonical · ${selectedTopic.canonical_topic_id.slice(0, 8)}` : 'Kanonik eşleşme yok'}
                </AppText>
              </View>
            ) : null}

            {topicId && recommended ? (
              <View style={{ gap: 8 }}>
                <AppText>Bu konu için mevcut bir Hafıza Dersi var.</AppText>
                <AppText variant="caption" tone="muted">
                  {recommended.title} · {recommended.status} · {recommended.lesson_scope}
                </AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pressable onPress={() => setCreateMode('reuse')} style={[adminChip, createMode === 'reuse' && adminChipOn]}>
                    <AppText>Mevcut Dersi Kullan</AppText>
                  </Pressable>
                  <Pressable onPress={() => setCreateMode('extension')} style={[adminChip, createMode === 'extension' && adminChipOn]}>
                    <AppText>Sınava Özel Ek İçerik</AppText>
                  </Pressable>
                  <Pressable onPress={() => setCreateMode('exam_specific')} style={[adminChip, createMode === 'exam_specific' && adminChipOn]}>
                    <AppText>Yeni Sınava Özel Ders</AppText>
                  </Pressable>
                </View>
                {createMode === 'reuse' ? (
                  <AppText variant="caption" tone="muted">
                    Önerilen: Mevcut Dersi Kullan
                  </AppText>
                ) : null}
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Pressable onPress={onClose} style={adminGhost}>
                <AppText>İptal</AppText>
              </Pressable>
              {topicId ? (
                <Pressable onPress={submit} disabled={busy} style={[adminBtn, busy ? { opacity: 0.6 } : null]}>
                  <AppText tone="inverse">
                    {busy
                      ? 'Kaydediliyor…'
                      : recommended && createMode === 'reuse'
                        ? 'Mevcut Dersi Kullan'
                        : 'Dersi Oluştur'}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
