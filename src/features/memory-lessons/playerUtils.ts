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

export function captionLines(text: string | null | undefined) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const words = raw.split(' ');
  if (words.length <= 16) return raw;
  return `${words.slice(0, 16).join(' ')}…`;
}

export function checkpointTriggers(scenes: MemoryLessonScene[], questions: MemoryLessonQuestion[], durationMs: number) {
  const ordered = questions.filter((row) => row.question_type === 'checkpoint').sort((a, b) => a.question_order - b.question_order);
  return ordered.map((question, index) => {
    const related = question.related_scene_id ? scenes.find((scene) => scene.id === question.related_scene_id) : null;
    const fallback = Math.round(((index + 1) / (ordered.length + 1)) * Math.max(durationMs, 1));
    const triggerMs = related ? Math.max(related.end_ms - 400, related.start_ms + 800) : fallback;
    return { question, triggerMs: Math.min(triggerMs, Math.max(durationMs - 2500, 0)) };
  });
}
