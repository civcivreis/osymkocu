export type ContentPackBlock = {
  type?: string;
  narration: string;
  card_type?: string;
  card_text?: string;
  semantic_key?: string;
};

export type ContentPackCheckpoint = {
  intro_narration?: string;
  question: string;
  choices: unknown;
  correct_answer: string;
  wrong_explanation?: string;
  retry_question?: string;
};

export type ContentPackQuestion = {
  question: string;
  choices: unknown;
  correct_answer: string;
  explanation?: string;
};

export type ContentPackLesson = {
  canonical_topic_id: string;
  pack_slug: string;
  title: string;
  subject?: string;
  exam_codes?: string[];
  estimated_duration_sec?: number;
  learning_objective?: string;
  hook?: string;
  teaching_blocks: ContentPackBlock[];
  checkpoints: ContentPackCheckpoint[];
  final_questions: ContentPackQuestion[];
  memory_summary?: string;
  content_version?: string;
};

export type PackIssue = { path: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePackPayload(raw: string): { lessons: unknown[]; format: "json" | "jsonl"; version?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { lessons: [], format: "json" };
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    return { lessons: Array.isArray(parsed) ? parsed : [parsed], format: "json" };
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.lessons)) {
        return {
          lessons: parsed.lessons,
          format: "json",
          version: String(parsed.version ?? parsed.content_version ?? ""),
        };
      }
      return { lessons: [parsed], format: "json" };
    } catch {
      /* jsonl */
    }
  }
  const lessons: unknown[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    lessons.push(JSON.parse(row));
  }
  return { lessons, format: "jsonl" };
}

function str(value: unknown) {
  return String(value ?? "").trim();
}

export function asChoices(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const keys = ["A", "B", "C", "D", "E"];
    const out: Record<string, string> = {};
    value.slice(0, 5).forEach((item, index) => {
      out[keys[index]] = str(item);
    });
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const letter = key.trim().toUpperCase().slice(0, 1);
      if (letter) out[letter] = str(item);
    }
    return out;
  }
  return {};
}

export function resolveCorrectKey(choices: unknown, correct: string) {
  const map = asChoices(choices);
  const raw = str(correct);
  if (/^[A-E]$/i.test(raw) && map[raw.toUpperCase()]) return raw.toUpperCase();
  const hit = Object.entries(map).find(([, label]) => label === raw);
  return hit?.[0] ?? "";
}

export function validateContentPack(input: unknown): { ok: boolean; lesson?: ContentPackLesson; errors: PackIssue[] } {
  const errors: PackIssue[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ path: "", message: "Nesne bekleniyor." }] };
  }
  const row = input as Record<string, unknown>;
  const pack_slug = str(row.canonical_slug || row.pack_slug || row.canonical_topic_id);
  const canonical = str(row.canonical_topic_id || row.canonical_slug);
  if (!canonical) errors.push({ path: "canonical_slug", message: "Zorunlu." });
  const title = str(row.title);
  if (!title) errors.push({ path: "title", message: "Zorunlu." });
  if (!str(row.learning_objective)) errors.push({ path: "learning_objective", message: "Zorunlu." });
  if (!str(row.hook)) errors.push({ path: "hook", message: "Zorunlu." });
  if (!str(row.memory_summary)) errors.push({ path: "memory_summary", message: "Zorunlu." });
  const blocks = Array.isArray(row.teaching_blocks) ? row.teaching_blocks : [];
  if (blocks.length < 1) errors.push({ path: "teaching_blocks", message: "En az bir öğretim bloğu gerekli." });
  const teaching_blocks: ContentPackBlock[] = [];
  blocks.forEach((block, index) => {
    if (!block || typeof block !== "object") {
      errors.push({ path: `teaching_blocks[${index}]`, message: "Geçersiz blok." });
      return;
    }
    const item = block as Record<string, unknown>;
    const narration = str(item.narration);
    const card_text = str(item.card_text);
    const card_type = str(item.card_type);
    const semantic_key = str(item.semantic_key);
    if (!narration) errors.push({ path: `teaching_blocks[${index}].narration`, message: "Anlatım zorunlu." });
    if (!card_text) errors.push({ path: `teaching_blocks[${index}].card_text`, message: "Kart metni zorunlu." });
    if (!card_type) errors.push({ path: `teaching_blocks[${index}].card_type`, message: "Kart tipi zorunlu." });
    if (!semantic_key) errors.push({ path: `teaching_blocks[${index}].semantic_key`, message: "semantic_key zorunlu." });
    teaching_blocks.push({
      type: str(item.type) || "teach",
      narration,
      card_type,
      card_text,
      semantic_key,
    });
  });
  const checkpointsRaw = Array.isArray(row.checkpoints) ? row.checkpoints : [];
  if (checkpointsRaw.length < 1) errors.push({ path: "checkpoints", message: "En az bir checkpoint gerekli." });
  const checkpoints: ContentPackCheckpoint[] = checkpointsRaw.map((item, index) => {
    const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!str(rec.question)) errors.push({ path: `checkpoints[${index}].question`, message: "Soru zorunlu." });
    if (!str(rec.wrong_explanation)) errors.push({ path: `checkpoints[${index}].wrong_explanation`, message: "Yanlış açıklaması zorunlu." });
    if (!str(rec.retry_question)) errors.push({ path: `checkpoints[${index}].retry_question`, message: "Retry sorusu zorunlu." });
    const choices = rec.choices;
    const correct = str(rec.correct_answer);
    if (!correct) errors.push({ path: `checkpoints[${index}].correct_answer`, message: "Doğru cevap zorunlu." });
    const key = resolveCorrectKey(choices, correct);
    if (asChoices(choices) && Object.keys(asChoices(choices)).length > 0 && !key) {
      errors.push({ path: `checkpoints[${index}].correct_answer`, message: "Doğru cevap şıklarda yok." });
    }
    return {
      intro_narration: str(rec.intro_narration),
      question: str(rec.question),
      choices,
      correct_answer: key || correct,
      wrong_explanation: str(rec.wrong_explanation),
      retry_question: str(rec.retry_question),
    };
  });
  const finalsRaw = Array.isArray(row.final_questions) ? row.final_questions : [];
  if (finalsRaw.length < 1) errors.push({ path: "final_questions", message: "En az bir final sorusu gerekli." });
  const final_questions: ContentPackQuestion[] = finalsRaw.map((item, index) => {
    const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!str(rec.question)) errors.push({ path: `final_questions[${index}].question`, message: "Soru zorunlu." });
    const answer = str(rec.correct_answer || rec.answer);
    let choices = rec.choices;
    if (!choices) {
      const twin = checkpoints.find((row) => row.question === str(rec.question));
      choices = twin?.choices;
    }
    const key = resolveCorrectKey(choices, answer);
    if (!answer) errors.push({ path: `final_questions[${index}].answer`, message: "Cevap zorunlu." });
    return {
      question: str(rec.question),
      choices,
      correct_answer: key || answer,
      explanation: str(rec.explanation),
    };
  });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    lesson: {
      canonical_topic_id: canonical,
      pack_slug,
      title,
      subject: str(row.subject) || undefined,
      exam_codes: Array.isArray(row.exam_codes) ? row.exam_codes.map((code) => str(code)).filter(Boolean) : undefined,
      estimated_duration_sec: Number(row.estimated_duration_sec) || undefined,
      learning_objective: str(row.learning_objective) || undefined,
      hook: str(row.hook) || undefined,
      teaching_blocks,
      checkpoints,
      final_questions,
      memory_summary: str(row.memory_summary) || undefined,
      content_version: str(row.content_version) || undefined,
    },
  };
}

export function isUuid(value: string) {
  return UUID.test(value);
}
