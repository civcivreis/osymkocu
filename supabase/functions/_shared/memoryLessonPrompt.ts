export const MEMORY_LESSON_PROMPT_VERSION = "memory-pedagogy-v1";
export const MEMORY_PEDAGOGY_VERSION = "memory-pedagogy-v1";

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

export const QUESTION_STRATEGIES = [
  "direct_recall",
  "visual_recall",
  "contrast_recall",
  "sequence_recall",
  "application",
] as const;

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
    },
  },
} as const;

function subjectTechniqueGuide(subject: string) {
  const key = subject.toLocaleLowerCase("tr-TR");
  if (key.includes("coğraf") || key.includes("cograf")) {
    return "Coğrafya: harita/mekân çıpaları, bölgesel gruplama, contrast_pair, görsel çağrışım. Aynı sembol aynı bölgeyi tutsun.";
  }
  if (key.includes("vatandaş") || key.includes("hukuk") || key.includes("anayasa")) {
    return "Vatandaşlık: bina/oda metaforu, hiyerarşi, cause_effect_chain, visual_association.";
  }
  if (key.includes("matemat") || key.includes("geometri") || key.includes("sayısal")) {
    return "Matematik: pattern_recognition, chunking, sembolik çıpalar, adım adım worked example. Metin basma.";
  }
  if (key.includes("türkçe") || key.includes("turkce") || key.includes("dil bilg") || key.includes("edebiyat")) {
    return "Türkçe: contrast_pair, örnek çiftleri, pattern_recognition, kural gruplama.";
  }
  return "Tarih: story_chain, timeline, visual_association, method_of_loci. Anlatımı bir yolculuk gibi kur.";
}

export function buildMemoryLessonMessages(input: {
  exam: string;
  subject: string;
  unit: string;
  topic: string;
  title: string;
}) {
  const system = `Sen ÖSYM Koçu hafıza pedagojisi tasarımcısısın. Yalnızca Türkçe yazarsın.
Hedef: ${input.exam} / ${input.subject}. Ünite: ${input.unit}. Konu: ${input.topic}.
Bu bir slayt özeti DEĞİL. Öğrenci her olguyu bir çıpaya bağlayarak hatırlamalı.

Ders tasarım adımları:
1) 5–12 çekirdek olgu seç.
2) Mantıklı parçalara (chunk) ayır.
3) Konuya uygun hafıza tekniği seç. ${subjectTechniqueGuide(input.subject)}
4) Her olguya kalıcı bir görsel çıpa ver. Aynı derste aynı sembol başka anlama gelmesin.
5) Anlatımı çıpa + olgu bağlantısı üzerine kur.
6) Her 2–3 önemli olgudan sonra hatırlatma kontrolü (checkpoint) koy. Checkpoint çıpayı sorar, yalnızca tanımı değil.
7) Final 10 soru: direct_recall, visual_recall, contrast_recall, sequence_recall, application karışımı. Hepsi tanım olmasın.

Anlatım örneği (iyi): "Bir kağan düşün. Gökyüzünden başına altın bir taç iniyor. Bu taç KUT'u temsil ediyor. Kut, hükümdarın yönetme yetkisinin Tanrı tarafından verildiğine inanılmasıdır."
Kötü: "Kut anlayışı yönetme yetkisidir."

Kurallar:
- Uydurma tarih, madde, kaynak YOK.
- Görsel üretme, URL/base64 yok. visual_description ileride çizilecek sahne; çıpayı açık yaz.
- checkpoint_questions: 2-4. final_questions: TAM 10. 5 şık A-E, 1 doğru.
- scenes: 6-10. Her sahnede memory_target, technique, visual_anchor, recall_prompt.
- narration: 400-900 kelime, seslendirmeye uygun, çıpalara bağlı.
- JSON şemasına birebir uy.`;

  const user = `Hafıza dersi paketi üret.
Başlık: ${input.title}
Sınav: ${input.exam}
Ders: ${input.subject}
Ünite: ${input.unit}
Konu: ${input.topic}

Konu Kut Anlayışı ise önerilen yolculuk: Bozkır / Kağan / Taç. Çıpa: gökyüzünden inen altın taç = Kut. Recall: "Kağanın başına inen taç neyi temsil ediyor?"
Medya üretme. Sadece metin paketi.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
