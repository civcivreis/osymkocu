import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { useAdminCatalog } from '@/src/features/admin/useAdmin';
import { pickDeviceImage } from '@/src/features/media/pickDeviceImage';
import { generateTopicQuestions, getTopicQuestionSummary, listTopicQuestions, setQuestionStatus } from '@/src/features/questions/questionBankApi';
import { useActiveCurriculumVersion, useExamCatalog, useSubjectCatalog, useTopicCatalog, useUnitCatalog } from '@/src/features/curriculum/useCurriculum';
import { getSupabase } from '@/src/lib/supabase/client';
import { fetchSignedMediaUrl } from '@/src/features/media/useSignedMediaUrl';

type QuestionRow = {
  id: string;
  stem: string;
  choices?: Record<string, string> | null;
  correct_choice?: string | null;
  explanation?: string | null;
  image_url?: string | null;
  difficulty?: string;
  subject?: string;
  topic?: string | null;
  exam?: string;
  exam_id?: string;
  subject_id?: string;
  topic_id?: string | null;
  archived_at?: string | null;
  is_published?: boolean;
};

const emptyChoices = { A: '', B: '', C: '', D: '', E: '' };

export function AdminQuestionsScreen() {
  const catalog = useAdminCatalog();
  const exams = useExamCatalog();
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const subjects = useSubjectCatalog(examId);
  const units = useUnitCatalog(subjectId);
  const topics = useTopicCatalog(unitId);
  const active = useActiveCurriculumVersion(examId);
  const selectedTopic = useMemo(() => (topics.data ?? []).find((row) => row.id === topicId) ?? null, [topicId, topics.data]);
  const canonicalId = selectedTopic?.canonical_topic_id ?? null;

  const [treeCounts, setTreeCounts] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getTopicQuestionSummary>> | null>(null);
  const [bankRows, setBankRows] = useState<Awaited<ReturnType<typeof listTopicQuestions>>>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);

  const [examType, setExamType] = useState('tyt');
  const [legacySubjectId, setLegacySubjectId] = useState('');
  const [editing, setEditing] = useState<Partial<QuestionRow> & { choices: Record<string, string> } | null>(null);

  const legacySubjects = useMemo(
    () =>
      (catalog.data?.subjects ?? []).filter((s) => {
        const exam = catalog.data?.exams.find((e) => e.id === s.exam_id);
        if (!exam) return false;
        if (examType === 'kpss') return exam.slug.startsWith('kpss');
        return exam.slug === examType;
      }),
    [catalog.data, examType],
  );

  const refreshTopic = () => {
    if (!canonicalId) {
      setSummary(null);
      setBankRows([]);
      return;
    }
    void getTopicQuestionSummary(canonicalId).then(setSummary).catch((error) => toastError(mapAdminError(error instanceof Error ? error.message : 'Özet alınamadı.')));
    void listTopicQuestions(canonicalId).then(setBankRows).catch(() => setBankRows([]));
  };

  useEffect(() => {
    const ids = (topics.data ?? []).map((row) => row.canonical_topic_id).filter(Boolean) as string[];
    if (!ids.length) {
      setTreeCounts({});
      return;
    }
    void Promise.all(
      ids.map(async (id) => {
        try {
          const row = await getTopicQuestionSummary(id);
          return [id, row.total] as const;
        } catch {
          return [id, 0] as const;
        }
      }),
    ).then((rows) => setTreeCounts(Object.fromEntries(rows)));
  }, [topics.data]);

  useEffect(() => {
    if (!canonicalId) {
      setSummary(null);
      setBankRows([]);
      return;
    }
    void getTopicQuestionSummary(canonicalId).then(setSummary).catch(() => setSummary(null));
    void listTopicQuestions(canonicalId).then(setBankRows).catch(() => setBankRows([]));
  }, [canonicalId]);

  const fail = (error: unknown) => toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));

  const generate = (mode: 'topic_pool' | 'missing_coverage') => {
    if (!canonicalId) {
      toastError('Kanonik konusu olan bir konu seç.');
      return;
    }
    setBusy(true);
    void generateTopicQuestions({
      mode,
      canonical_topic_id: canonicalId,
      curriculum_version_id: active.data?.id ?? null,
      exam_catalog_id: examId,
    })
      .then((result) => {
        toastSuccess(`${result.inserted ?? 0} aday soru üretildi. Yayınlanmadı.`);
        refreshTopic();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const save = () => {
    if (!editing?.stem || !editing.exam_id || !editing.subject_id) {
      toastError('Sınav, ders ve soru metni gerekli.');
      return;
    }
    void getSupabase()
      .rpc('admin_upsert_question', {
        p_payload: {
          id: editing.id ?? null,
          exam_id: editing.exam_id,
          subject_id: editing.subject_id,
          topic_id: editing.topic_id ?? null,
          stem: editing.stem,
          choices: editing.choices,
          correct_choice: editing.correct_choice ?? 'A',
          explanation: editing.explanation ?? '',
          difficulty: editing.difficulty ?? 'medium',
          image_url: editing.image_url ?? '',
          is_published: true,
        },
      })
      .then(({ error }) => {
        if (error) toastError(mapAdminError(error.message));
        else {
          toastSuccess('Kaydedildi');
          setEditing(null);
          setManual(false);
        }
      });
  };

  const uploadImage = async () => {
    const picked = await pickDeviceImage({ source: 'library' });
    if (!picked) return;
    const invoked = await getSupabase().functions.invoke('media-upload', {
      body: { purpose: 'question_image', base64: picked.base64, mime: picked.mime ?? 'image/jpeg', width: picked.width, height: picked.height },
    });
    const body = invoked.data as { data?: { mediaId?: string }; error?: { message?: string } } | null;
    if (invoked.error || body?.error || !body?.data?.mediaId) {
      toastError(body?.error?.message ?? invoked.error?.message ?? 'Yükleme başarısız');
      return;
    }
    try {
      const signed = await fetchSignedMediaUrl(body.data.mediaId);
      setEditing((cur) => (cur ? { ...cur, image_url: signed.url } : cur));
      toastSuccess('Görsel yüklendi');
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <View style={{ gap: 4 }}>
          <AppText variant="title">Soru Bankası</AppText>
          <AppText tone="muted">Müfredat ağacı · AI üretim · otomatik yayın yok</AppText>
        </View>
        <Pressable
          onPress={() => {
            setManual(true);
            setEditing({
              stem: '',
              choices: { ...emptyChoices },
              correct_choice: 'A',
              difficulty: 'medium',
              exam_id: catalog.data?.exams.find((e) => e.slug === examType || (examType === 'kpss' && e.slug.startsWith('kpss')))?.id,
              subject_id: legacySubjectId,
              topic_id: null,
            });
          }}
          style={adminGhost}>
          <AppText>+ Manuel Soru</AppText>
        </Pressable>
      </View>

      <View style={adminCard}>
        <AppText variant="label">Sınav</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(exams.data ?? []).filter((row) => row.is_active).map((row) => (
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
          <>
            <AppText variant="label">Ders</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(subjects.data ?? []).map((row) => (
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
            {(units.data ?? []).map((row) => (
              <Pressable
                key={row.id}
                onPress={() => {
                  setUnitId(row.id);
                  setTopicId(null);
                }}
                style={[adminChip, unitId === row.id && adminChipOn, { alignSelf: 'flex-start' }]}>
                <AppText>{row.name}</AppText>
              </Pressable>
            ))}
          </>
        ) : null}
        {unitId ? (
          <>
            <AppText variant="label">Konu</AppText>
            {(topics.data ?? []).map((row) => (
              <Pressable key={row.id} onPress={() => setTopicId(row.id)} style={[adminChip, topicId === row.id && adminChipOn, { alignSelf: 'flex-start' }]}>
                <AppText>
                  {row.name}
                  {row.canonical_topic_id ? `        ${treeCounts[row.canonical_topic_id] ?? 0} soru` : ' · kanonik yok'}
                </AppText>
              </Pressable>
            ))}
          </>
        ) : null}
      </View>

      {canonicalId && summary ? (
        <View style={adminCard}>
          <AppText variant="subtitle">{selectedTopic?.name}</AppText>
          <AppText>
            Lesson: {summary.lesson} · Total {summary.total} · Easy {summary.easy} · Medium {summary.medium} · Hard {summary.hard}
          </AppText>
          <AppText variant="caption" tone="muted">
            Final {summary.final_count}/10 · Pool {summary.pool_count}/{summary.pool_target} · Approved {summary.approved} · Needs Review {summary.needs_review}
          </AppText>
          {(summary.objectives ?? []).map((row) => (
            <AppText key={row.id} variant="caption">
              {row.count >= 2 ? '✓' : '⚠'} {row.title} — {row.count} soru
            </AppText>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable disabled={busy} onPress={() => generate('topic_pool')} style={adminBtn}>
              <AppText tone="inverse">{busy ? 'Üretiliyor…' : 'AI ile Soru Üret'}</AppText>
            </Pressable>
            <Pressable disabled={busy} onPress={() => generate('missing_coverage')} style={adminGhost}>
              <AppText>Eksik Soruları Üret</AppText>
            </Pressable>
            <Pressable onPress={() => setReviewOpen((open) => !open)} style={adminGhost}>
              <AppText>Soruları İncele</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {reviewOpen && bankRows.map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText variant="caption" tone="muted">
            {row.set_type} · {row.difficulty} · {row.question_strategy} · {row.question_status} · {row.source_type}
          </AppText>
          <AppText>{row.stem}</AppText>
          {row.image_url ? <RemoteImage uri={row.image_url} style={{ width: 220, height: 140, borderRadius: 12 }} resizeMode="contain" /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable onPress={() => void setQuestionStatus(row.id, 'approved').then(() => { toastSuccess('Onaylandı'); refreshTopic(); }).catch(fail)} style={adminGhost}>
              <AppText variant="caption">Onayla</AppText>
            </Pressable>
            <Pressable
              onPress={() =>
                askConfirm({
                  title: 'Yayınlansın mı?',
                  subtitle: 'Öğrenciler görür.',
                  confirmLabel: 'Yayınla',
                  onConfirm: () => void setQuestionStatus(row.id, 'published').then(() => { toastSuccess('Yayınlandı'); refreshTopic(); }).catch(fail),
                })
              }
              style={adminGhost}>
              <AppText variant="caption">Yayınla</AppText>
            </Pressable>
            <Pressable onPress={() => void setQuestionStatus(row.id, 'needs_review').then(refreshTopic).catch(fail)} style={adminGhost}>
              <AppText variant="caption">İncelemeye al</AppText>
            </Pressable>
          </View>
        </View>
      ))}

      {manual && editing ? (
        <View style={[adminCard, { maxWidth: 1000, width: '100%', alignSelf: 'center', gap: 12 }]}>
          <AppText variant="subtitle">Manuel soru</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['tyt', 'ayt', 'kpss'].map((item) => (
              <Pressable key={item} onPress={() => setExamType(item)} style={[adminChip, examType === item && adminChipOn]}>
                <AppText>{item.toUpperCase()}</AppText>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {legacySubjects.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setLegacySubjectId(item.id);
                  setEditing({ ...editing, subject_id: item.id, exam_id: item.exam_id });
                }}
                style={[adminChip, editing.subject_id === item.id && adminChipOn]}>
                <AppText>{item.name}</AppText>
              </Pressable>
            ))}
          </View>
          <TextInput value={editing.stem ?? ''} onChangeText={(v) => setEditing({ ...editing, stem: v })} placeholder="Soru metni" style={[adminField, { minHeight: 120 }]} multiline />
          {(['A', 'B', 'C', 'D', 'E'] as const).map((key) => (
            <View key={key} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <AppText variant="label">{key}</AppText>
              <TextInput
                value={editing.choices[key] ?? ''}
                onChangeText={(v) => setEditing({ ...editing, choices: { ...editing.choices, [key]: v } })}
                style={[adminField, { flex: 1 }]}
              />
            </View>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {(['A', 'B', 'C', 'D', 'E'] as const).map((key) => (
              <Pressable key={key} onPress={() => setEditing({ ...editing, correct_choice: key })}>
                <AppText tone={editing.correct_choice === key ? 'accent' : 'muted'}>{key}</AppText>
              </Pressable>
            ))}
          </View>
          <TextInput value={editing.explanation ?? ''} onChangeText={(v) => setEditing({ ...editing, explanation: v })} placeholder="Açıklama" style={[adminField, { minHeight: 90 }]} multiline />
          {editing.image_url ? (
            <View style={{ gap: 8 }}>
              <RemoteImage uri={editing.image_url} style={{ width: 220, height: 140, borderRadius: 12 }} resizeMode="contain" />
              <Pressable onPress={() => setEditing({ ...editing, image_url: '' })} style={adminGhost}>
                <AppText>Kaldır</AppText>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => void uploadImage()} style={[adminGhost, { alignSelf: 'flex-start' }]}>
              <AppText>Görsel Yükle</AppText>
            </Pressable>
          )}
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <Pressable onPress={() => { setEditing(null); setManual(false); }} style={adminGhost}>
              <AppText>İptal</AppText>
            </Pressable>
            <Pressable onPress={save} style={adminBtn}>
              <AppText tone="inverse">Kaydet</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
