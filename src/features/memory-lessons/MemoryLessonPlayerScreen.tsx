import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useOrientation } from '@/src/lib/layout/useOrientation';
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

import { actGuided, fetchLessonTimeline, recordGuidedAttempt } from '@/src/features/guided-study/api';
import { CheckpointCard } from './CheckpointCard';
import { HapLessonScreen } from './HapLessonScreen';
import { SceneCanvas } from './SceneCanvas';
import { checkpointQuestions } from './playerApi';
import { logLessonStarted } from './playerApi';
import { checkpointTriggers, formatMs, speakCoachLine } from './playerUtils';
import {
  useCompleteNarration,
  useCompleteReview,
  useLessonPrereqWarning,
  useMemoryLessonPlayerPackage,
  useNextMemoryLesson,
  useStudentLessonMedia,
  useSubmitCheckpoint,
  useTouchLessonProgress,
} from './useMemoryLessonPlayer';
import type { MemoryLessonQuestion, MemoryLessonScene } from './types';

const RATES = [0.8, 1, 1.25, 1.5] as const;

export function MemoryLessonPlayerScreen() {
  const params = useLocalSearchParams<{ lessonId?: string; examCatalogId?: string }>();
  const lessonId = String(params.lessonId ?? '');
  const examCatalogId = params.examCatalogId ? String(params.examCatalogId) : undefined;
  return <HapLessonScreen lessonId={lessonId} examCatalogId={examCatalogId} />;
}

function PlayerBody(props: {
  lessonId: string;
  lessonTitle: string;
  narrationUrl?: string;
  urls: Record<string, string>;
  scenes: MemoryLessonScene[];
  checkpoints: MemoryLessonQuestion[];
  durationHint: number;
  resumeMs: number;
  reviewMode: boolean;
  answeredIds: Set<string>;
  phase: 'play' | 'done';
  onComplete: () => void;
  mediaError: boolean;
  onRetryMedia: () => void;
  checkpointCorrect: number;
  checkpointTotal: number;
  journey: string[];
  anchors: string[];
  examCatalogId?: string;
  canonicalTopicId?: string;
  next?: { lesson_id: string; lesson_title: string } | null;
  fastRule?: string | null;
  examTechnique?: Record<string, unknown> | null;
  memoryHooks?: string[];
  sessionId?: string;
}) {
  const { colors, radius } = useAppTheme();
  if (!props.narrationUrl) {
    return (
      <View style={{ gap: 12 }}>
        {props.mediaError ? (
          <>
            <AppText>Medya şu anda açılamadı. İlerleme silinmedi.</AppText>
            <Pressable onPress={props.onRetryMedia} style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.accent }}>
              <AppText tone="inverse">Tekrar dene</AppText>
            </Pressable>
          </>
        ) : (
          <AppText tone="muted">Seslendirme henüz yok. Yayınlanmış içerik bekleniyor.</AppText>
        )}
      </View>
    );
  }
  return <AudioSession url={props.narrationUrl} {...props} />;
}

function AudioSession({
  url,
  urls,
  lessonId,
  scenes,
  checkpoints,
  durationHint,
  resumeMs,
  reviewMode,
  answeredIds,
  phase,
  onComplete,
  checkpointCorrect,
  checkpointTotal,
  journey,
  anchors,
  examCatalogId,
  canonicalTopicId,
  next,
  lessonTitle,
  fastRule,
  examTechnique,
  memoryHooks,
  sessionId,
}: {
  url: string;
  urls: Record<string, string>;
  lessonId: string;
  scenes: MemoryLessonScene[];
  checkpoints: MemoryLessonQuestion[];
  durationHint: number;
  resumeMs: number;
  reviewMode: boolean;
  answeredIds: Set<string>;
  phase: 'play' | 'done';
  onComplete: () => void;
  checkpointCorrect: number;
  checkpointTotal: number;
  journey: string[];
  anchors: string[];
  examCatalogId?: string;
  canonicalTopicId?: string;
  next?: { lesson_id: string; lesson_title: string } | null;
  lessonTitle: string;
  fastRule?: string | null;
  examTechnique?: Record<string, unknown> | null;
  memoryHooks?: string[];
  sessionId?: string;
}) {
  const { colors, radius } = useAppTheme();
  const { landscape } = useOrientation();
  const player = useAudioPlayer(url);
  const [introLine, setIntroLine] = useState<string | null>(null);
  const introLock = useRef(false);
  const status = useAudioPlayerStatus(player);
  const barWidth = useRef(1);
  const lastSaved = useRef(0);
  const started = useRef(false);
  const completed = useRef(false);
  const prevMs = useRef(0);
  const [rate, setRate] = useState(1);
  const [resumePrompt, setResumePrompt] = useState(resumeMs > 4000 && !reviewMode);
  const [activeCheckpoint, setActiveCheckpoint] = useState<MemoryLessonQuestion | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(answeredIds);
  const [gateKey, setGateKey] = useState(0);
  const [mediaFail, setMediaFail] = useState(false);
  const touch = useTouchLessonProgress();
  const submit = useSubmitCheckpoint();
  const profile = useAuthStore((s) => s.profile);
  const isVirtual = profile?.profile_type === 'virtual';

  const positionMs = Math.round((status.currentTime ?? 0) * 1000);
  const posRef = useRef(positionMs);
  posRef.current = positionMs;
  const durationMs = Math.max(Math.round((status.duration ?? 0) * 1000), durationHint, 1);
  const playing = Boolean(status.playing);
  const current = useMemo(() => {
    const ordered = [...scenes].sort((a, b) => a.start_ms - b.start_ms);
    if (!ordered.length) return null;
    return ordered.find((scene) => positionMs >= scene.start_ms && positionMs < scene.end_ms) ?? ordered[ordered.length - 1];
  }, [positionMs, scenes]);
  const imageUrl = current?.asset_key ? urls[current.asset_key] : undefined;
  const triggers = useMemo(
    () => checkpointTriggers(scenes, checkpoints, durationMs),
    [checkpoints, durationMs, scenes],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void logLessonStarted(lessonId);
    AnalyticsProvider.track('lesson_started', { lessonId, is_virtual: isVirtual });
  }, [isVirtual, lessonId]);

  useEffect(() => {
    player.playbackRate = rate;
  }, [player, rate]);

  useEffect(() => {
    void fetchLessonTimeline(lessonId).catch(() => undefined);
  }, [lessonId]);

  useEffect(() => {
    return () => {
      if (!sessionId) return;
      void actGuided(sessionId, 'save_resume', {
        audio_ms: posRef.current,
        status: 'paused',
        lesson_id: lessonId,
      }).catch(() => undefined);
    };
  }, [lessonId, sessionId]);

  useEffect(() => {
    const crossed = triggers.find(
      (row) =>
        !answered.has(row.question.id) &&
        !activeCheckpoint &&
        !introLine &&
        !introLock.current &&
        !resumePrompt &&
        prevMs.current < row.triggerMs &&
        positionMs >= row.triggerMs,
    );
    prevMs.current = positionMs;
    if (!crossed) return;
    introLock.current = true;
    player.pause();
    setIntroLine(crossed.intro);
    void speakCoachLine(crossed.intro).then(() => {
      setTimeout(() => {
        setIntroLine(null);
        setGateKey((n) => n + 1);
        setActiveCheckpoint(crossed.question);
        introLock.current = false;
      }, 400);
    });
  }, [activeCheckpoint, answered, introLine, player, positionMs, resumePrompt, reviewMode, triggers]);

  useEffect(() => {
    if (reviewMode || resumePrompt || activeCheckpoint || introLine) return;
    if (Date.now() - lastSaved.current < 5000) return;
    lastSaved.current = Date.now();
    void touch.mutateAsync({ lessonId, positionMs, durationMs }).catch(() => undefined);
  }, [activeCheckpoint, durationMs, lessonId, positionMs, resumePrompt, reviewMode, touch]);

  useEffect(() => {
    if (completed.current || phase === 'done' || activeCheckpoint || introLine) return;
    const ended = Boolean((status as { didJustFinish?: boolean }).didJustFinish) || (durationMs > 1500 && positionMs >= durationMs - 400 && !playing && positionMs > 1200);
    if (!ended) return;
    completed.current = true;
    onComplete();
  }, [activeCheckpoint, durationMs, introLine, onComplete, phase, player, playing, positionMs, status]);

  const seek = (ratio: number) => {
    if (activeCheckpoint) return;
    const nextPos = Math.max(0, Math.min(1, ratio)) * durationMs;
    void player.seekTo(nextPos / 1000);
  };

  const openFinal = () => {
    AnalyticsProvider.track('final_test_started', { lessonId, is_virtual: isVirtual });
    router.push({
      pathname: '/practice',
      params: {
        examCatalogId: examCatalogId ?? '',
        canonicalTopicId: canonicalTopicId ?? '',
        lessonId,
        setType: 'lesson_final',
        count: '10',
        sessionId: sessionId ?? '',
      },
    });
  };

  if (phase === 'done') {
    return (
      <View style={{ gap: 14, backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 18 }}>
        <AppText variant="title">Hızlıca pekiştirelim.</AppText>
        <AppText>{lessonTitle}</AppText>
        <AppText variant="caption" tone="muted">İlerlemen kaydedildi.</AppText>
        {fastRule ? (
          <AppText>
            5 sn kural: {fastRule}
          </AppText>
        ) : null}
          <AppText>
          Süre {formatMs(durationMs)} · Checkpoint {checkpointCorrect} / {checkpointTotal} doğru
        </AppText>
        {checkpointCorrect < checkpointTotal ? (
          <AppText variant="caption" tone="muted">
            Kaçırdığın ara sorular 2 saat sonra tekrar kuyruğuna düşer.
          </AppText>
        ) : null}
        {journey.length ? (
          <View style={{ gap: 4 }}>
            <AppText variant="label">Bugünkü Hafıza Yolculuğun</AppText>
            {journey.map((step) => (
              <AppText key={step} variant="caption">
                {step}
              </AppText>
            ))}
          </View>
        ) : null}
        {anchors.length ? (
          <View style={{ gap: 4 }}>
            <AppText variant="label">Hafıza kancaları</AppText>
            {anchors.slice(0, 4).map((row) => (
              <AppText key={row} variant="caption">
                {row}
              </AppText>
            ))}
          </View>
        ) : null}
        <Pressable onPress={openFinal} style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <AppText tone="inverse">Hızlıca pekiştirelim · 10 soru</AppText>
        </Pressable>
        <Pressable
          onPress={() =>
            router.push({
              pathname: `/dersler/hafiza/${lessonId}`,
              params: { mode: 'review', examCatalogId: examCatalogId ?? '' },
            } as never)
          }
          style={{ minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <AppText>2 Dakikalık Tekrar</AppText>
        </Pressable>
        <Pressable onPress={() => router.replace('/dersler/hafiza' as never)}>
          <AppText tone="accent">Sonra Yap</AppText>
        </Pressable>
        {next?.lesson_id ? (
          <Pressable onPress={() => router.replace((sessionId ? '/koc' : `/dersler/hafiza/${next.lesson_id}?examCatalogId=${examCatalogId ?? ''}`) as never)}>
            <AppText tone="accent">Sıradaki derse geçiyoruz · {next.lesson_title}</AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {mediaFail ? (
        <View style={{ gap: 8 }}>
          <AppText>Medya şu anda açılamadı. İlerleme silinmedi.</AppText>
          <Pressable onPress={() => { setMediaFail(false); player.play(); }}>
            <AppText tone="accent">Tekrar dene</AppText>
          </Pressable>
        </View>
      ) : null}
      {resumePrompt ? (
        <View style={{ gap: 8, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <AppText>{formatMs(resumeMs)} konumundan devam et</AppText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => {
                setResumePrompt(false);
                void player.seekTo(resumeMs / 1000).then(() => player.play()).catch(() => setMediaFail(true));
              }}
              style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.accent }}>
              <AppText tone="inverse">Devam et</AppText>
            </Pressable>
            <Pressable onPress={() => { setResumePrompt(false); player.play(); }} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
              <AppText>Baştan</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
      {reviewMode ? (
        <View style={{ gap: 6, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <AppText variant="label">2 Dakikalık Tekrar</AppText>
          <AppText variant="caption" tone="muted">
            Soru tipi: {String(examTechnique?.recognition_trigger ?? '—')}
          </AppText>
          <AppText>İlk hamle: {String(examTechnique?.first_move ?? '—')}</AppText>
          <AppText>Hızlı kural: {fastRule || String(examTechnique?.fast_strategy ?? '—')}</AppText>
          <AppText variant="caption">Tuzak: {String(examTechnique?.common_traps ?? '—')}</AppText>
          {memoryHooks?.[0] ? <AppText variant="caption">Kanca: {memoryHooks[0]}</AppText> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: landscape ? 'row' : 'column', gap: 12, alignItems: 'stretch' }}>
        <View style={{ flex: landscape ? 7 : undefined, minWidth: 0, position: 'relative' }}>
          <SceneCanvas scene={current} imageUrl={imageUrl} positionMs={positionMs} />
          {introLine ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 16,
                zIndex: 9,
                borderRadius: 16,
                backgroundColor: 'rgba(15,28,46,0.94)',
                padding: 14,
                gap: 6,
              }}>
              <AppText variant="caption" style={{ color: '#E07A3D', fontWeight: '800' }}>
                KOÇ
              </AppText>
              <AppText style={{ color: '#FFFFFF', fontWeight: '700' }}>{introLine}</AppText>
            </View>
          ) : null}
        </View>
        <View style={{ flex: landscape ? 3 : undefined, minWidth: landscape ? 240 : undefined, gap: 10 }}>
          {landscape && current?.narration_text ? (
            <View style={{ padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <AppText variant="label">Metin</AppText>
              <AppText variant="caption">{current.narration_text}</AppText>
            </View>
          ) : null}
          {activeCheckpoint ? (
            <CheckpointCard
              key={`${activeCheckpoint.id}-${gateKey}`}
              question={activeCheckpoint}
              reinforcement={current?.reinforcement_note}
              submitting={submit.isPending}
              onContinue={(resolved) => {
                setAnswered((prev) => new Set(prev).add(activeCheckpoint.id));
                if (!resolved && sessionId) {
                  void actGuided(sessionId, 'needs_review', { lesson_id: lessonId, question_id: activeCheckpoint.id }).catch(() => undefined);
                }
                setActiveCheckpoint(null);
                player.play();
              }}
              onSubmit={async (answer) => {
                const result = await submit.mutateAsync({
                  lessonId,
                  questionId: activeCheckpoint.id,
                  answer,
                });
                AnalyticsProvider.track('checkpoint_answered', { lessonId, correct: result.correct, is_virtual: isVirtual });
                if (sessionId) {
                  void recordGuidedAttempt({
                    sessionId,
                    selected: answer,
                    correctAnswer: result.correct_answer,
                    isCorrect: result.correct,
                    memoryQuestionId: activeCheckpoint.id,
                    lessonId,
                    pattern: String(activeCheckpoint.question_strategy ?? 'checkpoint'),
                  }).catch(() => undefined);
                  const nextAnswered = result.correct ? new Set(answered).add(activeCheckpoint.id) : answered;
                  if (result.correct && checkpoints.length > 0 && nextAnswered.size >= checkpoints.length) {
                    void actGuided(sessionId, 'checkpoint_set_done', { lesson_id: lessonId }).catch(() => undefined);
                  }
                }
                return result;
              }}
            />
          ) : null}
        </View>
      </View>
      <Pressable
        onLayout={(event) => {
          barWidth.current = Math.max(event.nativeEvent.layout.width, 1);
        }}
        onPress={(event) => seek(event.nativeEvent.locationX / barWidth.current)}
        accessibilityRole="adjustable"
        accessibilityLabel="İlerleme"
        style={{ height: 16, borderRadius: 8, backgroundColor: '#E4DDD0', justifyContent: 'center' }}>
        <View style={{ height: 8, width: `${Math.min(100, (positionMs / durationMs) * 100)}%`, borderRadius: 8, backgroundColor: colors.accent }} />
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="caption">{formatMs(positionMs)}</AppText>
        <AppText variant="caption">{formatMs(durationMs)}</AppText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Pressable
          onPress={() => {
            if (activeCheckpoint || resumePrompt) return;
            if (playing) player.pause();
            else player.play();
          }}
          style={{ minHeight: 44, minWidth: 120, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
          <AppText tone="inverse">{playing ? 'Duraklat' : 'Oynat'}</AppText>
        </Pressable>
        {RATES.map((value) => (
          <Pressable
            key={value}
            onPress={() => setRate(value)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: rate === value ? '#F3E0D4' : colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <AppText variant="caption">{value}x</AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
