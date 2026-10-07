import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { mapAdminError } from '@/src/features/admin/roles';
import { useAdminCatalog } from '@/src/features/admin/useAdmin';
import { pickDeviceImage } from '@/src/features/media/pickDeviceImage';
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
};

const emptyChoices = { A: '', B: '', C: '', D: '', E: '' };

export function AdminQuestionsScreen() {
  const catalog = useAdminCatalog();
  const [examType, setExamType] = useState('tyt');
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [editing, setEditing] = useState<Partial<QuestionRow> & { choices: Record<string, string> } | null>(null);

  const subjects = useMemo(
    () => (catalog.data?.subjects ?? []).filter((s) => {
      const exam = catalog.data?.exams.find((e) => e.id === s.exam_id);
      if (!exam) return false;
      if (examType === 'kpss') return exam.slug.startsWith('kpss');
      return exam.slug === examType;
    }),
    [catalog.data, examType],
  );
  const topics = useMemo(
    () => (catalog.data?.topics ?? []).filter((t) => t.subject_id === subjectId),
    [catalog.data, subjectId],
  );

  const list = () => {
    void getSupabase()
      .rpc('admin_search_questions', {
        p_exam_type: examType,
        p_search: search,
        p_limit: 50,
        p_subject_id: subjectId || null,
        p_topic_id: topicId || null,
        p_difficulty: difficulty || null,
        p_include_archived: includeArchived,
      })
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else setRows((data as QuestionRow[]) ?? []);
      });
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
          list();
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
    <View style={{ gap: 12 }}>
      <AppText variant="title">Soru Bankası</AppText>
      <TextInput value={search} onChangeText={setSearch} placeholder="Ara" style={field} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['tyt', 'ayt', 'kpss'].map((item) => (
          <Pressable key={item} onPress={() => { setExamType(item); setSubjectId(''); setTopicId(''); }}>
            <AppText tone={examType === item ? 'accent' : 'muted'}>{item.toUpperCase()}</AppText>
          </Pressable>
        ))}
        {['', 'easy', 'medium', 'hard'].map((item) => (
          <Pressable key={item || 'd'} onPress={() => setDifficulty(item)}>
            <AppText tone={difficulty === item ? 'accent' : 'muted'}>{item || 'zorluk'}</AppText>
          </Pressable>
        ))}
        <Pressable onPress={() => setIncludeArchived((v) => !v)}>
          <AppText tone={includeArchived ? 'accent' : 'muted'}>arşiv</AppText>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {subjects.map((item) => (
          <Pressable key={item.id} onPress={() => { setSubjectId(item.id); setTopicId(''); }}>
            <AppText tone={subjectId === item.id ? 'accent' : 'muted'}>{item.name}</AppText>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {topics.map((item) => (
          <Pressable key={item.id} onPress={() => setTopicId(item.id)}>
            <AppText tone={topicId === item.id ? 'accent' : 'muted'}>{item.name}</AppText>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={list} style={btn}><AppText tone="inverse">Listele</AppText></Pressable>
      <Pressable
        onPress={() =>
          setEditing({
            stem: '',
            choices: { ...emptyChoices },
            correct_choice: 'A',
            difficulty: 'medium',
            exam_id: catalog.data?.exams.find((e) => e.slug === examType || (examType === 'kpss' && e.slug.startsWith('kpss')))?.id,
            subject_id: subjectId,
            topic_id: topicId || null,
          })
        }>
        <AppText tone="accent">Yeni soru</AppText>
      </Pressable>
      {editing ? (
        <View style={card}>
          <TextInput value={editing.stem ?? ''} onChangeText={(v) => setEditing({ ...editing, stem: v })} placeholder="Soru" style={[field, { minHeight: 80 }]} multiline />
          {(['A', 'B', 'C', 'D', 'E'] as const).map((key) => (
            <TextInput
              key={key}
              value={editing.choices[key] ?? ''}
              onChangeText={(v) => setEditing({ ...editing, choices: { ...editing.choices, [key]: v } })}
              placeholder={`Şık ${key}`}
              style={field}
            />
          ))}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['A', 'B', 'C', 'D', 'E'] as const).map((key) => (
              <Pressable key={key} onPress={() => setEditing({ ...editing, correct_choice: key })}>
                <AppText tone={editing.correct_choice === key ? 'accent' : 'muted'}>{key}</AppText>
              </Pressable>
            ))}
          </View>
          <TextInput value={editing.explanation ?? ''} onChangeText={(v) => setEditing({ ...editing, explanation: v })} placeholder="Açıklama" style={field} />
          <TextInput value={editing.image_url ?? ''} onChangeText={(v) => setEditing({ ...editing, image_url: v })} placeholder="image_url" style={field} />
          {editing.image_url ? <RemoteImage uri={editing.image_url} style={{ width: 220, height: 140 }} resizeMode="contain" /> : null}
          <Pressable onPress={() => void uploadImage()}><AppText tone="accent">R2 görsel yükle</AppText></Pressable>
          <Pressable onPress={save} style={btn}><AppText tone="inverse">Kaydet</AppText></Pressable>
        </View>
      ) : null}
      {rows.map((row) => (
        <Pressable key={row.id} onPress={() => setEditing({ ...row, choices: { ...emptyChoices, ...(row.choices ?? {}) } })} style={card}>
          <AppText variant="caption">{row.exam} · {row.subject}{row.topic ? ` · ${row.topic}` : ''} · {row.difficulty}{row.archived_at ? ' · arşiv' : ''}</AppText>
          <AppText>{row.stem}</AppText>
          {row.image_url ? <RemoteImage uri={row.image_url} style={{ width: 180, height: 100, marginTop: 6 }} resizeMode="contain" /> : null}
          <AppText variant="caption" tone="muted">Doğru: {row.correct_choice ?? '—'}</AppText>
          <Pressable
            onPress={() =>
              askConfirm({
                title: row.archived_at ? 'Arşivden çıkar?' : 'Arşivle?',
                confirmLabel: 'Tamam',
                onConfirm: () => {
                  void getSupabase()
                    .rpc('admin_archive_question', { p_id: row.id, p_archive: !row.archived_at })
                    .then(({ error }) => (error ? toastError(mapAdminError(error.message)) : list()));
                },
              })
            }>
            <AppText variant="caption" tone="danger">{row.archived_at ? 'Geri al' : 'Arşivle'}</AppText>
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

const field = { minHeight: 44, borderWidth: 1, borderColor: '#D9DEE7', borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff' } as const;
const card = { backgroundColor: '#F7F8FA', borderRadius: 14, padding: 12, gap: 6, borderWidth: 1, borderColor: '#D9DEE7' } as const;
const btn = { minHeight: 44, borderRadius: 12, backgroundColor: '#3D4F66', alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 16 } as const;
