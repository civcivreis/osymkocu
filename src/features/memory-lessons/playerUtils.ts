import type { MemoryLessonQuestion, MemoryLessonScene } from './types';

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

export function captionLines(text: string | null | undefined, maxWords = 12) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const words = raw.split(' ');
  if (words.length <= maxWords) return raw;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export type OverlayBeat = {
  key: string;
  kicker: string;
  text: string;
};

export function sceneOverlayCards(scene: MemoryLessonScene | null): OverlayBeat[] {
  if (!scene) return [];
  const hook = captionLines(scene.memory_hook || scene.visual_anchor, 10);
  const target = captionLines(scene.memory_target || scene.journey_step, 10);
  const recall = captionLines(scene.recall_prompt || scene.reinforcement_note || scene.caption, 12);
  const cards: OverlayBeat[] = [];
  if (hook) cards.push({ key: `${scene.id}-hook`, kicker: 'Kanca', text: hook });
  if (target) cards.push({ key: `${scene.id}-hedef`, kicker: 'Bu neydi?', text: target });
  if (recall && recall !== hook && recall !== target) {
    cards.push({ key: `${scene.id}-kural`, kicker: 'Kural', text: recall });
  }
  return cards;
}

export function sceneOverlayBeat(scene: MemoryLessonScene | null, positionMs: number): OverlayBeat | null {
  const cards = sceneOverlayCards(scene);
  if (!scene || cards.length === 0) return null;
  const span = Math.max(scene.end_ms - scene.start_ms, 1);
  const t = Math.min(0.999, Math.max(0, (positionMs - scene.start_ms) / span));
  return cards[Math.min(cards.length - 1, Math.floor(t * cards.length))] ?? cards[0];
}

export function checkpointTriggers(scenes: MemoryLessonScene[], questions: MemoryLessonQuestion[], durationMs: number) {
  const orderedScenes = [...scenes].sort((a, b) => a.scene_order - b.scene_order || a.start_ms - b.start_ms);
  const ordered = questions.filter((row) => row.question_type === 'checkpoint').sort((a, b) => a.question_order - b.question_order);
  return ordered.map((question, index) => {
    const pairEnd = Math.min(orderedScenes.length - 1, (index + 1) * 2 - 1);
    const afterTwo = orderedScenes[Math.max(0, pairEnd)];
    const related = question.related_scene_id ? orderedScenes.find((scene) => scene.id === question.related_scene_id) : afterTwo;
    const scene = related ?? afterTwo ?? orderedScenes[orderedScenes.length - 1];
    const fallback = Math.round(((index + 1) / (ordered.length + 1)) * Math.max(durationMs, 1));
    const triggerMs = scene ? Math.max(scene.end_ms - 350, scene.start_ms + 900) : fallback;
    return { question, triggerMs: Math.min(triggerMs, Math.max(durationMs - 2500, 0)) };
  });
}

export function retryTriggerMs(scenes: MemoryLessonScene[], fromMs: number, durationMs: number) {
  const ordered = [...scenes].sort((a, b) => a.start_ms - b.start_ms);
  const current = ordered.findIndex((scene) => fromMs >= scene.start_ms && fromMs < scene.end_ms);
  const later = ordered[Math.min(ordered.length - 1, Math.max(current, 0) + 2)];
  const raw = later ? later.end_ms - 300 : fromMs + 20000;
  return Math.min(Math.max(raw, fromMs + 8000), Math.max(durationMs - 1800, fromMs + 4000));
}
