import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import {
  useBreakdownSessions,
  useBreakdownSuggestions,
  useCanonicalTopics,
  useCanonicalUnits,
  useFactoryExamCoverage,
  useFactoryHealth,
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

function engineLabel(state?: string, enabled?: boolean, stalled?: boolean) {
  if (stalled) return 'TAKILDI';
  if (state === 'running' || enabled) return 'Çalışıyor';
  if (state === 'stopping') return 'Duruyor';
  if (state === 'error') return 'Hata';
  if (state === 'paused' || !enabled) return 'Duraklatıldı';
  return state || 'Duraklatıldı';
}

function blockedLabel(code?: string | null) {
  if (!code) return null;
  const map: Record<string, string> = {
    NO_ELIGIBLE_SEGMENTS: 'Üretime hazır segment yok',
    CURRICULUM_NOT_READY: 'Müfredat hazır değil',
    DECOMPOSITION_PENDING: 'Ayrıştırma bekleniyor',
    OBJECTIVES_MISSING: 'Öğrenme hedefi eksik',
    ORDERING_PENDING: 'Sıra/önkoşul bekleniyor',
    REVIEW_REQUIRED: 'İnceleme gerekli',
    WORKER_UNAVAILABLE: 'İşçi iş alamıyor',
    SCHEDULER_NOT_RUNNING: 'Zamanlayıcı çalışmıyor',
    LOCK_STUCK: 'Kilit takılı',
    AI_CONFIG_MISSING: 'AI ayarı eksik',
    SOURCE_CONFIG_MISSING: 'Kaynak ayarı eksik',
    R2_CONFIG_MISSING: 'Depolama ayarı eksik',
    RATE_LIMITED: 'Hız limiti',
    UNKNOWN: 'Bilinmeyen engel',
  };
  return map[code] ?? code;
}

function StageLine({ job }: { job: FactoryJob }) {
  const media = job.media_total_count > 0 ? `${job.media_done_count}/${job.media_total_count}` : '';
  const mark = (done: boolean, current: boolean) => (done ? '✓' : current ? '⚙' : '○');
  return (
    <AppText variant="caption">
      {mark(job.stage_text_done, job.status === 'generating_text')} Kalıp+teknik ·{' '}
      {mark(job.stage_pedagogy_done, job.status === 'validating_pedagogy')} Pedagoji ·{' '}
      {mark(job.stage_questions_done, job.status === 'generating_questions')} Sorular ·{' '}
      {mark(job.stage_media_done, job.status === 'generating_media')} Medya{media ? ` ${media}` : ''}
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
  const [advanced, setAdvanced] = useState(false);
  const active = useActiveCurriculumVersion(examId);
  const subjects = useSubjectCatalog(examId);
  const units = useUnitCatalog(subjectId);
  const stats = useFactoryStats();
  const coverage = useFactoryExamCoverage();
  const health = useFactoryHealth();
  const settings = useFactorySettings();
  const [openExam, setOpenExam] = useState<string | null>(null);
  const jobs = useFactoryJobs();
  const topics = useCanonicalTopics();
  const unitsCanonical = useCanonicalUnits();
  const [breakdownUnitId, setBreakdownUnitId] = useState<string | null>(null);
  const mutations = useFactoryMutations();
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const [breakdownName, setBreakdownName] = useState('İslamiyet Öncesi Türk Tarihi');
  const [poolTarget, setPoolTarget] = useState('20');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessions = useBreakdownSessions();
  const suggestions = useBreakdownSuggestions(sessionId);
  const enabled = Boolean(settings.data?.production_enabled) || settings.data?.engine_state === 'running';
  const examCards = coverage.data?.length ? coverage.data : (exams.data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    sort_order: row.sort_order,
    is_enabled: true,
          curriculum_name: null as string | null,
          curriculum_status: null as string | null,
          subjects: 0,
          segments: 0,
          topics: 0,
    lessons_ready: 0,
    questions_ready: 0,
    failed: 0,
    pending_review: 0,
    by_subject: [] as { name: string; master: number; segs: number; ready: number; lessons: number }[],
  }));

  useEffect(() => {
    if (settings.data?.question_pool_target != null) setPoolTarget(String(settings.data.question_pool_target));
  }, [settings.data?.question_pool_target]);

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

  const current = (jobs.data ?? []).find((row) =>
    ['generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media'].includes(row.status),
  );
  const upcoming = (jobs.data ?? []).filter((row) => row.status === 'queued').slice(0, 8);

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const startMotor = (confirm: boolean) => {
    void mutations.startMotor
      .mutateAsync(confirm)
      .then((result) => {
        if (result.needs_confirm) {
          const lines = (result.exams ?? [])
            .map((row) => `${row.exam}: ${row.note ?? row.lesson_estimate ?? row.next_stage ?? 'denetlenecek'}`)
            .join('\n');
          const skip = (result.skips ?? []).map((row) => `${row.exam}: ${row.reason}`).join('\n');
          askConfirm({
            title: 'Motoru başlat?',
            subtitle: `Kapsam: ${result.scope_mode ?? 'single_topic'} · ${result.scope_exam_code ?? 'TYT'} / ${result.scope_subject_name ?? 'Türkçe'} · tavan ${result.factory_run_job_cap ?? 1} iş.\nTam kapsam kapalı.\n${lines || 'Sınav denetimi hazır.'}${skip ? `\nAtlandı:\n${skip}` : ''}`,
            confirmLabel: 'Motoru Başlat',
            onConfirm: () => startMotor(true),
          });
          return;
        }
        toastSuccess('Motor çalışıyor. Üretim sunucuda devam eder; sekme kapatılabilir.');
        void mutations.wake.mutateAsync().catch(() => undefined);
      })
      .catch(fail);
  };

  const statNum = (value: number | string | undefined) => {
    if (stats.isLoading || coverage.isLoading) return '…';
    if (value === '—' || value == null) return '0';
    return value;
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <View style={{ gap: 4 }}>
          <AppText variant="title">ÖSYM Koçu İçerik Motoru</AppText>
          <AppText tone="muted">
            Kilit master müfredattan üretir; sınav konularını web’den icat etmez. Yayın otomatik değil.
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={() => startMotor(false)} style={adminBtn}>
            <AppText tone="inverse">MOTORU BAŞLAT</AppText>
          </Pressable>
          <Pressable
            onPress={() =>
              void mutations.pauseMotor
                .mutateAsync()
                .then((row) => toastSuccess(row.engine_state === 'stopping' ? 'Yeni iş durdu. Mevcut iş bitsin.' : 'Motor duraklatıldı.'))
                .catch(fail)
            }
            style={adminGhost}>
            <AppText>MOTORU DURAKLAT</AppText>
          </Pressable>
        </View>
      </View>

      <AppText variant="caption" tone={health.data?.stalled ? 'muted' : enabled ? 'accent' : 'muted'}>
        {engineLabel(settings.data?.engine_state, enabled, health.data?.stalled)}
        {' · '}tavan {settings.data?.factory_run_job_cap ?? 1} iş · {settings.data?.scope_mode ?? 'single_topic'} · {settings.data?.scope_exam_code ?? 'TYT'}/{settings.data?.scope_subject_name ?? 'Türkçe'} · eşzamanlı {settings.data?.max_concurrency ?? 1} · havuz {settings.data?.question_pool_target ?? 20} · metin{' '}
        {settings.data?.text_workers ?? 2} · görsel {settings.data?.image_workers ?? 1} · TTS {settings.data?.tts_workers ?? 1}
      </AppText>

      <View style={adminCard}>
        <AppText variant="label">Motor Sağlığı</AppText>
        <AppText>
          Engine: {engineLabel(settings.data?.engine_state, enabled, health.data?.stalled)}
        </AppText>
        <AppText variant="caption">
          Zamanlayıcı: {health.data?.scheduler === 'healthy' ? 'Sağlıklı' : health.data?.scheduler === 'idle' ? 'Boşta' : 'Hata / bilinmiyor'}
        </AppText>
        <AppText variant="caption">
          Workers: {health.data?.active_jobs ?? 0} / {health.data?.max_concurrency ?? settings.data?.max_concurrency ?? 2} ·
          Kuyruk: {health.data?.queued_jobs ?? 0} · Pipeline: {health.data?.pipeline ?? 0}
        </AppText>
        <AppText variant="caption">
          Son orkestrasyon: {settings.data?.last_orchestrated_at ? new Date(settings.data.last_orchestrated_at).toLocaleString('tr-TR') : 'yok'}
        </AppText>
        <AppText variant="caption">
          Son AI: {health.data?.last_ai_call_at ? new Date(health.data.last_ai_call_at).toLocaleString('tr-TR') : 'yok'}
        </AppText>
        {health.data?.stalled ? (
          <AppText>Motor çalışıyor görünüyor ancak ilerleme yok.</AppText>
        ) : null}
        {blockedLabel(health.data?.blocked_reason ?? settings.data?.factory_blocked_reason) ? (
          <AppText>
            Engel: {blockedLabel(health.data?.blocked_reason ?? settings.data?.factory_blocked_reason)}
            {health.data?.blocked_detail ? ` — ${health.data.blocked_detail}` : ''}
          </AppText>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {[
          ['Ders Alanları', (coverage.data ?? []).reduce((sum, row) => sum + Number(row.subjects ?? 0), 0)],
          ['Master Konular', (coverage.data ?? []).reduce((sum, row) => sum + Number(row.topics ?? 0), 0)],
          ['Öğrenme Segmentleri', (coverage.data ?? []).reduce((sum, row) => sum + Number(row.segments ?? 0), 0)],
          ['Hafıza Dersleri', stats.data?.ready ?? 0],
          ['Soru Havuzu', (coverage.data ?? []).reduce((sum, row) => sum + Number(row.questions_ready ?? 0), 0)],
          ['Kontrol Bekleyen', stats.data?.pending_validation ?? 0],
        ].map(([label, value]) => (
          <View key={String(label)} style={[adminCard, { minWidth: compact ? '46%' : 140, flexGrow: 1 }]}>
            <AppText variant="caption" tone="muted">
              {label}
            </AppText>
            <AppText variant="title">{statNum(value as number)}</AppText>
            <AppText variant="caption" tone="muted">
              {label === 'Master Konular'
                ? 'Geniş müfredat başlığı'
                : label === 'Öğrenme Segmentleri'
                  ? '5–10 dk öğretilebilir blok'
                  : label === 'Hafıza Dersleri'
                    ? 'Öğrenciye giden üretilmiş ders'
                    : label === 'Ders Alanları'
                      ? 'Sınavdaki dersler (Türkçe, Tarih…)'
                      : ''}
            </AppText>
          </View>
        ))}
      </View>

      <View style={adminCard}>
        <AppText variant="label">Sınavlar</AppText>
        {examCards.map((row) => (
          <View key={row.id} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDE6D8' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Pressable
                onPress={() => void mutations.setExamEnabled.mutateAsync({ examId: row.id, enabled: !row.is_enabled }).catch(fail)}
                style={[adminChip, row.is_enabled && adminChipOn]}>
                <AppText>
                  {row.is_enabled ? '✓' : '○'} {row.name}
                </AppText>
              </Pressable>
            </View>
            <AppText variant="caption" tone="muted">
              {row.subjects ?? 0} ders alanı · {row.topics ?? 0} master konu · {row.segments ?? 0} öğrenme segmenti ·{' '}
              {row.lessons_ready ?? 0} hafıza dersi · {row.questions_ready ?? 0} soru
              {String(row.code ?? '').startsWith('KPSS')
                ? ' · KPSS kademeleri aynı kanonik içeriği eşler (üç kopya üretilmez).'
                : ''}
            </AppText>
            <Pressable onPress={() => setOpenExam((cur) => (cur === row.id ? null : row.id))}>
              <AppText tone="accent">{openExam === row.id ? 'Dersleri gizle' : 'Dersleri aç'}</AppText>
            </Pressable>
            {openExam === row.id
              ? (row.by_subject ?? []).map((sub: { name: string; master: number; segs: number; ready: number; lessons: number }) => (
                  <AppText key={sub.name} variant="caption">
                    {sub.name}: master {sub.master} · segment {sub.segs} · hazır {sub.ready} · ders {sub.lessons}
                  </AppText>
                ))
              : null}
          </View>
        ))}
      </View>

      <View style={adminCard}>
        <AppText variant="label">Şu anda</AppText>
        {current ? (
          <>
            <AppText variant="subtitle">{topicName(current.canonical_topic_id)}</AppText>
            <AppText variant="caption" tone="muted">
              {(coverage.data ?? []).find((row) => row.id === current.exam_id)?.name ?? 'Sınav'} · {jobLabel(current.status)}
              {current.media_total_count ? ` · Sahne ${current.media_done_count}/${current.media_total_count}` : ''}
            </AppText>
            <StageLine job={current} />
          </>
        ) : (
          <AppText>
            {health.data?.activity ||
              settings.data?.current_activity ||
              (enabled ? 'Motor durdu: kuyruk boş, neden sağlık kartında.' : 'Motor duraklatıldı.')}
          </AppText>
        )}
      </View>

      {upcoming.length ? (
        <View style={adminCard}>
          <AppText variant="label">Sıradaki işler</AppText>
          {upcoming.map((job, index) => (
            <AppText key={job.id} variant="caption">
              {index + 1}. {(coverage.data ?? []).find((row) => row.id === job.exam_id)?.name ?? 'Sınav'} → {topicName(job.canonical_topic_id)}
            </AppText>
          ))}
        </View>
      ) : null}

      <Pressable onPress={() => setAdvanced((value) => !value)} style={adminGhost}>
        <AppText>Gelişmiş / Manuel Araçlar {advanced ? '▾' : '▸'}</AppText>
      </Pressable>

      {advanced ? (
        <>
          <View style={adminCard}>
            <AppText variant="caption" tone="muted">
              Normal üretim için bu butonlar gerekmez. Yalnızca tanı/override.
            </AppText>
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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(exams.data ?? []).map((row) => (
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
            ) : null}
            {subjectId ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(units.data ?? []).map((row) => (
                  <Pressable key={row.id} onPress={() => setUnitId(row.id)} style={[adminChip, unitId === row.id && adminChipOn]}>
                    <AppText>{row.name}</AppText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[null, 'queued', 'generating_media', 'pending_validation', 'failed', 'completed'].map((item) => (
                <Pressable key={item ?? 'all'} onPress={() => setStatusFilter(item)} style={[adminChip, statusFilter === item && adminChipOn]}>
                  <AppText>{item ? jobLabel(item) : 'Tümü'}</AppText>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable
                onPress={() =>
                  void mutations.queue
                    .mutateAsync({
                      examId,
                      versionId: active.data?.id ?? null,
                      subjectId,
                      unitId,
                      enqueue: true,
                      confirm: true,
                    })
                    .then((result) => toastSuccess(`${result.queued} iş kuyruğa alındı`))
                    .catch(fail)
                }
                style={adminGhost}>
                <AppText>Eksik İçerikleri Kuyruğa Al</AppText>
              </Pressable>
              <Pressable
                onPress={() => void mutations.retryFailed.mutateAsync(active.data?.id ?? null).then(() => toastSuccess('Başarısızlar kuyruğa alındı')).catch(fail)}
                style={adminGhost}>
                <AppText>Başarısızları tekrar dene</AppText>
              </Pressable>
              <Pressable
                onPress={() =>
                  void mutations.queueTest
                    .mutateAsync()
                    .then((result) => toastSuccess(result.action === 'queued' ? 'Test konu kuyrukta' : 'Test konu zaten hazır'))
                    .catch(fail)
                }
                style={adminGhost}>
                <AppText>Queue test topic</AppText>
              </Pressable>
            </View>
          </View>

          <View style={adminCard}>
            <AppText variant="subtitle">AI ile Alt Konulara Böl</AppText>
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
            {(sessions.data ?? []).map((session) => (
              <Pressable key={session.id} onPress={() => setSessionId(session.id)} style={[adminChip, sessionId === session.id && adminChipOn]}>
                <AppText variant="caption">{session.source_name}</AppText>
              </Pressable>
            ))}
            {(suggestions.data ?? []).map((row) => (
              <View key={row.id} style={{ gap: 6, paddingVertical: 8 }}>
                <AppText>
                  {row.suggested_name} · {row.status}
                </AppText>
                <Pressable onPress={() => void mutations.approveSuggestion.mutateAsync(row.id).then(() => toastSuccess('Eklendi')).catch(fail)}>
                  <AppText tone="accent">Onayla</AppText>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {rows.slice(0, 40).map((job) => (
        <View key={job.id} style={adminCard}>
          <AppText variant="subtitle">{topicName(job.canonical_topic_id)}</AppText>
          <AppText variant="caption" tone="muted">
            {(coverage.data ?? []).find((row) => row.id === job.exam_id)?.name ?? 'Sınav'} · {jobLabel(job.status)}
          </AppText>
          <StageLine job={job} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {job.memory_lesson_id ? (
              <Pressable onPress={() => router.push(`/admin/hafiza-dersleri/${job.memory_lesson_id}` as never)} style={adminGhost}>
                <AppText variant="caption">Ders</AppText>
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
    </View>
  );
}
