import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateSpeech, inputHash, isRateLimitError, retryAfterMsFromError } from "./aiRouter.ts";
import { COACH_SPEECH_INSTRUCTIONS, preprocessNarrationScript } from "./speechProviderAdapter.ts";

export const TTS_CHAR_LIMIT = 4000;

export function minNarrationChunks(text: string, max = TTS_CHAR_LIMIT) {
  const trimmed = preprocessNarrationScript(text);
  if (!trimmed) return [];
  if (trimmed.length <= max) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(". ", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf(" ", max);
    if (cut < 1) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function buildLessonNarrationScript(lessonNarration: string, scenes: { narration_text?: string | null; narration_script?: string | null }[]) {
  const full = String(lessonNarration ?? "").trim();
  if (full) return preprocessNarrationScript(full);
  return preprocessNarrationScript(
    scenes.map((scene) => String(scene.narration_script || scene.narration_text || "").trim()).filter(Boolean).join(" "),
  );
}

export async function narrationHashFor(script: string, voice = "marin") {
  return inputHash({ script: preprocessNarrationScript(script), voice, v: "tts-lesson-v1" });
}

export function backoffMs(error: unknown, attempt: number) {
  const header = retryAfterMsFromError(error, attempt);
  const exp = Math.min(2000 * (2 ** attempt), 60_000);
  const jitter = Math.floor(Math.random() * 1200);
  return Math.max(header, exp + jitter);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function speakSerialized(text: string, lessonId: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const spoken = await generateSpeech("tts_generation", text, undefined, COACH_SPEECH_INSTRUCTIONS, { lessonId });
      return {
        bytes: spoken.bytes,
        mimeType: spoken.mimeType ?? "audio/mpeg",
        model: spoken.model,
        speechPath: spoken.speechPath,
        voice: spoken.voice,
        meta: spoken,
        attempts: attempt + 1,
      };
    } catch (error) {
      last = error;
      if (!isRateLimitError(error)) throw error;
      const wait = backoffMs(error, attempt);
      if (attempt >= 2 || wait > 8000) {
        const wrapped = new Error(`RATE_LIMITED:${wait}`);
        (wrapped as Error & { retryAfterMs: number }).retryAfterMs = wait;
        throw wrapped;
      }
      await sleep(wait);
    }
  }
  throw last;
}

export async function withTtsLock<T>(admin: SupabaseClient, run: () => Promise<T>) {
  const { data: locked } = await admin.rpc("tts_try_lock");
  if (locked !== true) {
    throw new Error("TTS_BUSY");
  }
  try {
    return await run();
  } finally {
    await admin.rpc("tts_unlock").then(() => undefined, () => undefined);
  }
}

export async function findReusableAudio(admin: SupabaseClient, hash: string) {
  const { data: job } = await admin
    .from("tts_jobs")
    .select("r2_key, lesson_id")
    .eq("narration_hash", hash)
    .eq("status", "ready")
    .not("r2_key", "is", null)
    .limit(1)
    .maybeSingle();
  if (job?.r2_key) return job;
  const { data: lesson } = await admin
    .from("memory_lessons")
    .select("id, narration_key")
    .eq("narration_hash", hash)
    .not("narration_key", "is", null)
    .limit(1)
    .maybeSingle();
  if (lesson?.narration_key) return { r2_key: lesson.narration_key, lesson_id: lesson.id };
  return null;
}
