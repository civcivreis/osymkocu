import { json, mapHttpError, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import {
  DECOMPOSE_MODEL,
  DECOMPOSE_PROMPT_VERSION,
  TOPIC_SCHEMA,
  TOPIC_SYSTEM,
  UNIT_SCHEMA,
  UNIT_SYSTEM,
  foldName,
  isTooBroad,
  namesOverlap,
} from "../_shared/curriculumDecompose.ts";

type ExistingTopic = {
  id: string;
  name: string;
  slug: string;
  canonical_unit_id: string;
};

async function chatJson(apiKey: string, system: string, user: string, schema: unknown) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DECOMPOSE_MODEL,
      temperature: 0.2,
      max_tokens: 4500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: schema },
    }),
  });
  if (!response.ok) throw new Error("AI_PROVIDER");
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const raw = payload.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(raw) as Record<string, unknown>;
}

function matchExisting(title: string, existing: ExistingTopic[]) {
  const hit = existing.find((row) => namesOverlap(title, row.name) || foldName(title) === foldName(row.name));
  if (!hit) return { match_status: "NEW" as const, matched_canonical_topic_id: null as string | null, matched_title: null as string | null };
  return { match_status: "MATCH_EXISTING" as const, matched_canonical_topic_id: hit.id, matched_title: hit.name };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  try {
    const user = await requireLessonAdmin(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const mode = String(body?.mode ?? "");
    if (mode !== "unit" && mode !== "topic") {
      return json({ error: { code: "INVALID_INPUT", message: "mode unit veya topic olmalı." } }, 400);
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: { code: "AI_NOT_CONFIGURED", message: "OPENAI_API_KEY sırrı yok." } }, 503);

    const admin = serviceClient();
    if (mode === "unit") {
      return await decomposeUnit(admin, user.id, apiKey, body ?? {});
    }
    return await decomposeTopic(admin, user.id, apiKey, body ?? {});
  } catch (error) {
    if (error instanceof Error && error.message === "AI_PROVIDER") {
      return json({ error: { code: "PROVIDER_ERROR", message: "Analiz servisi yanıt vermedi." } }, 502);
    }
    console.error("curriculum-decompose", error);
    return mapHttpError(error);
  }
});

async function decomposeUnit(
  admin: ReturnType<typeof serviceClient>,
  userId: string,
  apiKey: string,
  body: Record<string, unknown>,
) {
  const unitId = String(body.unit_id ?? "");
  const subjectId = String(body.subject_id ?? "");
  const versionId = String(body.curriculum_version_id ?? "");
  if (!unitId || !subjectId) {
    return json({ error: { code: "INVALID_INPUT", message: "unit_id ve subject_id gerekli." } }, 400);
  }

  const { data: unit } = await admin.from("unit_catalog").select("id, name, canonical_unit_id, subject_id").eq("id", unitId).maybeSingle();
  const { data: subject } = await admin.from("subject_catalog").select("id, name, exam_id, canonical_subject_id").eq("id", subjectId).maybeSingle();
  if (!unit || !subject) return json({ error: { code: "INVALID_INPUT", message: "Ünite veya ders bulunamadı." } }, 400);
  const { data: exam } = await admin.from("exam_catalog").select("id, name, code").eq("id", subject.exam_id).maybeSingle();
  const { data: version } = versionId
    ? await admin.from("curriculum_versions").select("*").eq("id", versionId).maybeSingle()
    : await admin.rpc("get_active_curriculum_version", { p_exam_id: subject.exam_id });
  const versionRow = Array.isArray(version) ? version[0] : version;

  const { data: catalogTopics } = await admin.from("topic_catalog").select("id, name, canonical_topic_id").eq("unit_id", unitId);
  const canonicalUnitId = unit.canonical_unit_id as string | null;
  const { data: canonicalTopics } = canonicalUnitId
    ? await admin.from("canonical_topics").select("id, name, slug, canonical_unit_id").eq("canonical_unit_id", canonicalUnitId)
    : { data: [] as ExistingTopic[] };
  const existing = (canonicalTopics ?? []) as ExistingTopic[];

  const { data: maps } = versionRow?.id
    ? await admin.from("exam_topic_map").select("canonical_topic_id, coverage_mode, depth_level, exam_notes, required_points, excluded_points, prerequisite_canonical_topic_ids, included").eq("curriculum_version_id", versionRow.id).eq("unit_id", unitId)
    : { data: [] };

  const userPrompt = [
    `Sınav: ${exam?.name ?? ""} (${exam?.code ?? ""})`,
    `Aktif müfredat: ${versionRow?.name ?? "yok"} ${versionRow?.revision_label ?? ""}`,
    `Ders: ${subject.name}`,
    `Ünite: ${unit.name}`,
    `Mevcut kanonik konular: ${(existing).map((row) => row.name).join(", ") || "yok"}`,
    `Katalog konuları: ${(catalogTopics ?? []).map((row: { name: string }) => row.name).join(", ") || "yok"}`,
    `Eşlemeler: ${JSON.stringify(maps ?? [])}`,
    "Hedef ders 5–10 dk / 5–12 olgu. Kapsam dışına çıkma. Mümkünse mevcut konuları tekrar etme.",
  ].join("\n");

  const ai = await chatJson(apiKey, UNIT_SYSTEM, userPrompt, UNIT_SCHEMA);
  const recommended = Array.isArray(ai.recommended_topics) ? ai.recommended_topics as Record<string, unknown>[] : [];
  const duplicates: { title: string; existing_title: string; reason: string }[] = [];
  const items = recommended.map((row, index) => {
    const title = String(row.title ?? "").trim();
    const match = matchExisting(title, existing);
    if (match.match_status === "MATCH_EXISTING") {
      duplicates.push({ title, existing_title: match.matched_title ?? "", reason: "Aynı veya çok yakın kanonik konu var." });
    }
    const broad = isTooBroad({
      estimated_minutes: Number(row.estimated_minutes),
      estimated_core_fact_count: Number(row.estimated_core_fact_count),
      estimated_scene_count: Number(row.estimated_scene_count),
      independent_entity_count: Number(row.independent_entity_count),
      memory_journey_feasibility: String(row.memory_journey_feasibility ?? "medium"),
    });
    return {
      id: crypto.randomUUID(),
      selected: true,
      title,
      description: String(row.description ?? ""),
      estimated_minutes: Number(row.estimated_minutes ?? 7),
      estimated_core_fact_count: Number(row.estimated_core_fact_count ?? 7),
      estimated_scene_count: Number(row.estimated_scene_count ?? 6),
      independent_entity_count: Number(row.independent_entity_count ?? 1),
      importance: String(row.importance ?? "core"),
      reason: String(row.reason ?? ""),
      memory_journey_feasibility: String(row.memory_journey_feasibility ?? "medium"),
      too_broad: broad,
      learning_objectives: Array.isArray(row.learning_objectives) ? row.learning_objectives.map((item) => String(item)) : [],
      match_status: match.match_status,
      matched_canonical_topic_id: match.matched_canonical_topic_id,
      matched_title: match.matched_title,
      match_action: match.match_status === "MATCH_EXISTING" ? "use_existing" : "create",
      item_order: index,
    };
  });

  const { data: proposal, error } = await admin.from("curriculum_decomposition_proposals").insert({
    mode: "unit",
    status: "draft",
    curriculum_version_id: versionRow?.id ?? null,
    exam_id: exam?.id ?? null,
    subject_id: subjectId,
    unit_id: unitId,
    canonical_unit_id: canonicalUnitId,
    title: String(ai.unit_title ?? unit.name),
    ai_payload: { ...ai, prompt_version: DECOMPOSE_PROMPT_VERSION, model: DECOMPOSE_MODEL },
    items,
    coverage_warnings: ai.coverage_warnings ?? [],
    missing_areas: ai.missing_areas ?? [],
    possible_duplicates: [...(Array.isArray(ai.possible_duplicates) ? ai.possible_duplicates : []), ...duplicates],
    created_by: userId,
  }).select("*").single();
  if (error || !proposal) throw error ?? new Error("PROPOSAL_FAILED");

  return json({ proposal, queued: false });
}

async function decomposeTopic(
  admin: ReturnType<typeof serviceClient>,
  userId: string,
  apiKey: string,
  body: Record<string, unknown>,
) {
  const topicId = String(body.canonical_topic_id ?? "");
  if (!topicId) return json({ error: { code: "INVALID_INPUT", message: "canonical_topic_id gerekli." } }, 400);
  const { data: topic } = await admin.from("canonical_topics").select("*").eq("id", topicId).maybeSingle();
  if (!topic) return json({ error: { code: "INVALID_INPUT", message: "Kanonik konu bulunamadı." } }, 400);
  const { data: unit } = await admin.from("canonical_units").select("*").eq("id", topic.canonical_unit_id).maybeSingle();
  const { data: subject } = unit
    ? await admin.from("canonical_subjects").select("*").eq("id", unit.canonical_subject_id).maybeSingle()
    : { data: null };
  const { data: objectives } = await admin.from("canonical_topic_learning_objectives").select("title").eq("canonical_topic_id", topicId);
  const { data: lessons } = await admin.from("memory_lessons").select("id, title, status, exam_type").eq("canonical_topic_id", topicId);
  const { data: siblings } = await admin.from("canonical_topics").select("id, name, slug, canonical_unit_id").eq("canonical_unit_id", topic.canonical_unit_id);

  const { data: mapRows } = await admin
    .from("exam_topic_map")
    .select("coverage_mode, depth_level, exam_notes, required_points, excluded_points, curriculum_version_id")
    .eq("canonical_topic_id", topicId);

  const userPrompt = [
    `Kanonik ders: ${subject?.name ?? ""}`,
    `Kanonik ünite: ${unit?.name ?? ""}`,
    `Kanonik konu: ${topic.name}`,
    `Eşlemeler: ${JSON.stringify(mapRows ?? [])}`,
    `Mevcut kazanımlar: ${(objectives ?? []).map((row: { title: string }) => row.title).join("; ") || "yok"}`,
    `Mevcut dersler: ${(lessons ?? []).map((row: { title: string; status: string }) => `${row.title} (${row.status})`).join(", ") || "yok"}`,
    `Komşu konular: ${(siblings ?? []).map((row: { name: string }) => row.name).join(", ")}`,
    "Pedagoji: 5–10 dk, 5–12 olgu, tek bellek yolculuğu. Soru/medya üretme.",
  ].join("\n");

  const ai = await chatJson(apiKey, TOPIC_SYSTEM, userPrompt, TOPIC_SCHEMA);
  const minutes = Number(ai.estimated_minutes ?? 8);
  const facts = Number(ai.estimated_core_fact_count ?? 7);
  const broad = Boolean(ai.too_broad_for_single_lesson) || isTooBroad({
    estimated_minutes: minutes,
    estimated_core_fact_count: facts,
    estimated_scene_count: Number(ai.estimated_scene_count),
    independent_entity_count: Number(ai.independent_entity_count),
    memory_journey_feasibility: String(ai.memory_journey_feasibility ?? "medium"),
  });
  const trivial = minutes <= 10 && facts <= 8 && Number(ai.independent_entity_count ?? 1) < 2;
  const tooBroad = trivial ? false : broad;

  const segments = Array.isArray(ai.segments) ? ai.segments as Record<string, unknown>[] : [];
  const existing = (siblings ?? []) as ExistingTopic[];
  const items = segments.map((row, index) => {
    const title = String(row.title ?? "").trim();
    const match = matchExisting(title, existing);
    return {
      id: crypto.randomUUID(),
      selected: true,
      title,
      description: String(row.description ?? ""),
      estimated_minutes: Number(row.estimated_minutes ?? 6),
      estimated_core_fact_count: Number(row.estimated_core_fact_count ?? 6),
      should_have_own_lesson: Boolean(row.should_have_own_lesson),
      reason: String(row.reason ?? ""),
      too_broad: false,
      match_status: match.match_status,
      matched_canonical_topic_id: match.matched_canonical_topic_id,
      matched_title: match.matched_title,
      match_action: match.match_status === "MATCH_EXISTING" ? "use_existing" : "create",
      item_order: index,
      learning_objectives: [],
    };
  });

  const { data: proposal, error } = await admin.from("curriculum_decomposition_proposals").insert({
    mode: "topic",
    status: "draft",
    curriculum_version_id: String(body.curriculum_version_id ?? "") || null,
    exam_id: String(body.exam_id ?? "") || null,
    subject_id: String(body.subject_id ?? "") || null,
    unit_id: String(body.unit_id ?? "") || null,
    canonical_topic_id: topicId,
    canonical_unit_id: topic.canonical_unit_id,
    title: topic.name,
    ai_payload: {
      ...ai,
      too_broad_for_single_lesson: tooBroad,
      prompt_version: DECOMPOSE_PROMPT_VERSION,
      model: DECOMPOSE_MODEL,
    },
    items,
    possible_duplicates: items.filter((item) => item.match_status === "MATCH_EXISTING").map((item) => ({
      title: item.title,
      existing_title: item.matched_title,
      reason: "Mevcut kanonik konu ile çakışıyor.",
    })),
    created_by: userId,
  }).select("*").single();
  if (error || !proposal) throw error ?? new Error("PROPOSAL_FAILED");

  return json({ proposal, queued: false });
}
