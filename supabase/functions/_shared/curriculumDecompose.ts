export const DECOMPOSE_MODEL = "gpt-4o-mini";
export const DECOMPOSE_PROMPT_VERSION = "curriculum-decompose-v1";

export function foldName(value: string) {
  return value
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıIİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[âÂ]/g, "a")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function namesOverlap(a: string, b: string) {
  const left = foldName(a);
  const right = foldName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 3 && right.length >= 3 && (left.includes(right) || right.includes(left))) return true;
  return false;
}

export function isTooBroad(input: {
  estimated_minutes?: number | null;
  estimated_core_fact_count?: number | null;
  estimated_scene_count?: number | null;
  independent_entity_count?: number | null;
  memory_journey_feasibility?: string | null;
}) {
  const minutes = Number(input.estimated_minutes ?? 0);
  const facts = Number(input.estimated_core_fact_count ?? 0);
  const scenes = Number(input.estimated_scene_count ?? 0);
  const entities = Number(input.independent_entity_count ?? 0);
  if (minutes > 12) return true;
  if (facts > 12) return true;
  if (scenes > 10) return true;
  if (entities >= 2) return true;
  if (input.memory_journey_feasibility === "low") return true;
  return false;
}

export const UNIT_SCHEMA = {
  name: "unit_decomposition",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["unit_title", "recommended_topics", "possible_duplicates", "coverage_warnings", "missing_areas"],
    properties: {
      unit_title: { type: "string" },
      recommended_topics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "description",
            "estimated_minutes",
            "estimated_core_fact_count",
            "estimated_scene_count",
            "independent_entity_count",
            "importance",
            "reason",
            "memory_journey_feasibility",
            "learning_objectives",
          ],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            estimated_minutes: { type: "number" },
            estimated_core_fact_count: { type: "integer" },
            estimated_scene_count: { type: "integer" },
            independent_entity_count: { type: "integer" },
            importance: { type: "string", enum: ["core", "supporting", "optional"] },
            reason: { type: "string" },
            memory_journey_feasibility: { type: "string", enum: ["high", "medium", "low"] },
            learning_objectives: { type: "array", items: { type: "string" } },
          },
        },
      },
      possible_duplicates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "existing_title", "reason"],
          properties: {
            title: { type: "string" },
            existing_title: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      coverage_warnings: { type: "array", items: { type: "string" } },
      missing_areas: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export const TOPIC_SCHEMA = {
  name: "topic_decomposition",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "topic",
      "too_broad_for_single_lesson",
      "reason",
      "estimated_minutes",
      "estimated_core_fact_count",
      "estimated_scene_count",
      "independent_entity_count",
      "memory_journey_feasibility",
      "segments",
      "learning_objectives",
    ],
    properties: {
      topic: { type: "string" },
      too_broad_for_single_lesson: { type: "boolean" },
      reason: { type: "string" },
      estimated_minutes: { type: "number" },
      estimated_core_fact_count: { type: "integer" },
      estimated_scene_count: { type: "integer" },
      independent_entity_count: { type: "integer" },
      memory_journey_feasibility: { type: "string", enum: ["high", "medium", "low"] },
      segments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "description", "estimated_minutes", "estimated_core_fact_count", "should_have_own_lesson", "reason"],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            estimated_minutes: { type: "number" },
            estimated_core_fact_count: { type: "integer" },
            should_have_own_lesson: { type: "boolean" },
            reason: { type: "string" },
          },
        },
      },
      learning_objectives: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export const UNIT_SYSTEM = `ÖSYM müfredat ayırıcısısın. Yalnızca verilen sınav kapsamındaki öğretilebilir kanonik konular öner.
Kurallar:
- Hedef ders: 5–10 dakika, 5–12 çekirdek olgu, 5–10 sahne, 2–4 ara soru, 10 final soru.
- 12 dakikayı veya 12 olguyu aşan konular çok geniş işaretlenir.
- Bir konu = bir tutarlı hafıza yolculuğu.
- Küçük 1–2 dakikalık parçalara bölme.
- Müfredat dışı akademik konu uydurma.
- Az, temiz, pedagojik konular tercih et; maksimum konu sayısı hedefi yok.
- required_points dahil et, excluded_points önerme.`;

export const TOPIC_SYSTEM = `Bir kanonik konunun tek hafıza dersi olup olamayacağını değerlendir.
Hedef: 5–10 dk, 5–12 olgu, tek bellek yolculuğu.
Çok genişse öğretilebilir segmentler öner. Önemsiz konuları aşırı bölme.
Müfredat kapsamının dışına çıkma. Soru veya medya üretme.`;
