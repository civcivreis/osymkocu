import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { mapAdminError } from '@/src/features/admin/roles';
import { getSupabase } from '@/src/lib/supabase/client';
import {
  DEFAULT_EXAM_SLOT,
  EXAM_TIME_SLOTS,
  buildIstanbulStart,
  defaultDuration,
  examTypeLabel,
  formatIstanbulDateTime,
} from '@/src/features/system-exams/examTime';
import { useAdminExams, useAdminUpsertExam } from '@/src/features/admin/useAdmin';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function AdminExamsScreen() {
  const exams = useAdminExams();
  const save = useAdminUpsertExam();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'tyt' | 'ayt' | 'kpss'>('tyt');
  const [date, setDate] = useState(todayIsoIstanbul());
  const [slot, setSlot] = useState(DEFAULT_EXAM_SLOT);
  const [duration, setDuration] = useState(String(defaultDuration('tyt')));
  const [status, setStatus] = useState<'draft' | 'scheduled' | 'live' | 'finished' | 'cancelled'>('draft');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<{
    id: string;
    stem: string;
    subject: string;
    choices?: Record<string, string> | null;
    correct_choice?: string | null;
    explanation?: string | null;
    image_url?: string | null;
  }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const create = () => {
    void save
      .mutateAsync({
        title,
        exam_type: type,
        description,
        start_at: buildIstanbulStart(date, slot),
        duration_minutes: Number(duration),
        status,
      })
      .then(async (row) => {
        if (picked.length) {
          const { error } = await getSupabase().rpc('admin_set_exam_questions', {
            p_exam: row.id,
            p_question_ids: picked,
          });
          if (error) throw error;
        }
        toastSuccess('Kaydedildi');
        setTitle('');
        setDescription('');
        setPicked([]);
      })
      .catch((error: unknown) => toastError(error));
  };

  const searchQs = () => {
    void getSupabase()
      .rpc('admin_search_questions', { p_exam_type: type, p_search: search, p_limit: 30 })
      .then(({ data, error }) => {
        if (error) {
          toastError(mapAdminError(error.message));
          return;
        }
        setHits((data as typeof hits) ?? []);
      });
  };

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Sistem Sınavları</AppText>
      <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
        <AppText variant="subtitle">Yeni sınav</AppText>
        <TextInput value={title} onChangeText={setTitle} placeholder="Başlık" style={field} />
        <TextInput value={description} onChangeText={setDescription} placeholder="Açıklama (isteğe bağlı)" style={field} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['tyt', 'ayt', 'kpss'] as const).map((item) => (
            <Pressable key={item} onPress={() => { setType(item); setDuration(String(defaultDuration(item))); }} style={[chip, type === item && chipOn]}>
              <AppText>{examTypeLabel(item)}</AppText>
            </Pressable>
          ))}
        </View>
        <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" style={field} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {EXAM_TIME_SLOTS.map((item) => (
            <Pressable key={item} onPress={() => setSlot(item)} style={[chip, slot === item && chipOn]}>
              <AppText>{item}</AppText>
            </Pressable>
          ))}
        </View>
        <TextInput value={duration} onChangeText={setDuration} placeholder="Süre (dk)" keyboardType="number-pad" style={field} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['draft', 'scheduled', 'live', 'finished', 'cancelled'] as const).map((item) => (
            <Pressable key={item} onPress={() => setStatus(item)} style={[chip, status === item && chipOn]}>
              <AppText>{item}</AppText>
            </Pressable>
          ))}
        </View>
        <AppText variant="caption" tone="muted">Saat rastgele üretilmez. Timezone: Europe/Istanbul.</AppText>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={search} onChangeText={setSearch} placeholder="Soru ara" style={[field, { flex: 1 }]} />
          <Pressable onPress={searchQs} style={btn}><AppText tone="inverse">Ara</AppText></Pressable>
        </View>
        {hits.map((hit) => (
          <View key={hit.id} style={{ paddingVertical: 6, gap: 4 }}>
            <Pressable
              onPress={() => setPicked((cur) => (cur.includes(hit.id) ? cur.filter((id) => id !== hit.id) : [...cur, hit.id]))}>
              <AppText variant="caption">
                {picked.includes(hit.id) ? '✓ ' : ''}{hit.subject}: {hit.stem}
              </AppText>
            </Pressable>
            <Pressable onPress={() => setPreviewId((cur) => (cur === hit.id ? null : hit.id))}>
              <AppText variant="caption" tone="accent">{previewId === hit.id ? 'Gizle' : 'Önizle'}</AppText>
            </Pressable>
            {previewId === hit.id ? (
              <View style={{ gap: 4 }}>
                {hit.image_url ? <RemoteImage uri={hit.image_url} style={{ width: 200, height: 120 }} resizeMode="contain" /> : null}
                {hit.choices
                  ? Object.entries(hit.choices).map(([key, value]) => (
                      <AppText key={key} variant="caption">{key}) {value}</AppText>
                    ))
                  : null}
                <AppText variant="caption" tone="accent">Doğru: {hit.correct_choice ?? '—'}</AppText>
                {hit.explanation ? <AppText variant="caption" tone="muted">{hit.explanation}</AppText> : null}
              </View>
            ) : null}
          </View>
        ))}
        <AppText variant="caption" tone="muted">{picked.length} soru seçildi</AppText>
        <Pressable onPress={create} style={btn}><AppText tone="inverse">Kaydet</AppText></Pressable>
      </View>
      {(exams.data ?? []).map((exam) => {
        const when = formatIstanbulDateTime(String(exam.start_at));
        return (
          <View key={String(exam.id)} style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 14, gap: 4 }}>
            <AppText variant="subtitle">{String(exam.title)}</AppText>
            <AppText variant="caption" tone="muted">
              {examTypeLabel(String(exam.exam_type))} · {when.label} · {String(exam.status)} · {String(exam.question_count)} soru
            </AppText>
            <Pressable
              onPress={() =>
                void save.mutateAsync({ id: exam.id, title: exam.title, exam_type: exam.exam_type, start_at: exam.start_at, duration_minutes: exam.duration_minutes, status: 'cancelled' })
                  .catch((error: unknown) => toastError(error))
              }>
              <AppText tone="danger">İptal et</AppText>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const field = { minHeight: 44, borderWidth: 1, borderColor: '#E4DDD0', borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff' } as const;
const chip = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#E8E3D8' } as const;
const chipOn = { backgroundColor: '#F3E0D4' } as const;
const btn = { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#C45C26', alignItems: 'center' as const, justifyContent: 'center' as const };
