import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminField, adminGhost, mufredatHref, queryParam } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { swapCatalogSort } from '@/src/features/curriculum/curriculumApi';
import {
  useCurriculumMutations,
  useExamCatalog,
  useSubjectCatalog,
  useTopicCatalog,
  useUnitCatalog,
} from '@/src/features/curriculum/useCurriculum';
import { createMemoryLesson } from '@/src/features/memory-lessons/memoryLessonApi';
import { getSupabase } from '@/src/lib/supabase/client';

type CatalogTable = 'subject_catalog' | 'unit_catalog' | 'topic_catalog';
type LessonHit = {
  id: string;
  title: string;
  status: string;
  delivery_mode: string | null;
  topic_id: string | null;
  canonical_topic_id: string | null;
};
type CountRow = { id: string; name: string; sort_order: number; is_active?: boolean };
type StatusKind = 'published' | 'draft' | 'empty' | 'archived';

function useLessonsForTopics(topicIds: string[], canonicalIds: string[]) {
  return useQuery({
    queryKey: ['admin-lessons-tree', topicIds.join(','), canonicalIds.join(',')],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const parts = [
        topicIds.length ? `topic_id.in.(${topicIds.join(',')})` : '',
        canonicalIds.length ? `canonical_topic_id.in.(${canonicalIds.join(',')})` : '',
      ].filter(Boolean);
      const { data, error } = await getSupabase()
        .from('memory_lessons')
        .select('id, title, status, delivery_mode, topic_id, canonical_topic_id')
        .or(parts.join(','));
      if (error) throw error;
      return (data ?? []) as LessonHit[];
    },
  });
}

function useQuestionCounts(lessonIds: string[]) {
  return useQuery({
    queryKey: ['admin-lesson-q-counts', lessonIds.join(',')],
    enabled: lessonIds.length > 0,
    queryFn: async () => {
      const { data, error } = await getSupabase().from('memory_lesson_questions').select('lesson_id').in('lesson_id', lessonIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        const id = String((row as { lesson_id: string }).lesson_id);
        map.set(id, (map.get(id) ?? 0) + 1);
      }
      return map;
    },
  });
}

function useChildCounts(subjectIds: string[]) {
  return useQuery({
    queryKey: ['admin-child-counts', subjectIds.join(',')],
    enabled: subjectIds.length > 0,
    queryFn: async () => {
      const supabase = getSupabase();
      const { data: units, error: unitError } = await supabase
        .from('unit_catalog')
        .select('id, subject_id')
        .in('subject_id', subjectIds);
      if (unitError) throw unitError;
      const unitRows = (units ?? []) as { id: string; subject_id: string }[];
      const unitIds = unitRows.map((row) => row.id);
      const { data: topics, error: topicError } = unitIds.length
        ? await supabase.from('topic_catalog').select('id, unit_id').in('unit_id', unitIds)
        : { data: [], error: null };
      if (topicError) throw topicError;
      const topicRows = (topics ?? []) as { id: string; unit_id: string }[];
      const unitsBySubject = new Map<string, number>();
      const topicsBySubject = new Map<string, number>();
      const topicsByUnit = new Map<string, number>();
      const subjectOfUnit = new Map(unitRows.map((row) => [row.id, row.subject_id]));
      for (const row of unitRows) unitsBySubject.set(row.subject_id, (unitsBySubject.get(row.subject_id) ?? 0) + 1);
      for (const row of topicRows) {
        topicsByUnit.set(row.unit_id, (topicsByUnit.get(row.unit_id) ?? 0) + 1);
        const subjectId = subjectOfUnit.get(row.unit_id);
        if (subjectId) topicsBySubject.set(subjectId, (topicsBySubject.get(subjectId) ?? 0) + 1);
      }
      return { unitsBySubject, topicsBySubject, topicsByUnit };
    },
  });
}

export function AdminMemoryLessonsScreen() {
  return <AdminLessonTree title="Müfredat" />;
}

export function AdminLessonTree({ title }: { title: string }) {
  const exams = useExamCatalog();
  const mutations = useCurriculumMutations();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ exam?: string; subject?: string; unit?: string }>();
  const examId = queryParam(params.exam);
  const subjectId = examId ? queryParam(params.subject) : null;
  const unitId = examId && subjectId ? queryParam(params.unit) : null;
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const go = (exam: string | null, subject: string | null, unit: string | null) => {
    router.replace(mufredatHref(exam, subject, unit) as never);
  };
  const subjects = useSubjectCatalog(examId);
  const units = useUnitCatalog(subjectId);
  const topics = useTopicCatalog(unitId);

  const exam = useMemo(() => (exams.data ?? []).find((row) => row.id === examId) ?? null, [examId, exams.data]);
  const subject = useMemo(() => (subjects.data ?? []).find((row) => row.id === subjectId) ?? null, [subjectId, subjects.data]);
  const unit = useMemo(() => (units.data ?? []).find((row) => row.id === unitId) ?? null, [unitId, units.data]);
  const topicRows = topics.data ?? [];
  const lessons = useLessonsForTopics(
    topicRows.map((row) => row.id),
    topicRows.map((row) => row.canonical_topic_id).filter((id): id is string => Boolean(id)),
  );
  const counts = useChildCounts((subjects.data ?? []).map((row) => row.id));
  const questionCounts = useQuestionCounts((lessons.data ?? []).map((row) => row.id));

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const lessonFor = (topicId: string, canonicalId?: string | null) =>
    (lessons.data ?? []).find((item) => item.topic_id === topicId) ??
    (lessons.data ?? []).find((item) => canonicalId && item.canonical_topic_id === canonicalId);

  const move = (table: CatalogTable, list: { id: string; sort_order: number }[], id: string, dir: -1 | 1) => {
    const index = list.findIndex((row) => row.id === id);
    const other = list[index + dir];
    if (index < 0 || !other) return;
    void mutations.swapSort.mutateAsync({ table, first: list[index], second: other }).catch(fail);
  };

  const reorder = async (table: CatalogTable, list: { id: string; sort_order: number }[], fromId: string, toId: string) => {
    const from = list.findIndex((row) => row.id === fromId);
    const to = list.findIndex((row) => row.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const copy = list.map((row) => ({ ...row }));
    const dir = from < to ? 1 : -1;
    let index = from;
    try {
      while (index !== to) {
        const first = copy[index];
        const second = copy[index + dir];
        if (!first || !second) break;
        await swapCatalogSort(table, first, second);
        const stored = first.sort_order;
        first.sort_order = second.sort_order;
        second.sort_order = stored;
        copy[index] = second;
        copy[index + dir] = first;
        index += dir;
      }
      await queryClient.invalidateQueries({ queryKey: ['subject-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['unit-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['topic-catalog'] });
    } catch (error) {
      fail(error);
    }
  };

  const remove = (table: CatalogTable, id: string, name: string) => {
    askConfirm({
      title: 'Silinsin mi?',
      subtitle: `${name} kalıcı silinir.`,
      confirmLabel: 'Sil',
      danger: true,
      onConfirm: () =>
        void mutations.removeRow
          .mutateAsync({ table, id })
          .then(() => {
            if (table === 'subject_catalog' && subjectId === id) go(examId, null, null);
            if (table === 'unit_catalog' && unitId === id) go(examId, subjectId, null);
            toastSuccess('Silindi');
          })
          .catch(fail),
    });
  };

  const archive = (table: CatalogTable, id: string, active: boolean) => {
    void mutations.setActive
      .mutateAsync({ table, id, isActive: !active })
      .then(() => toastSuccess(active ? 'Arşivlendi' : 'Yayına alındı'))
      .catch(fail);
  };

  const saveRename = (table: CatalogTable, id: string) => {
    if (!renameValue.trim()) return;
    void mutations.rename
      .mutateAsync({ table, id, name: renameValue })
      .then(() => {
        setRenameId(null);
        toastSuccess('Ad güncellendi');
      })
      .catch(fail);
  };

  const openContent = async (topic: { id: string; name: string; canonical_topic_id?: string | null }) => {
    if (!examId || !subjectId || !unitId) return;
    const existing = lessonFor(topic.id, topic.canonical_topic_id);
    try {
      const lessonId = existing
        ? existing.id
        : (
            await createMemoryLesson({
              exam_id: examId,
              subject_id: subjectId,
              unit_id: unitId,
              topic_id: topic.id,
              title: topic.name,
              lesson_scope: 'core',
              usage_mode: 'core',
            })
          ).id;
      router.push(
        `/admin/hafiza-dersleri/${lessonId}?exam=${encodeURIComponent(examId)}&subject=${encodeURIComponent(subjectId)}&unit=${encodeURIComponent(unitId)}` as never,
      );
    } catch (error) {
      fail(error);
    }
  };

  const crumb = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <Pressable onPress={() => go(null, null, null)}>
        <AppText variant="caption" tone="accent">
          {title}
        </AppText>
      </Pressable>
      {exam ? (
        <>
          <AppText variant="caption" tone="muted">
            /
          </AppText>
          <Pressable onPress={() => go(exam.id, null, null)}>
            <AppText variant="caption" tone={subject ? 'accent' : 'muted'}>
              {exam.name}
            </AppText>
          </Pressable>
        </>
      ) : null}
      {subject ? (
        <>
          <AppText variant="caption" tone="muted">
            /
          </AppText>
          <Pressable onPress={() => go(examId, subject.id, null)}>
            <AppText variant="caption" tone={unit ? 'accent' : 'muted'}>
              {subject.name}
            </AppText>
          </Pressable>
        </>
      ) : null}
      {unit ? (
        <>
          <AppText variant="caption" tone="muted">
            /
          </AppText>
          <AppText variant="caption" tone="muted">
            {unit.name}
          </AppText>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <AppText variant="title">{unit ? `Ana konu: ${unit.name}` : subject ? subject.name : exam ? exam.name : title}</AppText>
        {exam ? crumb : <AppText tone="muted">Sınav seç, sonra ders → ana konu → konu.</AppText>}
      </View>

      {exam ? (
        <Pressable
          onPress={() => {
            setDraft('');
            setAdding(false);
            if (unitId) {
              go(examId, subjectId, null);
              return;
            }
            if (subjectId) {
              go(examId, null, null);
              return;
            }
            go(null, null, null);
          }}
          hitSlop={8}>
          <AppText tone="accent">← Geri</AppText>
        </Pressable>
      ) : null}

      {!examId ? (
        <View style={{ gap: 8 }}>
          {(exams.data ?? [])
            .filter((row) => row.is_active)
            .map((row) => (
              <Pressable
                key={row.id}
                onPress={() => {
                  setDraft('');
                  go(row.id, null, null);
                }}
                style={rowCard}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="subtitle">{row.name}</AppText>
                  <AppText variant="caption" tone="muted">
                    {row.code}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </Pressable>
            ))}
        </View>
      ) : null}

      {exam && !subject ? (
        <ManageList
          section="Dersler"
          addLabel="+ Ders ekle"
          placeholder="Yeni ders (Türkçe, Matematik…)"
          adding={adding}
          setAdding={setAdding}
          draft={draft}
          setDraft={setDraft}
          onAdd={() =>
            void mutations.createSubject
              .mutateAsync({ exam_id: exam.id, name: draft })
              .then(() => {
                setDraft('');
                setAdding(false);
                toastSuccess('Ders eklendi');
              })
              .catch(fail)
          }
          rows={(subjects.data ?? []).map((row) => {
            const unitsCount = counts.data?.unitsBySubject.get(row.id) ?? 0;
            const topicsCount = counts.data?.topicsBySubject.get(row.id) ?? 0;
            return {
              id: row.id,
              name: row.name,
              sort_order: row.sort_order,
              is_active: row.is_active,
              subtitle: `${unitsCount} ana konu · ${topicsCount} konu`,
              status: row.is_active ? undefined : ('archived' as const),
            };
          })}
          renameId={renameId}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onOpen={(id) => {
            setDraft('');
            setAdding(false);
            go(examId, id, null);
          }}
          onStartRename={(id, name) => {
            setRenameId(id);
            setRenameValue(name);
          }}
          onSaveRename={(id) => saveRename('subject_catalog', id)}
          onCloseRename={() => setRenameId(null)}
          onDelete={(id, name) => remove('subject_catalog', id, name)}
          onArchive={(id, active) => archive('subject_catalog', id, active)}
          onMove={(id, dir) => move('subject_catalog', subjects.data ?? [], id, dir)}
          onReorder={(from, to) => void reorder('subject_catalog', subjects.data ?? [], from, to)}
        />
      ) : null}

      {subject && !unit ? (
        <ManageList
          section="Ana konular"
          addLabel="+ Ana konu ekle"
          placeholder="Yeni ana konu"
          adding={adding}
          setAdding={setAdding}
          draft={draft}
          setDraft={setDraft}
          onAdd={() =>
            void mutations.createUnit
              .mutateAsync({ subject_id: subject.id, name: draft })
              .then(() => {
                setDraft('');
                setAdding(false);
                toastSuccess('Ana konu eklendi');
              })
              .catch(fail)
          }
          rows={(units.data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            sort_order: row.sort_order,
            is_active: row.is_active,
            subtitle: `${counts.data?.topicsByUnit.get(row.id) ?? 0} konu`,
            status: row.is_active ? undefined : ('archived' as const),
          }))}
          renameId={renameId}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onOpen={(id) => {
            setDraft('');
            setAdding(false);
            go(examId, subject.id, id);
          }}
          onStartRename={(id, name) => {
            setRenameId(id);
            setRenameValue(name);
          }}
          onSaveRename={(id) => saveRename('unit_catalog', id)}
          onCloseRename={() => setRenameId(null)}
          onDelete={(id, name) => remove('unit_catalog', id, name)}
          onArchive={(id, active) => archive('unit_catalog', id, active)}
          onMove={(id, dir) => move('unit_catalog', units.data ?? [], id, dir)}
          onReorder={(from, to) => void reorder('unit_catalog', units.data ?? [], from, to)}
        />
      ) : null}

      {unit ? (
        <ManageList
          section="Konular"
          addLabel="+ Konu ekle"
          placeholder="Yeni konu"
          adding={adding}
          setAdding={setAdding}
          draft={draft}
          setDraft={setDraft}
          onAdd={() =>
            void mutations.createTopic
              .mutateAsync({ unit_id: unit.id, name: draft })
              .then(() => {
                setDraft('');
                setAdding(false);
                toastSuccess('Konu eklendi');
              })
              .catch(fail)
          }
          rows={topicRows.map((row) => {
            const lesson = lessonFor(row.id, row.canonical_topic_id);
            const questions = lesson ? (questionCounts.data?.get(lesson.id) ?? 0) : 0;
            const delivery =
              lesson?.delivery_mode === 'video' ? 'Video' : lesson?.delivery_mode === 'hybrid' ? 'Hibrit' : lesson ? 'Metin' : null;
            const status: StatusKind = !row.is_active
              ? 'archived'
              : !lesson
                ? 'empty'
                : lesson.status === 'published'
                  ? 'published'
                  : 'draft';
            return {
              id: row.id,
              name: row.name,
              sort_order: row.sort_order,
              is_active: row.is_active,
              subtitle: [delivery, lesson ? `1 ders · ${questions} soru` : 'Ders yok'].filter(Boolean).join(' · '),
              status,
            };
          })}
          renameId={renameId}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onOpen={(id) => {
            const topic = topicRows.find((row) => row.id === id);
            if (topic) void openContent(topic);
          }}
          onStartRename={(id, name) => {
            setRenameId(id);
            setRenameValue(name);
          }}
          onSaveRename={(id) => saveRename('topic_catalog', id)}
          onCloseRename={() => setRenameId(null)}
          onDelete={(id, name) => remove('topic_catalog', id, name)}
          onArchive={(id, active) => archive('topic_catalog', id, active)}
          onMove={(id, dir) => move('topic_catalog', topicRows, id, dir)}
          onReorder={(from, to) => void reorder('topic_catalog', topicRows, from, to)}
        />
      ) : null}
    </View>
  );
}

const rowCard = {
  backgroundColor: '#FFFCF7',
  borderRadius: 16,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  paddingVertical: 14,
  paddingHorizontal: 14,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
  minHeight: 64,
};

function StatusBadge({ status }: { status?: StatusKind }) {
  if (!status) return null;
  const map: Record<StatusKind, { label: string; bg: string; fg: string }> = {
    published: { label: 'Yayında', bg: '#E7F3EA', fg: '#1F6B3A' },
    draft: { label: 'Taslak', bg: '#F8EBDD', fg: '#8A3D16' },
    empty: { label: 'İçerik yok', bg: '#EEEAE2', fg: '#64748B' },
    archived: { label: 'Arşivde', bg: '#E8E8E8', fg: '#57534E' },
  };
  const tone = map[status];
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
      <AppText variant="caption" style={{ color: tone.fg, fontWeight: '600' }}>
        {tone.label}
      </AppText>
    </View>
  );
}

function ManageList({
  section,
  placeholder,
  addLabel,
  adding,
  setAdding,
  draft,
  setDraft,
  onAdd,
  rows,
  renameId,
  renameValue,
  setRenameValue,
  onOpen,
  onStartRename,
  onSaveRename,
  onCloseRename,
  onDelete,
  onArchive,
  onMove,
  onReorder,
}: {
  section: string;
  placeholder: string;
  addLabel: string;
  adding: boolean;
  setAdding: (value: boolean) => void;
  draft: string;
  setDraft: (value: string) => void;
  onAdd: () => void;
  rows: (CountRow & { subtitle?: string; status?: StatusKind })[];
  renameId: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onOpen?: (id: string) => void;
  onStartRename: (id: string, name: string) => void;
  onSaveRename: (id: string) => void;
  onCloseRename: () => void;
  onDelete: (id: string, name: string) => void;
  onArchive: (id: string, active: boolean) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const menuRow = rows.find((row) => row.id === menuId) ?? null;
  const menuIndex = menuRow ? rows.findIndex((row) => row.id === menuRow.id) : -1;
  const renaming = rows.find((row) => row.id === renameId) ?? null;

  return (
    <View style={{ gap: 10 }}>
      <AppText variant="label" tone="muted">
        {section}
      </AppText>
      <View style={[adminCard, { paddingVertical: 4, paddingHorizontal: 4, gap: 0 }]}>
        {rows.length === 0 ? (
          <View style={{ padding: 16 }}>
            <AppText variant="caption" tone="muted">
              Henüz kayıt yok.
            </AppText>
          </View>
        ) : null}
        {rows.map((row) => {
          const webDrag =
            Platform.OS === 'web'
              ? {
                  onDragOver: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
                  onDrop: (event: { preventDefault?: () => void }) => {
                    event.preventDefault?.();
                    if (dragId) onReorder(dragId, row.id);
                    setDragId(null);
                  },
                }
              : {};
          return (
            <View
              key={row.id}
              {...webDrag}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                minHeight: 64,
                paddingVertical: 10,
                paddingHorizontal: 8,
                borderRadius: 12,
                backgroundColor: dragId === row.id ? '#F8EBDD' : 'transparent',
              }}>
              <Pressable
                accessibilityLabel="Sıralamak için sürükle"
                hitSlop={8}
                {...(Platform.OS === 'web'
                  ? {
                      draggable: true,
                      onDragStart: () => setDragId(row.id),
                      onDragEnd: () => setDragId(null),
                    }
                  : {})}
                style={{ width: 28, alignItems: 'center', justifyContent: 'center' }}>
                <AppText tone="muted" style={{ fontSize: 16, letterSpacing: -1 }}>
                  ☰
                </AppText>
              </Pressable>
              <Pressable onPress={() => onOpen?.(row.id)} style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <AppText variant="subtitle" numberOfLines={1}>
                  {row.name}
                </AppText>
                {row.subtitle ? (
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {row.subtitle}
                  </AppText>
                ) : null}
              </Pressable>
              <StatusBadge status={row.status} />
              <Pressable
                onPress={() => setMenuId(row.id)}
                hitSlop={10}
                accessibilityLabel="Daha fazla"
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}>
                <Ionicons name="ellipsis-horizontal" size={18} color="#64748B" />
              </Pressable>
            </View>
          );
        })}
      </View>

      <Pressable
        onPress={() => {
          setDraft('');
          setAdding(true);
        }}
        style={[adminGhost, { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 12 }]}>
        <AppText>{addLabel}</AppText>
      </Pressable>

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <Pressable
          onPress={() => setAdding(false)}
          style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.35)', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => undefined} style={[adminCard, { maxWidth: 420, width: '100%', alignSelf: 'center', gap: 12 }]}>
            <AppText variant="subtitle">{addLabel.replace(/^\+\s*/, '')}</AppText>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              autoFocus
              style={adminField}
              onSubmitEditing={() => {
                if (draft.trim()) onAdd();
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable onPress={() => setAdding(false)} style={adminGhost}>
                <AppText>Vazgeç</AppText>
              </Pressable>
              <Pressable onPress={onAdd} disabled={!draft.trim()} style={[adminBtn, { opacity: draft.trim() ? 1 : 0.5 }]}>
                <AppText tone="inverse">Ekle</AppText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(renaming)} transparent animationType="fade" onRequestClose={onCloseRename}>
        <Pressable
          onPress={onCloseRename}
          style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.35)', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => undefined} style={[adminCard, { maxWidth: 420, width: '100%', alignSelf: 'center', gap: 12 }]}>
            <AppText variant="subtitle">Adını değiştir</AppText>
            <TextInput value={renameValue} onChangeText={setRenameValue} autoFocus style={adminField} />
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable onPress={onCloseRename} style={adminGhost}>
                <AppText>Vazgeç</AppText>
              </Pressable>
              <Pressable onPress={() => renaming && onSaveRename(renaming.id)} style={adminBtn}>
                <AppText tone="inverse">Kaydet</AppText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(menuRow)} transparent animationType="fade" onRequestClose={() => setMenuId(null)}>
        <Pressable
          onPress={() => setMenuId(null)}
          style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.35)', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => undefined} style={[adminCard, { maxWidth: 360, width: '100%', alignSelf: 'center', gap: 4 }]}>
            <AppText variant="subtitle">{menuRow?.name}</AppText>
            {(
              [
                {
                  label: 'Adını değiştir',
                  onPress: () => {
                    if (!menuRow) return;
                    onStartRename(menuRow.id, menuRow.name);
                    setMenuId(null);
                  },
                },
                {
                  label: 'Yukarı taşı',
                  disabled: menuIndex <= 0,
                  onPress: () => {
                    if (!menuRow) return;
                    onMove(menuRow.id, -1);
                    setMenuId(null);
                  },
                },
                {
                  label: 'Aşağı taşı',
                  disabled: menuIndex < 0 || menuIndex >= rows.length - 1,
                  onPress: () => {
                    if (!menuRow) return;
                    onMove(menuRow.id, 1);
                    setMenuId(null);
                  },
                },
                {
                  label: menuRow?.is_active === false ? 'Yayına al' : 'Arşivle',
                  onPress: () => {
                    if (!menuRow) return;
                    onArchive(menuRow.id, menuRow.is_active !== false);
                    setMenuId(null);
                  },
                },
                {
                  label: 'Sil',
                  danger: true,
                  onPress: () => {
                    if (!menuRow) return;
                    setMenuId(null);
                    onDelete(menuRow.id, menuRow.name);
                  },
                },
              ] as { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }[]
            ).map((item) => (
              <Pressable
                key={item.label}
                disabled={item.disabled}
                onPress={item.onPress}
                style={{ paddingVertical: 12, opacity: item.disabled ? 0.4 : 1 }}>
                <AppText tone={item.danger ? 'danger' : 'primary'}>{item.label}</AppText>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
