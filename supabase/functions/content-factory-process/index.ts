import { json, mapHttpError, preflight, requireFactoryCaller, serviceClient } from "../_shared/lessonHttp.ts";
import {
  ACTIVE,
  appendEvent,
  envConcurrency,
  failJob,
  hasText,
  invokeFunction,
  loadLesson,
  mediaProgress,
  pedagogyOk,
  questionCounts,
  saveJob,
  type FactoryJob,
} from "../_shared/contentFactory.ts";

async function ensureLesson(job: FactoryJob, req: Request) {
  if (job.memory_lesson_id) return job.memory_lesson_id;
  if (!job.topic_id) throw new Error("NO_TOPIC");
  const created = await invokeFunction("memory-lesson-create", {
    topic_id: job.topic_id,
    unit_id: job.unit_id,
    subject_id: job.subject_id,
    exam_id: job.exam_id,
    lesson_scope: job.lesson_scope || "core",
    usage_mode: job.coverage_mode || "core",
  }, req);
  const lessonId = (created.data as { lesson?: { id?: string } } | null)?.lesson?.id;
  if (!created.ok || !lessonId) throw new Error("CREATE_FAILED");
  return lessonId;
}

async function gatePending(admin: ReturnType<typeof serviceClient>, job: FactoryJob, lessonId: string) {
  const lesson = await loadLesson(admin, lessonId);
  const questions = await questionCounts(admin, lessonId);
  const media = await mediaProgress(admin, lessonId, lesson?.narration_key ?? null);
  const pedagogy = pedagogyOk(lesson);
  const questionsOk = questions.finals === 10 && questions.checkpoints >= 2 && !questions.duplicateQuestions;
  const mediaOk = job.job_type === "text_only" || job.job_type === "questions_only" || job.job_type === "pedagogy_refresh"
    ? true
    : media.done === media.total && media.total > 0;
  const complete = Boolean(lesson?.narration) && pedagogy && questionsOk && mediaOk;
  return { lesson, questions, media, pedagogy, questionsOk, mediaOk, complete };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  try {
    await requireFactoryCaller(req);
    const admin = serviceClient();
    await admin.rpc("factory_orchestrate_internal");
    const { data: settings } = await admin.from("content_factory_settings").select("*").eq("id", 1).maybeSingle();
    const enabled = Boolean(settings?.production_enabled) || settings?.engine_state === "running" || settings?.engine_state === "stopping";
    const concurrency = envConcurrency(Number(settings?.max_concurrency ?? 2));

    const { data: running } = await admin
      .from("content_generation_jobs")
      .select("*")
      .in("status", [...ACTIVE])
      .order("priority", { ascending: false })
      .limit(concurrency);

    const jobs: FactoryJob[] = (running ?? []) as FactoryJob[];
    if (settings?.engine_state === "running" && jobs.length < concurrency) {
      const { data: claimed } = await admin.rpc("factory_claim_jobs_internal", { p_limit: concurrency - jobs.length });
      const extra = Array.isArray(claimed) ? claimed as FactoryJob[] : claimed ? [claimed as FactoryJob] : [];
      for (const job of extra) {
        if (!jobs.some((row) => row.id === job.id)) jobs.push(job);
      }
    }

    const processed: { id: string; status: string; stage: string }[] = [];

    for (const job of jobs.slice(0, concurrency)) {
      const stage = await advanceJob(admin, job, req);
      processed.push({ id: job.id, status: job.status, stage });
    }

    return json({
      paused: settings?.engine_state === "paused" || !settings?.production_enabled,
      engine_state: settings?.engine_state ?? "paused",
      concurrency,
      running: jobs.length,
      processed,
    }, 200, req);
  } catch (error) {
    console.error("content-factory-process", error);
    return mapHttpError(error, req);
  }
});

async function advanceJob(admin: ReturnType<typeof serviceClient>, job: FactoryJob, req: Request) {
  try {
    if (job.canonical_topic_id) {
      const { data: blocked } = await admin.rpc("topic_ordering_blocks_generation", { p_topic: job.canonical_topic_id });
      if (blocked) {
        await appendEvent(admin, job, "ORDERING_REVIEW", "Önkoşul incelemesi bekleniyor; ders üretimi atlandı.");
        return "queued";
      }
    }
    if (job.job_type === "media_only") {
      return await runMedia(admin, job, req);
    }

    let lessonId = job.memory_lesson_id;
    if (!lessonId) {
      lessonId = await ensureLesson(job, req);
      await saveJob(admin, job, { memory_lesson_id: lessonId, status: "generating_text" });
    }

    const lesson = await loadLesson(admin, lessonId);
    const hash = job.generation_hash;
    if (hash && lesson && !lesson.lesson_generation_hash) {
      await admin.from("memory_lessons").update({ lesson_generation_hash: hash }).eq("id", lessonId);
    }
    if (hash && hasText(lesson)) {
      await saveJob(admin, job, { stage_text_done: true, factory_stage: "lesson_text_ready" });
    }
    if (!hasText(lesson) && job.job_type !== "media_only") {
      if (hash) {
        const { data: existing } = await admin
          .from("memory_lessons")
          .select("id")
          .eq("lesson_generation_hash", hash)
          .neq("id", lessonId)
          .not("narration", "is", null)
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          await saveJob(admin, job, { memory_lesson_id: existing.id, stage_text_done: true, factory_stage: "lesson_text_ready" });
          await appendEvent(admin, job, "TEXT_REUSED", "Aynı üretim özeti bulundu; metin atlandı.");
          return "generating_text";
        }
      }
      await saveJob(admin, job, { status: "generating_text", factory_stage: "lesson_text_ready", locked_until: new Date(Date.now() + 12 * 60_000).toISOString() });
      const gen = await invokeFunction("memory-lesson-generate", { lessonId }, req);
      if (!gen.ok) {
        await failJob(admin, job, "TEXT_FAILED", "Metin üretilemedi.");
        return "failed";
      }
      if (lessonId) {
        await admin.from("memory_lessons").update({
          status: "draft",
          lesson_generation_hash: hash ?? job.generation_hash ?? null,
        }).eq("id", lessonId).neq("status", "published");
      }
      await saveJob(admin, job, { stage_text_done: true, status: "validating_pedagogy", factory_stage: "pedagogy_ready" });
      await appendEvent(admin, job, "TEXT_OK", "Metin üretildi.");
      return "generating_text";
    }
    if (!job.stage_text_done) await saveJob(admin, job, { stage_text_done: true });

    if (!pedagogyOk(lesson) || job.job_type === "pedagogy_refresh") {
      await saveJob(admin, job, { status: "validating_pedagogy" });
      await admin.rpc("refresh_memory_lesson_pedagogy", { p_id: lessonId });
      const scored = await loadLesson(admin, lessonId);
      if (!pedagogyOk(scored) && job.job_type !== "pedagogy_refresh") {
        await failJob(admin, job, "PEDAGOGY_INCOMPLETE", "Hafıza pedagojisi eksik.");
        return "failed";
      }
      await saveJob(admin, job, { stage_pedagogy_done: pedagogyOk(scored), status: "generating_questions" });
      await appendEvent(admin, job, "PEDAGOGY_OK", "Pedagoji doğrulandı.");
      if (job.job_type === "pedagogy_refresh") {
        await finishIfReady(admin, job, lessonId);
        return "validating_pedagogy";
      }
      return "validating_pedagogy";
    }
    if (!job.stage_pedagogy_done) await saveJob(admin, job, { stage_pedagogy_done: true });

    const counts = await questionCounts(admin, lessonId);
    if (counts.finals !== 10 || counts.checkpoints < 2 || job.job_type === "questions_only") {
      if (counts.finals !== 10 || counts.checkpoints < 2) {
        await saveJob(admin, job, { status: "generating_questions" });
        const gen = await invokeFunction("memory-lesson-generate", { lessonId }, req);
        if (!gen.ok) {
          await failJob(admin, job, "QUESTIONS_FAILED", "Sorular üretilemedi.");
          return "failed";
        }
        await admin.from("memory_lessons").update({ status: "draft" }).eq("id", lessonId).neq("status", "published");
      }
      const after = await questionCounts(admin, lessonId);
      if (after.finals !== 10 || after.checkpoints < 2 || after.duplicateQuestions) {
        await failJob(admin, job, "QUESTIONS_INCOMPLETE", "Soru seti eksik veya yineleniyor.");
        return "failed";
      }
      await saveJob(admin, job, { stage_questions_done: true, status: "generating_questions" });
      await appendEvent(admin, job, "QUESTIONS_OK", "Ders soruları hazır.");
      return "generating_questions";
    }
    if (!job.stage_questions_done) await saveJob(admin, job, { stage_questions_done: true });

    if (!job.stage_pool_done) {
      const topicId = lesson?.canonical_topic_id ?? job.canonical_topic_id;
      if (topicId) {
        await invokeFunction("question-generate", { mode: "lesson_sync", memory_lesson_id: lessonId, canonical_topic_id: topicId }, req);
        const pool = await invokeFunction("question-generate", {
          mode: "topic_pool",
          canonical_topic_id: topicId,
          memory_lesson_id: lessonId,
          curriculum_version_id: job.curriculum_version_id,
          exam_catalog_id: job.exam_id,
        }, req);
        if (!pool.ok && pool.status !== 200) {
          await failJob(admin, job, "POOL_FAILED", "Soru havuzu üretilemedi.");
          return "failed";
        }
      }
      await saveJob(admin, job, { stage_pool_done: true });
      await appendEvent(admin, job, "POOL_OK", "Konu soru havuzu işlendi. Otomatik yayın yok.");
      if (job.job_type === "questions_only" || job.job_type === "text_only") {
        await finishIfReady(admin, job, lessonId);
        return "generating_questions";
      }
      return "generating_questions";
    }

    if (job.job_type === "text_only" || job.job_type === "questions_only") {
      await finishIfReady(admin, job, lessonId);
      return "completed";
    }

    return await runMedia(admin, job, req);
  } catch (error) {
    const code = error instanceof Error && error.message === "NO_TOPIC" ? "NO_TOPIC" : "STAGE_FAILED";
    await failJob(admin, job, code, "Üretim adımı tamamlanamadı.");
    return "failed";
  }
}

async function runMedia(admin: ReturnType<typeof serviceClient>, job: FactoryJob, req: Request) {
  const lessonId = job.memory_lesson_id;
  if (!lessonId) {
    await failJob(admin, job, "NO_LESSON", "Ders kaydı yok.");
    return "failed";
  }
  const existing = await loadLesson(admin, lessonId);
  const already = await mediaProgress(admin, lessonId, existing?.narration_key ?? null);
  if (already.done === already.total && already.total > 0) {
    await saveJob(admin, job, {
      status: "generating_media",
      media_done_count: already.done,
      media_total_count: already.total,
      stage_media_done: true,
      factory_stage: "media_ready",
    });
    await finishIfReady(admin, job, lessonId);
    return "generating_media";
  }
  await saveJob(admin, job, { status: "generating_media", factory_stage: "media_ready", locked_until: new Date(Date.now() + 12 * 60_000).toISOString() });
  const media = await invokeFunction("memory-lesson-generate-media", { lessonId, mode: "missing" }, req);
  if (!media.ok) {
    await failJob(admin, job, "MEDIA_FAILED", "Medya üretilemedi.");
    return "failed";
  }
  const lesson = await loadLesson(admin, lessonId);
  const progress = await mediaProgress(admin, lessonId, lesson?.narration_key ?? null);
  await saveJob(admin, job, {
    media_done_count: progress.done,
    media_total_count: progress.total,
    stage_media_done: progress.done === progress.total && progress.total > 0,
  });
  await appendEvent(admin, job, "MEDIA_TICK", `Medya ${progress.done}/${progress.total}`);
  if (progress.done === progress.total && progress.total > 0) {
    await finishIfReady(admin, job, lessonId);
  }
  return "generating_media";
}

async function finishIfReady(admin: ReturnType<typeof serviceClient>, job: FactoryJob, lessonId: string) {
  const gate = await gatePending(admin, job, lessonId);
  await saveJob(admin, job, {
    stage_text_done: Boolean(gate.lesson?.narration),
    stage_pedagogy_done: gate.pedagogy,
    stage_questions_done: gate.questionsOk,
    stage_media_done: gate.mediaOk,
    media_done_count: gate.media.done,
    media_total_count: gate.media.total,
  });
  if (!gate.complete) return;
  await admin.from("memory_lessons").update({ status: "pending_validation" }).eq("id", lessonId);
  await saveJob(admin, job, {
    status: "pending_validation",
    finished_at: new Date().toISOString(),
  });
  await appendEvent(admin, job, "PENDING_VALIDATION", "Kontrole hazır. Otomatik yayın yok.");
  await saveJob(admin, job, { status: "completed" });
}
