import type { MemoryLessonQuestion, MemoryLessonScene, OverlayCard } from './types';

export function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function choiceEntries(options: unknown): { key: string; label: string }[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((item, index) => {
      if (item && typeof item === 'object' && 'key' in item) {
        const row = item as { key?: string; label?: string; text?: string };
        return { key: String(row.key ?? String.fromCharCode(65 + index)), label: String(row.label ?? row.text ?? '') };
      }
      return { key: String.fromCharCode(65 + index), label: String(item) };
    }).filter((row) => row.label);
  }
  if (typeof options === 'object') {
    return ['A', 'B', 'C', 'D', 'E']
      .map((key) => ({ key, label: String((options as Record<string, unknown>)[key] ?? '') }))
      .filter((row) => row.label.trim().length > 0);
  }
  return [];
}

export function captionLines(text: string | null | undefined, maxWords = 8) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const words = raw.split(' ');
  if (words.length <= maxWords) return raw;
  return words.slice(0, maxWords).join(' ');
}

export type OverlayBeat = {
  key: string;
  kicker: string;
  text: string;
  label?: string;
};

function inferCardType(scene: MemoryLessonScene) {
  const note = `${scene.memory_technique ?? ''} ${scene.recall_prompt ?? ''}`.toLowerCase();
  if (note.includes('trap') || /yanlış|tuza/.test(scene.reinforcement_note ?? '')) return 'TUZAK';
  if (note.includes('pattern') || note.includes('chunk')) return 'HIZLI TEKNİK';
  if (note.includes('contrast')) return 'KIYASLA';
  return 'HAP BİLGİ';
}

export function overlayCardAt(scene: MemoryLessonScene | null, positionMs: number): OverlayBeat | null {
  if (!scene) return null;
  const span = Math.max(scene.end_ms - scene.start_ms, 1);
  const raw = Array.isArray(scene.overlay_cards) ? scene.overlay_cards : [];
  const timed: OverlayCard[] = raw
    .map((card, index) => ({
      ...card,
      start_ms: Number(card.start_ms ?? scene.start_ms + Math.round(span * 0.12)),
      end_ms: Number(card.end_ms ?? scene.end_ms - Math.round(span * 0.14)),
      semantic_key: card.semantic_key ?? `${scene.id}-${index}`,
    }))
    .sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0));

  const hit = timed.find((card) => positionMs >= (card.start_ms ?? 0) && positionMs < (card.end_ms ?? 0));
  if (hit) {
    return {
      key: hit.semantic_key ?? hit.narration_segment_id ?? scene.id,
      kicker: hit.card_type || 'HAP BİLGİ',
      text: captionLines(hit.short_text, 8),
      label: captionLines(scene.visual_anchor, 3) || undefined,
    };
  }
  if (timed.length) return null;

  const start = scene.start_ms + Math.round(span * 0.12);
  const end = scene.end_ms - Math.round(span * 0.14);
  if (positionMs < start || positionMs >= end) return null;
  const text = captionLines(scene.memory_target || scene.caption, 8);
  if (!text) return null;
  return {
    key: scene.id,
    kicker: inferCardType(scene),
    text,
    label: captionLines(scene.visual_anchor, 3) || undefined,
  };
}

export function sceneOverlayCards(scene: MemoryLessonScene | null): OverlayBeat[] {
  const beat = overlayCardAt(scene, scene ? scene.start_ms + 1 : 0);
  return beat ? [beat] : [];
}

export function sceneOverlayBeat(scene: MemoryLessonScene | null, positionMs: number): OverlayBeat | null {
  return overlayCardAt(scene, positionMs);
}

const INTROS = [
  'Tamam, şimdi bunu sana soracağım.',
  'Bunu kaptın mı hemen bakalım.',
  'Şimdi aynı mantığı sen uygula.',
  'Buraya kadar tamam. Bir tane sen çöz.',
  'Şimdi sıra sende.',
];

export function checkpointIntroFor(question: MemoryLessonQuestion, index: number) {
  return question.checkpoint_intro?.trim() || INTROS[index % INTROS.length];
}

export function checkpointTriggers(scenes: MemoryLessonScene[], questions: MemoryLessonQuestion[], durationMs: number) {
  const orderedScenes = [...scenes].sort((a, b) => a.scene_order - b.scene_order || a.start_ms - b.start_ms);
  const ordered = questions.filter((row) => row.question_type === 'checkpoint').sort((a, b) => a.question_order - b.question_order);
  return ordered.map((question, index) => {
    const pairEnd = Math.min(orderedScenes.length - 1, (index + 1) * 2 - 1);
    const afterTwo = orderedScenes[Math.max(0, pairEnd)];
    const related = question.related_scene_id ? orderedScenes.find((scene) => scene.id === question.related_scene_id) : afterTwo;
    const scene = related ?? afterTwo ?? orderedScenes[orderedScenes.length - 1];
    const triggerMs = scene ? scene.end_ms + 450 : Math.round(((index + 1) / (ordered.length + 1)) * Math.max(durationMs, 1));
    return {
      question,
      triggerMs: Math.min(triggerMs, Math.max(durationMs - 400, 0)),
      introMs: scene ? Math.max(scene.end_ms - 80, scene.start_ms) : triggerMs - 450,
      intro: checkpointIntroFor(question, index),
    };
  });
}

export function retryTriggerMs(scenes: MemoryLessonScene[], fromMs: number, durationMs: number) {
  const ordered = [...scenes].sort((a, b) => a.start_ms - b.start_ms);
  const current = ordered.findIndex((scene) => fromMs >= scene.start_ms && fromMs < scene.end_ms);
  const later = ordered[Math.min(ordered.length - 1, Math.max(current, 0) + 2)];
  const raw = later ? later.end_ms - 300 : fromMs + 20000;
  return Math.min(Math.max(raw, fromMs + 8000), Math.max(durationMs - 1800, fromMs + 4000));
}

export function speakCoachLine(text: string): Promise<void> {
  const line = text.trim();
  if (!line) return Promise.resolve();
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (synth) {
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(line);
      utter.lang = 'tr-TR';
      utter.rate = 1;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      synth.cancel();
      synth.speak(utter);
      setTimeout(resolve, Math.min(4200, 900 + line.length * 55));
    });
  }
  return new Promise((resolve) => setTimeout(resolve, Math.min(2200, 700 + line.length * 40)));
}
