import { json, mapHttpError, preflight, requireFactoryCaller, serviceClient } from "../_shared/lessonHttp.ts";
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

class PackageError extends Error {
  code: string;
  details: string[];
  constructor(code: string, details: string[] = []) {
    super(code);
    this.name = "PackageError";
    this.code = code;
    this.details = details;
  }
}

function asCleanArray(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  return value;
}

function asBool(value: unknown) {
  if (value === true || value === "true" || value === 1) return true;
  if (value === false || value === "false" || value === 0) return false;
  return value;
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function parsePackage(raw: string): Package {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new PackageError("SCHEMA_PARSE_FAILED", [`raw_length=${raw.length}`]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PackageError("SCHEMA_PARSE_FAILED", ["root_not_object"]);
  }

  const learning = asCleanArray(parsed.learning_objectives);
  const hooks = asCleanArray(parsed.memory_hooks);
  const techniques = asCleanArray(parsed.memory_techniques);
  const facts = asCleanArray(parsed.core_facts);
  const scenes = asCleanArray(parsed.scenes);
  const checkpoints = asCleanArray(parsed.checkpoint_questions);
  const finals = asCleanArray(parsed.final_questions);
  if (learning === null) throw new PackageError("INVALID_ENUM", ["learning_objectives_not_array"]);
  if (hooks === null) throw new PackageError("INVALID_ENUM", ["memory_hooks_not_array"]);
  if (techniques === null) throw new PackageError("INVALID_ENUM", ["memory_techniques_not_array"]);
  if (facts === null) throw new PackageError("INVALID_ENUM", ["core_facts_not_array"]);
  if (scenes === null) throw new PackageError("NO_SCENES", ["scenes_not_array"]);
  if (checkpoints === null) throw new PackageError("INVALID_CHECKPOINT_COUNT", ["checkpoint_questions_not_array"]);
  if (finals === null) throw new PackageError("INVALID_QUESTION_PATTERN", ["final_questions_not_array"]);

  parsed.learning_objectives = learning.map((item) => String(item ?? "").trim()).filter(Boolean);
  parsed.memory_hooks = hooks.map((item) => String(item ?? "").trim()).filter(Boolean);
  parsed.memory_techniques = techniques.map((item) => String(item ?? "").trim()).filter(Boolean);
  parsed.title = String(parsed.title ?? "").trim();
  parsed.summary = String(parsed.summary ?? "").trim();
  parsed.narration = String(parsed.narration ?? "").trim();
  parsed.minimum_theory = String(parsed.minimum_theory ?? "").trim();
  parsed.fast_rule = String(parsed.fast_rule ?? "").trim();
  parsed.memory_journey_title = String(parsed.memory_journey_title ?? "").trim();
  parsed.memory_journey_summary = String(parsed.memory_journey_summary ?? "").trim();

  const technique = (parsed.exam_technique ?? {}) as Record<string, unknown>;
  if (technique && typeof technique === "object") {
    technique.aaa_bu_suydu = asBool(technique.aaa_bu_suydu);
    const signals = asCleanArray(technique.stem_signals);
    technique.stem_signals = signals === null ? [] : signals.map((item) => String(item ?? "").trim()).filter(Boolean);
    parsed.exam_technique = technique;
  }

  if (!parsed.title) throw new PackageError("MISSING_TITLE");
  if (!parsed.narration || wordCount(parsed.narration) < 80) {
    throw new PackageError("EMPTY_NARRATION", [`words=${wordCount(String(parsed.narration ?? ""))}`]);
  }
  if ((parsed.learning_objectives as string[]).length < 1) throw new PackageError("NO_LEARNING_OBJECTIVES");
  if (scenes.length < 6) throw new PackageError("NO_SCENES", [`count=${scenes.length}`]);
  if (scenes.length > 10) throw new PackageError("INVALID_SCENE_TIMING", [`count=${scenes.length}`]);
  for (const scene of scenes) {
    const row = scene as Record<string, unknown>;
    const duration = Number(row.estimated_duration_sec);
    if (!Number.isFinite(duration) || duration < 5 || duration > 90) {
      throw new PackageError("INVALID_SCENE_TIMING", [`duration=${row.estimated_duration_sec}`]);
    }
    row.estimated_duration_sec = Math.round(duration);
    row.narration_text = String(row.narration_text ?? "").trim();
    if (!row.narration_text) throw new PackageError("EMPTY_NARRATION", ["scene_narration_empty"]);
  }
  if (finals.length !== 10) throw new PackageError("INVALID_QUESTION_PATTERN", [`finals=${finals.length}`]);
  if (checkpoints.length < 2 || checkpoints.length > 4) {
    throw new PackageError("INVALID_CHECKPOINT_COUNT", [`count=${checkpoints.length}`]);
  }
  if (facts.length < 5 || facts.length > 12) {
    throw new PackageError("INVALID_QUESTION_PATTERN", [`core_facts=${facts.length}`]);
  }
  if ((parsed.memory_techniques as string[]).length < 1) throw new PackageError("INVALID_ENUM", ["memory_techniques_empty"]);
  const exam = parsed.exam_technique as ExamTechnique | undefined;
  if (!exam?.recognition_trigger || !parsed.fast_rule || !parsed.minimum_theory) {
    throw new PackageError("INVALID_QUESTION_PATTERN", ["missing_exam_technique_or_fast_rule_or_minimum_theory"]);
  }
  if (exam.aaa_bu_suydu !== true) throw new PackageError("INVALID_ENUM", ["aaa_bu_suydu_not_true"]);

  const rawStrategies = finals.map((item) => String((item as GenQuestion).question_strategy ?? "").trim());
  const unknown = rawStrategies.filter((key) => !STRATEGY_SET.has(key));
  if (unknown.length) throw new PackageError("INVALID_ENUM", [`question_strategy=${unknown.slice(0, 4).join(",")}`]);
  if (new Set(rawStrategies).size < 3) {
    throw new PackageError("INVALID_QUESTION_PATTERN", ["final_strategy_diversity<3"]);
  }
  const techMoves = checkpoints.filter((item) =>
    ["first_move", "pattern_recognition", "elimination"].includes(String((item as GenQuestion).question_strategy ?? ""))
  );
  if (techMoves.length < 1) {
    throw new PackageError("INVALID_QUESTION_PATTERN", ["checkpoint_missing_first_move_or_pattern_or_elimination"]);
  }
  return parsed as unknown as Package;
}

type StructuredGen = Awaited<ReturnType<typeof generateStructured>>;

function packageFeedback(error: PackageError) {
  return `The previous package is invalid because ${error.code}${error.details.length ? `: ${error.details.join("; ")}` : ""}. scenes must be 6-10, checkpoint_questions 2-4, final_questions exactly 10, core_facts 5-12, learning_objectives nonempty, narration long enough, exam_technique.aaa_bu_suydu true, at least 3 distinct final question_strategy values, and one checkpoint using first_move or pattern_recognition or elimination. Do not omit required arrays.`;
}

async function tryGenerate(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  lessonId: string,
  forcePremium: boolean,
): Promise<{ pkg: Package; generated: StructuredGen }> {
  const generated = await generateStructured("lesson_generation", messages, MEMORY_LESSON_JSON_SCHEMA, {
    promptVersion: MEMORY_LESSON_PROMPT_VERSION,
    lessonId,
    cache: false,
    forcePremium,
  });
  return { pkg: parsePackage(generated.text), generated };
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
  let generated: StructuredGen | undefined;
  let pkg: Package | undefined;
  let retryCount = 0;
  const run = async (feedback?: PackageError, premium = false) => {
    const payload = feedback
      ? [...messages, { role: "user" as const, content: packageFeedback(feedback) }]
      : messages;
    const result = await tryGenerate(payload, lessonId, premium);
    generated = result.generated;
    pkg = result.pkg;
  };
  try {
    await run();
  } catch (error) {
    if (!(error instanceof PackageError) && error instanceof Error && error.message !== "SCHEMA_PARSE_FAILED") {
      throw error;
    }
    let fail = error instanceof PackageError ? error : new PackageError(error instanceof Error ? error.message : "SCHEMA_PARSE_FAILED");
    retryCount = 1;
    try {
      await run(fail, false);
    } catch (second) {
      if (!(second instanceof PackageError) && second instanceof Error && second.message !== "SCHEMA_PARSE_FAILED") {
        throw second;
      }
      fail = second instanceof PackageError ? second : new PackageError(second instanceof Error ? second.message : "SCHEMA_PARSE_FAILED");
      retryCount = 2;
      await run(fail, true);
    }
  }
  if (!generated || !pkg) throw new PackageError("SCHEMA_PARSE_FAILED");
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
      retryCount += 1;
      return {
        pkg,
        meta: generationMeta(retry, {
          prompt_version: MEMORY_LESSON_PROMPT_VERSION,
          retry_count: retryCount,
          response_format: retry.responseFormat,
          raw_response_length: retry.rawResponseLength,
          generation_stage: "lesson_text",
        }),
      };
    }
  } catch (error) {
    console.error("lesson quality skipped", error instanceof Error ? error.message : error);
  }
  return {
    pkg,
    meta: generationMeta(generated, {
      prompt_version: MEMORY_LESSON_PROMPT_VERSION,
      retry_count: retryCount,
      response_format: generated.responseFormat,
      raw_response_length: generated.rawResponseLength,
      generation_stage: "lesson_text",
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") {
    return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);
  }

  const admin = serviceClient();
  let lessonId = "";
  let previousStatus = "draft";
  const failMeta: Record<string, unknown> = {
    generation_stage: "lesson_text",
    prompt_version: MEMORY_LESSON_PROMPT_VERSION,
  };

  try {
    await requireFactoryCaller(req);
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
    const code = error instanceof PackageError
      ? error.code
      : error instanceof Error
        ? error.message.split(":")[0].slice(0, 48)
        : "UNKNOWN";
    const details = error instanceof PackageError ? error.details : [];
    console.error("memory-lesson-generate", code, details, error);
    if (lessonId) {
      const mapped = error instanceof PackageError
        ? { text: "Üretilen paket şema kontrolünden geçmedi." }
        : friendlyAiError(error, "lesson");
      const friendly = `${mapped.text} (${code})`;
      await admin.from("memory_lessons").update({
        status: previousStatus === "generating" ? "draft" : previousStatus,
        generation_status: "failed",
        generation_error: friendly,
        generation_metadata: {
          ...failMeta,
          failure_code: code,
          schema_validation_errors: details,
          model: failMeta.model ?? null,
        },
      }).eq("id", lessonId).then(() => undefined, () => undefined);
    }
    if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
      return json({ error: { code: "AI_NOT_CONFIGURED", message: "AI yapılandırması eksik." } }, 503);
    }
    if (error instanceof PackageError || code === "SCHEMA_PARSE_FAILED") {
      return json({
        error: {
          code,
          message: "Üretilen paket şema kontrolünden geçmedi.",
          details,
        },
      }, 502);
    }
    if (error instanceof Error && (error.message.startsWith("AI_PROVIDER") || ["AI_RETRYABLE", "AI_TIMEOUT"].includes(error.message))) {
      return json({ error: { code: "PROVIDER_ERROR", message: "Ders içeriği üretilemedi." } }, 502);
    }
    return mapHttpError(error, req);
  }
});
