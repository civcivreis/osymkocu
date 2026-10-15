import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { CheckpointCard } from '@/src/features/memory-lessons/CheckpointCard';
import { SceneCanvas } from '@/src/features/memory-lessons/SceneCanvas';
import { checkpointTriggers, formatMs } from '@/src/features/memory-lessons/playerUtils';
import type { MemoryLesson, MemoryLessonQuestion, MemoryLessonScene } from '@/src/features/memory-lessons/types';

type HtmlAudio = {
  play: () => Promise<void>;
  pause: () => void;
  currentTime: number;
  duration: number;
  src: string;
  addEventListener: (name: string, fn: () => void) => void;
  removeEventListener: (name: string, fn: () => void) => void;
};

export function AdminLessonPreviewPlayer({
  lesson,
  scenes,
  questions = [],
  urls,
}: {
  lesson: MemoryLesson;
  scenes: MemoryLessonScene[];
  questions?: MemoryLessonQuestion[];
  urls: Record<string, string>;
}) {
  const narrationUrl = lesson.narration_key ? urls[lesson.narration_key] : undefined;
  const audioRef = useRef<HtmlAudio | null>(null);
  const barWidth = useRef(1);
  const prevMs = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(Math.max((lesson.duration_sec ?? 0) * 1000, 1));
  const [activeCheckpoint, setActiveCheckpoint] = useState<MemoryLessonQuestion | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!narrationUrl || typeof Audio === 'undefined') return;
    const el = new Audio(narrationUrl) as unknown as HtmlAudio;
    audioRef.current = el;
    const onTime = () => setPositionMs(Math.round(el.currentTime * 1000));
    const onDur = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDurationMs(Math.round(el.duration * 1000));
    };
    const onEnd = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('ended', onEnd);
    return () => {
      el.pause();
      el.src = '';
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('ended', onEnd);
      audioRef.current = null;
    };
  }, [narrationUrl]);

  const current = useMemo(() => {
    const ordered = [...scenes].sort((a, b) => a.start_ms - b.start_ms);
    if (ordered.length === 0) return null;
    return (
      ordered.find((scene) => positionMs >= scene.start_ms && positionMs < scene.end_ms) ??
      ordered[ordered.length - 1]
    );
  }, [positionMs, scenes]);

  const triggers = useMemo(
    () => checkpointTriggers(scenes, questions, durationMs),
    [durationMs, questions, scenes],
  );

  useEffect(() => {
    const crossed = triggers.find(
      (row) =>
        !answered.has(row.question.id) &&
        !activeCheckpoint &&
        prevMs.current < row.triggerMs &&
        positionMs >= row.triggerMs,
    );
    prevMs.current = positionMs;
    if (!crossed) return;
    audioRef.current?.pause();
    setPlaying(false);
    setActiveCheckpoint(crossed.question);
  }, [activeCheckpoint, answered, positionMs, triggers]);

  const imageUrl = current?.asset_key ? urls[current.asset_key] : undefined;
  const progress = Math.min(1, positionMs / Math.max(durationMs, 1));
  const nextGate = triggers.find((row) => !answered.has(row.question.id));

  const toggle = () => {
    const el = audioRef.current;
    if (!el || activeCheckpoint) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const seek = (ratio: number) => {
    if (activeCheckpoint) return;
    const el = audioRef.current;
    const next = Math.max(0, Math.min(1, ratio)) * durationMs;
    setPositionMs(next);
    prevMs.current = next;
    if (el) el.currentTime = next / 1000;
  };

  if (!narrationUrl) {
    return <AppText tone="muted">Seslendirme henüz yok. Medya üret.</AppText>;
  }

  return (
    <View style={{ gap: 12, backgroundColor: '#FFFcf7', borderRadius: 16, padding: 14 }}>
      <View style={{ position: 'relative' }}>
        <SceneCanvas scene={current} imageUrl={imageUrl} positionMs={positionMs} />
        {activeCheckpoint ? (
          <CheckpointCard
            question={activeCheckpoint}
            reinforcement={current?.reinforcement_note}
            onSubmit={async (answer) => {
              const correct = String(activeCheckpoint.correct_answer ?? '').toUpperCase() === String(answer).toUpperCase();
              return {
                correct,
                correct_answer: String(activeCheckpoint.correct_answer ?? 'A'),
                explanation: activeCheckpoint.explanation,
              };
            }}
            onContinue={() => {
              setAnswered((prev) => new Set(prev).add(activeCheckpoint.id));
              setActiveCheckpoint(null);
              void audioRef.current?.play().then(() => setPlaying(true)).catch(() => undefined);
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
        <View style={{ height: 8, width: `${progress * 100}%`, borderRadius: 8, backgroundColor: '#C45C26' }} />
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="caption">{formatMs(positionMs)}</AppText>
        <AppText variant="caption">{formatMs(durationMs)}</AppText>
      </View>
      <Pressable
        onPress={toggle}
        style={{
          minHeight: 44,
          borderRadius: 12,
          backgroundColor: '#C45C26',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <AppText tone="inverse">{playing ? 'Duraklat' : 'Oynat'}</AppText>
      </Pressable>
      <AppText variant="caption" tone="muted">
        Sahne {current?.scene_order ?? '—'} · kanca videonun üstünde ·{' '}
        {nextGate
          ? `Sonraki soru ${formatMs(nextGate.triggerMs)}`
          : questions.some((row) => row.question_type === 'checkpoint')
            ? 'Kontrol soruları geçildi'
            : 'Bu derste checkpoint yok'}
      </AppText>
    </View>
  );
}
