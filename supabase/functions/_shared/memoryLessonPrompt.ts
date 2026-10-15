import { buildExamTechniqueSystem, EXAM_TECHNIQUE_PROMPT_VERSION, HEURISTIC_KINDS, TECHNIQUE_QUESTION_STRATEGIES } from "./examTechnique.ts";

export const MEMORY_LESSON_PROMPT_VERSION = "exam-technique-overlay-v3";
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
      learning_objectives: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 8 },
      narration: { type: "string" },
      memory_hooks: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 10 },
      primary_memory_technique: { type: "string", enum: [...MEMORY_TECHNIQUES] },
      memory_techniques: { type: "array", items: { type: "string", enum: [...MEMORY_TECHNIQUES] }, minItems: 1, maxItems: 6 },
      memory_journey_title: { type: "string" },
      memory_journey_summary: { type: "string" },
      core_facts: { type: "array", items: CORE_FACT_SCHEMA, minItems: 5, maxItems: 12 },
      scenes: {
        type: "array",
        minItems: 6,
        maxItems: 10,
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
      checkpoint_questions: { type: "array", items: QUESTION_SCHEMA, minItems: 2, maxItems: 4 },
      final_questions: { type: "array", items: QUESTION_SCHEMA, minItems: 10, maxItems: 10 },
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
          stem_signals: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
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

Oyuncu videosu (altyazı yok): her sahnede 3 kısa kart sırayla gelir.
- memory_hook: en fazla 8 kelime, görsel kanca
- memory_target: en fazla 8 kelime, "bu neydi?"
- recall_prompt: en fazla 12 kelime, hızlı kural
- caption: 6-10 kelime, ekran yazısı; paragraf değil

checkpoint_questions: 2-4 adet. En az biri first_move / pattern_recognition / elimination.
final_questions: TAM 10, en az 3 farklı question_strategy.

Kurallar:
- Uydurma yok.
- Görsel üretme. visual_description sahne tarifi.
- scenes: 6-10, HOOK ile başla. Boş dizi yasak.
- narration: 350-800 kelime, koç tonu, asgari teori.
- exam_technique.aaa_bu_suydu: true (öğrenci "aaa bu giriş/cümle tekniğiydi" desin).
- JSON şemasına birebir uy. Eksik dizi veya eksik final_questions kabul edilmez.`;

  const user = `Sınav tekniği + hafıza dersi paketi üret.
Başlık: ${input.title}
Sınav: ${input.exam}
Ders: ${input.subject}
Ünite: ${input.unit}
Konu: ${input.topic}
${input.patterns ? `Bilinen soru kalıpları:\n${input.patterns}` : ""}
${/giriş|giris|cümle yerleştir|cumle yerlestir/i.test(`${input.topic} ${input.title}`)
    ? `Bu dersin soru kalıbı: giriş cümlesi / cümle yerleştirme.
RECOGNITION: öğrenci bağlam bağımlılığını tanır.
FIRST MOVE: cümle başı / bağlaç / gönderme ipuçlarına bak.
FAST METHOD: önceki bağlama bağlı adayları ele.
TRAP: sezgisel ipuçları mutlak kural değildir.
VERIFY: son adayı paragraf anlamına karşı kontrol et.
Öğrenci düşünmeli: "Aaa bu giriş cümlesi tekniğiydi."`
    : ""}
Medya üretme. Sadece metin paketi.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
