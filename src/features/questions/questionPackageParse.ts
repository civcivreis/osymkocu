export type ImportQuestionRow = {
  exam_codes: string[];
  subject: string;
  main_theme: string;
  topic: string;
  canonical_slug: string;
  question_text: string;
  choices: Record<string, string>;
  correct_answer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question_type: string;
  status: string;
  source: string;
  tags: string[];
  invalid_reason?: string;
};

export type ParsedPackage = {
  package_name: string;
  package_version: string;
  rows: ImportQuestionRow[];
};

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function strList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  const raw = str(value);
  if (!raw) return [];
  return raw.split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
}

function difficultyOf(value: unknown): 'easy' | 'medium' | 'hard' {
  const raw = str(value).toLowerCase();
  if (['easy', 'kolay', '1', 'e'].includes(raw)) return 'easy';
  if (['hard', 'zor', '3', 'h'].includes(raw)) return 'hard';
  return 'medium';
}

function choicesOf(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const next: Record<string, string> = {};
    value.forEach((item, index) => {
      const key = LETTERS[index];
      if (!key) return;
      if (typeof item === 'string') next[key] = item.trim();
      else {
        const rec = asRecord(item);
        next[key] = str(rec.text || rec.label || rec.value);
      }
    });
    return next;
  }
  const rec = asRecord(value);
  const next: Record<string, string> = {};
  LETTERS.forEach((key) => {
    const found = rec[key] ?? rec[key.toLowerCase()];
    if (found != null) next[key] = str(found);
  });
  return next;
}

function correctOf(value: unknown, choices: Record<string, string>): string {
  const raw = str(value);
  const upper = raw.toUpperCase();
  if (LETTERS.includes(upper as (typeof LETTERS)[number]) && choices[upper]) return upper;
  const hit = Object.entries(choices).find(([, text]) => text && text.toLowerCase() === raw.toLowerCase());
  if (hit) return hit[0];
  if (LETTERS.includes(upper as (typeof LETTERS)[number])) return upper;
  return raw;
}

function questionTypeOf(value: unknown): string {
  const raw = str(value).toLowerCase();
  if (['lesson_mastery', 'checkpoint', 'lesson_checkpoint', 'mastery'].includes(raw)) return 'lesson_checkpoint';
  if (['topic_test', 'topic_pool', 'pool'].includes(raw)) return 'topic_pool';
  if (['package_review', 'review', 'paket'].includes(raw)) return 'package_review';
  if (['test_center', 'test-merkezi'].includes(raw)) return 'test_center';
  if (['system_exam', 'sistem'].includes(raw)) return 'system_exam';
  if (['lesson_final', 'final'].includes(raw)) return 'lesson_final';
  return raw || 'topic_pool';
}

function finalizeRow(partial: Omit<ImportQuestionRow, 'invalid_reason'>): ImportQuestionRow {
  const filled = Object.values(partial.choices).filter(Boolean).length;
  let invalid_reason: string | undefined;
  if (partial.question_text.length < 8) invalid_reason = 'Soru metni eksik';
  else if (filled < 2) invalid_reason = 'Şık sayısı yetersiz';
  else if (!partial.correct_answer) invalid_reason = 'Doğru yanıt yok';
  else if (!partial.topic && !partial.canonical_slug) invalid_reason = 'Konu yok';
  else if (!partial.exam_codes.length) invalid_reason = 'Sınav kodu yok';
  else if (!partial.subject) invalid_reason = 'Ders yok';
  return invalid_reason ? { ...partial, invalid_reason } : partial;
}

function fromQuestionObject(raw: Record<string, unknown>, fallback: Partial<ImportQuestionRow> = {}): ImportQuestionRow {
  const choices = choicesOf(raw.choices ?? raw.options ?? raw.siklar);
  const topic = str(raw.topic ?? raw.topic_name ?? raw.title ?? fallback.topic);
  const row = {
    exam_codes: strList(raw.exam_codes ?? raw.exams ?? fallback.exam_codes),
    subject: str(raw.subject ?? raw.ders ?? fallback.subject),
    main_theme: str(raw.main_theme ?? raw.unit ?? raw.ana_konu ?? fallback.main_theme),
    topic,
    canonical_slug: str(raw.canonical_slug ?? raw.slug ?? fallback.canonical_slug),
    question_text: str(raw.question_text ?? raw.question ?? raw.stem ?? raw.text),
    choices,
    correct_answer: correctOf(raw.correct_answer ?? raw.correct_choice ?? raw.answer ?? raw.correct, choices),
    explanation: str(raw.explanation ?? raw.wrong_explanation ?? raw.detail),
    difficulty: difficultyOf(raw.difficulty ?? raw.zorluk),
    question_type: questionTypeOf(raw.question_type ?? raw.set_type ?? fallback.question_type),
    status: str(raw.status ?? 'draft') || 'draft',
    source: str(raw.source ?? fallback.source),
    tags: strList(raw.tags),
  };
  return finalizeRow(row);
}

function fromLesson(raw: Record<string, unknown>): ImportQuestionRow[] {
  const fallback: Partial<ImportQuestionRow> = {
    exam_codes: strList(raw.exam_codes),
    subject: str(raw.subject),
    main_theme: str(raw.main_theme ?? raw.unit),
    topic: str(raw.title ?? raw.topic),
    canonical_slug: str(raw.canonical_slug),
    source: str(raw.content_version ?? raw.package_name),
  };
  const rows: ImportQuestionRow[] = [];
  const checkpoints = Array.isArray(raw.checkpoints) ? raw.checkpoints : [];
  const finals = Array.isArray(raw.final_questions) ? raw.final_questions : [];
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  checkpoints.forEach((item) => {
    rows.push(fromQuestionObject({ ...asRecord(item), question_type: 'lesson_checkpoint' }, fallback));
  });
  finals.forEach((item) => {
    rows.push(fromQuestionObject({ ...asRecord(item), question_type: 'lesson_final' }, fallback));
  });
  questions.forEach((item) => rows.push(fromQuestionObject(asRecord(item), fallback)));
  return rows;
}

function collect(value: unknown, acc: ImportQuestionRow[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collect(item, acc));
    return;
  }
  const rec = asRecord(value);
  if (!Object.keys(rec).length) return;
  if (Array.isArray(rec.lessons)) {
    rec.lessons.forEach((lesson) => acc.push(...fromLesson(asRecord(lesson))));
    return;
  }
  if (Array.isArray(rec.questions) && !rec.question_text && !rec.question && !rec.stem) {
    rec.questions.forEach((item) => acc.push(fromQuestionObject(asRecord(item), rec)));
    return;
  }
  if (rec.teaching_blocks || rec.checkpoints || rec.canonical_slug) {
    acc.push(...fromLesson(rec));
    return;
  }
  if (rec.question_text || rec.question || rec.stem) {
    acc.push(fromQuestionObject(rec));
  }
}

export function parseQuestionPackageText(text: string, fileName: string): ParsedPackage {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  const rows: ImportQuestionRow[] = [];
  let meta: Record<string, unknown> = {};
  if (!trimmed) return { package_name: fileName, package_version: '1', rows: [] };

  const looksJsonl = trimmed.includes('\n') && !trimmed.startsWith('[') && !trimmed.startsWith('{');
  const jsonl = fileName.toLowerCase().endsWith('.jsonl') || looksJsonl;
  if (jsonl) {
    trimmed.split(/\n+/).forEach((line) => {
      if (!line.trim()) return;
      try {
        collect(JSON.parse(line), rows);
      } catch {
        rows.push(
          finalizeRow({
            exam_codes: [],
            subject: '',
            main_theme: '',
            topic: '',
            canonical_slug: '',
            question_text: line.slice(0, 80),
            choices: {},
            correct_answer: '',
            explanation: '',
            difficulty: 'medium',
            question_type: 'topic_pool',
            status: 'draft',
            source: fileName,
            tags: [],
          }),
        );
        rows[rows.length - 1].invalid_reason = 'JSONL satırı okunamadı';
      }
    });
  } else {
    const parsed = JSON.parse(trimmed) as unknown;
    meta = asRecord(parsed);
    collect(parsed, rows);
  }

  return {
    package_name: str(meta.package_name ?? meta.name ?? meta.version ?? fileName.replace(/\.(jsonl|json)$/i, '')),
    package_version: str(meta.package_version ?? meta.version ?? meta.content_version ?? '1'),
    rows,
  };
}
