import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { mapAdminError } from '@/src/features/admin/roles';
import { AdminLessonPreviewPlayer } from '@/src/features/admin/AdminLessonPreviewPlayer';
import {
  useAdminMemoryLesson,
  useApproveMemoryLesson,
  useGenerateMemoryLesson,
  useGenerateMemoryLessonMedia,
  useLessonMediaUrls,
  useMemoryLessonQuestions,
  useMemoryLessonScenes,
  usePublishMemoryLesson,
  useSaveMemoryLessonReview,
} from '@/src/features/memory-lessons/useMemoryLessons';
import {
  MEMORY_TECHNIQUES,
  QUESTION_STRATEGIES,
  asCoreFacts,
  strategyLabel,
  techniqueLabel,
  type CoreFact,
} from '@/src/features/memory-lessons/pedagogy';
import type { MemoryLessonQuestion, MemoryLessonScene } from '@/src/features/memory-lessons/types';

const field = {
  minHeight: 44,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  backgroundColor: '#fff',
} as const;
const btn = {
  minHeight: 44,
  paddingHorizontal: 16,
  borderRadius: 12,
  backgroundColor: '#C45C26',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
const ghost = {
  minHeight: 40,
  paddingHorizontal: 14,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: '#fff',
};

type Tab = 'genel' | 'anlatim' | 'teknik' | 'tasarim' | 'sahneler' | 'sorular' | 'medya' | 'onizleme';

const TABS: { key: Tab; label: string }[] = [
  { key: 'genel', label: 'Genel' },
  { key: 'anlatim', label: 'Anlatım' },
  { key: 'teknik', label: 'Sınav Tekniği' },
  { key: 'tasarim', label: 'Hafıza Tasarımı' },
  { key: 'sahneler', label: 'Sahneler' },
  { key: 'sorular', label: 'Sorular' },
  { key: 'medya', label: 'Medya' },
  { key: 'onizleme', label: 'Önizleme' },
];

type StepState = 'done' | 'current' | 'blocked' | 'todo';

function productionSteps(lesson: {
  generation_status?: string | null;
  narration?: string | null;
  pedagogy_score?: number | null;
  media_generation_status?: string | null;
  status: string;
}) {
  const content = lesson.generation_status === 'succeeded' || Boolean(lesson.narration);
  const memory = typeof lesson.pedagogy_score === 'number' && lesson.pedagogy_score >= 80;
  const media = lesson.media_generation_status === 'ready';
  const review = lesson.status === 'pending_validation' || lesson.status === 'approved' || lesson.status === 'published';
  const published = lesson.status === 'published';
  const steps: { id: string; label: string; hint: string; state: StepState }[] = [
    { id: 'konu', label: 'Konu', hint: 'Konu seçildi', state: 'done' },
    {
      id: 'icerik',
      label: 'İçerik',
      hint: content ? 'İçerik üretildi' : 'İçerik bekleniyor',
      state: content ? 'done' : 'current',
    },
    {
      id: 'hafiza',
      label: 'Hafıza Tasarımı',
          hint: memory ? 'Teknik + hafıza hazır' : content ? 'Sınav tekniği eksik' : 'İçerik sonrası',
      state: memory ? 'done' : content ? 'current' : 'todo',
    },
    {
      id: 'medya',
      label: 'Medya',
      hint: media ? 'Medya hazır' : memory ? 'Medya eksik' : 'Önce hafıza tasarımı',
      state: media ? 'done' : memory ? (lesson.media_generation_status === 'failed' ? 'blocked' : 'current') : 'todo',
    },
    {
      id: 'kontrol',
      label: 'Kontrol',
      hint: review ? 'Kontrol tamam' : media ? 'Onay bekleniyor' : 'Medya sonrası',
      state: review ? 'done' : media ? 'current' : 'todo',
    },
    {
      id: 'yayin',
      label: 'Yayın',
      hint: published ? 'Yayında' : review ? 'Yayınlanabilir' : 'Kontrol sonrası',
      state: published ? 'done' : review ? 'current' : 'todo',
    },
  ];
  return steps;
}

function statusBadge(status: string) {
  if (status === 'pending_validation') return 'Pending Validation';
  if (status === 'approved') return 'Approved';
  if (status === 'published') return 'Published';
  if (status === 'generating') return 'Generating';
  return 'Draft';
}

function scopeBadge(scope?: string | null) {
  if (scope === 'exam_specific' || scope === 'exam_extension') return 'Exam Specific';
  return 'Core';
}

function stepMark(state: StepState) {
  if (state === 'done') return '✓';
  if (state === 'blocked') return '!';
  if (state === 'current') return '●';
  return '○';
}

function asLines(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join('\n');
  return String(value ?? '');
}

function fromLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionText(options: unknown, key: string) {
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    return String((options as Record<string, unknown>)[key] ?? '');
  }
  return '';
}

export function AdminMemoryLessonReviewScreen() {
  const params = useLocalSearchParams<{ id?: string; tab?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const lessonQuery = useAdminMemoryLesson(id);
  const scenesQuery = useMemoryLessonScenes(id);
  const questionsQuery = useMemoryLessonQuestions(id);
  const generate = useGenerateMemoryLesson();
  const generateMedia = useGenerateMemoryLessonMedia();
  const save = useSaveMemoryLessonReview();
  const approve = useApproveMemoryLesson();
  const publish = usePublishMemoryLesson();
  const [tab, setTab] = useState<Tab>(TABS.some((item) => item.key === tabParam) ? (tabParam as Tab) : 'genel');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [narration, setNarration] = useState('');
  const [objectives, setObjectives] = useState('');
  const [hooks, setHooks] = useState('');
  const [primaryTechnique, setPrimaryTechnique] = useState('');
  const [techniques, setTechniques] = useState<string[]>([]);
  const [journeyTitle, setJourneyTitle] = useState('');
  const [journeySummary, setJourneySummary] = useState('');
  const [coreFacts, setCoreFacts] = useState<CoreFact[]>([]);
  const [minimumTheory, setMinimumTheory] = useState('');
  const [fastRule, setFastRule] = useState('');
  const [recognition, setRecognition] = useState('');
  const [firstMove, setFirstMove] = useState('');
  const [fastStrategy, setFastStrategy] = useState('');
  const [traps, setTraps] = useState('');
  const [elim, setElim] = useState('');
  const [whenNot, setWhenNot] = useState('');
  const [stemSignals, setStemSignals] = useState('');
  const [scenes, setScenes] = useState<MemoryLessonScene[]>([]);
  const [questions, setQuestions] = useState<MemoryLessonQuestion[]>([]);

  const lesson = lessonQuery.data;
  const mediaUrls = useLessonMediaUrls(id, Boolean(lesson?.narration_key || scenesQuery.data?.some((row) => row.asset_key)));
  const generating = generate.isPending || lesson?.generation_status === 'generating' || lesson?.status === 'generating';
  const mediaBusy = generateMedia.isPending;

  useEffect(() => {
    if (!lesson) return;
    setTitle(lesson.title ?? '');
    setSummary(lesson.description ?? '');
    setNarration(lesson.narration ?? '');
    setObjectives(asLines(lesson.learning_objectives));
    setHooks(asLines(lesson.memory_hooks));
    setPrimaryTechnique(lesson.primary_memory_technique ?? '');
    setTechniques(Array.isArray(lesson.memory_techniques) ? lesson.memory_techniques.map(String) : []);
    setJourneyTitle(lesson.memory_journey_title ?? '');
    setJourneySummary(lesson.memory_journey_summary ?? '');
    setCoreFacts(asCoreFacts(lesson.core_facts));
    setMinimumTheory(lesson.minimum_theory ?? '');
    setFastRule(lesson.fast_rule ?? '');
    const tech = lesson.exam_technique && typeof lesson.exam_technique === 'object' ? lesson.exam_technique : {};
    setRecognition(String(tech.recognition_trigger ?? ''));
    setFirstMove(String(tech.first_move ?? ''));
    setFastStrategy(String(tech.fast_strategy ?? ''));
    setTraps(String(tech.common_traps ?? ''));
    setElim(String(tech.elimination_rules ?? ''));
    setWhenNot(String(tech.when_not_to_use ?? ''));
    setStemSignals(Array.isArray(tech.stem_signals) ? tech.stem_signals.map(String).join('\n') : String(tech.stem_signals ?? ''));
  }, [lesson]);

  useEffect(() => {
    if (scenesQuery.data) setScenes(scenesQuery.data);
  }, [scenesQuery.data]);

  useEffect(() => {
    if (questionsQuery.data) setQuestions(questionsQuery.data);
  }, [questionsQuery.data]);

  const checkpoints = useMemo(
    () => questions.filter((row) => row.question_type === 'checkpoint'),
    [questions],
  );
  const finals = useMemo(() => questions.filter((row) => row.question_type === 'final'), [questions]);

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const persist = () => {
    if (!id) return;
    void save
      .mutateAsync({
        lesson: {
          id,
          title,
          description: summary,
          narration,
          learning_objectives: fromLines(objectives),
          memory_hooks: fromLines(hooks),
          primary_memory_technique: primaryTechnique || null,
          memory_techniques: techniques,
          core_facts: coreFacts,
          memory_journey_title: journeyTitle || null,
          memory_journey_summary: journeySummary || null,
          minimum_theory: minimumTheory || null,
          fast_rule: fastRule || null,
          exam_technique: {
            know: minimumTheory,
            recognize: recognition,
            solve: fastStrategy,
            recognition_trigger: recognition,
            first_move: firstMove,
            fast_strategy: fastStrategy,
            common_traps: traps,
            elimination_rules: elim,
            when_not_to_use: whenNot,
            stem_signals: fromLines(stemSignals),
            heuristic_kind: 'strong_clue',
            aaa_bu_suydu: Boolean(recognition && firstMove && fastRule),
          },
        },
        scenes,
        questions,
      })
      .then(() => toastSuccess('Kaydedildi'))
      .catch(fail);
  };

  if (!id) return <AppText>Ders bulunamadı.</AppText>;
  if (lessonQuery.isLoading) return <AppText>Yükleniyor…</AppText>;
  if (!lesson) return <AppText>Ders bulunamadı.</AppText>;

  const steps = productionSteps(lesson);

  return (
    <View style={{ gap: 16 }}>
      <Pressable onPress={() => router.push('/admin/hafiza-dersleri' as never)}>
        <AppText tone="accent">← Listeye dön</AppText>
      </Pressable>
      <AppText variant="title">{lesson.title}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <View style={[ghost, { backgroundColor: '#F3E0D4' }]}>
          <AppText variant="caption">{statusBadge(lesson.status)}</AppText>
        </View>
        <View style={ghost}>
          <AppText variant="caption">{scopeBadge(lesson.lesson_scope)}</AppText>
        </View>
        <View style={ghost}>
          <AppText variant="caption">Pedagogy {typeof lesson.pedagogy_score === 'number' ? lesson.pedagogy_score : '—'}</AppText>
        </View>
        <View style={ghost}>
          <AppText variant="caption">
            Media {lesson.media_generation_status === 'ready' ? 'ready' : lesson.media_generation_status === 'failed' ? 'failed' : 'pending'}
          </AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {steps.map((step, index) => (
          <View key={step.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 12,
                backgroundColor: step.state === 'done' ? '#E8F3E8' : step.state === 'blocked' ? '#FCE8E4' : step.state === 'current' ? '#F3E0D4' : '#FFFCF7',
                borderWidth: 1,
                borderColor: '#E4DDD0',
              }}>
              <AppText variant="caption">
                {stepMark(step.state)} {step.hint}
              </AppText>
            </View>
            {index < steps.length - 1 ? <AppText tone="muted">→</AppText> : null}
          </View>
        ))}
      </View>

      {lesson.generation_error ? <AppText tone="danger">{lesson.generation_error}</AppText> : null}
      {lesson.media_generation_error ? <AppText tone="danger">{lesson.media_generation_error}</AppText> : null}
      {Array.isArray(lesson.pedagogy_issues) && lesson.pedagogy_issues.length > 0 ? (
        <View style={{ gap: 4 }}>
          <AppText tone="danger">Hafıza pedagojisi eksik</AppText>
          {lesson.pedagogy_issues.map((issue, index) => (
            <AppText key={`issue-${index}`} variant="caption" tone="danger">
              {String(issue)}
            </AppText>
          ))}
        </View>
      ) : null}
      {generating ? <AppText tone="accent">İçerik hazırlanıyor...</AppText> : null}
      {mediaBusy ? <AppText tone="accent">Medya hazırlanıyor...</AppText> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable
          disabled={generating}
          onPress={() => void generate.mutateAsync(id).then(() => toastSuccess('İçerik üretildi')).catch(fail)}
          style={[btn, generating ? { opacity: 0.6 } : null]}>
          <AppText tone="inverse">{generating ? 'İçerik hazırlanıyor...' : 'İçerik Üret'}</AppText>
        </Pressable>
        <Pressable
          disabled={generating}
          onPress={() => void generate.mutateAsync(id).then(() => toastSuccess('Hafıza tasarımı yenilendi')).catch(fail)}
          style={ghost}>
          <AppText>Hafıza Tasarımını Yenile</AppText>
        </Pressable>
        <Pressable
          disabled={generating || mediaBusy || lesson.generation_status !== 'succeeded'}
          onPress={() =>
            void generateMedia
              .mutateAsync({ lessonId: id, mode: 'missing' })
              .then(() => toastSuccess('Medya üretildi'))
              .catch(fail)
          }
          style={ghost}>
          <AppText>Eksik Medyayı Üret</AppText>
        </Pressable>
        <Pressable onPress={() => setTab('onizleme')} style={ghost}>
          <AppText>Önizle</AppText>
        </Pressable>
        <Pressable disabled={generating} onPress={persist} style={ghost}>
          <AppText>Kaydet</AppText>
        </Pressable>
        <Pressable
          disabled={generating || lesson.status !== 'pending_validation'}
          onPress={() => void approve.mutateAsync(id).then(() => toastSuccess('Onaya alındı')).catch(fail)}
          style={ghost}>
          <AppText>Onaya Hazır</AppText>
        </Pressable>
        <Pressable
          disabled={generating || lesson.status !== 'approved'}
          onPress={() => void publish.mutateAsync(id).then(() => toastSuccess('Yayınlandı')).catch(fail)}
          style={ghost}>
          <AppText>Yayınla</AppText>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TABS.map((item) => (
          <Pressable key={item.key} onPress={() => setTab(item.key)} style={[ghost, tab === item.key ? { backgroundColor: '#F3E0D4' } : null]}>
            <AppText>{item.label}</AppText>
          </Pressable>
        ))}
      </View>

      {tab === 'genel' ? (
        <View style={{ gap: 10, backgroundColor: '#FFFCF7', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E4DDD0' }}>
          <AppText variant="caption" tone="muted">
            {lesson.exam_type} · {lesson.subject} · {lesson.unit} · {lesson.topic}
            {lesson.generation_model ? ` · ${lesson.generation_model}` : ''}
          </AppText>
          <TextInput value={title} onChangeText={setTitle} placeholder="Başlık" style={field} />
          <TextInput value={summary} onChangeText={setSummary} placeholder="Özet" multiline style={[field, { minHeight: 90 }]} />
          <AppText variant="caption" tone="muted">
            Pedagoji puanı: {typeof lesson.pedagogy_score === 'number' ? `${lesson.pedagogy_score}/100` : 'henüz yok'}
            {typeof lesson.technique_score === 'number' ? ` · teknik ${lesson.technique_score}` : ''}
            {lesson.academic_pass === false ? ' · akademik geçmedi' : ''}
            {lesson.pedagogy_version ? ` · ${lesson.pedagogy_version}` : ''}
          </AppText>
        </View>
      ) : null}

      {tab === 'anlatim' ? (
        <View style={{ gap: 10 }}>
          <TextInput value={objectives} onChangeText={setObjectives} placeholder="Kazanımlar (her satır bir madde)" multiline style={[field, { minHeight: 120 }]} />
          <TextInput value={narration} onChangeText={setNarration} placeholder="Anlatım" multiline style={[field, { minHeight: 240 }]} />
        </View>
      ) : null}

      {tab === 'teknik' ? (
        <View style={{ gap: 10 }}>
          <AppText variant="subtitle">Sınav Tekniği</AppText>
          <TextInput value={recognition} onChangeText={setRecognition} placeholder="Soru kalıbı / tanıma tetikleyicisi" multiline style={[field, { minHeight: 72 }]} />
          <TextInput value={firstMove} onChangeText={setFirstMove} placeholder="İlk hamle" multiline style={[field, { minHeight: 72 }]} />
          <TextInput value={fastStrategy} onChangeText={setFastStrategy} placeholder="Hızlı güvenilir yol" multiline style={[field, { minHeight: 90 }]} />
          <TextInput value={traps} onChangeText={setTraps} placeholder="Tipik tuzak" multiline style={[field, { minHeight: 72 }]} />
          <TextInput value={whenNot} onChangeText={setWhenNot} placeholder="Ne zaman kullanılmaz" multiline style={[field, { minHeight: 72 }]} />
          <TextInput value={elim} onChangeText={setElim} placeholder="Eleme kuralı" multiline style={[field, { minHeight: 72 }]} />
          <TextInput value={fastRule} onChangeText={setFastRule} placeholder="5 saniyelik kural (en fazla 3 satır)" multiline style={[field, { minHeight: 72 }]} />
          <TextInput value={minimumTheory} onChangeText={setMinimumTheory} placeholder="Asgari teori (KNOW)" multiline style={[field, { minHeight: 90 }]} />
          <TextInput value={stemSignals} onChangeText={setStemSignals} placeholder="Soru kökü sinyalleri (her satır)" multiline style={[field, { minHeight: 72 }]} />
        </View>
      ) : null}

      {tab === 'tasarim' ? (
        <View style={{ gap: 12 }}>
          <AppText variant="subtitle">Birincil teknik: {techniqueLabel(primaryTechnique)}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MEMORY_TECHNIQUES.map((item) => (
              <Pressable
                key={item}
                onPress={() => {
                  setPrimaryTechnique(item);
                  setTechniques((cur) => (cur.includes(item) ? cur : [...cur, item]));
                }}
                style={[ghost, primaryTechnique === item ? { backgroundColor: '#F3E0D4' } : null]}>
                <AppText>{techniqueLabel(item)}</AppText>
              </Pressable>
            ))}
          </View>
          <AppText variant="caption">Kullanılan teknikler</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MEMORY_TECHNIQUES.map((item) => (
              <Pressable
                key={`use-${item}`}
                onPress={() =>
                  setTechniques((cur) => (cur.includes(item) ? cur.filter((row) => row !== item) : [...cur, item]))
                }
                style={[ghost, techniques.includes(item) ? { backgroundColor: '#F3E0D4' } : null]}>
                <AppText>{techniqueLabel(item)}</AppText>
              </Pressable>
            ))}
          </View>
          <TextInput value={journeyTitle} onChangeText={setJourneyTitle} placeholder="Hafıza yolculuğu başlığı" style={field} />
          <TextInput
            value={journeySummary}
            onChangeText={setJourneySummary}
            placeholder="Yolculuk özeti (öğrenci zihninde yeniden oynatılacak sıra)"
            multiline
            style={[field, { minHeight: 90 }]}
          />
          <AppText variant="subtitle">Çekirdek olgular</AppText>
          {coreFacts.map((fact, index) => (
            <View key={`fact-${index}`} style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 14, gap: 8 }}>
              <TextInput
                value={fact.fact}
                onChangeText={(value) => setCoreFacts((cur) => cur.map((row, i) => (i === index ? { ...row, fact: value } : row)))}
                placeholder="Olgu / memory target"
                multiline
                style={[field, { minHeight: 64 }]}
              />
              <TextInput
                value={fact.visual_anchor}
                onChangeText={(value) =>
                  setCoreFacts((cur) => cur.map((row, i) => (i === index ? { ...row, visual_anchor: value } : row)))
                }
                placeholder="Görsel çıpa"
                style={field}
              />
              <TextInput
                value={fact.recall_prompt}
                onChangeText={(value) =>
                  setCoreFacts((cur) => cur.map((row, i) => (i === index ? { ...row, recall_prompt: value } : row)))
                }
                placeholder="Hatırlatma sorusu"
                style={field}
              />
              <AppText variant="caption">{techniqueLabel(fact.technique)}</AppText>
            </View>
          ))}
          <TextInput
            value={hooks}
            onChangeText={setHooks}
            placeholder="Ek hafıza kancaları (her satır bir madde)"
            multiline
            style={[field, { minHeight: 120 }]}
          />
        </View>
      ) : null}

      {tab === 'sahneler' ? (
        <View style={{ gap: 12 }}>
          {scenes.map((scene, index) => (
            <View key={scene.id} style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 14, gap: 8 }}>
              <AppText variant="subtitle">Sahne {scene.scene_order}</AppText>
              <TextInput
                value={scene.caption ?? ''}
                onChangeText={(value) => setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, caption: value } : row)))}
                placeholder="Altyazı"
                style={field}
              />
              <TextInput
                value={scene.memory_hook ?? ''}
                onChangeText={(value) => setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, memory_hook: value } : row)))}
                placeholder="Hafıza kancası"
                style={field}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {MEMORY_TECHNIQUES.map((item) => (
                  <Pressable
                    key={`${scene.id}-${item}`}
                    onPress={() => setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, memory_technique: item } : row)))}
                    style={[ghost, scene.memory_technique === item ? { backgroundColor: '#F3E0D4' } : null]}>
                    <AppText variant="caption">{techniqueLabel(item)}</AppText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={scene.memory_target ?? ''}
                onChangeText={(value) => setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, memory_target: value } : row)))}
                placeholder="Ne öğretiliyor? (memory target)"
                style={field}
              />
              <TextInput
                value={scene.visual_anchor ?? ''}
                onChangeText={(value) => setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, visual_anchor: value } : row)))}
                placeholder="Görsel çıpa"
                style={field}
              />
              <TextInput
                value={scene.recall_prompt ?? ''}
                onChangeText={(value) => setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, recall_prompt: value } : row)))}
                placeholder="Sonra nasıl hatırlanacak?"
                style={field}
              />
              <TextInput
                value={scene.reinforcement_note ?? ''}
                onChangeText={(value) =>
                  setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, reinforcement_note: value } : row)))
                }
                placeholder="Pekiştirme notu"
                style={field}
              />
              <TextInput
                value={scene.journey_step ?? ''}
                onChangeText={(value) => setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, journey_step: value } : row)))}
                placeholder="Yolculuk durağı"
                style={field}
              />
              <TextInput
                value={scene.narration_text ?? ''}
                onChangeText={(value) =>
                  setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, narration_text: value } : row)))
                }
                placeholder="Sahne anlatımı"
                multiline
                style={[field, { minHeight: 90 }]}
              />
              <TextInput
                value={scene.visual_description ?? ''}
                onChangeText={(value) =>
                  setScenes((cur) => cur.map((row, i) => (i === index ? { ...row, visual_description: value } : row)))
                }
                placeholder="Görsel tarifi"
                multiline
                style={[field, { minHeight: 80 }]}
              />
              <AppText variant="caption" tone="muted">
                {scene.asset_key ? 'Görsel hazır' : 'Görsel yok'} · {scene.start_ms}–{scene.end_ms} ms
              </AppText>
              <Pressable
                disabled={generating || mediaBusy || lesson.generation_status !== 'succeeded'}
                onPress={() =>
                  void generateMedia
                    .mutateAsync({ lessonId: id, mode: 'scene', sceneId: scene.id })
                    .then(() => toastSuccess('Görsel yenilendi'))
                    .catch(fail)
                }
                style={ghost}>
                <AppText>Görseli Yenile</AppText>
              </Pressable>
            </View>
          ))}
          {scenes.length === 0 ? <AppText tone="muted">Henüz sahne yok. İçerik Üret.</AppText> : null}
        </View>
      ) : null}

      {tab === 'sorular' ? (
        <View style={{ gap: 12 }}>
          <AppText variant="subtitle">Ara kontrol</AppText>
          {checkpoints.map((question) => (
            <QuestionEditor
              key={question.id}
              question={question}
              onChange={(next) => setQuestions((cur) => cur.map((row) => (row.id === next.id ? next : row)))}
            />
          ))}
          <AppText variant="subtitle">Final ({finals.length}/10)</AppText>
          {finals.map((question) => (
            <QuestionEditor
              key={question.id}
              question={question}
              onChange={(next) => setQuestions((cur) => cur.map((row) => (row.id === next.id ? next : row)))}
            />
          ))}
          {questions.length === 0 ? <AppText tone="muted">Henüz soru yok. İçerik Üret.</AppText> : null}
        </View>
      ) : null}

      {tab === 'medya' ? (
        <View style={{ gap: 12, backgroundColor: '#FFFCF7', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E4DDD0' }}>
          <AppText>
            Durum: {lesson.media_generation_status ?? 'idle'}
            {lesson.narration_key ? ' · ses hazır' : ' · ses yok'}
          </AppText>
          <AppText variant="caption" tone="muted">
            Sahneler: {scenes.filter((row) => row.asset_key).length}/{scenes.length} görsel
          </AppText>
          {lesson.media_generation_error ? <AppText tone="danger">{lesson.media_generation_error}</AppText> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable
              disabled={generating || mediaBusy || lesson.generation_status !== 'succeeded'}
              onPress={() =>
                void generateMedia
                  .mutateAsync({ lessonId: id, mode: 'missing' })
                  .then(() => toastSuccess('Medya üretildi'))
                  .catch(fail)
              }
              style={ghost}>
              <AppText>Eksik Medyayı Üret</AppText>
            </Pressable>
            <Pressable
              disabled={generating || mediaBusy || lesson.generation_status !== 'succeeded'}
              onPress={() =>
                void generateMedia
                  .mutateAsync({ lessonId: id, mode: 'narration' })
                  .then(() => toastSuccess('Seslendirme yenilendi'))
                  .catch(fail)
              }
              style={ghost}>
              <AppText>Seslendirmeyi Yenile</AppText>
            </Pressable>
            <Pressable
              disabled={generating || mediaBusy || lesson.generation_status !== 'succeeded'}
              onPress={() =>
                void generateMedia
                  .mutateAsync({ lessonId: id, mode: 'all' })
                  .then(() => toastSuccess('Medya yenilendi'))
                  .catch(fail)
              }
              style={ghost}>
              <AppText>Tüm Medyayı Yenile</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {tab === 'onizleme' ? (
        <AdminLessonPreviewPlayer lesson={lesson} scenes={scenes} urls={mediaUrls.data ?? {}} />
      ) : null}
    </View>
  );
}

function QuestionEditor({
  question,
  onChange,
}: {
  question: MemoryLessonQuestion;
  onChange: (next: MemoryLessonQuestion) => void;
}) {
  const options = (question.options && typeof question.options === 'object' ? question.options : {}) as Record<string, string>;
  const setOpt = (key: string, value: string) => {
    onChange({ ...question, options: { ...options, [key]: value } });
  };
  return (
    <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 14, gap: 8 }}>
      <AppText variant="caption" tone="muted">
        {question.question_type} · {question.question_order} · {strategyLabel(question.question_strategy)}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {QUESTION_STRATEGIES.map((item) => (
          <Pressable
            key={item}
            onPress={() => onChange({ ...question, question_strategy: item })}
            style={[ghost, question.question_strategy === item ? { backgroundColor: '#F3E0D4' } : null]}>
            <AppText variant="caption">{strategyLabel(item)}</AppText>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={question.question_text}
        onChangeText={(value) => onChange({ ...question, question_text: value })}
        placeholder="Soru"
        multiline
        style={[field, { minHeight: 72 }]}
      />
      {(['A', 'B', 'C', 'D', 'E'] as const).map((key) => (
        <TextInput
          key={key}
          value={optionText(options, key)}
          onChangeText={(value) => setOpt(key, value)}
          placeholder={`${key} şıkkı`}
          style={field}
        />
      ))}
      <TextInput
        value={question.correct_answer}
        onChangeText={(value) => onChange({ ...question, correct_answer: value.toUpperCase().slice(0, 1) })}
        placeholder="Doğru (A-E)"
        style={field}
      />
      <TextInput
        value={question.explanation ?? ''}
        onChangeText={(value) => onChange({ ...question, explanation: value })}
        placeholder="Açıklama"
        multiline
        style={[field, { minHeight: 72 }]}
      />
    </View>
  );
}
