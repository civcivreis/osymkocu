import { json, mapHttpError, preflight, requireFactoryCaller, serviceClient } from "../_shared/lessonHttp.ts";
import {
  asChoices,
  isUuid,
  parsePackPayload,
  validateContentPack,
  type ContentPackLesson,
} from "../_shared/contentPack.ts";
import { AYT_EXAM, COVERAGE_TOPICS, MATH_HAP_RELATIONS, SHARED_MATH_EXAMS, foldName } from "../_shared/mathHapMap.ts";

function foldTr(value: string) {
  return value
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıIİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u");
}

function slugify(value: string) {
  const base = foldTr(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  return base || "ders";
}

function mapExamType(codes: string[] | undefined) {
  const first = String(codes?.[0] ?? "kpss").toUpperCase();
  if (first.startsWith("TYT")) return "tyt";
  if (first.startsWith("AYT")) return "ayt";
  return "kpss";
}

async function uniqueSlug(admin: ReturnType<typeof serviceClient>, title: string, preferred?: string | null) {
  const root = preferred || slugify(title);
  for (let i = 0; i < 12; i += 1) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const { data } = await admin.from("memory_lessons").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${root}-${crypto.randomUUID().slice(0, 8)}`;
}

type TopicHit = { id: string; name: string; slug: string; canonical_unit_id: string };

async function loadMathTopics(admin: ReturnType<typeof serviceClient>) {
  const { data: subjects } = await admin.from("canonical_subjects").select("id, name");
  const mathSubjectIds = (subjects ?? [])
    .filter((row) => {
      const name = foldName(String(row.name ?? ""));
      return name === "matematik" || name === "geometri";
    })
    .map((row) => row.id);
  if (!mathSubjectIds.length) {
    const { data } = await admin.from("canonical_topics").select("id, name, slug, canonical_unit_id");
    return (data ?? []) as TopicHit[];
  }
  const { data: units } = await admin.from("canonical_units").select("id").in("canonical_subject_id", mathSubjectIds);
  const unitIds = (units ?? []).map((row) => row.id);
  if (!unitIds.length) return [];
  const { data } = await admin.from("canonical_topics").select("id, name, slug, canonical_unit_id").in("canonical_unit_id", unitIds);
  return (data ?? []) as TopicHit[];
}

async function resolveTopic(
  admin: ReturnType<typeof serviceClient>,
  pack: ContentPackLesson,
  catalog: TopicHit[],
): Promise<{ topic: TopicHit | null; reason?: string }> {
  const key = pack.pack_slug || pack.canonical_topic_id;
  if (isUuid(key)) {
    const hit = catalog.find((row) => row.id === key);
    if (hit) return { topic: hit };
    const { data } = await admin.from("canonical_topics").select("id, name, slug, canonical_unit_id").eq("id", key).maybeSingle();
    return data ? { topic: data as TopicHit } : { topic: null, reason: "UUID kanonik konuda yok." };
  }
  const slugHit = catalog.filter((row) => row.slug === key);
  if (slugHit.length === 1) return { topic: slugHit[0] };
  if (slugHit.length > 1) return { topic: null, reason: "Aynı slug birden fazla kanonik konuda." };
  const nameHit = catalog.filter((row) => foldName(row.name) === foldName(pack.title) || foldName(row.name) === foldName(key));
  if (nameHit.length === 1) return { topic: nameHit[0] };
  const aliases = MATH_HAP_RELATIONS[key] ?? [];
  for (const name of aliases) {
    const matches = catalog.filter((row) => foldName(row.name) === foldName(name));
    if (matches.length === 1) return { topic: matches[0] };
  }
  if (!aliases.length) return { topic: null, reason: "Kanonik eşleşme yok; tahmin edilmedi." };
  return { topic: null, reason: `İlişki denendi (${aliases.join(" / ")}) ama tek kanonik konu bulunamadı.` };
}

function buildNarration(pack: ContentPackLesson) {
  const parts = [
    pack.hook,
    ...pack.teaching_blocks.map((block) => block.narration),
    ...pack.checkpoints.map((item) => item.intro_narration).filter(Boolean),
    pack.memory_summary,
  ].filter(Boolean);
  return parts.join(" ").trim();
}

async function persistLesson(
  admin: ReturnType<typeof serviceClient>,
  pack: ContentPackLesson,
  topic: TopicHit,
  existingId: string | null,
  contentVersion: string,
) {
  const { data: unit } = await admin
    .from("canonical_units")
    .select("id, name, canonical_subject_id")
    .eq("id", topic.canonical_unit_id)
    .maybeSingle();
  const { data: subject } = unit
    ? await admin.from("canonical_subjects").select("id, name").eq("id", unit.canonical_subject_id).maybeSingle()
    : { data: null };
  const examType = mapExamType(pack.exam_codes);
  const duration = Math.max(60, Number(pack.estimated_duration_sec) || pack.teaching_blocks.length * 40);
  const lessonPatch = {
    exam_type: examType,
    subject: pack.subject || subject?.name || "Matematik",
    unit: unit?.name || "Ünite",
    topic: topic.name,
    title: pack.title,
    description: pack.learning_objective ?? pack.memory_summary ?? "",
    narration: buildNarration(pack),
    learning_objectives: pack.learning_objective ? [pack.learning_objective] : [],
    memory_hooks: pack.hook ? [pack.hook] : [],
    duration_sec: duration,
    canonical_topic_id: topic.id,
    status: "draft",
    content_source: "import",
    lock_authored: true,
    pack_slug: pack.pack_slug,
    content_version: contentVersion,
    content_status: "ready",
    questions_status: "ready",
    visual_status: "pending",
    tts_status: "idle",
    lesson_status: "waiting_media",
    generation_status: "succeeded",
    generation_error: null,
  };

  let lessonId = existingId;
  if (lessonId) {
    const { error } = await admin.from("memory_lessons").update(lessonPatch).eq("id", lessonId);
    if (error) throw error;
    await admin.from("memory_lesson_scenes").delete().eq("lesson_id", lessonId);
    await admin.from("memory_lesson_questions").delete().eq("lesson_id", lessonId);
  } else {
    const slug = await uniqueSlug(admin, pack.title, pack.pack_slug);
    const { data, error } = await admin.from("memory_lessons").insert({ ...lessonPatch, slug }).select("id").single();
    if (error) throw error;
    lessonId = data.id;
  }

  const sceneRows = pack.teaching_blocks.map((block, index) => {
    const start = Math.round((index / pack.teaching_blocks.length) * duration * 1000);
    const end = Math.round(((index + 1) / pack.teaching_blocks.length) * duration * 1000);
    return {
      lesson_id: lessonId,
      scene_order: index + 1,
      start_ms: start,
      end_ms: Math.max(end, start + 4000),
      asset_type: "image",
      caption: block.card_text,
      narration_text: block.narration,
      overlay_cards: [{
        card_type: block.card_type || "HAP BİLGİ",
        short_text: block.card_text,
        semantic_key: block.semantic_key,
        narration_segment_id: block.semantic_key,
        start_ms: start,
        end_ms: Math.max(end, start + 4000),
      }],
    };
  });
  const { error: sceneError } = await admin.from("memory_lesson_scenes").insert(sceneRows);
  if (sceneError) throw sceneError;

  const seenQuestions = new Set<string>();
  const questionRows = [
    ...pack.checkpoints.map((item, index) => ({
      lesson_id: lessonId,
      question_type: "checkpoint",
      question_order: index + 1,
      question_text: item.question,
      options: asChoices(item.choices),
      correct_answer: item.correct_answer,
      explanation: item.wrong_explanation ?? "",
      wrong_feedback: item.wrong_explanation ?? "",
      retry_question_text: item.retry_question || item.question,
      checkpoint_intro: item.intro_narration ?? "",
    })),
    ...pack.final_questions.map((item, index) => ({
      lesson_id: lessonId,
      question_type: "final",
      question_order: index + 1,
      question_text: item.question,
      options: asChoices(item.choices),
      correct_answer: item.correct_answer,
      explanation: item.explanation ?? "",
    })),
  ].filter((row) => {
    const key = `${row.question_type}:${row.question_text.trim().toLowerCase()}`;
    const textKey = row.question_text.trim().toLowerCase();
    if (seenQuestions.has(textKey) || seenQuestions.has(key)) return false;
    seenQuestions.add(textKey);
    return true;
  });
  const { error: qError } = await admin.from("memory_lesson_questions").insert(questionRows);
  if (qError) throw qError;
  return lessonId as string;
}

async function mapSharedExams(
  admin: ReturnType<typeof serviceClient>,
  lessonId: string,
  topicId: string,
  packCodes: string[] | undefined,
) {
  const wanted = [...new Set([...SHARED_MATH_EXAMS, ...(packCodes ?? [])])]
    .map((code) => code.toUpperCase())
    .filter((code) => code !== AYT_EXAM);
  const { data: exams } = await admin.from("exam_catalog").select("id, code").in("code", wanted);
  const mapped: Record<string, boolean> = {};
  const rejected: { exam: string; reason: string }[] = [];
  const ayt: string[] = [];
  for (const exam of exams ?? []) {
    const { data: version } = await admin
      .from("curriculum_versions")
      .select("id")
      .eq("exam_id", exam.id)
      .eq("status", "active")
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!version?.id) {
      rejected.push({ exam: exam.code, reason: "Aktif müfredat yok." });
      continue;
    }
    const { data: topicMap } = await admin
      .from("exam_topic_map")
      .select("id")
      .eq("curriculum_version_id", version.id)
      .eq("canonical_topic_id", topicId)
      .eq("included", true)
      .maybeSingle();
    if (!topicMap) {
      rejected.push({ exam: exam.code, reason: "Bu kanonik konu bu sınav müfredatında yok." });
      continue;
    }
    const { error } = await admin.from("memory_lesson_exam_map").upsert({
      lesson_id: lessonId,
      curriculum_version_id: version.id,
      canonical_topic_id: topicId,
      usage_mode: "core",
      is_active: true,
    }, { onConflict: "lesson_id,curriculum_version_id" });
    if (error) {
      rejected.push({ exam: exam.code, reason: error.message });
      continue;
    }
    mapped[exam.code] = true;
  }
  const { data: aytExam } = await admin.from("exam_catalog").select("id").eq("code", AYT_EXAM).maybeSingle();
  if (aytExam?.id) {
    const { data: aytVersion } = await admin
      .from("curriculum_versions")
      .select("id")
      .eq("exam_id", aytExam.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (aytVersion?.id) {
      const { data: aytHit } = await admin
        .from("exam_topic_map")
        .select("id")
        .eq("curriculum_version_id", aytVersion.id)
        .eq("canonical_topic_id", topicId)
        .maybeSingle();
      if (aytHit) ayt.push("AYT müfredatında aynı kanonik konu var; birincil AYT dersi olarak bağlanmadı (önkoşul adayı).");
    }
  }
  return { mapped, rejected, ayt };
}

async function queueFirstMedia(admin: ReturnType<typeof serviceClient>, lessonIds: string[]) {
  const picked = lessonIds.slice(0, 5);
  let queued = 0;
  for (const lessonId of picked) {
    const { data: lesson } = await admin.from("memory_lessons").select("id, canonical_topic_id, narration_key").eq("id", lessonId).maybeSingle();
    if (!lesson?.canonical_topic_id || lesson.narration_key) continue;
    const { data: existing } = await admin
      .from("content_generation_jobs")
      .select("id")
      .eq("memory_lesson_id", lessonId)
      .eq("job_type", "media_only")
      .in("status", ["queued", "generating_media", "generating_text"])
      .maybeSingle();
    if (existing) continue;
    const { error } = await admin.from("content_generation_jobs").insert({
      canonical_topic_id: lesson.canonical_topic_id,
      memory_lesson_id: lessonId,
      job_type: "media_only",
      status: "queued",
      coverage_mode: "core",
      lesson_scope: "core",
      priority: 80,
    });
    if (!error) queued += 1;
  }
  return { queued, lesson_ids: picked };
}

async function coverageReport(admin: ReturnType<typeof serviceClient>, catalog: TopicHit[]) {
  const missing: { topic: string; canonical_exists: boolean; lesson_exists: boolean }[] = [];
  const coverageAlias: Record<string, string[]> = {
    "Asal Çarpanlara Ayırma": ["Asal Sayılar ve Asal Çarpanlara Ayırma", "Asal Sayılar ve Asal Çarpanlar"],
    "Fonksiyon Temeli": ["Fonksiyonlara Giriş", "Fonksiyon"],
    "Sayı Problemleri": ["Sayı problemleri"],
    "Kesir Problemleri": ["Kesir problemleri"],
    "Faiz Problemleri": ["Faiz problemleri"],
    "Havuz Problemleri": ["İşçi-havuz", "İşçi – Havuz"],
    "Çember temel bilgileri": ["Çember ve Daire"],
    "Sayısal Mantık": ["Sayısal Mantık"],
  };
  for (const name of COVERAGE_TOPICS) {
    const names = [name, ...(coverageAlias[name] ?? [])];
    const topic = catalog.find((row) => names.some((item) => foldName(row.name) === foldName(item)));
    let lessonExists = false;
    if (topic) {
      const { count } = await admin
        .from("memory_lessons")
        .select("id", { count: "exact", head: true })
        .eq("canonical_topic_id", topic.id)
        .neq("status", "archived");
      lessonExists = (count ?? 0) > 0;
    }
    missing.push({
      topic: name,
      canonical_exists: Boolean(topic),
      lesson_exists: lessonExists,
    });
  }
  return missing.filter((row) => !row.lesson_exists);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "METHOD", message: "POST gerekli." } }, 405);
  try {
    const caller = await requireFactoryCaller(req);
    const body = await req.json().catch(() => ({})) as {
      text?: string;
      filename?: string;
      update_existing?: boolean;
      enqueue_media?: boolean;
      enqueue_first_media_batch?: boolean;
    };
    const text = String(body.text ?? "");
    if (!text.trim()) return json({ error: { code: "INVALID", message: "JSON veya JSONL gerekli." } }, 400);
    let parsed: ReturnType<typeof parsePackPayload>;
    try {
      parsed = parsePackPayload(text);
    } catch (error) {
      return json({ error: { code: "PARSE", message: error instanceof Error ? error.message : "JSON okunamadı." } }, 400);
    }
    if (parsed.lessons.length > 80) {
      parsed = { ...parsed, lessons: parsed.lessons.slice(0, 80) };
    }

    const admin = serviceClient();
    const catalog = await loadMathTopics(admin);
    const packVersion = parsed.version || "KPSS_MATH_HAP_V1";
    const { data: importRow, error: importError } = await admin.from("content_pack_imports").insert({
      filename: String(body.filename ?? `pack-${parsed.format}`).slice(0, 160),
      status: "running",
      created_by: caller.user?.id ?? null,
      summary: { total: parsed.lessons.length, version: packVersion },
    }).select("id").single();
    if (importError) throw importError;

    const invalid: { row: number; title?: string; errors: unknown }[] = [];
    const imported: { row: number; lesson_id: string; title: string; topic: string }[] = [];
    const updated: { row: number; lesson_id: string; title: string }[] = [];
    const skipped: { row: number; lesson_id: string; title: string }[] = [];
    const failedMapping: { row: number; title?: string; slug?: string; reason: string }[] = [];
    const examTally: Record<string, number> = { TYT: 0, KPSS_ORTAOGRETIM: 0, KPSS_ONLISANS: 0, KPSS_LISANS: 0 };
    const rejectedShared: { title: string; exam: string; reason: string }[] = [];
    const aytNotes: string[] = [];
    const updateExisting = body.update_existing === true;
    const mediaEligible: string[] = [];

    for (let i = 0; i < parsed.lessons.length; i++) {
      const checked = validateContentPack(parsed.lessons[i]);
      if (!checked.ok || !checked.lesson) {
        invalid.push({
          row: i + 1,
          title: String((parsed.lessons[i] as { title?: string })?.title ?? ""),
          errors: checked.errors,
        });
        await admin.from("content_pack_rows").insert({
          import_id: importRow.id,
          row_index: i + 1,
          canonical_topic_id: String((parsed.lessons[i] as { canonical_slug?: string })?.canonical_slug ?? ""),
          payload: parsed.lessons[i],
          status: "invalid",
          error: JSON.stringify(checked.errors).slice(0, 800),
        });
        continue;
      }
      const pack = checked.lesson;
      pack.content_version = pack.content_version || packVersion;
      const resolved = await resolveTopic(admin, pack, catalog);
      if (!resolved.topic) {
        failedMapping.push({ row: i + 1, title: pack.title, slug: pack.pack_slug, reason: resolved.reason ?? "eşleşmedi" });
        await admin.from("content_pack_rows").insert({
          import_id: importRow.id,
          row_index: i + 1,
          canonical_topic_id: pack.pack_slug,
          title: pack.title,
          payload: pack,
          status: "failed_mapping",
          error: resolved.reason ?? "eşleşmedi",
        });
        continue;
      }
      const { data: existing } = await admin
        .from("memory_lessons")
        .select("id, status, content_version, pack_slug")
        .eq("pack_slug", pack.pack_slug)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let lessonId = existing?.id ?? null;
      let action: "imported" | "updated" | "skipped_duplicate" = "imported";
      if (existing) {
        if (updateExisting && existing.status === "draft") {
          lessonId = await persistLesson(admin, pack, resolved.topic, existing.id, pack.content_version || packVersion);
          action = "updated";
          updated.push({ row: i + 1, lesson_id: lessonId, title: pack.title });
        } else {
          action = "skipped_duplicate";
          lessonId = existing.id;
          skipped.push({ row: i + 1, lesson_id: existing.id, title: pack.title });
        }
      } else {
        lessonId = await persistLesson(admin, pack, resolved.topic, null, pack.content_version || packVersion);
        imported.push({ row: i + 1, lesson_id: lessonId, title: pack.title, topic: resolved.topic.name });
      }
      const maps = await mapSharedExams(admin, lessonId, resolved.topic.id, pack.exam_codes);
      for (const [code, ok] of Object.entries(maps.mapped)) {
        if (ok && examTally[code] != null) examTally[code] += 1;
      }
      for (const row of maps.rejected) rejectedShared.push({ title: pack.title, exam: row.exam, reason: row.reason });
      aytNotes.push(...maps.ayt.map((note) => `${pack.title}: ${note}`));
      if (action !== "skipped_duplicate") mediaEligible.push(lessonId);
      await admin.from("content_pack_rows").insert({
        import_id: importRow.id,
        row_index: i + 1,
        canonical_topic_id: resolved.topic.id,
        title: pack.title,
        payload: pack,
        status: action,
        lesson_id: lessonId,
      });
    }

    const startMedia = body.enqueue_first_media_batch === true
      || body.enqueue_media === true
      || packVersion === "KPSS_MATH_HAP_V1";
    const firstFiveIds = mediaEligible.slice(0, 5);
    const mediaState = startMedia
      ? await queueFirstMedia(admin, firstFiveIds)
      : { queued: 0, lesson_ids: firstFiveIds };

    const missing = await coverageReport(admin, catalog);
    const summary = {
      total: parsed.lessons.length,
      imported: imported.length,
      updated: updated.length,
      skipped_duplicate: skipped.length,
      failed_mapping: failedMapping.length,
      invalid: invalid.length,
      mapped_tyt: examTally.TYT,
      mapped_kpss_ortaogretim: examTally.KPSS_ORTAOGRETIM,
      mapped_kpss_onlisans: examTally.KPSS_ONLISANS,
      mapped_kpss_lisans: examTally.KPSS_LISANS,
      media_queued: startMedia ? mediaState.queued : 0,
      first_media_lessons: startMedia ? mediaState.lesson_ids : [],
    };
    await admin.from("content_pack_imports").update({ status: "completed", summary }).eq("id", importRow.id);
    return json({
      ok: true,
      import_id: importRow.id,
      ...summary,
      invalid,
      failed_mapping: failedMapping,
      skipped_duplicates: skipped,
      imported_rows: imported,
      updated_rows: updated,
      rejected_shared: rejectedShared,
      ayt_prerequisite: aytNotes.slice(0, 40),
      missing_shared_math_topics: missing,
      published: false,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : JSON.stringify(error);
    console.error("content-pack-import", message);
    return json({ error: { code: "IMPORT_FAILED", message: message.slice(0, 500) } }, 500, req);
  }
});
