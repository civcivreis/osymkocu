import { json, mapHttpError, preflight, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import { generateImage, generateSpeech, generationMeta } from "../_shared/aiRouter.ts";
import { lessonAssetPrefix, putLessonObject } from "../_shared/lessonR2.ts";
import { estimateSpeechMs, mp3DurationMs } from "../_shared/mp3Duration.ts";

const MIN_SCENE_MS = 4000;

type Mode = "missing" | "all" | "narration" | "scene";
type SceneRow = {
  id: string;
  scene_order: number;
  narration_text: string | null;
  visual_description: string | null;
  memory_hook: string | null;
  memory_technique: string | null;
  memory_target: string | null;
  visual_anchor: string | null;
  recall_prompt: string | null;
  asset_key: string | null;
  start_ms: number;
  end_ms: number;
  visual_priority?: string | null;
};
type LessonRow = {
  id: string;
  exam_type: string;
  subject: string;
  unit: string;
  topic: string;
  title: string;
  slug: string;
  version: number;
  narration: string | null;
  narration_key: string | null;
  thumbnail_key: string | null;
  duration_sec: number | null;
  primary_memory_technique: string | null;
  memory_journey_title: string | null;
};

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function stripId3(bytes: Uint8Array) {
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return bytes.subarray(10 + size);
  }
  return bytes;
}

function concatMp3(parts: Uint8Array[]) {
  if (parts.length === 1) return parts[0];
  const pieces = parts.map((part, index) => (index === 0 ? part : stripId3(part)));
  const total = pieces.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of pieces) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunkNarration(text: string, max = 3900) {
  const trimmed = text.trim();
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

function applyTiming(scenes: SceneRow[], durationMs: number) {
  const n = scenes.length;
  if (n === 0) return [] as Array<{ id: string; start_ms: number; end_ms: number }>;
  const weights = scenes.map((scene) => Math.max((scene.narration_text ?? "").trim().length, 1));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const minTotal = n * MIN_SCENE_MS;
  const total = Math.max(durationMs, minTotal);
  let raw = weights.map((w) => (w / weightSum) * total);
  raw = raw.map((ms) => Math.max(ms, MIN_SCENE_MS));
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const scale = total / rawSum;
  let cursor = 0;
  return scenes.map((scene, index) => {
    const dur = index === n - 1 ? Math.max(total - cursor, MIN_SCENE_MS) : Math.round(raw[index] * scale);
    const start_ms = cursor;
    const end_ms = start_ms + dur;
    cursor = end_ms;
    return { id: scene.id, start_ms, end_ms };
  });
}

async function upsertAsset(
  admin: ReturnType<typeof serviceClient>,
  lessonId: string,
  assetType: string,
  r2Key: string,
  mimeType: string,
  sizeBytes: number,
  metadata?: Record<string, unknown>,
) {
  const { error } = await admin.from("memory_lesson_assets").upsert(
    {
      lesson_id: lessonId,
      asset_type: assetType,
      r2_key: r2Key,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      generation_metadata: metadata ?? {},
    },
    { onConflict: "lesson_id,r2_key" },
  );
  if (error) throw error;
}

async function speak(text: string, lessonId: string) {
  const spoken = await generateSpeech(text, { lessonId });
  return { bytes: spoken.bytes, meta: generationMeta(spoken, { voice: spoken.voice, prompt_version: "tts-v1" }) };
}

async function generateSceneImage(prompt: string, premium: boolean, lessonId: string) {
  const task = premium ? "premium_image_generation" : "image_generation";
  const image = await generateImage(task, prompt, { lessonId, size: "1792x1024" });
  return { bytes: image.bytes, meta: generationMeta(image, { prompt_version: "scene-image-v1" }) };
}

function imagePrompt(lesson: LessonRow, scene: SceneRow) {
  const technique = scene.memory_technique || lesson.primary_memory_technique || "visual_association";
  const anchor = scene.visual_anchor || scene.memory_hook || "";
  const target = scene.memory_target || "";
  return [
    "Educational mnemonic scene, 16:9 landscape, calm cinematic educational illustration, soft painterly lighting, muted earth tones.",
    "The image must reinforce one consistent memory anchor. Do not change the meaning of a recurring symbol.",
    "No text, no letters, no numbers, no captions, no watermarks, no logos.",
    "No fake historical documents, no labeled maps, no gore, no violence, no shocking imagery.",
    `Subject context: ${lesson.subject}. Unit: ${lesson.unit}. Topic: ${lesson.topic}. Lesson: ${lesson.title}.`,
    lesson.memory_journey_title ? `Memory journey: ${lesson.memory_journey_title}. Keep recurring props visually consistent.` : "",
    `Memory technique: ${technique}.`,
    target ? `Memory target (the fact being encoded, do not render as text): ${target}` : "",
    anchor ? `Visual anchor to depict clearly: ${anchor}` : "",
    scene.narration_text ? `Scene narration context: ${String(scene.narration_text).slice(0, 400)}` : "",
    scene.visual_description ? `Additional visual notes: ${scene.visual_description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "METHOD", message: "POST gerekli." } }, 405);

  let failLessonId = "";
  try {
    await requireLessonAdmin(req);
    const body = await req.json().catch(() => ({})) as {
      lesson_id?: string;
      mode?: string;
      scene_id?: string;
      force?: boolean;
      premium?: boolean;
    };
    const lessonId = String(body.lesson_id ?? "").trim();
    if (!lessonId) return json({ error: { code: "INVALID", message: "lesson_id gerekli." } }, 400);
    failLessonId = lessonId;

    let mode = (body.mode ?? "missing") as Mode;
    if (body.force === true && mode === "missing") mode = "all";
    if (!["missing", "all", "narration", "scene"].includes(mode)) {
      return json({ error: { code: "INVALID", message: "Geçersiz mod." } }, 400);
    }
    if (mode === "scene" && !String(body.scene_id ?? "").trim()) {
      return json({ error: { code: "INVALID", message: "scene_id gerekli." } }, 400);
    }

    const admin = serviceClient();
    const { data: lesson, error: lessonError } = await admin
      .from("memory_lessons")
      .select("id, exam_type, subject, unit, topic, title, slug, version, narration, narration_key, thumbnail_key, duration_sec, primary_memory_technique, memory_journey_title")
      .eq("id", lessonId)
      .maybeSingle();
    if (lessonError) throw lessonError;
    if (!lesson) return json({ error: { code: "NOT_FOUND", message: "Ders bulunamadı." } }, 404);

    const { data: scenesData, error: scenesError } = await admin
      .from("memory_lesson_scenes")
      .select("id, scene_order, narration_text, visual_description, memory_hook, memory_technique, memory_target, visual_anchor, recall_prompt, asset_key, start_ms, end_ms, visual_priority")
      .eq("lesson_id", lessonId)
      .order("scene_order", { ascending: true });
    if (scenesError) throw scenesError;
    const scenes = (scenesData ?? []) as SceneRow[];
    const narration = String(lesson.narration ?? "").trim();
    if (!narration || scenes.length === 0) {
      return json({ error: { code: "NO_CONTENT", message: "Önce anlatım ve sahneler üretilmeli." } }, 409);
    }

    await admin
      .from("memory_lessons")
      .update({ media_generation_status: "generating", media_generation_error: null })
      .eq("id", lessonId);

    const prefix = lessonAssetPrefix({
      examType: String(lesson.exam_type),
      subject: String(lesson.subject),
      lessonSlug: String(lesson.slug),
      version: Number(lesson.version ?? 1),
    });

    let narrationKey = lesson.narration_key as string | null;
    let durationMs: number | null = null;
    let ttsError: string | null = null;
    let imageFailures = 0;
    const createdKeys: string[] = [];
    let usedTtsModel: string | null = null;
    let usedImageModel: string | null = null;

    const shouldNarration = mode === "all" || mode === "narration" || (mode === "missing" && !narrationKey);
    if (shouldNarration) {
      try {
        const chunks = chunkNarration(narration);
        const audioParts: Uint8Array[] = [];
        let ttsMeta: Record<string, unknown> | undefined;
        for (const chunk of chunks) {
          const spoken = await speak(chunk, lessonId);
          audioParts.push(spoken.bytes);
          ttsMeta = spoken.meta;
          usedTtsModel = String(spoken.meta.model);
        }
        const mp3 = concatMp3(audioParts);
        const key = `${prefix}/narration.mp3`;
        const uploaded = await putLessonObject(key, mp3, "audio/mpeg");
        narrationKey = key;
        durationMs = mp3DurationMs(mp3) ?? estimateSpeechMs(narration);
        await admin
          .from("memory_lessons")
          .update({
            narration_key: key,
            duration_sec: Math.max(1, Math.round(durationMs / 1000)),
          })
          .eq("id", lessonId);
        await upsertAsset(admin, lessonId, "narration", key, "audio/mpeg", uploaded.bytes, ttsMeta);
        createdKeys.push(key);
      } catch (error) {
        console.error("memory-lesson-generate-media narration", error);
        ttsError = "Seslendirme oluşturulamadı.";
        if (mode === "narration") {
          await admin
            .from("memory_lessons")
            .update({ media_generation_status: "failed", media_generation_error: ttsError })
            .eq("id", lessonId);
          return json({ error: { code: "TTS_FAILED", message: ttsError } }, 502);
        }
      }
    }

    if (mode !== "narration") {
      const targets = mode === "scene"
        ? scenes.filter((scene) => scene.id === String(body.scene_id).trim())
        : scenes;
      if (mode === "scene" && targets.length === 0) {
        await admin
          .from("memory_lessons")
          .update({
            media_generation_status: lesson.narration_key ? "ready" : "failed",
            media_generation_error: "Sahne bulunamadı.",
          })
          .eq("id", lessonId);
        return json({ error: { code: "NOT_FOUND", message: "Sahne bulunamadı." } }, 404);
      }
      for (const scene of targets) {
        const padded = String(scene.scene_order).padStart(3, "0");
        const key = `${prefix}/scenes/${padded}.png`;
        const skip = mode === "missing" && Boolean(scene.asset_key);
        if (skip) continue;
        try {
          const premium = Boolean(body.premium)
            || scene.scene_order === 1
            || scene.visual_priority === "premium"
            || scene.visual_priority === "key_anchor";
          const png = await generateSceneImage(imagePrompt(lesson as LessonRow, scene), premium, lessonId);
          usedImageModel = String(png.meta.model);
          const uploaded = await putLessonObject(key, png.bytes, "image/png");
          await admin
            .from("memory_lesson_scenes")
            .update({ asset_key: key, asset_type: "image" })
            .eq("id", scene.id);
          await upsertAsset(admin, lessonId, "image", key, "image/png", uploaded.bytes, png.meta);
          scene.asset_key = key;
          createdKeys.push(key);
          if (scene.scene_order === 1 || !lesson.thumbnail_key) {
            await admin.from("memory_lessons").update({ thumbnail_key: key }).eq("id", lessonId);
            lesson.thumbnail_key = key;
          }
        } catch (error) {
          console.error("memory-lesson-generate-media image", scene.id, error);
          imageFailures += 1;
        }
      }
    }

    const { data: refreshedScenes } = await admin
      .from("memory_lesson_scenes")
      .select("id, scene_order, narration_text, visual_description, memory_hook, memory_technique, memory_target, visual_anchor, recall_prompt, asset_key, start_ms, end_ms")
      .eq("lesson_id", lessonId)
      .order("scene_order", { ascending: true });
    const latestScenes = (refreshedScenes ?? scenes) as SceneRow[];

    const { data: refreshedLesson } = await admin
      .from("memory_lessons")
      .select("narration_key, duration_sec")
      .eq("id", lessonId)
      .maybeSingle();
    narrationKey = refreshedLesson?.narration_key ?? narrationKey;
    if (durationMs == null && refreshedLesson?.duration_sec) {
      durationMs = Number(refreshedLesson.duration_sec) * 1000;
    }
    if (durationMs == null) durationMs = estimateSpeechMs(narration);

    if (narrationKey && latestScenes.length > 0) {
      const timed = applyTiming(latestScenes, durationMs);
      for (const row of timed) {
        await admin.from("memory_lesson_scenes").update({ start_ms: row.start_ms, end_ms: row.end_ms }).eq("id", row.id);
      }
      await admin
        .from("memory_lessons")
        .update({ duration_sec: Math.max(1, Math.round(durationMs / 1000)) })
        .eq("id", lessonId);
    }

    const missingImages = latestScenes.some((scene) => !scene.asset_key);
    const failed = !narrationKey || missingImages;
    const friendly = !narrationKey
      ? (ttsError ?? "Seslendirme oluşturulamadı.")
      : missingImages
      ? "Görsel üretilemedi."
      : imageFailures > 0
      ? "Görsel üretilemedi."
      : null;
    const patch: Record<string, unknown> = {
      media_generation_status: failed ? "failed" : "ready",
      media_generation_error: failed ? friendly : null,
    };
    if (!failed) patch.media_generated_at = new Date().toISOString();
    await admin.from("memory_lessons").update(patch).eq("id", lessonId);

    const { data: out } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
    return json({
      lesson: out,
      keys: createdKeys,
      skipped: mode === "missing",
      tts_model: usedTtsModel,
      image_model: usedImageModel,
    });
  } catch (error) {
    console.error("memory-lesson-generate-media", error);
    if (failLessonId) {
      try {
        await serviceClient()
          .from("memory_lessons")
          .update({
            media_generation_status: "failed",
            media_generation_error: "Medya üretilemedi.",
          })
          .eq("id", failLessonId);
      } catch {
        // status best-effort
      }
    }
    return mapHttpError(error, req);
  }
});
