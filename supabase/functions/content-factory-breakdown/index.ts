import { json, mapHttpError, preflight, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import { generateStructured } from "../_shared/aiRouter.ts";

type Suggestion = { name: string; note?: string };

function parseSuggestions(raw: string): Suggestion[] {
  const parsed = JSON.parse(raw) as { topics?: Suggestion[] };
  const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
  return topics
    .map((item) => ({ name: String(item?.name ?? "").trim().slice(0, 160), note: String(item?.note ?? "").slice(0, 240) }))
    .filter((item) => item.name.length >= 3)
    .slice(0, 24);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  try {
    const user = await requireLessonAdmin(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const sourceName = String(body?.source_name ?? body?.name ?? "").trim().slice(0, 160);
    const unitId = String(body?.canonical_unit_id ?? "").trim() || null;
    const topicId = String(body?.canonical_topic_id ?? "").trim() || null;
    if (!sourceName) {
      return json({ error: { code: "INVALID_INPUT", message: "Kaynak konu adı gerekli." } }, 400);
    }
    const generated = await generateStructured("curriculum_decomposition", [
      {
        role: "system",
        content: "ÖSYM müfredatı için kanonik alt konular öner. Üretim kuyruğuna alma. Yalnızca konu adları.",
      },
      {
        role: "user",
        content: `Ana konu: ${sourceName}\nAlt konular öner (ör. Kut Anlayışı, Kurultay, Töre).`,
      },
    ], {
      name: "topic_breakdown",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["topics"],
        properties: {
          topics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "note"],
              properties: {
                name: { type: "string" },
                note: { type: "string" },
              },
            },
          },
        },
      },
    }, { promptVersion: "topic-breakdown-v1", cache: true });
    const suggestions = parseSuggestions(generated.text);
    if (suggestions.length === 0) {
      return json({ error: { code: "INVALID_PACKAGE", message: "Alt konu önerisi boş." } }, 502);
    }

    const admin = serviceClient();
    const { data: session, error } = await admin
      .from("topic_breakdown_sessions")
      .insert({
        source_name: sourceName,
        canonical_unit_id: unitId,
        canonical_topic_id: topicId,
        status: "draft",
        created_by: user.id,
      })
      .select("*")
      .single();
    if (error || !session) throw error ?? new Error("SESSION_FAILED");

    const rows = suggestions.map((item, index) => ({
      session_id: session.id,
      suggested_name: item.name,
      note: item.note || null,
      status: "pending",
      sort_order: index,
    }));
    const { data: stored, error: sugError } = await admin.from("topic_breakdown_suggestions").insert(rows).select("*");
    if (sugError) throw sugError;

    return json({
      session,
      suggestions: stored ?? [],
      queued: false,
    });
  } catch (error) {
    console.error("content-factory-breakdown", error);
    return mapHttpError(error, req);
  }
});
