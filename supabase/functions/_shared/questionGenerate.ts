export const QUESTION_GEN_PROMPT = "question-bank-technique-v1";

export const STRATEGIES = [
  "direct_recall",
  "visual_recall",
  "contrast_recall",
  "sequence_recall",
  "application",
  "cause_effect",
  "interpretation",
  "pattern_recognition",
  "first_move",
  "elimination",
  "exam_style",
] as const;

export const QUESTION_BANK_SCHEMA = {
  name: "question_bank_batch",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "stem",
            "options",
            "correct_choice",
            "explanation",
            "difficulty",
            "strategy",
            "learning_objective",
            "requires_image",
            "trap_type",
            "recommended_strategy",
            "technique_role",
          ],
          properties: {
            stem: { type: "string" },
            options: {
              type: "object",
              additionalProperties: false,
              required: ["A", "B", "C", "D", "E"],
              properties: {
                A: { type: "string" },
                B: { type: "string" },
                C: { type: "string" },
                D: { type: "string" },
                E: { type: "string" },
              },
            },
            correct_choice: { type: "string", enum: ["A", "B", "C", "D", "E"] },
            explanation: { type: "string" },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            strategy: { type: "string", enum: [...STRATEGIES] },
            learning_objective: { type: "string" },
            requires_image: { type: "boolean" },
            trap_type: { type: "string" },
            recommended_strategy: { type: "string" },
            technique_role: { type: "string", enum: [...STRATEGIES] },
          },
        },
      },
    },
  },
} as const;

export type GeneratedQuestion = {
  stem: string;
  options: Record<string, string>;
  correct_choice: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  strategy: string;
  learning_objective: string;
  requires_image: boolean;
  trap_type?: string;
  recommended_strategy?: string;
  technique_role?: string;
};

export function validateGenerated(q: GeneratedQuestion) {
  const issues: string[] = [];
  const keys = ["A", "B", "C", "D", "E"] as const;
  const opts = q.options ?? {};
  for (const key of keys) {
    if (!String(opts[key] ?? "").trim()) issues.push("missing_option");
  }
  const correct = String(q.correct_choice ?? "").toUpperCase();
  if (!keys.includes(correct as typeof keys[number])) issues.push("bad_answer");
  if (!String(opts[correct] ?? "").trim()) issues.push("answer_not_in_options");
  if (String(q.stem ?? "").trim().length < 12) issues.push("short_stem");
  if (String(q.explanation ?? "").trim().length < 16) issues.push("short_explanation");
  if (!["easy", "medium", "hard"].includes(q.difficulty)) issues.push("no_difficulty");
  if (!STRATEGIES.includes(q.strategy as typeof STRATEGIES[number])) issues.push("no_strategy");
  const values = keys.map((key) => String(opts[key] ?? "").trim().toLowerCase());
  if (new Set(values).size < 5) issues.push("duplicate_options");
  return { ok: issues.length === 0, issues };
}

export function poolTarget() {
  const raw = Number(Deno.env.get("QUESTION_POOL_TARGET_PER_TOPIC") ?? "");
  if (Number.isFinite(raw) && raw >= 5 && raw <= 40) return Math.floor(raw);
  return 20;
}
