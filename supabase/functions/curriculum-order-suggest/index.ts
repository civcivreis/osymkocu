import { json, mapHttpError, preflight, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import { generateStructured, generationMeta } from "../_shared/aiRouter.ts";

const SCHEMA = {
  name: "curriculum_order_suggestions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["suggestions"],
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["topic", "depends_on", "type", "reason", "confidence"],
          properties: {
            topic: { type: "string" },
            depends_on: { type: "string" },
            type: { type: "string", enum: ["hard_prerequisite", "soft_prerequisite", "recommended_before"] },
            reason: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    },
  },
} as const;

function fold(value: string) {
  return value
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıIİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);
  try {
    const user = await requireLessonAdmin(req);
    const body = (await req.json().catch(() => ({}))) as { curriculum_version_id?: string; unit_id?: string };
    const versionId = String(body.curriculum_version_id ?? "");
    if (!versionId) return json({ error: { code: "INVALID_INPUT", message: "curriculum_version_id gerekli." } }, 400);
    const admin = serviceClient();
    let maps = admin
      .from("exam_topic_map")
      .select("canonical_topic_id, sort_order, unit_id")
      .eq("curriculum_version_id", versionId)
      .eq("included", true);
    if (body.unit_id) maps = maps.eq("unit_id", body.unit_id);
    const { data: mapRows } = await maps;
    const ids = [...new Set((mapRows ?? []).map((row) => row.canonical_topic_id).filter(Boolean))];
    const { data: topics } = ids.length
      ? await admin.from("canonical_topics").select("id, name, difficulty_level").in("id", ids)
      : { data: [] };
    const names = (topics ?? []).map((row) => row.name).join(", ");
    if (!names) return json({ created: 0, applied: false });
    const generated = await generateStructured("curriculum_decomposition", [
      { role: "system", content: "Müfredat önkoşul denetçisisin. Yalnızca verilen konu adlarını kullan. Çevrim önerme. Emin değilsen soft_prerequisite yaz. Yayınlanmış sırayı değiştirme; yalnızca öneri üret." },
      { role: "user", content: `Konular (müfredat sırasıyla): ${names || "yok"}\nPedagoji: kavram → uygulama, temel → ileri.` },
    ], SCHEMA, { promptVersion: "curriculum-order-suggest-v1", cache: true });
    const parsed = generated.parsed as { suggestions?: { topic?: string; depends_on?: string; type?: string; reason?: string; confidence?: number }[] };
    const byName = new Map((topics ?? []).map((row) => [fold(row.name), row.id as string]));
    const rows: Record<string, unknown>[] = [];
    for (const item of parsed.suggestions ?? []) {
      const topicId = byName.get(fold(String(item.topic ?? "")));
      const depId = byName.get(fold(String(item.depends_on ?? "")));
      if (!topicId || !depId || topicId === depId) continue;
      const type = item.type === "hard_prerequisite" && Number(item.confidence ?? 0) < 0.6
        ? "soft_prerequisite"
        : (item.type ?? "soft_prerequisite");
      rows.push({
        curriculum_version_id: versionId,
        topic_id: topicId,
        depends_on_topic_id: depId,
        dependency_type: type,
        reason: item.reason ?? "AI önerisi",
        status: Number(item.confidence ?? 1) < 0.5 ? "pending" : "pending",
        created_by: user.id,
      });
    }
    if (rows.length) await admin.from("curriculum_ordering_suggestions").insert(rows);
    return json({ created: rows.length, applied: false, meta: generationMeta(generated, { prompt_version: "curriculum-order-suggest-v1" }) });
  } catch (error) {
    console.error("curriculum-order-suggest", error);
    return mapHttpError(error, req);
  }
});
