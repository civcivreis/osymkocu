import { json, mapHttpError, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import {
  MEMORY_LESSON_JSON_SCHEMA,
  MEMORY_LESSON_MODEL,
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
  const strategies = new Set(parsed.final_questions.map((item) => asStrategy(item.question_strategy)));
  if (strategies.size < 3) throw new Error("INVALID_PACKAGE");
  return parsed;
}

async function generatePackage(apiKey: string, ctx: {
  exam: string;
  subject: string;
  unit: string;
  topic: string;
  title: string;
}) {
  const payload = {
    model: MEMORY_LESSON_MODEL,
    temperature: 0.3,
    max_tokens: 8192,
    messages: buildMemoryLessonMessages(ctx),
    response_format: { type: "json_schema", json_schema: MEMORY_LESSON_JSON_SCHEMA },
  };
  let response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 400) {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, response_format: { type: "json_object" } }),
    });
  }
  if (!response.ok) {
    const raw = await response.text();
    console.error("openai http", response.status, raw.slice(0, 400));
    throw new Error(response.status === 401 || response.status === 429 ? "AI_PROVIDER" : "AI_PROVIDER");
  }
  const body = await response.json();
  const content = String(body.choices?.[0]?.message?.content ?? "");
  return { pkg: parsePackage(content), tokens: Number(body.usage?.total_tokens ?? 0) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
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

    const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

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

    const { pkg } = await generatePackage(apiKey, {
      exam: examName,
      subject: subjectName,
      unit: unitName,
      topic: topicName,
      title: String(lesson.title ?? topicName),
    });

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
        duration_sec: Math.round(cursor / 1000),
        status: "pending_validation",
        generation_status: "succeeded",
        generation_model: MEMORY_LESSON_MODEL,
        generated_at: new Date().toISOString(),
        prompt_version: MEMORY_LESSON_PROMPT_VERSION,
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
      const friendly = error instanceof Error && error.message === "INVALID_PACKAGE"
        ? "Üretilen paket eksik. Tekrar dene."
        : error instanceof Error && error.message === "AI_NOT_CONFIGURED"
          ? "OPENAI_API_KEY yok."
        : "İçerik üretilemedi.";
      await admin.from("memory_lessons").update({
        status: previousStatus === "generating" ? "draft" : previousStatus,
        generation_status: "failed",
        generation_error: friendly,
      }).eq("id", lessonId).then(() => undefined, () => undefined);
    }
    if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
      return json({ error: { code: "AI_NOT_CONFIGURED", message: "OPENAI_API_KEY sırrı yok." } }, 503);
    }
    if (error instanceof Error && error.message === "INVALID_PACKAGE") {
      return json({ error: { code: "INVALID_PACKAGE", message: "Üretilen paket eksik. Tekrar dene." } }, 502);
    }
    if (error instanceof Error && error.message === "AI_PROVIDER") {
      return json({ error: { code: "PROVIDER_ERROR", message: "Üretim servisi yanıt vermedi." } }, 502);
    }
    console.error("memory-lesson-generate", error);
    return mapHttpError(error);
  }
});
