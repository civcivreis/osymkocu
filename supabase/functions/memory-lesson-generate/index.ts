import { json, mapHttpError, preflight, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import { generateStructured, generationMeta, friendlyAiError } from "../_shared/aiRouter.ts";
import {
  MEMORY_LESSON_JSON_SCHEMA,
  MEMORY_LESSON_PROMPT_VERSION,
  MEMORY_PEDAGOGY_VERSION,
  MEMORY_TECHNIQUES,
  QUESTION_STRATEGIES,
  buildMemoryLessonMessages,
} from "../_shared/memoryLessonPrompt.ts";

type Options = { A: string; B: string; C: string; D: string; E: string };
type GenQuestion = {
  order: number;
  question_text: string;
  options: Options;
  correct_answer: string;
  explanation: string;
  question_strategy: string;
};
type GenScene = {
  order: number;
  narration_text: string;
  caption: string;
  memory_hook: string;
  memory_technique: string;
  memory_target: string;
  visual_anchor: string;
  recall_prompt: string;
  reinforcement_note: string;
  visual_description: string;
  estimated_duration_sec: number;
  journey_step: string;
};
type CoreFact = {
  fact: string;
  technique: string;
  visual_anchor: string;
  recall_prompt: string;
};
type ExamTechnique = {
  know: string;
  recognize: string;
  solve: string;
  recognition_trigger: string;
  first_move: string;
  fast_strategy: string;
  common_traps: string;
  elimination_rules: string;
  when_not_to_use: string;
  stem_signals: string[];
  heuristic_kind: string;
  aaa_bu_suydu: boolean;
};
type Package = {
  title: string;
  summary: string;
  learning_objectives: string[];
  narration: string;
  memory_hooks: string[];
  primary_memory_technique: string;
  memory_techniques: string[];
  memory_journey_title: string;
  memory_journey_summary: string;
  core_facts: CoreFact[];
  scenes: GenScene[];
  checkpoint_questions: GenQuestion[];
  final_questions: GenQuestion[];
  minimum_theory: string;
  fast_rule: string;
  exam_technique: ExamTechnique;
};

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

const TECHNIQUE_SET = new Set<string>(MEMORY_TECHNIQUES);
const STRATEGY_SET = new Set<string>(QUESTION_STRATEGIES);

function asTechnique(value: unknown) {
  const key = String(value ?? "").trim();
  return TECHNIQUE_SET.has(key) ? key : "visual_association";
}

function asStrategy(value: unknown) {
  const key = String(value ?? "").trim();
  return STRATEGY_SET.has(key) ? key : "direct_recall";
}

function parsePackage(raw: string): Package {
  const parsed = JSON.parse(raw) as Package;
  if (!parsed || typeof parsed !== "object") throw new Error("INVALID_PACKAGE");
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 4) throw new Error("INVALID_PACKAGE");
  if (!Array.isArray(parsed.final_questions) || parsed.final_questions.length !== 10) {
    throw new Error("INVALID_PACKAGE");
  }
  if (!Array.isArray(parsed.checkpoint_questions) || parsed.checkpoint_questions.length < 2 || parsed.checkpoint_questions.length > 4) {
    throw new Error("INVALID_PACKAGE");
  }
  if (!Array.isArray(parsed.core_facts) || parsed.core_facts.length < 5 || parsed.core_facts.length > 12) {
    throw new Error("INVALID_PACKAGE");
  }
  if (!Array.isArray(parsed.memory_techniques) || parsed.memory_techniques.length < 1) {
    throw new Error("INVALID_PACKAGE");
  }
  if (!parsed.exam_technique?.recognition_trigger || !parsed.fast_rule?.trim() || !parsed.minimum_theory?.trim()) {
    throw new Error("INVALID_PACKAGE");
  }
  if (parsed.exam_technique.aaa_bu_suydu !== true) throw new Error("INVALID_PACKAGE");
  const strategies = new Set(parsed.final_questions.map((item) => asStrategy(item.question_strategy)));
  if (strategies.size < 3) throw new Error("INVALID_PACKAGE");
  const techMoves = parsed.checkpoint_questions.filter((item) =>
    ["first_move", "pattern_recognition", "elimination"].includes(asStrategy(item.question_strategy))
  );
  if (techMoves.length < 1) throw new Error("INVALID_PACKAGE");
  return parsed;
}

async function generatePackage(ctx: {
  exam: string;
  subject: string;
  unit: string;
  topic: string;
  title: string;
  patterns?: string;
}, lessonId: string) {
  const messages = buildMemoryLessonMessages(ctx);
  const generated = await generateStructured("lesson_generation", messages, MEMORY_LESSON_JSON_SCHEMA, {
    promptVersion: MEMORY_LESSON_PROMPT_VERSION,
    lessonId,
    cache: true,
  });
  let pkg: Package;
  try {
    pkg = parsePackage(generated.text);
  } catch {
    throw new Error("INVALID_PACKAGE");
  }
  try {
    await generateStructured("exam_technique_validation", [
      {
        role: "system",
        content:
          "Sınav tekniğini doğrula. JSON: {ok,reliable,faster,has_limits,false_absolute,maps_to_exam,recognizable,saves_work,memorable_cue,issues:string[]}. Sezgiyi kural diye satan paketi reddet.",
      },
      { role: "user", content: JSON.stringify(pkg.exam_technique) },
    ], {
      name: "technique_check",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "reliable", "faster", "has_limits", "false_absolute", "maps_to_exam", "recognizable", "saves_work", "memorable_cue", "issues"],
        properties: {
          ok: { type: "boolean" },
          reliable: { type: "boolean" },
          faster: { type: "boolean" },
          has_limits: { type: "boolean" },
          false_absolute: { type: "boolean" },
          maps_to_exam: { type: "boolean" },
          recognizable: { type: "boolean" },
          saves_work: { type: "boolean" },
          memorable_cue: { type: "boolean" },
          issues: { type: "array", items: { type: "string" } },
        },
      },
    }, { promptVersion: MEMORY_PEDAGOGY_VERSION, lessonId, cache: true });
  } catch (error) {
    console.error("technique check skipped", error instanceof Error ? error.message : error);
  }
  try {
    const quality = await generateStructured("lesson_quality_validation", [
      { role: "system", content: "ÖSYM ders paketi kalite kontrolü. JSON: {ok:boolean,issues:string[]}" },
      { role: "user", content: generated.text.slice(0, 8000) },
    ], {
      name: "lesson_quality",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "issues"],
        properties: { ok: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
      },
    }, { promptVersion: MEMORY_LESSON_PROMPT_VERSION, lessonId, cache: false });
    const parsed = quality.parsed as { ok?: boolean };
    if (parsed?.ok === false) {
      const retry = await generateStructured("lesson_generation", [
        ...messages,
        { role: "user", content: `Önceki paket reddedildi. Düzelt: ${JSON.stringify(quality.parsed)}` },
      ], MEMORY_LESSON_JSON_SCHEMA, { promptVersion: MEMORY_LESSON_PROMPT_VERSION, lessonId, cache: false });
      pkg = parsePackage(retry.text);
      return { pkg, meta: generationMeta(retry, { prompt_version: MEMORY_LESSON_PROMPT_VERSION, retry_count: 1, input_hash: null }) };
    }
  } catch (error) {
    console.error("lesson quality skipped", error instanceof Error ? error.message : error);
  }
  return { pkg, meta: generationMeta(generated, { prompt_version: MEMORY_LESSON_PROMPT_VERSION, retry_count: 0 }) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") {
    return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);
  }

  const admin = serviceClient();
  let lessonId = "";
  let previousStatus = "draft";

  try {
    await requireLessonAdmin(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const payload = (body?.payload ?? body ?? {}) as Record<string, unknown>;
    lessonId = String(payload.lesson_id ?? "").trim();
    if (!lessonId) {
      return json({ error: { code: "INVALID_INPUT", message: "lesson_id gerekli." } }, 400);
    }

    const { data: lesson } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();
    if (!lesson) {
      return json({ error: { code: "INVALID_INPUT", message: "Ders bulunamadı." } }, 404);
    }
    previousStatus = String(lesson.status ?? "draft");
    if (previousStatus === "published") {
      return json({ error: { code: "INVALID_INPUT", message: "Yayındaki ders yeniden üretilemez." } }, 400);
    }

    let examName = String(lesson.exam_type ?? "");
    let subjectName = String(lesson.subject ?? "");
    let unitName = String(lesson.unit ?? "");
    let topicName = String(lesson.topic ?? "");

    if (lesson.topic_id) {
      const { data: topicRow } = await admin.from("topic_catalog").select("id, name, unit_id").eq("id", lesson.topic_id).maybeSingle();
      if (topicRow) {
        topicName = topicRow.name;
        const { data: unitRow } = await admin.from("unit_catalog").select("id, name, subject_id").eq("id", topicRow.unit_id).maybeSingle();
        if (unitRow) {
          unitName = unitRow.name;
          const { data: subjectRow } = await admin.from("subject_catalog").select("id, name, exam_id").eq("id", unitRow.subject_id).maybeSingle();
          if (subjectRow) {
            subjectName = subjectRow.name;
            const { data: examRow } = await admin.from("exam_catalog").select("id, name, code").eq("id", subjectRow.exam_id).maybeSingle();
            if (examRow) examName = examRow.name;
          }
        }
      }
    }

    await admin.from("memory_lessons").update({
      status: "generating",
      generation_status: "generating",
      generation_error: null,
    }).eq("id", lessonId);

    if (lesson.topic_id) {
      await admin.from("topic_catalog").update({ content_status: "generating" }).eq("id", lesson.topic_id);
    }

    let patternText = "";
    if (lesson.canonical_topic_id) {
      const { data: patterns } = await admin
        .from("exam_question_patterns")
        .select("name, recognition_trigger, fast_strategy, common_traps, elimination_rules, when_not_to_use, example_signals")
        .eq("canonical_topic_id", lesson.canonical_topic_id)
        .order("priority", { ascending: true });
      if (patterns?.length) patternText = JSON.stringify(patterns);
    }

    const { pkg, meta } = await generatePackage({
      exam: examName,
      subject: subjectName,
      unit: unitName,
      topic: topicName,
      title: String(lesson.title ?? topicName),
      patterns: patternText,
    }, lessonId);

    await admin.from("memory_lesson_review_anchors").delete().eq("lesson_id", lessonId);
    await admin.from("memory_lesson_questions").delete().eq("lesson_id", lessonId);
    await admin.from("memory_lesson_scenes").delete().eq("lesson_id", lessonId);

    const scenes = [...pkg.scenes].sort((a, b) => a.order - b.order);
    let cursor = 0;
    const sceneRows = scenes.map((scene, index) => {
      const duration = Math.max(5, Math.min(90, Number(scene.estimated_duration_sec) || 30));
      const start = cursor;
      cursor += duration * 1000;
      return {
        lesson_id: lessonId,
        scene_order: index + 1,
        start_ms: start,
        end_ms: cursor,
        asset_type: "image",
        caption: String(scene.caption ?? "").slice(0, 500),
        narration_text: String(scene.narration_text ?? ""),
        memory_hook: String(scene.memory_hook ?? ""),
        visual_description: String(scene.visual_description ?? ""),
        memory_technique: asTechnique(scene.memory_technique),
        memory_target: String(scene.memory_target ?? "").slice(0, 500),
        visual_anchor: String(scene.visual_anchor ?? "").slice(0, 400),
        recall_prompt: String(scene.recall_prompt ?? "").slice(0, 300),
        reinforcement_note: String(scene.reinforcement_note ?? "").slice(0, 400),
        journey_step: String(scene.journey_step ?? "").slice(0, 160),
        visual_priority: index === 0 ? "premium" : String(scene.visual_anchor ?? "").trim().length > 12 ? "key_anchor" : "standard",
      };
    });
    const { error: sceneError } = await admin.from("memory_lesson_scenes").insert(sceneRows);
    if (sceneError) throw sceneError;

    const finalDifficulty = (index: number) => (index < 3 ? "easy" : index < 7 ? "medium" : "hard");
    const seen = new Set<string>();
    const questionRows = [
      ...pkg.checkpoint_questions.map((item, index) => ({
        lesson_id: lessonId,
        question_type: "checkpoint",
        question_order: index + 1,
        question_text: String(item.question_text ?? ""),
        options: item.options ?? {},
        correct_answer: String(item.correct_answer ?? "A").slice(0, 1).toUpperCase(),
        explanation: String(item.explanation ?? ""),
        question_strategy: asStrategy(item.question_strategy),
        difficulty: "medium",
        canonical_topic_id: lesson.canonical_topic_id ?? null,
        technique_role: asStrategy(item.question_strategy),
      })),
      ...pkg.final_questions.map((item, index) => ({
        lesson_id: lessonId,
        question_type: "final",
        question_order: index + 1,
        question_text: String(item.question_text ?? ""),
        options: item.options ?? {},
        correct_answer: String(item.correct_answer ?? "A").slice(0, 1).toUpperCase(),
        explanation: String(item.explanation ?? ""),
        question_strategy: asStrategy(item.question_strategy),
        difficulty: finalDifficulty(index),
        canonical_topic_id: lesson.canonical_topic_id ?? null,
        technique_role: asStrategy(item.question_strategy),
      })),
    ].filter((row) => {
      const optionValues = Object.values(row.options as Record<string, string>).map((value) => String(value).trim().toLowerCase()).sort().join("|");
      const key = `${row.question_text.trim().toLowerCase()}|${optionValues}|${row.correct_answer}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const { error: qError } = await admin.from("memory_lesson_questions").insert(questionRows);
    if (qError) throw qError;

    const { data: updated, error: upError } = await admin
      .from("memory_lessons")
      .update({
        title: String(pkg.title || lesson.title).slice(0, 160),
        description: String(pkg.summary ?? "").slice(0, 2000),
        narration: pkg.narration,
        learning_objectives: asStringArray(pkg.learning_objectives),
        memory_hooks: asStringArray(pkg.memory_hooks),
        primary_memory_technique: asTechnique(pkg.primary_memory_technique),
        memory_techniques: [...new Set(asStringArray(pkg.memory_techniques).map(asTechnique))],
        core_facts: (pkg.core_facts ?? []).map((fact) => ({
          fact: String(fact.fact ?? ""),
          technique: asTechnique(fact.technique),
          visual_anchor: String(fact.visual_anchor ?? ""),
          recall_prompt: String(fact.recall_prompt ?? ""),
        })),
        memory_journey_title: String(pkg.memory_journey_title ?? "").slice(0, 120),
        memory_journey_summary: String(pkg.memory_journey_summary ?? "").slice(0, 2000),
        pedagogy_version: MEMORY_PEDAGOGY_VERSION,
        minimum_theory: String(pkg.minimum_theory ?? "").slice(0, 4000),
        fast_rule: String(pkg.fast_rule ?? "").slice(0, 600),
        exam_technique: pkg.exam_technique ?? {},
        duration_sec: Math.round(cursor / 1000),
        status: "pending_validation",
        generation_status: "succeeded",
        generation_model: meta.model,
        generated_at: new Date().toISOString(),
        prompt_version: MEMORY_LESSON_PROMPT_VERSION,
        generation_metadata: meta,
        generation_error: null,
      })
      .eq("id", lessonId)
      .select("*")
      .single();
    if (upError) throw upError;

    if (lesson.topic_id) {
      await admin.from("topic_catalog").update({ content_status: "pending_validation" }).eq("id", lesson.topic_id);
    }

    await admin.rpc("refresh_memory_lesson_pedagogy", { p_id: lessonId });
    const { data: scored } = await admin.from("memory_lessons").select("*").eq("id", lessonId).maybeSingle();

    return json({ lesson: scored ?? updated });
  } catch (error) {
    if (lessonId) {
      const mapped = error instanceof Error && error.message === "INVALID_PACKAGE"
        ? { text: "Üretilen paket eksik. Tekrar dene." }
        : friendlyAiError(error, "lesson");
      const friendly = mapped.text;
      await admin.from("memory_lessons").update({
        status: previousStatus === "generating" ? "draft" : previousStatus,
        generation_status: "failed",
        generation_error: friendly,
      }).eq("id", lessonId).then(() => undefined, () => undefined);
    }
    if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
      return json({ error: { code: "AI_NOT_CONFIGURED", message: "AI yapılandırması eksik." } }, 503);
    }
    if (error instanceof Error && error.message === "INVALID_PACKAGE") {
      return json({ error: { code: "INVALID_PACKAGE", message: "Üretilen paket eksik. Tekrar dene." } }, 502);
    }
    if (error instanceof Error && ["AI_PROVIDER", "AI_RETRYABLE", "AI_TIMEOUT"].includes(error.message)) {
      return json({ error: { code: "PROVIDER_ERROR", message: "Ders içeriği üretilemedi." } }, 502);
    }
    console.error("memory-lesson-generate", error);
    return mapHttpError(error, req);
  }
});
