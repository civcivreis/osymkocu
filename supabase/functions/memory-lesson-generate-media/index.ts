import { json, mapHttpError, preflight, requireFactoryCaller, serviceClient } from "../_shared/lessonHttp.ts";
import {
  generateImage,
  generationMeta,
  isRateLimitError,
  retryAfterMsFromError,
} from "../_shared/aiRouter.ts";
import { createLessonSignedUrl, getLessonObject, headLessonObject, lessonAssetPrefix, putLessonObject } from "../_shared/lessonR2.ts";
import { estimateSpeechMs, mp3DurationMs } from "../_shared/mp3Duration.ts";
import {
  buildLessonNarrationScript,
  findReusableAudio,
  minNarrationChunks,
  narrationHashFor,
  speakSerialized,
  withTtsLock,
} from "../_shared/ttsQueue.ts";

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

async function patchStages(
  admin: ReturnType<typeof serviceClient>,
  lessonId: string,
  patch: Record<string, unknown>,
) {
  await admin.from("memory_lessons").update(patch).eq("id", lessonId);
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
  const patch: Record<string, unknown> = {
    media_generation_status: "waiting_retry",
    media_generation_error: `RATE_LIMITED:${operation}`,
    media_next_retry_at: next,
    lesson_status: "waiting_media",
  };
  if (operation === "tts") patch.tts_status = "rate_limited";
  if (operation === "image") patch.visual_status = "pending";
  await admin.from("memory_lessons").update(patch).eq("id", lessonId);
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
  const spoken = await speakSerialized(text, lessonId);
  return {
    bytes: spoken.bytes,
    mimeType: spoken.mimeType ?? "audio/mpeg",
    model: spoken.model,
    speechPath: spoken.speechPath,
    meta: generationMeta(spoken.meta, { voice: spoken.voice, prompt_version: "tts-lesson-v1", speech_path: spoken.speechPath }),
  };
}

async function generateSceneImage(prompt: string, premium: boolean, lessonId: string) {
  const task = premium ? "premium_image_generation" : "image_generation";
  const image = await generateImage(task, prompt, { lessonId, size: "1792x1024" });
  return { bytes: image.bytes, meta: generationMeta(image, { prompt_version: "scene-image-16x9-v1" }) };
}

function imagePrompt(lesson: LessonRow, scene: SceneRow) {
  const technique = scene.memory_technique || lesson.primary_memory_technique || "visual_association";
  const anchor = scene.visual_anchor || scene.memory_hook || "";
  const target = scene.memory_target || "";
  return [
    "Educational mnemonic scene, ONE master 16:9 landscape image (1792x1024). Do not produce a portrait or 9:16 variant.",
    "Compose for responsive reuse. Keep all essential subjects, mnemonic objects and visual focal points inside the central 55–60% safe area. Avoid critical visual information near the extreme left/right edges.",
    "Do not bake important explanatory text into the image. Lesson text and cards are UI overlays. The scene must remain understandable in mobile, tablet and desktop layouts.",
    "Calm cinematic educational illustration, soft painterly lighting, muted earth tones.",
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
      .select("id, exam_type, subject, unit, topic, title, slug, version, narration, narration_key, narration_hash, thumbnail_key, duration_sec, primary_memory_technique, memory_journey_title, tts_status, content_status, questions_status, visual_status, lesson_status")
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
      await patchStages(admin, lessonId, {
        media_generation_status: "ready",
        media_generation_error: null,
        media_generated_at: new Date().toISOString(),
        tts_status: "ready",
        visual_status: "ready",
        lesson_status: "pending_validation",
      });
      const { data: ready } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
      return json({ lesson: ready, keys: [], skipped: true, pending: false });
    }

    await patchStages(admin, lessonId, {
      media_generation_status: "generating",
      media_generation_error: null,
      lesson_status: "waiting_media",
    });

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

    const forceTts = body.force === true && (mode === "all" || mode === "narration");
    const script = buildLessonNarrationScript(narration, scenes);
    const hash = await narrationHashFor(script);
    const shouldNarration = (mode === "narration" || ((mode === "missing" || mode === "all") && !narrationKey) || forceTts) &&
      Boolean(script);
    if (shouldNarration) {
      try {
        await patchStages(admin, lessonId, { narration_hash: hash, tts_status: "queued" });
        const reused = !forceTts ? await findReusableAudio(admin, hash) : null;
        if (reused?.r2_key) {
          narrationKey = String(reused.r2_key);
          durationMs = estimateSpeechMs(script);
          await patchStages(admin, lessonId, {
            narration_key: narrationKey,
            narration_hash: hash,
            duration_sec: Math.max(1, Math.round(durationMs / 1000)),
            tts_status: "ready",
            lesson_status: "waiting_media",
          });
          await admin.from("tts_jobs").upsert({
            lesson_id: lessonId,
            narration_hash: hash,
            script_text: script.slice(0, 8000),
            chunk_index: 0,
            chunk_total: 1,
            status: "ready",
            r2_key: narrationKey,
            reused_from_lesson_id: reused.lesson_id === lessonId ? null : reused.lesson_id,
            updated_at: new Date().toISOString(),
          }, { onConflict: "lesson_id,chunk_index" });
        } else {
          const pieces = minNarrationChunks(script);
          if (pieces.length === 0) throw new Error("NO_NARRATION_SCRIPT");
          const { data: pendingCap } = await admin.rpc("factory_pending_tts_count");
          const { data: settings } = await admin.from("content_factory_settings").select("max_pending_tts_jobs").eq("id", 1).maybeSingle();
          if (Number(pendingCap ?? 0) >= Number(settings?.max_pending_tts_jobs ?? 5)) {
            await patchStages(admin, lessonId, { tts_status: "queued", media_generation_status: "waiting_media", lesson_status: "waiting_media" });
            const { data: outCap } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
            return json({ lesson: outCap, pending: true, deferred: true, reason: "tts_batch_cap" });
          }
          for (let i = 0; i < pieces.length; i++) {
            await admin.from("tts_jobs").upsert({
              lesson_id: lessonId,
              narration_hash: hash,
              script_text: pieces[i],
              chunk_index: i,
              chunk_total: pieces.length,
              status: "queued",
              updated_at: new Date().toISOString(),
            }, { onConflict: "lesson_id,chunk_index" });
          }
          const { data: jobRows } = await admin.from("tts_jobs").select("*").eq("lesson_id", lessonId).order("chunk_index");
          const rows = jobRows ?? [];
          let ttsMeta: Record<string, unknown> | undefined;
          let limited: { wait: number; next: string; index: number } | null = null;

          await withTtsLock(admin, async () => {
            for (const row of rows) {
              if (onlyChunk != null && Number(row.chunk_index) !== onlyChunk) continue;
              if (row.status === "ready" && row.r2_key) continue;
              if (row.next_retry_at && new Date(String(row.next_retry_at)).getTime() > Date.now()) {
                limited = {
                  wait: Math.max(0, new Date(String(row.next_retry_at)).getTime() - Date.now()),
                  next: String(row.next_retry_at),
                  index: Number(row.chunk_index),
                };
                break;
              }
              await admin.from("tts_jobs").update({
                status: "generating",
                attempt_count: Number(row.attempt_count ?? 0) + 1,
                updated_at: new Date().toISOString(),
              }).eq("id", row.id);
              await patchStages(admin, lessonId, { tts_status: "generating" });
              try {
                const spoken = await speak(String(row.script_text), lessonId);
                if (spoken.bytes.byteLength < 400) throw new Error("TTS_EMPTY");
                const chunkKey = pieces.length === 1
                  ? `${prefix}/narration.mp3`
                  : `${prefix}/narration/chunk-${String(row.chunk_index).padStart(3, "0")}.mp3`;
                await putLessonObject(chunkKey, spoken.bytes, "audio/mpeg");
                await verifyUploaded(chunkKey, 400, "audio/mpeg");
                await admin.from("tts_jobs").update({
                  status: "ready",
                  r2_key: chunkKey,
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
                console.error("memory-lesson-generate-media tts", row.chunk_index, error);
                if (isRateLimitError(error) || (error instanceof Error && error.message === "TTS_BUSY")) {
                  const stored = await persistRateLimit(admin, lessonId, error, "tts");
                  await admin.from("tts_jobs").update({
                    status: Number(row.attempt_count ?? 0) + 1 >= 3 ? "waiting_retry" : "rate_limited",
                    last_error: "429",
                    next_retry_at: stored.next,
                    updated_at: new Date().toISOString(),
                  }).eq("id", row.id);
                  await patchStages(admin, lessonId, {
                    tts_status: Number(row.attempt_count ?? 0) + 1 >= 3 ? "waiting_retry" : "rate_limited",
                    lesson_status: "waiting_media",
                    media_generation_status: "waiting_retry",
                  });
                  limited = { wait: stored.wait, next: stored.next, index: Number(row.chunk_index) };
                  break;
                }
                await admin.from("tts_jobs").update({
                  status: "failed",
                  last_error: error instanceof Error ? error.message.slice(0, 180) : "TTS_FAILED",
                  updated_at: new Date().toISOString(),
                }).eq("id", row.id);
                throw error;
              }
            }
          });

          const { data: afterJobs } = await admin.from("tts_jobs").select("chunk_index, status, r2_key").eq("lesson_id", lessonId).order("chunk_index");
          const ready = (afterJobs ?? []).filter((row) => row.status === "ready" && row.r2_key);
          const pending = (afterJobs ?? []).filter((row) => row.status !== "ready");

          if (ready.length > 0 && pending.length === 0) {
            let mp3: Uint8Array;
            if (ready.length === 1) {
              mp3 = await getLessonObject(String(ready[0].r2_key));
            } else {
              const audioParts: Uint8Array[] = [];
              for (const row of ready) audioParts.push(await getLessonObject(String(row.r2_key)));
              mp3 = concatMp3(audioParts);
            }
            if (mp3.byteLength < 400) throw new Error("TTS_EMPTY");
            const key = `${prefix}/narration.mp3`;
            const uploaded = await putLessonObject(key, mp3, "audio/mpeg");
            await verifyUploaded(key, 400, "audio/mpeg");
            const assembledUrl = await createLessonSignedUrl(key, 600);
            if (!assembledUrl) throw new Error("TTS_URL_FAILED");
            narrationKey = key;
            durationMs = mp3DurationMs(mp3) ?? estimateSpeechMs(script);
            await patchStages(admin, lessonId, {
              narration_key: key,
              narration_hash: hash,
              duration_sec: Math.max(1, Math.round(durationMs / 1000)),
              tts_status: "ready",
              lesson_status: "waiting_media",
            });
            await upsertAsset(admin, lessonId, "narration", key, "audio/mpeg", uploaded.bytes, ttsMeta);
            createdKeys.push(key);
          }

          if (limited || pending.length > 0) {
            const { data: outPartial } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
            return json({
              lesson: outPartial,
              keys: createdKeys,
              pending: true,
              tts_calls: ready.length,
              remaining_chunks: pending.length,
              tts_model: usedTtsModel,
              error: limited
                ? {
                  code: "RATE_LIMITED",
                  message: "TTS rate-limited. Lesson content preserved.",
                  operation: "tts",
                  retry_after_ms: limited.wait,
                  next_retry_at: limited.next,
                }
                : undefined,
            }, limited ? 429 : 200);
          }
        }

        const { data: outAfterTts } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
        if (mode === "narration") {
          return json({
            lesson: outAfterTts,
            keys: createdKeys,
            pending: false,
            tts_calls: 1,
            tts_model: usedTtsModel,
            signed_ok: true,
          });
        }
      } catch (error) {
        console.error("memory-lesson-generate-media narration", error);
        if (isRateLimitError(error) || (error instanceof Error && error.message === "TTS_BUSY")) {
          const limited = await persistRateLimit(admin, lessonId, error, "tts");
          return json({
            error: {
              code: "RATE_LIMITED",
              message: "TTS rate-limited. Lesson content preserved.",
              operation: "tts",
              retry_after_ms: limited.wait,
              next_retry_at: limited.next,
            },
          }, 429);
        }
        ttsError = error instanceof Error ? error.message.slice(0, 180) : "Seslendirme oluşturulamadı.";
        await patchStages(admin, lessonId, {
          tts_status: "failed",
          lesson_status: "waiting_media",
          media_generation_status: "waiting_media",
          media_generation_error: ttsError,
        });
        if (mode === "narration") {
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
    const patch: Record<string, unknown> = {
      media_generation_status: complete ? "ready" : narrationKey ? "waiting_media" : (ttsError ? "waiting_media" : "generating"),
      media_generation_error: complete ? null : !narrationKey ? (ttsError ?? "Seslendirme bekleniyor.") : missingImages ? "Görsel bekleniyor." : null,
      tts_status: narrationKey ? "ready" : undefined,
      visual_status: missingImages ? "pending" : "ready",
      lesson_status: complete ? "pending_validation" : "waiting_media",
    };
    if (complete) patch.media_generated_at = new Date().toISOString();
    await admin.from("memory_lessons").update(Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))).eq("id", lessonId);

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
          media_generation_status: complete ? "ready" : "waiting_media",
          lesson_status: complete ? "pending_validation" : "waiting_media",
          media_generation_error: complete ? null : "Medya üretimi yarıda kaldı, tekrar dene.",
        }).eq("id", failLessonId);
      } catch {
        // status best-effort
      }
    }
    return mapHttpError(error, req);
  }
});
