import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost, mufredatHref, queryParam } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { useExamCatalog } from '@/src/features/curriculum/useCurriculum';
import { mapLessonExams, signLessonVideoUpload } from '@/src/features/memory-lessons/memoryLessonApi';
import {
  useAdminMemoryLesson,
  useDeleteMemoryLesson,
  useMemoryLessonQuestions,
  usePublishMemoryLesson,
  useSaveMemoryLessonReview,
} from '@/src/features/memory-lessons/useMemoryLessons';
import { getSupabase } from '@/src/lib/supabase/client';
import type { MemoryLessonQuestion } from '@/src/features/memory-lessons/types';

type CueKind = 'pause' | 'card' | 'question';
type Cue = {
  kind: CueKind;
  seconds: number;
  cardTitle: string;
  cardText: string;
  questionText: string;
  a: string;
  b: string;
  c: string;
  d: string;
  correct: string;
  onWrong: 'show_detail_then_retry' | 'retry';
  onCorrect: 'resume' | 'next';
  resumeSeconds: number;
  explanation: string;
  retryRequired: boolean;
};

const emptyCue = (): Cue => ({
  kind: 'question',
  seconds: 0,
  cardTitle: '',
  cardText: '',
  questionText: '',
  a: '',
  b: '',
  c: '',
  d: '',
  correct: 'B',
  onWrong: 'show_detail_then_retry',
  onCorrect: 'resume',
  resumeSeconds: 0,
  explanation: '',
  retryRequired: true,
});

function hapFromLesson(lesson: { minimum_theory?: string | null; hap_blocks?: unknown; fast_rule?: string | null }) {
  if (typeof lesson.minimum_theory === 'string' && lesson.minimum_theory.trim()) return lesson.minimum_theory;
  const blocks = Array.isArray(lesson.hap_blocks) ? lesson.hap_blocks : [];
  const hap = blocks.find((row) => row && typeof row === 'object' && String((row as { type?: string }).type).includes('HAP'));
  return hap && typeof hap === 'object' ? String((hap as { text?: string }).text ?? '') : '';
}

export function AdminMemoryLessonReviewScreen() {
  const params = useLocalSearchParams<{ id?: string; exam?: string; subject?: string; unit?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const lessonQuery = useAdminMemoryLesson(id);
  const questionsQuery = useMemoryLessonQuestions(id);
  const save = useSaveMemoryLessonReview();
  const publish = usePublishMemoryLesson();
  const remove = useDeleteMemoryLesson();
  const exams = useExamCatalog();
  const lesson = lessonQuery.data;

  const [title, setTitle] = useState('');
  const [hap, setHap] = useState('');
  const [tactic, setTactic] = useState('');
  const [detail, setDetail] = useState('');
  const [minutes, setMinutes] = useState('8');
  const [delivery, setDelivery] = useState<'text' | 'video'>('text');
  const [questions, setQuestions] = useState<MemoryLessonQuestion[]>([]);
  const [examCodes, setExamCodes] = useState<string[]>([]);
  const [cues, setCues] = useState<Cue[]>([]);
  const [videoKey, setVideoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewStep, setPreviewStep] = useState<'hap' | 'q' | 'wrong' | 'end' | 'break' | 'pack'>('hap');
  const [memoryTip, setMemoryTip] = useState('');
  const [packages, setPackages] = useState<{ id: string; title: string }[]>([]);
  const [packId, setPackId] = useState<string | null>(null);
  const [packPos, setPackPos] = useState('1');

  useEffect(() => {
    if (!lesson) return;
    setTitle(lesson.title ?? '');
    setHap(hapFromLesson(lesson));
    setTactic(String(lesson.fast_rule ?? ''));
    setDetail(String(lesson.detailed_explanation ?? ''));
    setMinutes(String(lesson.study_minutes ?? 8));
    setDelivery(lesson.delivery_mode === 'video' ? 'video' : 'text');
    setVideoKey(lesson.video_key ?? null);
    setMemoryTip(String(lesson.exam_technique?.common_traps ?? ''));
  }, [lesson]);

  useEffect(() => {
    if (questionsQuery.data) setQuestions(questionsQuery.data);
  }, [questionsQuery.data]);

  useEffect(() => {
    void getSupabase()
      .from('lesson_packages')
      .select('id, title')
      .neq('status', 'archived')
      .order('sort_order')
      .then(({ data }) => setPackages((data ?? []) as { id: string; title: string }[]));
  }, []);

  useEffect(() => {
    const topicId = lesson?.canonical_topic_id;
    if (!topicId) return;
    void getSupabase()
      .from('lesson_package_items')
      .select('package_id, sort_order')
      .eq('canonical_topic_id', topicId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setPackId(String(data.package_id));
        setPackPos(String((data.sort_order ?? 0) + 1));
      });
  }, [lesson?.canonical_topic_id]);

  useEffect(() => {
    if (!id) return;
    void getSupabase()
      .from('lesson_timeline_events')
      .select('event_type, appear_at_ms, payload')
      .eq('lesson_id', id)
      .order('appear_at_ms')
      .then(({ data }) => {
        setCues(
          (data ?? []).map((row) => {
            const payload = (row.payload ?? {}) as Record<string, unknown>;
            const choices = (payload.choices ?? {}) as Record<string, string>;
            const type = String(row.event_type);
            return {
              kind: type === 'card_show' ? 'card' : type === 'pause' ? 'pause' : 'question',
              seconds: Math.round(Number(row.appear_at_ms ?? 0) / 1000),
              cardTitle: String(payload.title ?? ''),
              cardText: String(payload.text ?? ''),
              questionText: String(payload.text ?? ''),
              a: String(choices.A ?? ''),
              b: String(choices.B ?? ''),
              c: String(choices.C ?? ''),
              d: String(choices.D ?? ''),
              correct: String(payload.correct ?? 'B'),
              onWrong: payload.on_wrong === 'retry' ? 'retry' : 'show_detail_then_retry',
              onCorrect: payload.on_correct === 'next' ? 'next' : 'resume',
              resumeSeconds: Math.round(Number(payload.resume_ms ?? row.appear_at_ms ?? 0) / 1000),
              explanation: String(payload.explanation ?? ''),
              retryRequired: payload.retry_required !== false,
            };
          }),
        );
      });
  }, [id]);

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const persistCues = async () => {
    if (!id) return;
    await getSupabase().from('lesson_timeline_events').delete().eq('lesson_id', id);
    for (const cue of cues) {
      const event_type = cue.kind === 'card' ? 'card_show' : cue.kind === 'pause' ? 'pause' : 'question';
      const payload =
        cue.kind === 'card'
          ? { title: cue.cardTitle, text: cue.cardText }
          : {
              text: cue.questionText,
              choices: { A: cue.a, B: cue.b, C: cue.c, D: cue.d },
              correct: cue.correct,
              pause: true,
              on_wrong: cue.onWrong,
              on_correct: cue.onCorrect,
              resume_ms: (cue.resumeSeconds || cue.seconds) * 1000,
              explanation: cue.explanation,
              retry_required: cue.retryRequired,
            };
      await getSupabase().from('lesson_timeline_events').insert({
        lesson_id: id,
        event_type,
        appear_at_ms: cue.seconds * 1000,
        payload,
      });
    }
  };

  const persist = () => {
    if (!id) return;
    void save
      .mutateAsync({
        lesson: {
          id,
          title,
          minimum_theory: hap,
          fast_rule: tactic,
          detailed_explanation: detail,
          delivery_mode: delivery,
          study_minutes: Number(minutes) || 8,
          exam_technique: { ...(lesson?.exam_technique ?? {}), common_traps: memoryTip },
          hap_blocks: [
            hap ? { type: 'HAP_BILGI', title: 'Hap bilgi', text: hap } : null,
            tactic ? { type: 'HIZLI_TEKNIK', title: 'Taktik', text: tactic } : null,
            memoryTip ? { type: 'HAFIZA', title: 'Hafıza ipucu', text: memoryTip } : null,
          ].filter(Boolean) as { type: string; title: string; text: string }[],
        },
        scenes: [],
        questions,
      })
      .then(async () => {
        await persistCues();
        const topicId = lesson?.canonical_topic_id;
        if (topicId) {
          await getSupabase().from('lesson_package_items').delete().eq('canonical_topic_id', topicId);
          if (packId) {
            await getSupabase().from('lesson_package_items').insert({
              package_id: packId,
              canonical_topic_id: topicId,
              sort_order: Math.max(0, Number(packPos) - 1),
            });
          }
        }
        toastSuccess('Kaydedildi');
      })
      .catch(fail);
  };

  const uploadVideo = () => {
    if (!id || typeof document === 'undefined') {
      toastError('Video yükleme web yöneticisinde.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      void signLessonVideoUpload(id, file.type || 'video/mp4')
        .then(async ({ put_url, key }) => {
          const res = await fetch(put_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'video/mp4' } });
          if (!res.ok) throw new Error('Yükleme başarısız');
          await getSupabase().from('memory_lessons').update({ video_key: key, delivery_mode: 'video' }).eq('id', id);
          setVideoKey(key);
          setDelivery('video');
          toastSuccess('Video yüklendi');
        })
        .catch(fail)
        .finally(() => setUploading(false));
    };
    input.click();
  };

  const goBack = () => {
    const exam = queryParam(params.exam) ?? lessonQuery.data?.exam_id ?? null;
    const subject = queryParam(params.subject) ?? lessonQuery.data?.subject_id ?? null;
    const unit = queryParam(params.unit) ?? lessonQuery.data?.unit_id ?? null;
    if (exam) {
      router.replace(mufredatHref(exam, subject, unit) as never);
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/admin/mufredat' as never);
  };

  const backLink = (
    <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Geri">
      <AppText tone="accent">← Geri</AppText>
    </Pressable>
  );

  if (!id || lessonQuery.isLoading) {
    return (
      <View style={{ gap: 16 }}>
        {backLink}
        <AppText>Yükleniyor…</AppText>
      </View>
    );
  }
  if (!lesson) {
    return (
      <View style={{ gap: 16 }}>
        {backLink}
        <AppText>Ders bulunamadı.</AppText>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      {backLink}
      <AppText variant="title">{title || lesson.title}</AppText>
      <AppText variant="caption" tone="muted">
        {lesson.status === 'published' ? 'Yayında' : 'Taslak'} · {delivery === 'video' ? 'Video' : 'Metin'}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable onPress={persist} style={adminBtn}>
          <AppText tone="inverse">Kaydet</AppText>
        </Pressable>
        <Pressable
          onPress={() => {
            setPreviewStep(delivery === 'video' ? 'q' : 'hap');
            setPreview(true);
          }}
          style={adminGhost}>
          <AppText>Önizle</AppText>
        </Pressable>
        <Pressable
          onPress={() => void publish.mutateAsync(id).then(() => toastSuccess('Yayınlandı')).catch(fail)}
          style={adminGhost}>
          <AppText>Yayınla</AppText>
        </Pressable>
        <Pressable
          onPress={() =>
            askConfirm({
              title: 'Dersi sil?',
              subtitle: 'Kalıcı silinir.',
              confirmLabel: 'Sil',
              danger: true,
              onConfirm: () =>
                void remove
                  .mutateAsync(id)
                  .then(() => {
                    toastSuccess('Silindi');
                    goBack();
                  })
                  .catch(fail),
            })
          }
          style={adminGhost}>
          <AppText>Sil</AppText>
        </Pressable>
      </View>

      <View style={adminCard}>
        <AppText variant="label">Ne anlatılacak</AppText>
        <TextInput value={title} onChangeText={setTitle} placeholder="Başlık" style={adminField} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setDelivery('text')} style={[adminChip, delivery === 'text' && adminChipOn]}>
            <AppText>Metin</AppText>
          </Pressable>
          <Pressable onPress={() => setDelivery('video')} style={[adminChip, delivery === 'video' && adminChipOn]}>
            <AppText>Video</AppText>
          </Pressable>
        </View>
        <TextInput value={hap} onChangeText={setHap} placeholder="Hap bilgi" multiline style={[adminField, { minHeight: 90 }]} />
        <TextInput value={tactic} onChangeText={setTactic} placeholder="Taktik (isteğe bağlı)" multiline style={[adminField, { minHeight: 72 }]} />
        <TextInput
          value={memoryTip}
          onChangeText={setMemoryTip}
          placeholder="Hafıza ipucu (isteğe bağlı)"
          multiline
          style={[adminField, { minHeight: 72 }]}
        />
        <TextInput value={detail} onChangeText={setDetail} placeholder="Detaylı anlatım (Anladım modalı)" multiline style={[adminField, { minHeight: 140 }]} />
        <TextInput value={minutes} onChangeText={setMinutes} placeholder="Süre (dk)" style={adminField} />
        <AppText variant="label">Paket</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={() => setPackId(null)} style={[adminChip, !packId && adminChipOn]}>
            <AppText>Paketsiz (5’li sıra)</AppText>
          </Pressable>
          {packages.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => setPackId(row.id)}
              style={[adminChip, packId === row.id && adminChipOn]}>
              <AppText>{row.title}</AppText>
            </Pressable>
          ))}
        </View>
        {packId ? (
          <TextInput value={packPos} onChangeText={setPackPos} placeholder="Paket sırası (1–5)" style={adminField} />
        ) : null}
      </View>

      <View style={adminCard}>
        <AppText variant="label">Konu testi</AppText>
        <AppText variant="caption" tone="muted">
          Doğru şıkkı işaretle. Öğrenci doğruyu bulursa tebrik edilip sonraki konuya geçer; yanlışı işaretlerse doğru şık ve senin seçtiğin anlatım görünür.
        </AppText>
        {questions.map((question, index) => (
          <QuestionBlock
            key={question.id}
            question={question}
            onChange={(next) => setQuestions((cur) => cur.map((row) => (row.id === next.id ? next : row)))}
            onRemove={() => setQuestions((cur) => cur.filter((_, i) => i !== index))}
          />
        ))}
        <Pressable
          onPress={() =>
            setQuestions((cur) => [
              ...cur,
              {
                id: `new-${Date.now()}`,
                lesson_id: id,
                question_type: 'checkpoint',
                question_order: cur.length + 1,
                question_text: '',
                options: { A: '', B: '', C: '', D: '' },
                correct_answer: 'B',
                explanation: '',
                wrong_feedback: 'detail',
                related_scene_id: null,
                created_at: new Date().toISOString(),
              },
            ])
          }
          style={adminGhost}>
          <AppText>Soru ekle</AppText>
        </Pressable>
      </View>

      <View style={adminCard}>
        <AppText variant="label">Video etkileşimleri</AppText>
        <AppText variant="caption" tone="muted">
          16:9 mp4 yükle. Zaman damgasında video durur, soru açılır. Doğru: devam veya sonraki konu. Yanlış: detay + tekrar.
        </AppText>
        <AppText>{videoKey ? 'Video yüklü' : 'Henüz video yok'}</AppText>
        <Pressable onPress={uploadVideo} disabled={uploading} style={adminBtn}>
          <AppText tone="inverse">{uploading ? 'Yükleniyor…' : videoKey ? 'Videoyu değiştir' : 'Video yükle'}</AppText>
        </Pressable>
        {cues.map((cue, index) => (
          <View key={`cue-${index}`} style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EDE6D8' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['pause', 'card', 'question'] as const).map((kind) => (
                <Pressable
                  key={kind}
                  onPress={() => setCues((cur) => cur.map((row, i) => (i === index ? { ...row, kind } : row)))}
                  style={[adminChip, cue.kind === kind && adminChipOn]}>
                  <AppText>{kind === 'pause' ? 'Duruş' : kind === 'card' ? 'Kart' : 'Soru'}</AppText>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={String(cue.seconds)}
              onChangeText={(value) =>
                setCues((cur) => cur.map((row, i) => (i === index ? { ...row, seconds: Number(value) || 0 } : row)))
              }
              placeholder="Saniye"
              style={adminField}
            />
            {cue.kind === 'card' ? (
              <>
                <TextInput
                  value={cue.cardTitle}
                  onChangeText={(value) => setCues((cur) => cur.map((row, i) => (i === index ? { ...row, cardTitle: value } : row)))}
                  placeholder="Kart başlığı"
                  style={adminField}
                />
                <TextInput
                  value={cue.cardText}
                  onChangeText={(value) => setCues((cur) => cur.map((row, i) => (i === index ? { ...row, cardText: value } : row)))}
                  placeholder="Kart metni"
                  multiline
                  style={[adminField, { minHeight: 72 }]}
                />
              </>
            ) : null}
            {cue.kind === 'question' ? (
              <>
                <TextInput
                  value={cue.questionText}
                  onChangeText={(value) =>
                    setCues((cur) => cur.map((row, i) => (i === index ? { ...row, questionText: value } : row)))
                  }
                  placeholder="Video sorusu"
                  multiline
                  style={[adminField, { minHeight: 72 }]}
                />
                {(['a', 'b', 'c', 'd'] as const).map((key) => (
                  <TextInput
                    key={key}
                    value={cue[key]}
                    onChangeText={(value) => setCues((cur) => cur.map((row, i) => (i === index ? { ...row, [key]: value } : row)))}
                    placeholder={`${key.toUpperCase()} şıkkı`}
                    style={adminField}
                  />
                ))}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(['A', 'B', 'C', 'D'] as const).map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => setCues((cur) => cur.map((row, i) => (i === index ? { ...row, correct: key } : row)))}
                      style={[adminChip, cue.correct === key && adminChipOn]}>
                      <AppText>{key} doğru</AppText>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={cue.explanation}
                  onChangeText={(value) =>
                    setCues((cur) => cur.map((row, i) => (i === index ? { ...row, explanation: value } : row)))
                  }
                  placeholder="Yanlış anlatımı / detay kaynağı"
                  multiline
                  style={[adminField, { minHeight: 72 }]}
                />
                <AppText variant="caption">Doğru olursa</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pressable
                    onPress={() => setCues((cur) => cur.map((row, i) => (i === index ? { ...row, onCorrect: 'resume' } : row)))}
                    style={[adminChip, cue.onCorrect === 'resume' && adminChipOn]}>
                    <AppText>Videoya devam et</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => setCues((cur) => cur.map((row, i) => (i === index ? { ...row, onCorrect: 'next' } : row)))}
                    style={[adminChip, cue.onCorrect === 'next' && adminChipOn]}>
                    <AppText>Sonraki konuya geç</AppText>
                  </Pressable>
                </View>
                <AppText variant="caption">Yanlış olursa</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pressable
                    onPress={() =>
                      setCues((cur) =>
                        cur.map((row, i) => (i === index ? { ...row, onWrong: 'show_detail_then_retry' } : row)),
                      )
                    }
                    style={[adminChip, cue.onWrong === 'show_detail_then_retry' && adminChipOn]}>
                    <AppText>Detaylı anlatımı aç</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setCues((cur) => cur.map((row, i) => (i === index ? { ...row, onWrong: 'retry' } : row)))
                    }
                    style={[adminChip, cue.onWrong === 'retry' && adminChipOn]}>
                    <AppText>Tekrar sor</AppText>
                  </Pressable>
                </View>
                <Pressable
                  onPress={() =>
                    setCues((cur) =>
                      cur.map((row, i) => (i === index ? { ...row, retryRequired: !row.retryRequired } : row)),
                    )
                  }
                  style={adminGhost}>
                  <AppText variant="caption">Tekrar zorunlu: {cue.retryRequired ? 'evet' : 'hayır'}</AppText>
                </Pressable>
                <TextInput
                  value={String(cue.resumeSeconds)}
                  onChangeText={(value) =>
                    setCues((cur) =>
                      cur.map((row, i) => (i === index ? { ...row, resumeSeconds: Number(value) || 0 } : row)),
                    )
                  }
                  placeholder="Devam saniyesi (resume)"
                  style={adminField}
                />
              </>
            ) : null}
            <Pressable onPress={() => setCues((cur) => cur.filter((_, i) => i !== index))} style={adminGhost}>
              <AppText variant="caption">Bu adımı sil</AppText>
            </Pressable>
          </View>
        ))}
        <Pressable onPress={() => setCues((cur) => [...cur, emptyCue()])} style={adminGhost}>
          <AppText>Etkileşim ekle</AppText>
        </Pressable>
      </View>

      <View style={adminCard}>
        <AppText variant="label">Bu konu başka hangi sınavlarda geçerli?</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(exams.data ?? []).map((exam) => {
            const on = examCodes.includes(exam.code);
            return (
              <Pressable
                key={exam.id}
                onPress={() => setExamCodes((cur) => (on ? cur.filter((code) => code !== exam.code) : [...cur, exam.code]))}
                style={[adminChip, on && adminChipOn]}>
                <AppText>{exam.name}</AppText>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() =>
            id ? void mapLessonExams(id, examCodes).then(() => toastSuccess('Eşleme kaydedildi')).catch(fail) : undefined
          }
          style={adminGhost}>
          <AppText>Eşlemeyi kaydet</AppText>
        </Pressable>
      </View>

      <Modal visible={preview} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#FFFCF7', borderRadius: 16, padding: 16, gap: 12, maxHeight: '90%' }}>
            <AppText variant="title">Önizleme · {delivery === 'video' ? 'Video' : 'Metin'}</AppText>
            {previewStep === 'hap' ? (
              <>
                <AppText variant="label">Hap bilgi</AppText>
                <AppText>{hap || '—'}</AppText>
                {tactic ? <AppText>Taktik: {tactic}</AppText> : null}
                {memoryTip ? <AppText>İpucu: {memoryTip}</AppText> : null}
                <Pressable onPress={() => setPreviewStep('q')} style={adminBtn}>
                  <AppText tone="inverse">Anladım</AppText>
                </Pressable>
              </>
            ) : null}
            {previewStep === 'q' ? (
              <>
                {delivery === 'video' ? (
                  <AppText variant="caption">Video {cues[0]?.seconds ?? 0}. saniyede durur.</AppText>
                ) : null}
                <AppText>{cues[0]?.questionText || questions[0]?.question_text || 'Konu sorusu'}</AppText>
                <Pressable onPress={() => setPreviewStep('end')} style={adminBtn}>
                  <AppText tone="inverse">Doğru yanıtla</AppText>
                </Pressable>
                <Pressable onPress={() => setPreviewStep('wrong')} style={adminGhost}>
                  <AppText>Yanlış yanıtla</AppText>
                </Pressable>
              </>
            ) : null}
            {previewStep === 'wrong' ? (
              <>
                <AppText>Yanlış şık kırmızı, doğru şık yeşil.</AppText>
                <AppText>{cues[0]?.explanation || detail || 'Detaylı anlatım'}</AppText>
                <Pressable
                  onPress={() => setPreviewStep(cues[0]?.onCorrect === 'resume' ? 'q' : 'q')}
                  style={adminBtn}>
                  <AppText tone="inverse">Anladım (tekrar sor)</AppText>
                </Pressable>
              </>
            ) : null}
            {previewStep === 'end' ? (
              <>
                <AppText variant="subtitle">Sıradaki derse geçiliyor</AppText>
                <AppText>10 → 0 sayaç. Dokunulmazsa sonraki ders açılır.</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pressable onPress={() => setPreviewStep('break')} style={adminGhost}>
                    <AppText>Mola Ver</AppText>
                  </Pressable>
                  <Pressable onPress={() => setPreview(false)} style={adminGhost}>
                    <AppText>Bitir</AppText>
                  </Pressable>
                  <Pressable onPress={() => setPreviewStep('pack')} style={adminBtn}>
                    <AppText tone="inverse">Geç</AppText>
                  </Pressable>
                </View>
              </>
            ) : null}
            {previewStep === 'break' ? (
              <>
                <AppText variant="title">Moladasın ☕</AppText>
                <Pressable onPress={() => setPreviewStep('pack')} style={adminBtn}>
                  <AppText tone="inverse">Devam Et</AppText>
                </Pressable>
              </>
            ) : null}
            {previewStep === 'pack' ? (
              <>
                <AppText variant="title">Paket tamamlandı 🎯</AppText>
                <AppText>5 konuyu kapsayan paket tekrarı simülasyonu.</AppText>
                <Pressable onPress={() => setPreview(false)} style={adminBtn}>
                  <AppText tone="inverse">Kapat</AppText>
                </Pressable>
              </>
            ) : null}
            <Pressable onPress={() => setPreview(false)} style={adminGhost}>
              <AppText>Önizlemeyi kapat</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function QuestionBlock({
  question,
  onChange,
  onRemove,
}: {
  question: MemoryLessonQuestion;
  onChange: (next: MemoryLessonQuestion) => void;
  onRemove: () => void;
}) {
  const options = (question.options && typeof question.options === 'object' && !Array.isArray(question.options)
    ? question.options
    : {}) as Record<string, string>;
  const wrongMode = question.wrong_feedback === 'hap' || question.wrong_feedback === 'custom' ? question.wrong_feedback : 'detail';
  return (
    <View style={{ gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#EDE6D8' }}>
      <TextInput
        value={question.question_text}
        onChangeText={(value) => onChange({ ...question, question_text: value })}
        placeholder="Soru"
        multiline
        style={[adminField, { minHeight: 72 }]}
      />
      <AppText variant="caption" tone="muted">
        Şıkkı yaz, yeşil düğmeyle doğruyu işaretle.
      </AppText>
      {(['A', 'B', 'C', 'D'] as const).map((key) => {
        const selected = question.correct_answer === key;
        return (
          <View key={key} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={String(options[key] ?? '')}
              onChangeText={(value) => onChange({ ...question, options: { ...options, [key]: value } })}
              placeholder={`${key} şıkkı`}
              style={[adminField, { flex: 1, borderColor: selected ? '#2F7D32' : '#E4DDD0' }]}
            />
            <Pressable
              onPress={() => onChange({ ...question, correct_answer: key })}
              style={{
                minHeight: 44,
                paddingHorizontal: 12,
                borderRadius: 12,
                justifyContent: 'center',
                backgroundColor: selected ? '#2F7D32' : '#fff',
                borderWidth: 1,
                borderColor: selected ? '#2F7D32' : '#E4DDD0',
              }}>
              <AppText style={{ color: selected ? '#fff' : '#0F1C2E' }}>{selected ? 'Doğru' : 'İşaretle'}</AppText>
            </Pressable>
          </View>
        );
      })}
      <AppText variant="caption">Doğru olursa: tebrik + sonraki konuya geçilir.</AppText>
      <AppText variant="label">Yanlış olursa öğrenci ne görsün?</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(
          [
            ['custom', 'Yazdığım anlatım'],
            ['hap', 'Hap bilgi'],
            ['detail', 'Detaylı anlatım'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => onChange({ ...question, wrong_feedback: value })}
            style={[adminChip, wrongMode === value && adminChipOn]}>
            <AppText>{label}</AppText>
          </Pressable>
        ))}
      </View>
      {wrongMode === 'custom' ? (
        <TextInput
          value={question.explanation ?? ''}
          onChangeText={(value) => onChange({ ...question, explanation: value })}
          placeholder="Yanlışta gösterilecek anlatım"
          multiline
          style={[adminField, { minHeight: 90 }]}
        />
      ) : (
        <AppText variant="caption" tone="muted">
          {wrongMode === 'hap' ? 'Üstteki hap bilgi gösterilir.' : 'Üstteki detaylı anlatım gösterilir.'}
        </AppText>
      )}
      <Pressable onPress={onRemove} style={adminGhost}>
        <AppText variant="caption">Soruyu sil</AppText>
      </Pressable>
    </View>
  );
}
