import { json, mapHttpError, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";

const MODEL = "gpt-4o-mini";

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
  if (req.method === "OPTIONS") return json({ ok: true });
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
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ error: { code: "AI_NOT_CONFIGURED", message: "OPENAI_API_KEY sırrı yok." } }, 503);
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 1200,
        response_format: {
          type: "json_schema",
          json_schema: {
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
          },
        },
        messages: [
          {
            role: "system",
            content: "ÖSYM müfredatı için kanonik alt konular öner. Üretim kuyruğuna alma. Yalnızca konu adları.",
          },
          {
            role: "user",
            content: `Ana konu: ${sourceName}\nAlt konular öner (ör. Kut Anlayışı, Kurultay, Töre).`,
          },
        ],
      }),
    });
    if (!response.ok) {
      return json({ error: { code: "PROVIDER_ERROR", message: "Öneri servisi yanıt vermedi." } }, 502);
    }
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const suggestions = parseSuggestions(payload.choices?.[0]?.message?.content ?? "{}");
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
    return mapHttpError(error);
  }
});
