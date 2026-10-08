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
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

import { CheckpointCard } from './CheckpointCard';
import { SceneCanvas } from './SceneCanvas';
import { checkpointQuestions } from './playerApi';
import { logLessonStarted } from './playerApi';
import { checkpointTriggers, formatMs } from './playerUtils';
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
  const { colors, radius, spacing } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const params = useLocalSearchParams<{ lessonId?: string; examCatalogId?: string; mode?: string; queueId?: string }>();
  const lessonId = String(params.lessonId ?? '');
  const examCatalogId = params.examCatalogId ? String(params.examCatalogId) : undefined;
  const reviewMode = params.mode === 'review' || params.mode === 'tekrar';
  const pack = useMemoryLessonPlayerPackage(lessonId || undefined);
  const media = useStudentLessonMedia(lessonId || undefined, Boolean(pack.data?.lesson));
  const completeNarration = useCompleteNarration();
  const completeReview = useCompleteReview();
  const nextLesson = useNextMemoryLesson(lessonId || undefined, examCatalogId);
  const prereq = useLessonPrereqWarning(lessonId || undefined);
  const [phase, setPhase] = useState<'play' | 'done'>('play');

  const lesson = pack.data?.lesson;
  const scenes = useMemo(() => {
    const all = pack.data?.scenes ?? [];
    if (!reviewMode) return all;
    const key = all.filter((row) => row.visual_anchor || row.memory_target);
    return (key.length ? key : all).slice(0, 4);
  }, [pack.data?.scenes, reviewMode]);
  const checks = checkpointQuestions(pack.data?.questions ?? []).slice(0, reviewMode ? 3 : 8);
  const urls = media.data ?? {};
  const narrationUrl = lesson?.narration_key ? urls[lesson.narration_key] : undefined;
  const progress = pack.data?.progress;
  const answeredIds = new Set((pack.data?.answers ?? []).map((row) => row.checkpoint_question_id));
  const anchors = pack.data?.anchors ?? [];

  const finishNarration = () => {
    setPhase('done');
    AnalyticsProvider.track('lesson_completed', { lessonId, is_virtual: false });
    if (reviewMode && params.queueId) {
      void completeReview.mutateAsync(String(params.queueId)).catch(() => undefined);
    } else if (!reviewMode) {
      void completeNarration.mutateAsync(lessonId).catch(() => undefined);
    }
  };

  if (pack.isLoading) {
    return (
      <Screen>
        <AppText tone="muted">Ders yükleniyor…</AppText>
      </Screen>
    );
  }
  if (!lesson) {
    return (
      <Screen>
        <Pressable onPress={() => router.back()}>
          <AppText tone="accent">Geri</AppText>
        </Pressable>
        <AppText variant="title">Ders bulunamadı</AppText>
        <AppText tone="muted">Yalnızca yayınlanmış hafıza dersleri açılır.</AppText>
      </Screen>
    );
  }

  const checkpointCorrect = progress?.checkpoint_correct ?? pack.data?.answers.filter((row) => row.correct).length ?? 0;
  const checkpointTotal = Math.max(progress?.checkpoint_total ?? 0, checks.length);
  const canvas = (
    <PlayerBody
      lessonId={lessonId}
      lessonTitle={lesson.title}
      narrationUrl={narrationUrl}
      urls={urls}
      scenes={scenes}
      checkpoints={checks}
      durationHint={(lesson.duration_sec ?? 0) * 1000}
      resumeMs={progress?.last_position_ms ?? 0}
      reviewMode={reviewMode}
      answeredIds={answeredIds}
      phase={phase}
      onComplete={finishNarration}
      mediaError={media.isError}
      onRetryMedia={() => void media.refetch()}
      checkpointCorrect={checkpointCorrect}
      checkpointTotal={checkpointTotal}
      journey={scenes.map((row) => row.journey_step).filter(Boolean) as string[]}
      anchors={anchors.map((row) => `${row.visual_anchor} = ${row.memory_target}`)}
      examCatalogId={examCatalogId}
      canonicalTopicId={lesson.canonical_topic_id ?? undefined}
      next={nextLesson.data}
    />
  );

  return (
    <Screen scroll={phase === 'done'} style={isDesktop ? { maxWidth: 1100 } : undefined}>
      <SeoHead title={`${lesson.title} | ${APP_NAME}`} path={`/dersler/hafiza/${lessonId}`} index={false} />
      <View style={{ gap: spacing.md, paddingBottom: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="chevron-back" size={20} color={colors.accent} />
            <AppText tone="accent">Geri</AppText>
          </Pressable>
          <View style={{ flex: 1 }}>
            <AppText variant="subtitle">{lesson.title}</AppText>
            <AppText variant="caption" tone="muted">
              {lesson.subject} · {lesson.topic}
            </AppText>
          </View>
        </View>
        {prereq.data?.prereq_title ? (
          <AppText variant="caption">
            Bu konuya geçmeden önce {prereq.data.prereq_title} konusunu tamamlaman önerilir.
          </AppText>
        ) : null}
        {isDesktop ? (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, maxWidth: 920 }}>{canvas}</View>
            <View style={{ width: 240, gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <AppText variant="label">Ders Akışı</AppText>
              {scenes.map((scene) => (
                <AppText key={scene.id} variant="caption" tone="muted">
                  {scene.scene_order}. {scene.memory_target || scene.caption || 'Sahne'}
                </AppText>
              ))}
              {anchors.slice(0, 5).map((row) => (
                <AppText key={row.id} variant="caption">
                  {row.visual_anchor} → {row.memory_target}
                </AppText>
              ))}
            </View>
          </View>
        ) : (
          canvas
        )}
      </View>
    </Screen>
  );
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
}) {
  const { colors, radius } = useAppTheme();
  const player = useAudioPlayer(url);
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
  const [mediaFail, setMediaFail] = useState(false);
  const touch = useTouchLessonProgress();
  const submit = useSubmitCheckpoint();
  const profile = useAuthStore((s) => s.profile);
  const isVirtual = profile?.profile_type === 'virtual';

  const positionMs = Math.round((status.currentTime ?? 0) * 1000);
  const durationMs = Math.max(Math.round((status.duration ?? 0) * 1000), durationHint, 1);
  const playing = Boolean(status.playing);
  const current = useMemo(() => {
    const ordered = [...scenes].sort((a, b) => a.start_ms - b.start_ms);
    if (!ordered.length) return null;
    return ordered.find((scene) => positionMs >= scene.start_ms && positionMs < scene.end_ms) ?? ordered[ordered.length - 1];
  }, [positionMs, scenes]);
  const imageUrl = current?.asset_key ? urls[current.asset_key] : undefined;
  const triggers = useMemo(() => checkpointTriggers(scenes, checkpoints, durationMs), [checkpoints, durationMs, scenes]);

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
    const crossed = triggers.find(
      (row) =>
        !answered.has(row.question.id) &&
        !activeCheckpoint &&
        !reviewMode &&
        !resumePrompt &&
        prevMs.current < row.triggerMs &&
        positionMs >= row.triggerMs,
    );
    prevMs.current = positionMs;
    if (crossed) {
      player.pause();
      setActiveCheckpoint(crossed.question);
    }
  }, [activeCheckpoint, answered, player, positionMs, resumePrompt, reviewMode, triggers]);

  useEffect(() => {
    if (reviewMode || resumePrompt || activeCheckpoint) return;
    if (Date.now() - lastSaved.current < 5000) return;
    lastSaved.current = Date.now();
    void touch.mutateAsync({ lessonId, positionMs, durationMs }).catch(() => undefined);
  }, [activeCheckpoint, durationMs, lessonId, positionMs, resumePrompt, reviewMode, touch]);

  useEffect(() => {
    if (completed.current || phase === 'done' || activeCheckpoint) return;
    const ended = Boolean((status as { didJustFinish?: boolean }).didJustFinish) || (durationMs > 1500 && positionMs >= durationMs - 400 && !playing && positionMs > 1200);
    if (!ended) return;
    completed.current = true;
    onComplete();
  }, [activeCheckpoint, durationMs, onComplete, phase, playing, positionMs, status]);

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
      },
    });
  };

  if (phase === 'done') {
    return (
      <View style={{ gap: 14, backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 18 }}>
        <AppText variant="title">Dersi tamamladın 🎯</AppText>
        <AppText>{lessonTitle}</AppText>
        <AppText>
          Süre {formatMs(durationMs)} · Checkpoint {checkpointCorrect} / {checkpointTotal} doğru
        </AppText>
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
          <AppText tone="inverse">10 Soruyla Pekiştir</AppText>
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
          <Pressable onPress={() => router.replace(`/dersler/hafiza/${next.lesson_id}?examCatalogId=${examCatalogId ?? ''}` as never)}>
            <AppText tone="accent">Sonraki Derse Geç · {next.lesson_title}</AppText>
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
      <View style={{ position: 'relative' }}>
        <SceneCanvas scene={current} imageUrl={imageUrl} emphasizeAnchor={Boolean(current?.visual_anchor) && positionMs - (current?.start_ms ?? 0) < 2200} />
        {activeCheckpoint ? (
          <CheckpointCard
            question={activeCheckpoint}
            reinforcement={current?.reinforcement_note}
            submitting={submit.isPending}
            onContinue={() => {
              setActiveCheckpoint(null);
              player.play();
            }}
            onSubmit={async (answer) => {
              const result = await submit.mutateAsync({
                lessonId,
                questionId: activeCheckpoint.id,
                answer,
              });
              setAnswered((prev) => new Set(prev).add(activeCheckpoint.id));
              AnalyticsProvider.track('checkpoint_answered', { lessonId, correct: result.correct, is_virtual: isVirtual });
              return result;
            }}
          />
        ) : null}
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
