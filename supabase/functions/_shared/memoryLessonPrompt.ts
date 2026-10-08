import { buildExamTechniqueSystem, EXAM_TECHNIQUE_PROMPT_VERSION, HEURISTIC_KINDS, TECHNIQUE_QUESTION_STRATEGIES } from "./examTechnique.ts";

export const MEMORY_LESSON_PROMPT_VERSION = EXAM_TECHNIQUE_PROMPT_VERSION;
export const MEMORY_PEDAGOGY_VERSION = "exam-technique-v1";

export const MEMORY_TECHNIQUES = [
  "visual_association",
  "story_chain",
  "method_of_loci",
  "acronym",
  "chunking",
  "contrast_pair",
  "timeline",
  "absurd_imagery",
  "analogy",
  "pattern_recognition",
  "cause_effect_chain",
] as const;

export const QUESTION_STRATEGIES = TECHNIQUE_QUESTION_STRATEGIES;

const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["order", "question_text", "options", "correct_answer", "explanation", "question_strategy"],
  properties: {
    order: { type: "integer" },
    question_text: { type: "string" },
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
    correct_answer: { type: "string", enum: ["A", "B", "C", "D", "E"] },
    explanation: { type: "string" },
    question_strategy: { type: "string", enum: [...QUESTION_STRATEGIES] },
  },
} as const;

const CORE_FACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fact", "technique", "visual_anchor", "recall_prompt"],
  properties: {
    fact: { type: "string" },
    technique: { type: "string", enum: [...MEMORY_TECHNIQUES] },
    visual_anchor: { type: "string" },
    recall_prompt: { type: "string" },
  },
} as const;

export const MEMORY_LESSON_JSON_SCHEMA = {
  name: "memory_lesson_package",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "summary",
      "learning_objectives",
      "narration",
      "memory_hooks",
      "primary_memory_technique",
      "memory_techniques",
      "memory_journey_title",
      "memory_journey_summary",
      "core_facts",
      "scenes",
      "checkpoint_questions",
      "final_questions",
      "minimum_theory",
      "fast_rule",
      "exam_technique",
    ],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      learning_objectives: { type: "array", items: { type: "string" } },
      narration: { type: "string" },
      memory_hooks: { type: "array", items: { type: "string" } },
      primary_memory_technique: { type: "string", enum: [...MEMORY_TECHNIQUES] },
      memory_techniques: { type: "array", items: { type: "string", enum: [...MEMORY_TECHNIQUES] } },
      memory_journey_title: { type: "string" },
      memory_journey_summary: { type: "string" },
      core_facts: { type: "array", items: CORE_FACT_SCHEMA },
      scenes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "order",
            "narration_text",
            "caption",
            "memory_hook",
            "memory_technique",
            "memory_target",
            "visual_anchor",
            "recall_prompt",
            "reinforcement_note",
            "visual_description",
            "estimated_duration_sec",
            "journey_step",
          ],
          properties: {
            order: { type: "integer" },
            narration_text: { type: "string" },
            caption: { type: "string" },
            memory_hook: { type: "string" },
            memory_technique: { type: "string", enum: [...MEMORY_TECHNIQUES] },
            memory_target: { type: "string" },
            visual_anchor: { type: "string" },
            recall_prompt: { type: "string" },
            reinforcement_note: { type: "string" },
            visual_description: { type: "string" },
            estimated_duration_sec: { type: "integer" },
            journey_step: { type: "string" },
          },
        },
      },
      checkpoint_questions: { type: "array", items: QUESTION_SCHEMA },
      final_questions: { type: "array", items: QUESTION_SCHEMA },
      minimum_theory: { type: "string" },
      fast_rule: { type: "string" },
      exam_technique: {
        type: "object",
        additionalProperties: false,
        required: [
          "know",
          "recognize",
          "solve",
          "recognition_trigger",
          "first_move",
          "fast_strategy",
          "common_traps",
          "elimination_rules",
          "when_not_to_use",
          "stem_signals",
          "heuristic_kind",
          "aaa_bu_suydu",
        ],
        properties: {
          know: { type: "string" },
          recognize: { type: "string" },
          solve: { type: "string" },
          recognition_trigger: { type: "string" },
          first_move: { type: "string" },
          fast_strategy: { type: "string" },
          common_traps: { type: "string" },
          elimination_rules: { type: "string" },
          when_not_to_use: { type: "string" },
          stem_signals: { type: "array", items: { type: "string" } },
          heuristic_kind: { type: "string", enum: [...HEURISTIC_KINDS] },
          aaa_bu_suydu: { type: "boolean" },
        },
      },
    },
  },
} as const;

export function buildMemoryLessonMessages(input: {
  exam: string;
  subject: string;
  unit: string;
  topic: string;
  title: string;
  patterns?: string;
}) {
  const system = `${buildExamTechniqueSystem(input)}

Hafıza kancası (memory_hook) ile sınav tekniği AYRI:
- memory_hook: kalıcı görsel çağrışım
- exam_technique: soruyu görünce ilk hamle

Anlatım örneği (iyi): "Bu soru gelince önce cümle başlarındaki 'bu / ancak / çünkü'ye bak. Bağlama bağlı olanı ele. Sonra anlamla doğrula. Altın taç = Kut kancası aklında dursun; soru 'kutsal yönetme yetkisi' deyince Kut zincirini aç."
Kötü: yalnızca tanım paragrafı.

Kurallar:
- Uydurma yok.
- Görsel üretme. visual_description sahne tarifi.
- checkpoint_questions: 2-4. final_questions: TAM 10.
- scenes: 6-10, HOOK ile başla.
- narration: 350-800 kelime, koç tonu, asgari teori.
- JSON şemasına birebir uy.`;

  const user = `Sınav tekniği + hafıza dersi paketi üret.
Başlık: ${input.title}
Sınav: ${input.exam}
Ders: ${input.subject}
Ünite: ${input.unit}
Konu: ${input.topic}
${input.patterns ? `Bilinen soru kalıpları:\n${input.patterns}` : ""}
Medya üretme. Sadece metin paketi.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
