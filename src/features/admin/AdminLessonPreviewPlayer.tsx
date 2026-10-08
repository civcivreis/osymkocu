import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import type { MemoryLesson, MemoryLessonScene } from '@/src/features/memory-lessons/types';

type HtmlAudio = {
  play: () => Promise<void>;
  pause: () => void;
  currentTime: number;
  duration: number;
  src: string;
  addEventListener: (name: string, fn: () => void) => void;
  removeEventListener: (name: string, fn: () => void) => void;
};

function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AdminLessonPreviewPlayer({
  lesson,
  scenes,
  urls,
}: {
  lesson: MemoryLesson;
  scenes: MemoryLessonScene[];
  urls: Record<string, string>;
}) {
  const narrationUrl = lesson.narration_key ? urls[lesson.narration_key] : undefined;
  const audioRef = useRef<HtmlAudio | null>(null);
  const barWidth = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(Math.max((lesson.duration_sec ?? 0) * 1000, 1));

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

  const imageUrl = current?.asset_key ? urls[current.asset_key] : undefined;
  const progress = Math.min(1, positionMs / durationMs);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const seek = (ratio: number) => {
    const el = audioRef.current;
    const next = Math.max(0, Math.min(1, ratio)) * durationMs;
    setPositionMs(next);
    if (el) el.currentTime = next / 1000;
  };

  if (!narrationUrl) {
    return <AppText tone="muted">Seslendirme henüz yok. Medya üret.</AppText>;
  }

  return (
    <View style={{ gap: 12, backgroundColor: '#FFFcf7', borderRadius: 16, padding: 14 }}>
      <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#E8E3D8' }}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <AppText tone="muted">Görsel yok</AppText>
          </View>
        )}
      </View>
      <AppText variant="subtitle">{current?.caption || lesson.title}</AppText>
      {current?.memory_hook ? <AppText tone="muted">{current.memory_hook}</AppText> : null}
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
      {current ? (
        <AppText variant="caption" tone="muted">
          Sahne {current.scene_order} · {formatMs(current.start_ms)}–{formatMs(current.end_ms)}
        </AppText>
      ) : null}
    </View>
  );
}
