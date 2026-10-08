import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { tickFactoryProcess } from '@/src/features/content-factory/factoryApi';
import { getTopicQuestionSummary } from '@/src/features/questions/questionBankApi';
import {
  useBreakdownSessions,
  useBreakdownSuggestions,
  useCanonicalTopics,
  useCanonicalUnits,
  useFactoryExamCoverage,
  useFactoryJobs,
  useFactoryMutations,
  useFactorySettings,
  useFactoryStats,
} from '@/src/features/content-factory/useContentFactory';
import type { FactoryJob } from '@/src/features/content-factory/types';
import { useActiveCurriculumVersion, useExamCatalog, useSubjectCatalog, useUnitCatalog } from '@/src/features/curriculum/useCurriculum';

function jobLabel(status: string) {
  if (status === 'queued') return 'Kuyrukta';
  if (status === 'generating_text') return 'Metin';
  if (status === 'validating_pedagogy') return 'Pedagoji';
  if (status === 'generating_questions') return 'Sorular';
  if (status === 'generating_media') return 'Medya';
  if (status === 'pending_validation') return 'Kontrol';
  if (status === 'completed') return 'Tamam';
  if (status === 'failed') return 'Hata';
  if (status === 'cancelled') return 'İptal';
  return status;
}

function StageLine({ job }: { job: FactoryJob }) {
  const media = job.media_total_count > 0 ? `${job.media_done_count}/${job.media_total_count}` : '';
  const mark = (done: boolean, current: boolean, missing: boolean) => (done ? '✓' : missing ? '!' : current ? '⚙' : '○');
  return (
    <AppText variant="caption">
      {mark(job.stage_text_done, job.status === 'generating_text', false)} Text ·{' '}
      {mark(job.stage_pedagogy_done, job.status === 'validating_pedagogy', job.error_code === 'PEDAGOGY_INCOMPLETE')} Pedagogy ·{' '}
      {mark(job.stage_questions_done, job.status === 'generating_questions', false)} Questions ·{' '}
      {mark(Boolean(job.stage_pool_done), job.status === 'generating_questions' && job.stage_questions_done, false)} Pool ·{' '}
      {mark(job.stage_media_done, job.status === 'generating_media', false)} Media{media ? ` ${media}` : ''} ·{' '}
      {mark(job.status === 'pending_validation' || job.status === 'completed', job.status === 'pending_validation', false)} Validation
    </AppText>
  );
}

export function AdminContentFactoryScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const exams = useExamCatalog();
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const active = useActiveCurriculumVersion(examId);
  const subjects = useSubjectCatalog(examId);
  const units = useUnitCatalog(subjectId);
  const stats = useFactoryStats();
  const coverage = useFactoryExamCoverage();
  const settings = useFactorySettings();
  const jobs = useFactoryJobs();
  const topics = useCanonicalTopics();
  const unitsCanonical = useCanonicalUnits();
  const [breakdownUnitId, setBreakdownUnitId] = useState<string | null>(null);
  const mutations = useFactoryMutations();
  const [estimate, setEstimate] = useState<{ generate: number; reused: number; skipped: number } | null>(null);
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const [breakdownName, setBreakdownName] = useState('İslamiyet Öncesi Türk Tarihi');
  const [poolTarget, setPoolTarget] = useState('20');
  const [questionStats, setQuestionStats] = useState<Record<string, Awaited<ReturnType<typeof getTopicQuestionSummary>>>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessions = useBreakdownSessions();
  const suggestions = useBreakdownSuggestions(sessionId);
  const enabled = Boolean(settings.data?.production_enabled);

  useEffect(() => {
    if (settings.data?.question_pool_target != null) setPoolTarget(String(settings.data.question_pool_target));
  }, [settings.data?.question_pool_target]);

  useEffect(() => {
    const ids = [...new Set((jobs.data ?? []).map((row) => row.canonical_topic_id))].slice(0, 24);
    if (!ids.length) return;
    void Promise.all(
      ids.map(async (id) => {
        try {
          const summary = await getTopicQuestionSummary(id);
          return [id, summary] as const;
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      const next: Record<string, Awaited<ReturnType<typeof getTopicQuestionSummary>>> = {};
      for (const row of rows) {
        if (row) next[row[0]] = row[1];
      }
      setQuestionStats(next);
    });
  }, [jobs.data]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      void tickFactoryProcess().catch(() => undefined);
    }, 12000);
    return () => clearInterval(timer);
  }, [enabled]);

  const topicName = useMemo(() => {
    const map = new Map((topics.data ?? []).map((row) => [row.id, row.name]));
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [topics.data]);

  const rows = useMemo(() => {
    return (jobs.data ?? []).filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (examId && row.exam_id && row.exam_id !== examId) return false;
      if (subjectId && row.subject_id && row.subject_id !== subjectId) return false;
      if (unitId && row.unit_id && row.unit_id !== unitId) return false;
      return true;
    });
  }, [jobs.data, statusFilter, examId, subjectId, unitId]);

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const scope = {
    examId,
    versionId: active.data?.id ?? null,
    subjectId,
    unitId,
  };

  const runPreview = () => {
    void mutations.preview.mutateAsync({ ...scope, enqueue: false }).then(setEstimate).catch(fail);
  };

  const startMotor = (confirm: boolean) => {
    void mutations.startMotor
      .mutateAsync(confirm)
      .then((result) => {
        if (result.needs_confirm) {
          const lines = (result.exams ?? [])
            .map((row) => `${row.exam}: ${row.generate} üretilecek`)
            .join('\n');
          askConfirm({
            title: 'Motoru başlat?',
            subtitle: `İçerik motoru tüm aktif sınavların eksik içeriklerini üretmeye başlayacak.\n${result.generate} ders üretilecek · ${result.reused} yeniden kullanılacak · ${result.skipped} atlanacak.${lines ? `\n${lines}` : ''}`,
            confirmLabel: 'Motoru Başlat',
            onConfirm: () => startMotor(true),
          });
          return;
        }
        toastSuccess(`${result.queued ?? 0} iş kuyrukta. Yayın otomatik değil.`);
        void mutations.tick.mutateAsync().catch(() => undefined);
      })
      .catch(fail);
  };

  const enqueueMissing = (confirm: boolean) => {
    const go = () => {
      void mutations.queue
        .mutateAsync({ ...scope, enqueue: true, confirm })
        .then((result) => {
          if (result.needs_confirm) {
            askConfirm({
              title: 'Eksik içerikleri kuyruğa al?',
              subtitle: `${result.generate} üretilecek · ${result.reused} yeniden kullanılacak · ${result.skipped} atlanacak`,
              confirmLabel: 'Kuyruğa al',
              onConfirm: () => enqueueMissing(true),
            });
            return;
          }
          setEstimate(result);
          toastSuccess(`${result.queued} iş kuyruğa alındı`);
        })
        .catch(fail);
    };
    if (!confirm) {
      void mutations.preview.mutateAsync({ ...scope, enqueue: false }).then((result) => {
        setEstimate(result);
        if (result.generate > 8) {
          askConfirm({
            title: 'Eksik içerikleri kuyruğa al?',
            subtitle: `${result.generate} üretilecek · ${result.reused} yeniden kullanılacak · ${result.skipped} atlanacak`,
            confirmLabel: 'Kuyruğa al',
            onConfirm: () => enqueueMissing(true),
          });
          return;
        }
        go();
      }).catch(fail);
      return;
    }
    go();
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <View style={{ gap: 4 }}>
          <AppText variant="title">ÖSYM Koçu İçerik Motoru</AppText>
          <AppText tone="muted">İzle · incele · geçersiz kıl. Yayın otomatik değil.</AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={() => startMotor(false)} style={adminBtn}>
            <AppText tone="inverse">MOTORU BAŞLAT</AppText>
          </Pressable>
          <Pressable
            onPress={() =>
              void mutations.setProduction.mutateAsync({ enabled: false }).then(() => toastSuccess('Motor duraklatıldı. Çalışanlar bitsin.')).catch(fail)
            }
            style={adminGhost}>
            <AppText>MOTORU DURAKLAT</AppText>
          </Pressable>
        </View>
      </View>

      <AppText variant="caption" tone={enabled ? 'accent' : 'muted'}>
        {enabled ? '● Çalışıyor' : '○ Duraklatıldı'} · eşzamanlı {settings.data?.max_concurrency ?? 2} · havuz {settings.data?.question_pool_target ?? 20} · metin {settings.data?.text_workers ?? 2} · görsel {settings.data?.image_workers ?? 1} · TTS {settings.data?.tts_workers ?? 1}
      </AppText>

      <View style={adminCard}>
        <AppText variant="label">Sınav kapsamı</AppText>
        {(coverage.data ?? []).map((row) => (
          <View key={row.id} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingVertical: 6 }}>
            <Pressable
              onPress={() => void mutations.setExamEnabled.mutateAsync({ examId: row.id, enabled: !row.is_enabled }).catch(fail)}
              style={[adminChip, row.is_enabled && adminChipOn]}>
              <AppText>
                {row.is_enabled ? '✓' : '○'} {row.name}
              </AppText>
            </Pressable>
            <AppText variant="caption" tone="muted">
              {row.lessons_ready}/{row.topics} konu hazır · {row.questions_ready} soru · {row.pending_review} inceleme · {row.failed} hata
            </AppText>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <AppText variant="caption">Question Pool Target</AppText>
        <TextInput value={poolTarget} onChangeText={setPoolTarget} keyboardType="number-pad" style={[adminField, { minWidth: 80 }]} />
        <Pressable
          onPress={() =>
            void mutations.setPoolTarget
              .mutateAsync(Number(poolTarget) || 20)
              .then(() => toastSuccess('Havuz hedefi kaydedildi'))
              .catch(fail)
          }
          style={adminGhost}>
          <AppText>Kaydet</AppText>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {[
          ['Curriculum Topics', stats.data?.total_topics ?? '—'],
          ['Lessons Ready', stats.data?.ready ?? '—'],
          ['Videos Ready', stats.data?.ready ?? '—'],
          ['Questions Ready', (coverage.data ?? []).reduce((sum, row) => sum + Number(row.questions_ready ?? 0), 0) || '—'],
          ['Pending Review', stats.data?.pending_validation ?? '—'],
          ['Failed', stats.data?.failed ?? '—'],
        ].map(([label, value]) => (
          <View key={String(label)} style={[adminCard, { minWidth: compact ? '46%' : 140, flexGrow: 1 }]}>
            <AppText variant="caption" tone="muted">
              {label}
            </AppText>
            <AppText variant="title">{value}</AppText>
          </View>
        ))}
      </View>

      <View style={adminCard}>
        <AppText variant="label">Kuyruk filtresi</AppText>
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
                }}
                style={[adminChip, examId === row.id && adminChipOn]}>
                <AppText>{row.name}</AppText>
              </Pressable>
            ))}
        </View>
        {examId ? (
          <AppText variant="caption" tone="muted">
            Müfredat: {active.data?.name ?? 'aktif yok'}
          </AppText>
        ) : null}
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
              {(units.data ?? []).map((row) => (
                <Pressable key={row.id} onPress={() => setUnitId(row.id)} style={[adminChip, unitId === row.id && adminChipOn]}>
                  <AppText>{row.name}</AppText>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        <AppText variant="label">Durum</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[null, 'queued', 'generating_media', 'pending_validation', 'failed', 'completed'].map((item) => (
            <Pressable key={item ?? 'all'} onPress={() => setStatusFilter(item)} style={[adminChip, statusFilter === item && adminChipOn]}>
              <AppText>{item ? jobLabel(item) : 'Tümü'}</AppText>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={runPreview} style={adminGhost}>
            <AppText>Tahmin</AppText>
          </Pressable>
          <Pressable onPress={() => enqueueMissing(false)} style={adminBtn}>
            <AppText tone="inverse">Eksik İçerikleri Kuyruğa Al</AppText>
          </Pressable>
          <Pressable
            onPress={() => void mutations.retryFailed.mutateAsync(active.data?.id ?? null).then(() => toastSuccess('Başarısızlar kuyruğa alındı')).catch(fail)}
            style={adminGhost}>
            <AppText>Başarısızları Tekrar Dene</AppText>
          </Pressable>
          <Pressable
            onPress={() =>
              void mutations.queueTest
                .mutateAsync()
                .then((result) => toastSuccess(result.action === 'queued' ? 'Kut Anlayışı kuyruğa alındı' : 'Kut Anlayışı zaten kuyrukta veya hazır'))
                .catch(fail)
            }
            style={adminGhost}>
            <AppText>Queue test topic</AppText>
          </Pressable>
        </View>
        {estimate ? (
          <AppText variant="caption">
            {estimate.generate} üretilecek · {estimate.reused} yeniden kullanılacak · {estimate.skipped} atlanacak
          </AppText>
        ) : null}
      </View>

      {rows.map((job) => (
        <View key={job.id} style={adminCard}>
          <AppText variant="subtitle">{topicName(job.canonical_topic_id)}</AppText>
          <AppText variant="caption" tone="muted">
            {(coverage.data ?? []).find((row) => row.id === job.exam_id)?.name ?? 'Sınav'} · {job.factory_stage ?? jobLabel(job.status)} · deneme {job.attempt_count}/{job.max_attempts} · {String(job.updated_at).slice(0, 16).replace('T', ' ')}
          </AppText>
          <StageLine job={job} />
          {questionStats[job.canonical_topic_id] ? (
            <AppText variant="caption">
              Lesson: {questionStats[job.canonical_topic_id].lesson} · Final {questionStats[job.canonical_topic_id].final_count}/10 · Pool{' '}
              {questionStats[job.canonical_topic_id].pool_count}/{questionStats[job.canonical_topic_id].pool_target} · Objectives{' '}
              {(questionStats[job.canonical_topic_id].objectives ?? []).filter((row) => row.count > 0).length}/
              {(questionStats[job.canonical_topic_id].objectives ?? []).length} covered
            </AppText>
          ) : null}
          {job.error_code ? (
            <AppText variant="caption" tone="danger">
              {job.error_code === 'TEXT_FAILED'
                ? 'Metin adımı başarısız'
                : job.error_code === 'MEDIA_FAILED'
                  ? 'Medya adımı başarısız'
                  : job.error_code === 'PEDAGOGY_INCOMPLETE'
                    ? 'Pedagoji eksik'
                    : job.error_code === 'QUESTIONS_INCOMPLETE'
                      ? 'Soru seti eksik'
                      : 'Üretim adımı başarısız'}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pressable
              onPress={() =>
                void mutations.queueOne
                  .mutateAsync({
                    canonical_topic_id: job.canonical_topic_id,
                    curriculum_version_id: job.curriculum_version_id,
                    topic_id: job.topic_id,
                    subject_id: job.subject_id,
                    unit_id: job.unit_id,
                    exam_id: job.exam_id,
                  })
                  .then(() => toastSuccess('Kuyruğa alındı'))
                  .catch(fail)
              }
              style={adminGhost}>
              <AppText variant="caption">Queue</AppText>
            </Pressable>
            <Pressable onPress={() => void mutations.retry.mutateAsync(job.id).then(() => toastSuccess('Tekrar kuyrukta')).catch(fail)} style={adminGhost}>
              <AppText variant="caption">Retry</AppText>
            </Pressable>
            <Pressable onPress={() => void mutations.cancel.mutateAsync(job.id).catch(fail)} style={adminGhost}>
              <AppText variant="caption">Cancel</AppText>
            </Pressable>
            {job.memory_lesson_id ? (
              <Pressable onPress={() => router.push(`/admin/hafiza-dersleri/${job.memory_lesson_id}` as never)} style={adminGhost}>
                <AppText variant="caption">Open Lesson</AppText>
              </Pressable>
            ) : null}
            {job.memory_lesson_id ? (
              <Pressable onPress={() => router.push(`/admin/hafiza-dersleri/${job.memory_lesson_id}` as never)} style={adminGhost}>
                <AppText variant="caption">Review</AppText>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setLogOpen(logOpen === job.id ? null : job.id)} style={adminGhost}>
              <AppText variant="caption">Detay</AppText>
            </Pressable>
          </View>
          {logOpen === job.id && Array.isArray(job.events) ? (
            <View style={{ gap: 4 }}>
              {job.events.map((event, index) => (
                <AppText key={`${job.id}-${index}`} variant="caption" tone="muted">
                  {typeof event === 'object' && event && 'code' in event
                    ? `${String((event as { code?: string }).code)} · ${String((event as { message?: string }).message ?? '')}`
                    : String(event)}
                </AppText>
              ))}
            </View>
          ) : null}
        </View>
      ))}

      <View style={adminCard}>
        <AppText variant="subtitle">AI ile Alt Konulara Böl</AppText>
        <AppText variant="caption" tone="muted">
          Öneriler kuyruğa girmez. Yalnızca onaylanan konular kanonik müfredata eklenir.
        </AppText>
        <TextInput value={breakdownName} onChangeText={setBreakdownName} style={adminField} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(unitsCanonical.data ?? []).map((row) => (
            <Pressable key={row.id} onPress={() => setBreakdownUnitId(row.id)} style={[adminChip, breakdownUnitId === row.id && adminChipOn]}>
              <AppText variant="caption">{row.name}</AppText>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() =>
            void mutations.breakdown
              .mutateAsync({ source_name: breakdownName, canonical_unit_id: breakdownUnitId })
              .then((result) => {
                setSessionId(result.session.id);
                toastSuccess('Öneriler hazır. Üretim başlamadı.');
              })
              .catch(fail)
          }
          style={adminGhost}>
          <AppText>AI ile Alt Konulara Böl</AppText>
        </Pressable>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(sessions.data ?? []).map((session) => (
            <Pressable key={session.id} onPress={() => setSessionId(session.id)} style={[adminChip, sessionId === session.id && adminChipOn]}>
              <AppText variant="caption">{session.source_name}</AppText>
            </Pressable>
          ))}
        </View>
        {(suggestions.data ?? []).map((row) => (
          <View key={row.id} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDE6D8' }}>
            <AppText>
              {row.suggested_name} · {row.status}
            </AppText>
            {row.note ? <AppText variant="caption" tone="muted">{row.note}</AppText> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Pressable
                onPress={() => void mutations.approveSuggestion.mutateAsync(row.id).then(() => toastSuccess('Kanonik konuya eklendi')).catch(fail)}
                style={adminGhost}>
                <AppText variant="caption">Onayla</AppText>
              </Pressable>
              <Pressable
                onPress={() => void mutations.updateSuggestion.mutateAsync({ id: row.id, patch: { suggested_name: breakdownName } }).catch(fail)}
                style={adminGhost}>
                <AppText variant="caption">Edit</AppText>
              </Pressable>
              <Pressable
                onPress={() => void mutations.updateSuggestion.mutateAsync({ id: row.id, patch: { status: 'rejected' } }).catch(fail)}
                style={adminGhost}>
                <AppText variant="caption">Reject</AppText>
              </Pressable>
              <Pressable
                onPress={() => {
                  const target = (suggestions.data ?? []).find((item) => item.id !== row.id && item.status === 'pending');
                  if (!target) return;
                  void mutations.updateSuggestion
                    .mutateAsync({ id: row.id, patch: { status: 'merged', merge_into_id: target.id } })
                    .catch(fail);
                }}
                style={adminGhost}>
                <AppText variant="caption">Merge</AppText>
              </Pressable>
            </View>
          </View>
        ))}
        {sessionId ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable
              onPress={() => {
                (suggestions.data ?? [])
                  .filter((row) => row.status === 'pending')
                  .forEach((row) => void mutations.approveSuggestion.mutateAsync(row.id).catch(fail));
              }}
              style={adminBtn}>
              <AppText tone="inverse">Approve All</AppText>
            </Pressable>
            <Pressable
              onPress={() =>
                void mutations.addSuggestion.mutateAsync({ sessionId, name: breakdownName }).then(() => toastSuccess('Konu eklendi')).catch(fail)
              }
              style={adminGhost}>
              <AppText>Add Topic</AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
