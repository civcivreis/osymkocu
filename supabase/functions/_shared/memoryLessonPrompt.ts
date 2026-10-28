import { buildExamTechniqueSystem, EXAM_TECHNIQUE_PROMPT_VERSION, HEURISTIC_KINDS, TECHNIQUE_QUESTION_STRATEGIES } from "./examTechnique.ts";

export const MEMORY_LESSON_PROMPT_VERSION = "hap-bilgi-v2-sync";
export const MEMORY_PEDAGOGY_VERSION = "narration-card-sync-v1";

export const HAP_CARD_TYPES = [
  "HAP BİLGİ",
  "HATIRLA",
  "HIZLI TEKNİK",
  "TUZAK",
  "KIYASLA",
  "FORMÜL",
  "ANAHTAR KELİME",
] as const;

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
  required: [
    "order",
    "question_text",
    "options",
    "correct_answer",
    "explanation",
    "question_strategy",
    "related_scene_order",
    "checkpoint_intro",
    "correct_feedback",
    "wrong_feedback",
    "retry_question_text",
  ],
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
    related_scene_order: { type: "integer" },
    checkpoint_intro: { type: "string" },
    correct_feedback: { type: "string" },
    wrong_feedback: { type: "string" },
    retry_question_text: { type: "string" },
  },
} as const;

const SCENE_CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["card_type", "short_text", "semantic_key", "start_frac", "end_frac", "narration_segment_id"],
  properties: {
    card_type: { type: "string", enum: [...HAP_CARD_TYPES] },
    short_text: { type: "string" },
    semantic_key: { type: "string" },
    start_frac: { type: "number" },
    end_frac: { type: "number" },
    narration_segment_id: { type: "string" },
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
        minItems: 5,
        maxItems: 8,
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
            "cards",
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
            cards: { type: "array", items: SCENE_CARD_SCHEMA, minItems: 1, maxItems: 3 },
          },
        },
      },
      checkpoint_questions: { type: "array", items: QUESTION_SCHEMA, minItems: 1, maxItems: 3 },
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

Bu bir HAP BİLGİ dersidir, konferans değil. Öğrenci "Haa bu muydu?" demeli.
Süre 3-7 dakika. Gereksiz akademik tanım yok. Sadece tanı → kural → en hızlı teknik → tuzak → cevap.

ANLATIM BİRİNCİL. Kart ikinci ders değildir.
Üretim sırası: öğrenme hedefi → narration → sahne narration_text (cümle cümle) → semantic_key → kartlar (anlatımdan türet) → checkpoint_intro → soru → doğru/yanlış feedback → retry → resume.

Kartlar (HAP BİLGİ, HATIRLA, HIZLI TEKNİK, TUZAK, KIYASLA, FORMÜL, ANAHTAR KELİME):
- Sadece o anda söylenen cümlenin kısa çapası. Transkript değil.
- short_text en fazla 8 kelime. Yeni bilgi kartta yok.
- Aynı anda en fazla 1 kart. Kartlar overlap etmez.
- start_frac/end_frac sahne içinde 0-1. Kart, ilgili cümle bitince kaybolur.
- narration_segment_id dolu olmalı.

Checkpoint asla cümle ortasında kesilmez. Sahne narration_text'in SON cümlesi checkpoint_intro olsun, çeşitlendir:
"Tamam, şimdi bunu sana soracağım." / "Bunu kaptın mı hemen bakalım." / "Şimdi aynı mantığı sen uygula." / "Buraya kadar tamam. Bir tane sen çöz." / "Şimdi sıra sende."
Aynı cümleyi her checkpoint'te tekrarlama.

correct_feedback kısa: "Aynen, bu." / "Tamamdır, devam."
wrong_feedback: kısa düzeltme (doğru kural) + sonra retry aynı bilgi.
retry_question_text: aynı bilgi, ufak yeniden ifade veya aynı soru.

- visual_anchor: tek kelime/kısa etiket
- memory_target: tek cümle hap bilgi (kart short_text daha kısa)
- caption: 6-10 kelime

checkpoint_questions: 1-3. En az biri first_move / pattern_recognition / elimination.
final_questions: TAM 10.

Kurallar:
- Uydurma yok.
- Görsel üretme. visual_description sahne tarifi.
- scenes: 5-8. Boş dizi yasak.
- narration: 180-420 kelime, koç tonu, asgari teori.
- exam_technique.aaa_bu_suydu: true.
- JSON şemasına birebir uy.`;

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
