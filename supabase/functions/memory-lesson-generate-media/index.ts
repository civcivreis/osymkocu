import { json, mapHttpError, preflight, requireFactoryCaller, serviceClient } from "../_shared/lessonHttp.ts";
import {
  generateImage,
  generateSpeech,
  generationMeta,
  inputHash,
  isRateLimitError,
  retryAfterMsFromError,
} from "../_shared/aiRouter.ts";
import { createLessonSignedUrl, getLessonObject, headLessonObject, lessonAssetPrefix, putLessonObject } from "../_shared/lessonR2.ts";
import { estimateSpeechMs, mp3DurationMs } from "../_shared/mp3Duration.ts";
import { COACH_SPEECH_INSTRUCTIONS, preprocessNarrationScript } from "../_shared/speechProviderAdapter.ts";

const MIN_SCENE_MS = 4000;

type Mode = "missing" | "all" | "narration" | "scene";
type SceneRow = {
  id: string;
  scene_order: number;
  narration_text: string | null;
  display_text?: string | null;
  narration_script?: string | null;
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
  media_next_retry_at?: string | null;
  media_attempt_count?: number | null;
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

function semanticNarrationChunks(scenes: SceneRow[], fallback: string) {
  const parts = scenes
    .map((scene) => String(scene.narration_script || scene.narration_text || "").trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.flatMap((part) => chunkNarration(preprocessNarrationScript(part), 1800));
  return chunkNarration(preprocessNarrationScript(fallback), 1800);
}

function chunkRole(scene: SceneRow, index: number, total: number) {
  if (index === 0) return "hook";
  if (index === total - 1) return "summary";
  if (scene.recall_prompt) return "checkpoint_transition";
  const blob = `${scene.memory_technique ?? ""} ${scene.narration_script ?? ""} ${scene.narration_text ?? ""}`.toLowerCase();
  if (/örnek|örneğin/.test(blob)) return "example";
  if (scene.memory_technique) return "technique";
  return "hap_bilgi";
}

type ChunkPlan = { chunkIndex: number; sceneId: string | null; role: string; text: string };

function buildChunkPlan(scenes: SceneRow[], fallback: string): ChunkPlan[] {
  const out: ChunkPlan[] = [];
  scenes.forEach((scene, index) => {
    const raw = String(scene.narration_script || scene.narration_text || "").trim();
    if (!raw) return;
    const role = chunkRole(scene, index, scenes.length);
    for (const piece of chunkNarration(preprocessNarrationScript(raw), 1800)) {
      out.push({ chunkIndex: out.length, sceneId: scene.id, role, text: piece });
    }
  });
  if (out.length === 0) {
    semanticNarrationChunks(scenes, fallback).forEach((piece, i, all) => {
      out.push({
        chunkIndex: i,
        sceneId: null,
        role: i === 0 ? "hook" : i === all.length - 1 ? "summary" : "hap_bilgi",
        text: piece,
      });
    });
  }
  return out;
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

async function verifyUploaded(key: string, minBytes: number, expectMime: string) {
  const head = await headLessonObject(key);
  if (!head.exists || head.bytes < minBytes) {
    throw new Error(`ASSET_UNVERIFIED:${key}:${head.bytes}`);
  }
  const mime = String(head.mime ?? "").toLowerCase();
  if (mime && !mime.includes(expectMime.split("/")[1]) && mime !== expectMime) {
    throw new Error(`ASSET_MIME:${key}:${mime}`);
  }
  return head;
}

async function persistRateLimit(
  admin: ReturnType<typeof serviceClient>,
  lessonId: string,
  error: unknown,
  operation: string,
) {
  const wait = retryAfterMsFromError(error, 0);
  const next = new Date(Date.now() + wait).toISOString();
  await admin.from("memory_lessons").update({
    media_generation_status: "generating",
    media_generation_error: `RATE_LIMITED:${operation}`,
    media_next_retry_at: next,
  }).eq("id", lessonId);
  return { wait, next };
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
  const spoken = await generateSpeech("tts_generation", text, undefined, COACH_SPEECH_INSTRUCTIONS, { lessonId });
  return {
    bytes: spoken.bytes,
    mimeType: spoken.mimeType ?? "audio/mpeg",
    model: spoken.model,
    speechPath: spoken.speechPath,
    meta: generationMeta(spoken, { voice: spoken.voice, prompt_version: "tts-v2", speech_path: spoken.speechPath }),
  };
}

async function generateSceneImage(prompt: string, premium: boolean, lessonId: string) {
  const task = premium ? "premium_image_generation" : "image_generation";
  const image = await generateImage(task, prompt, { lessonId, size: "1536x1024" });
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
    await requireFactoryCaller(req);
    const body = await req.json().catch(() => ({})) as {
      lesson_id?: string;
      mode?: string;
      scene_id?: string;
      force?: boolean;
      premium?: boolean;
      chunk_index?: number;
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
    const onlyChunk = body.chunk_index == null ? null : Number(body.chunk_index);

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
      .select("id, scene_order, narration_text, display_text, narration_script, visual_description, memory_hook, memory_technique, memory_target, visual_anchor, recall_prompt, asset_key, start_ms, end_ms, visual_priority, media_next_retry_at, media_attempt_count")
      .eq("lesson_id", lessonId)
      .order("scene_order", { ascending: true });
    if (scenesError) throw scenesError;
    const scenes = (scenesData ?? []) as SceneRow[];
    const narration = String(lesson.narration ?? "").trim();
    if (!narration || scenes.length === 0) {
      return json({ error: { code: "NO_CONTENT", message: "Önce anlatım ve sahneler üretilmeli." } }, 409);
    }

    let narrationKey = lesson.narration_key as string | null;
    const missingImagesNow = scenes.some((scene) => !scene.asset_key);
    if (mode === "missing" && narrationKey && !missingImagesNow) {
      await admin
        .from("memory_lessons")
        .update({ media_generation_status: "ready", media_generation_error: null, media_generated_at: new Date().toISOString() })
        .eq("id", lessonId);
      const { data: ready } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
      return json({ lesson: ready, keys: [], skipped: true, pending: false });
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

    let durationMs: number | null = null;
    let ttsError: string | null = null;
    let imageFailures = 0;
    const createdKeys: string[] = [];
    let usedTtsModel: string | null = null;
    let usedImageModel: string | null = null;

    const shouldNarration = mode === "all" || mode === "narration" || (mode === "missing" && !narrationKey);
    if (shouldNarration) {
      try {
        const plan = buildChunkPlan(scenes, narration);
        if (plan.length === 0) throw new Error("NO_NARRATION_SCRIPT");
        for (const item of plan) {
          const textHash = await inputHash(item.text);
          const { error: upsertError } = await admin.from("memory_lesson_narration_chunks").upsert({
            lesson_id: lessonId,
            scene_id: item.sceneId,
            chunk_index: item.chunkIndex,
            chunk_role: item.role,
            text_hash: textHash,
            script_text: item.text,
            status: "pending",
            updated_at: new Date().toISOString(),
          }, { onConflict: "lesson_id,chunk_index", ignoreDuplicates: true });
          if (upsertError) throw new Error(`CHUNK_UPSERT:${upsertError.message}`);
          const { data: existing } = await admin
            .from("memory_lesson_narration_chunks")
            .select("id, text_hash, status, r2_key, script_text")
            .eq("lesson_id", lessonId)
            .eq("chunk_index", item.chunkIndex)
            .maybeSingle();
          if (existing?.script_text) {
            /* keep existing narration text; resume audio only */
          } else if (existing && existing.text_hash !== textHash && existing.status === "ready") {
            await admin.from("memory_lesson_narration_chunks").update({
              text_hash: textHash,
              script_text: item.text,
              chunk_role: item.role,
              status: "pending",
              r2_key: null,
              updated_at: new Date().toISOString(),
            }).eq("id", existing.id);
          }
        }

        const { data: chunkRows } = await admin
          .from("memory_lesson_narration_chunks")
          .select("*")
          .eq("lesson_id", lessonId)
          .order("chunk_index", { ascending: true });
        const rows = chunkRows ?? [];
        let ttsMeta: Record<string, unknown> | undefined;
        let limitedChunk: { wait: number; next: string; index: number } | null = null;

        for (const row of rows) {
          if (onlyChunk != null && Number(row.chunk_index) !== onlyChunk) continue;
          if (row.status === "ready" && row.r2_key) continue;
          if (row.next_retry_at && new Date(String(row.next_retry_at)).getTime() > Date.now()) {
            limitedChunk = {
              wait: Math.max(0, new Date(String(row.next_retry_at)).getTime() - Date.now()),
              next: String(row.next_retry_at),
              index: Number(row.chunk_index),
            };
            break;
          }
          const planItem = plan.find((item) => item.chunkIndex === Number(row.chunk_index));
          const script = String(planItem?.text || row.script_text || "").trim();
          if (!script) continue;
          await admin.from("memory_lesson_narration_chunks").update({
            status: "generating",
            attempt_count: Number(row.attempt_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          try {
            const spoken = await speak(script, lessonId);
            if (spoken.bytes.byteLength < 400) throw new Error("TTS_EMPTY");
            const chunkKey = `${prefix}/narration/chunk-${String(row.chunk_index).padStart(3, "0")}.mp3`;
            await putLessonObject(chunkKey, spoken.bytes, "audio/mpeg");
            await verifyUploaded(chunkKey, 400, "audio/mpeg");
            const dur = mp3DurationMs(spoken.bytes);
            await admin.from("memory_lesson_narration_chunks").update({
              status: "ready",
              r2_key: chunkKey,
              mime_type: spoken.mimeType,
              duration_ms: dur,
              model: spoken.model,
              voice: spoken.meta.voice ?? null,
              last_error: null,
              next_retry_at: null,
              updated_at: new Date().toISOString(),
            }).eq("id", row.id);
            ttsMeta = spoken.meta;
            usedTtsModel = spoken.model;
            createdKeys.push(chunkKey);
            row.status = "ready";
            row.r2_key = chunkKey;
          } catch (error) {
            console.error("memory-lesson-generate-media chunk", row.chunk_index, error);
            if (isRateLimitError(error)) {
              const limited = await persistRateLimit(admin, lessonId, error, "tts");
              await admin.from("memory_lesson_narration_chunks").update({
                status: "rate_limited",
                last_error: "429",
                next_retry_at: limited.next,
                updated_at: new Date().toISOString(),
              }).eq("id", row.id);
              limitedChunk = { wait: limited.wait, next: limited.next, index: Number(row.chunk_index) };
              break;
            }
            await admin.from("memory_lesson_narration_chunks").update({
              status: "failed",
              last_error: error instanceof Error ? error.message.slice(0, 180) : "TTS_FAILED",
              updated_at: new Date().toISOString(),
            }).eq("id", row.id);
            throw error;
          }
        }

        const { data: afterChunks } = await admin
          .from("memory_lesson_narration_chunks")
          .select("chunk_index, status, r2_key, next_retry_at")
          .eq("lesson_id", lessonId)
          .order("chunk_index", { ascending: true });
        const ready = (afterChunks ?? []).filter((row) => row.status === "ready" && row.r2_key);
        const pending = (afterChunks ?? []).filter((row) => row.status !== "ready");

        if (ready.length > 0 && pending.length === 0) {
          const audioParts: Uint8Array[] = [];
          for (const row of ready) {
            audioParts.push(await getLessonObject(String(row.r2_key)));
          }
          const mp3 = concatMp3(audioParts);
          if (mp3.byteLength < 2000) throw new Error("TTS_EMPTY");
          const key = `${prefix}/narration.mp3`;
          const uploaded = await putLessonObject(key, mp3, "audio/mpeg");
          await verifyUploaded(key, 2000, "audio/mpeg");
          const assembledUrl = await createLessonSignedUrl(key, 600);
          if (!assembledUrl) throw new Error("TTS_URL_FAILED");
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
        }

        if (limitedChunk || pending.length > 0) {
          const { data: outPartial } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
          return json({
            lesson: outPartial,
            keys: createdKeys,
            pending: true,
            narration_chunks: afterChunks,
            ready_chunks: ready.length,
            remaining_chunks: pending.length,
            tts_model: usedTtsModel,
            error: limitedChunk
              ? {
                code: "RATE_LIMITED",
                message: "TTS rate-limited.",
                operation: "tts",
                chunk_index: limitedChunk.index,
                retry_after_ms: limitedChunk.wait,
                next_retry_at: limitedChunk.next,
              }
              : undefined,
          }, limitedChunk ? 429 : 200);
        }

        const { data: outAfterTts } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
        if (mode === "narration") {
          return json({
            lesson: outAfterTts,
            keys: createdKeys,
            pending: false,
            ready_chunks: ready.length,
            tts_model: usedTtsModel,
            signed_ok: true,
          });
        }
        return json({
          lesson: outAfterTts,
          keys: createdKeys,
          pending: true,
          remaining: scenes.filter((scene) => mode === "all" || !scene.asset_key).length,
          tts_model: usedTtsModel,
          ready_chunks: ready.length,
        });
      } catch (error) {
        console.error("memory-lesson-generate-media narration", error);
        if (isRateLimitError(error)) {
          const limited = await persistRateLimit(admin, lessonId, error, "tts");
          return json({
            error: {
              code: "RATE_LIMITED",
              message: "TTS rate-limited.",
              operation: "tts",
              retry_after_ms: limited.wait,
              next_retry_at: limited.next,
            },
          }, 429);
        }
        ttsError = error instanceof Error ? error.message.slice(0, 180) : "Seslendirme oluşturulamadı.";
        if (mode === "narration") {
          await admin
            .from("memory_lessons")
            .update({ media_generation_status: "failed", media_generation_error: ttsError })
            .eq("id", lessonId);
          return json({ error: { code: "TTS_FAILED", message: ttsError } }, 502);
        }
      }
    }

    if (mode !== "narration" && narrationKey) {
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
      let madeImage = false;
      for (const scene of targets) {
        const padded = String(scene.scene_order).padStart(3, "0");
        const key = `${prefix}/scenes/${padded}.png`;
        const skip = mode === "missing" && Boolean(scene.asset_key);
        if (skip) continue;
        if (scene.media_next_retry_at && new Date(String(scene.media_next_retry_at)).getTime() > Date.now()) continue;
        if (madeImage) break;
        try {
          const premium = Boolean(body.premium) || scene.scene_order === 1;
          const png = await generateSceneImage(imagePrompt(lesson as LessonRow, scene), premium, lessonId);
          usedImageModel = String(png.meta.model);
          if (png.bytes.byteLength < 500) throw new Error("IMAGE_EMPTY");
          const uploaded = await putLessonObject(key, png.bytes, "image/png");
          await verifyUploaded(key, 500, "image/png");
          await admin
            .from("memory_lesson_scenes")
            .update({
              asset_key: key,
              asset_type: "image",
              media_next_retry_at: null,
              media_error: null,
              media_attempt_count: Number(scene.media_attempt_count ?? 0) + 1,
            })
            .eq("id", scene.id);
          await upsertAsset(admin, lessonId, "image", key, "image/png", uploaded.bytes, png.meta);
          scene.asset_key = key;
          createdKeys.push(key);
          madeImage = true;
          if (scene.scene_order === 1 || !lesson.thumbnail_key) {
            await admin.from("memory_lessons").update({ thumbnail_key: key }).eq("id", lessonId);
            lesson.thumbnail_key = key;
          }
        } catch (error) {
          console.error("memory-lesson-generate-media image", scene.id, error);
          if (isRateLimitError(error)) {
            const limited = await persistRateLimit(admin, lessonId, error, "image");
            await admin.from("memory_lesson_scenes").update({
              media_next_retry_at: limited.next,
              media_error: "429",
              media_attempt_count: Number(scene.media_attempt_count ?? 0) + 1,
            }).eq("id", scene.id);
            return json({
              error: {
                code: "RATE_LIMITED",
                message: "Image rate-limited.",
                operation: "image",
                scene_id: scene.id,
                retry_after_ms: limited.wait,
                next_retry_at: limited.next,
                keys: createdKeys,
              },
            }, 429);
          }
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
    const remaining = (mode === "all" ? latestScenes.length - createdKeys.filter((key) => key.includes("/scenes/")).length : latestScenes.filter((scene) => !scene.asset_key).length);
    const complete = Boolean(narrationKey) && !missingImages;
    const stalled = !complete && createdKeys.length === 0 && imageFailures > 0;
    const patch: Record<string, unknown> = {
      media_generation_status: complete ? "ready" : stalled ? "failed" : "generating",
      media_generation_error: complete ? null : stalled ? "Görsel üretilemedi." : !narrationKey ? (ttsError ?? "Seslendirme bekleniyor.") : null,
    };
    if (complete) patch.media_generated_at = new Date().toISOString();
    await admin.from("memory_lessons").update(patch).eq("id", lessonId);

    const { data: out } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
    return json({
      lesson: out,
      keys: createdKeys,
      skipped: mode === "missing",
      pending: !complete && !stalled,
      remaining: Math.max(0, remaining),
      tts_model: usedTtsModel,
      image_model: usedImageModel,
    });
  } catch (error) {
    console.error("memory-lesson-generate-media", error);
    if (failLessonId) {
      try {
        const admin = serviceClient();
        const { data: lesson } = await admin.from("memory_lessons").select("narration_key").eq("id", failLessonId).maybeSingle();
        const { data: sceneRows } = await admin.from("memory_lesson_scenes").select("asset_key").eq("lesson_id", failLessonId);
        const complete = Boolean(lesson?.narration_key) && (sceneRows ?? []).length > 0 && (sceneRows ?? []).every((row) => row.asset_key);
        await admin.from("memory_lessons").update({
          media_generation_status: complete ? "ready" : "generating",
          media_generation_error: complete ? null : "Medya üretimi yarıda kaldı, tekrar dene.",
        }).eq("id", failLessonId);
      } catch {
        // status best-effort
      }
    }
    return mapHttpError(error, req);
  }
});
