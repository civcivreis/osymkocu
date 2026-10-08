import { json, mapHttpError, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import {
  QUESTION_BANK_SCHEMA,
  QUESTION_GEN_MODEL,
  QUESTION_GEN_PROMPT,
  poolTarget,
  validateGenerated,
  type GeneratedQuestion,
} from "../_shared/questionGenerate.ts";

type Mode = "lesson_sync" | "topic_pool" | "exam_specific" | "missing_coverage";

async function chatQuestions(apiKey: string, user: string, count: number) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: QUESTION_GEN_MODEL,
      temperature: 0.4,
      max_tokens: 5000,
      response_format: { type: "json_schema", json_schema: QUESTION_BANK_SCHEMA },
      messages: [
        {
          role: "system",
          content: `ÖSYM soru yazarısın. Yalnızca verilen ders içeriği ve kazanımları test et. Müfredat dışı bilgi yok. ${count} soru üret. Zorluk muhakeme ve çeldirici kalitesinden gelsin, önemsiz ayrıntı olmasın. Birden fazla strateji kullan. Tanım sorusu yığını üretme.`,
        },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error("AI_PROVIDER");
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as { questions?: GeneratedQuestion[] };
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}

async function ensureSet(
  admin: ReturnType<typeof serviceClient>,
  canonicalTopicId: string,
  setType: string,
  versionId: string | null,
  examId: string | null,
  lessonId: string | null,
) {
  const { data, error } = await admin.rpc("ensure_curriculum_question_set", {
    p_canonical_topic_id: canonicalTopicId,
    p_set_type: setType,
    p_curriculum_version_id: versionId,
    p_exam_catalog_id: examId,
    p_memory_lesson_id: lessonId,
    p_title: setType,
  });
  if (error) throw error;
  return String(data);
}

function matchObjective(title: string, objectives: { id: string; title: string }[]) {
  const needle = title.trim().toLowerCase();
  return objectives.find((row) => row.title.toLowerCase() === needle || row.title.toLowerCase().includes(needle) || needle.includes(row.title.toLowerCase()))?.id ?? objectives[0]?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  try {
    await requireLessonAdmin(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const mode = String(body?.mode ?? "topic_pool") as Mode;
    const admin = serviceClient();
    const canonicalTopicId = String(body?.canonical_topic_id ?? "");
    const lessonId = String(body?.memory_lesson_id ?? "") || null;
    const versionId = String(body?.curriculum_version_id ?? "") || null;
    const examCatalogId = String(body?.exam_catalog_id ?? "") || null;

    if (mode === "lesson_sync") {
      if (!lessonId) return json({ error: { code: "INVALID_INPUT", message: "memory_lesson_id gerekli." } }, 400);
      return json(await syncLessonQuestions(admin, lessonId));
    }

    if (!canonicalTopicId) return json({ error: { code: "INVALID_INPUT", message: "canonical_topic_id gerekli." } }, 400);

    const target = Number(body?.count ?? 0) || await missingPoolCount(admin, canonicalTopicId, mode, versionId, examCatalogId);
    if (target <= 0) {
      return json({ inserted: 0, skipped: 0, published: false, reason: "target_met" });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: { code: "AI_NOT_CONFIGURED", message: "OPENAI_API_KEY sırrı yok." } }, 503);

    const ctx = await buildContext(admin, canonicalTopicId, lessonId, versionId, examCatalogId);
    const setType = mode === "exam_specific" ? "exam_specific" : mode === "missing_coverage" ? "topic_pool" : "topic_pool";
    const setId = await ensureSet(admin, canonicalTopicId, setType, versionId, examCatalogId, null);
    const batch = await chatQuestions(apiKey, ctx.prompt, Math.min(target, 12));
    const result = await insertBatch(admin, batch, {
      canonicalTopicId,
      setId,
      versionId,
      examCatalogId,
      lessonId,
      sourceType: "curriculum_generated",
      objectives: ctx.objectives,
      canonicalUnitId: ctx.unitId,
      canonicalSubjectId: ctx.subjectId,
    });
    return json({ ...result, published: false, set_type: setType });
  } catch (error) {
    if (error instanceof Error && error.message === "AI_PROVIDER") {
      return json({ error: { code: "PROVIDER_ERROR", message: "Soru üretimi yanıt vermedi." } }, 502);
    }
    console.error("question-generate", error);
    return mapHttpError(error);
  }
});

async function missingPoolCount(
  admin: ReturnType<typeof serviceClient>,
  topicId: string,
  mode: string,
  versionId: string | null,
  examId: string | null,
) {
  const settings = await admin.from("content_factory_settings").select("question_pool_target").eq("id", 1).maybeSingle();
  const target = Number(settings.data?.question_pool_target ?? poolTarget());
  const { data: sets } = await admin
    .from("curriculum_question_sets")
    .select("id")
    .eq("canonical_topic_id", topicId)
    .eq("set_type", mode === "exam_specific" ? "exam_specific" : "topic_pool");
  const setIds = (sets ?? []).map((row: { id: string }) => row.id);
  let existing = 0;
  if (setIds.length) {
    const { count } = await admin
      .from("questions")
      .select("id", { count: "exact", head: true })
      .in("curriculum_question_set_id", setIds)
      .neq("question_status", "archived");
    existing = count ?? 0;
  }
  if (mode === "missing_coverage") {
    const { data: objs } = await admin.from("canonical_topic_learning_objectives").select("id").eq("canonical_topic_id", topicId);
    const { data: cov } = await admin.from("objective_question_coverage").select("learning_objective_id").eq("canonical_topic_id", topicId);
    const counts = new Map<string, number>();
    for (const row of cov ?? []) {
      const id = String((row as { learning_objective_id: string }).learning_objective_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const missing = (objs ?? []).filter((row: { id: string }) => (counts.get(row.id) ?? 0) < 2).length;
    return Math.min(8, missing * 2);
  }
  if (mode === "exam_specific" && examId) {
    const { data: examSets } = await admin
      .from("curriculum_question_sets")
      .select("id")
      .eq("canonical_topic_id", topicId)
      .eq("set_type", "exam_specific")
      .eq("exam_catalog_id", examId);
    const ids = (examSets ?? []).map((row: { id: string }) => row.id);
    if (ids.length) {
      const { count } = await admin.from("questions").select("id", { count: "exact", head: true }).in("curriculum_question_set_id", ids).neq("question_status", "archived");
      existing = count ?? 0;
    }
  }
  void versionId;
  return Math.max(0, target - existing);
}

async function buildContext(
  admin: ReturnType<typeof serviceClient>,
  topicId: string,
  lessonId: string | null,
  versionId: string | null,
  examCatalogId: string | null,
) {
  const { data: topic } = await admin.from("canonical_topics").select("*").eq("id", topicId).maybeSingle();
  const { data: unit } = topic ? await admin.from("canonical_units").select("*").eq("id", topic.canonical_unit_id).maybeSingle() : { data: null };
  const { data: subject } = unit ? await admin.from("canonical_subjects").select("*").eq("id", unit.canonical_subject_id).maybeSingle() : { data: null };
  const { data: objectives } = await admin.from("canonical_topic_learning_objectives").select("id, title, objective_order").eq("canonical_topic_id", topicId).order("objective_order");
  const { data: lesson } = lessonId
    ? await admin.from("memory_lessons").select("title, narration, memory_hooks, core_facts, description").eq("id", lessonId).maybeSingle()
    : await admin.from("memory_lessons").select("title, narration, memory_hooks, core_facts, description").eq("canonical_topic_id", topicId).in("status", ["pending_validation", "approved", "published", "draft"]).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const lessonRow = Array.isArray(lesson) ? lesson[0] : lesson;
  const { data: maps } = await admin
    .from("exam_topic_map")
    .select("coverage_mode, depth_level, exam_notes, required_points, excluded_points, curriculum_version_id")
    .eq("canonical_topic_id", topicId);
  const { data: exam } = examCatalogId
    ? await admin.from("exam_catalog").select("name, code").eq("id", examCatalogId).maybeSingle()
    : { data: null };
  const { data: existing } = await admin.from("questions").select("stem").eq("canonical_topic_id", topicId).neq("question_status", "archived").limit(40);
  const { data: version } = versionId
    ? await admin.from("curriculum_versions").select("name").eq("id", versionId).maybeSingle()
    : { data: null };

  const prompt = [
    `Sınav: ${exam?.name ?? "paylaşılan çekirdek"}`,
    `Müfredat: ${version?.name ?? ""}`,
    `Ders: ${subject?.name ?? ""}`,
    `Ünite: ${unit?.name ?? ""}`,
    `Konu: ${topic?.name ?? ""}`,
    `Kazanımlar: ${(objectives ?? []).map((row: { title: string }) => row.title).join(" | ") || "yok"}`,
    `Çekirdek olgular: ${JSON.stringify(lessonRow?.core_facts ?? [])}`,
    `Anlatım: ${String(lessonRow?.narration ?? "").slice(0, 4000)}`,
    `Hafıza kancaları: ${JSON.stringify(lessonRow?.memory_hooks ?? [])}`,
    `Eşleme: ${JSON.stringify(maps ?? [])}`,
    `Mevcut soru kökleri (tekrar etme): ${(existing ?? []).map((row: { stem: string }) => row.stem.slice(0, 80)).join(" || ")}`,
    "Yalnızca bu içerikten soru yaz. Yayınlama.",
  ].join("\n");

  return {
    prompt,
    objectives: (objectives ?? []) as { id: string; title: string }[],
    unitId: unit?.id ?? null,
    subjectId: subject?.id ?? null,
  };
}

async function insertBatch(
  admin: ReturnType<typeof serviceClient>,
  batch: GeneratedQuestion[],
  ctx: {
    canonicalTopicId: string;
    setId: string;
    versionId: string | null;
    examCatalogId: string | null;
    lessonId: string | null;
    sourceType: string;
    objectives: { id: string; title: string }[];
    canonicalUnitId: string | null;
    canonicalSubjectId: string | null;
  },
) {
  let inserted = 0;
  let skipped = 0;
  for (const raw of batch) {
    const q: GeneratedQuestion = {
      stem: String(raw.stem ?? "").trim(),
      options: raw.options ?? { A: "", B: "", C: "", D: "", E: "" },
      correct_choice: String(raw.correct_choice ?? "A").toUpperCase(),
      explanation: String(raw.explanation ?? "").trim(),
      difficulty: raw.difficulty,
      strategy: raw.strategy,
      learning_objective: String(raw.learning_objective ?? ""),
      requires_image: Boolean(raw.requires_image),
    };
    const check = validateGenerated(q);
    const objectiveId = matchObjective(q.learning_objective, ctx.objectives);
    const { data: existingHash } = await admin
      .from("questions")
      .select("id")
      .eq("canonical_topic_id", ctx.canonicalTopicId)
      .eq("stem", q.stem)
      .maybeSingle();
    if (existingHash) {
      skipped += 1;
      continue;
    }
    const status = check.ok ? "generated" : "needs_review";
    const { data: row, error } = await admin
      .from("questions")
      .insert({
        stem: q.stem,
        choices: q.options,
        correct_choice: q.correct_choice,
        explanation: q.explanation,
        difficulty: q.difficulty,
        question_strategy: q.strategy,
        question_status: status,
        source_type: ctx.sourceType,
        is_published: false,
        canonical_topic_id: ctx.canonicalTopicId,
        canonical_unit_id: ctx.canonicalUnitId,
        canonical_subject_id: ctx.canonicalSubjectId,
        curriculum_version_id: ctx.versionId,
        exam_catalog_id: ctx.examCatalogId,
        memory_lesson_id: ctx.lessonId,
        curriculum_question_set_id: ctx.setId,
        learning_objective_id: objectiveId,
        needs_image: q.requires_image,
        generation_model: QUESTION_GEN_MODEL,
        generated_at: new Date().toISOString(),
        prompt_version: QUESTION_GEN_PROMPT,
      })
      .select("id")
      .single();
    if (error || !row) {
      skipped += 1;
      continue;
    }
    if (objectiveId) {
      await admin.from("objective_question_coverage").insert({
        canonical_topic_id: ctx.canonicalTopicId,
        learning_objective_id: objectiveId,
        question_id: row.id,
      }).then(() => undefined, () => undefined);
    }
    inserted += 1;
  }
  return { inserted, skipped };
}

async function syncLessonQuestions(admin: ReturnType<typeof serviceClient>, lessonId: string) {
  const { data: lesson } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
  if (!lesson?.canonical_topic_id) return { inserted: 0, skipped: 0, published: false, reason: "no_canonical" };
  const topicId = String(lesson.canonical_topic_id);
  const { data: unit } = lesson.canonical_topic_id
    ? await admin.from("canonical_topics").select("canonical_unit_id").eq("id", topicId).maybeSingle()
    : { data: null };
  const { data: unitRow } = unit?.canonical_unit_id
    ? await admin.from("canonical_units").select("canonical_subject_id").eq("id", unit.canonical_unit_id).maybeSingle()
    : { data: null };
  const { data: rows } = await admin.from("memory_lesson_questions").select("*").eq("lesson_id", lessonId);
  const checkpointSet = await ensureSet(admin, topicId, "lesson_checkpoint", null, null, lessonId);
  const finalSet = await ensureSet(admin, topicId, "lesson_final", null, null, lessonId);
  const { data: objectives } = await admin.from("canonical_topic_learning_objectives").select("id, title").eq("canonical_topic_id", topicId);
  let inserted = 0;
  let skipped = 0;
  for (const row of rows ?? []) {
    const setId = row.question_type === "final" ? finalSet : checkpointSet;
    const options = row.options && typeof row.options === "object" ? row.options : {};
    const generated: GeneratedQuestion = {
      stem: String(row.question_text ?? ""),
      options: options as Record<string, string>,
      correct_choice: String(row.correct_answer ?? "A"),
      explanation: String(row.explanation ?? ""),
      difficulty: (row.difficulty as GeneratedQuestion["difficulty"]) || "medium",
      strategy: String(row.question_strategy ?? "direct_recall"),
      learning_objective: "",
      requires_image: false,
    };
    const result = await insertBatch(admin, [generated], {
      canonicalTopicId: topicId,
      setId,
      versionId: null,
      examCatalogId: null,
      lessonId,
      sourceType: "memory_lesson",
      objectives: (objectives ?? []) as { id: string; title: string }[],
      canonicalUnitId: unit?.canonical_unit_id ?? null,
      canonicalSubjectId: unitRow?.canonical_subject_id ?? null,
    });
    inserted += result.inserted;
    skipped += result.skipped;
  }
  return { inserted, skipped, published: false };
}
