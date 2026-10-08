import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type FactoryJob = {
  id: string;
  canonical_topic_id: string;
  curriculum_version_id: string | null;
  memory_lesson_id: string | null;
  exam_id: string | null;
  subject_id: string | null;
  unit_id: string | null;
  topic_id: string | null;
  job_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  stage_text_done: boolean;
  stage_pedagogy_done: boolean;
  stage_questions_done: boolean;
  stage_media_done: boolean;
  stage_pool_done?: boolean;
  media_done_count: number;
  media_total_count: number;
  events: unknown;
  lesson_scope: string;
  coverage_mode: string;
  generation_hash?: string | null;
  factory_stage?: string | null;
  locked_until?: string | null;
};

const ACTIVE = new Set([
  "generating_text",
  "validating_pedagogy",
  "generating_questions",
  "generating_media",
]);

export function envConcurrency(fallback: number) {
  const raw = Number(Deno.env.get("CONTENT_FACTORY_CONCURRENCY") ?? "");
  if (Number.isFinite(raw) && raw >= 1 && raw <= 8) return Math.floor(raw);
  return fallback;
}

export async function invokeFunction(name: string, body: unknown, req: Request) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: req.headers.get("Authorization") ?? "",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function eventList(job: FactoryJob) {
  return Array.isArray(job.events) ? [...job.events] : [];
}

export async function appendEvent(
  admin: SupabaseClient,
  job: FactoryJob,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  const events = eventList(job);
  events.push({ at: new Date().toISOString(), code, message, ...extra });
  job.events = events.slice(-40);
  await admin.from("content_generation_jobs").update({ events: job.events }).eq("id", job.id);
}

export async function failJob(admin: SupabaseClient, job: FactoryJob, code: string, message: string) {
  const failedOut = job.attempt_count >= job.max_attempts;
  await appendEvent(admin, job, code, message);
  await admin.from("content_generation_jobs").update({
    status: failedOut ? "failed" : "queued",
    error_code: code,
    error_message: message,
    finished_at: failedOut ? new Date().toISOString() : null,
  }).eq("id", job.id);
}

export async function saveJob(admin: SupabaseClient, job: FactoryJob, patch: Record<string, unknown>) {
  Object.assign(job, patch);
  await admin.from("content_generation_jobs").update(patch).eq("id", job.id);
}

type LessonRow = {
  id: string;
  status: string;
  narration: string | null;
  generation_status: string | null;
  pedagogy_score: number | null;
  media_generation_status: string | null;
  narration_key: string | null;
  canonical_topic_id: string | null;
  lesson_generation_hash?: string | null;
};

export async function loadLesson(admin: SupabaseClient, id: string | null) {
  if (!id) return null;
  const { data } = await admin.from("memory_lessons").select(
    "id, status, narration, generation_status, pedagogy_score, media_generation_status, narration_key, canonical_topic_id, lesson_generation_hash",
  ).eq("id", id).maybeSingle();
  return (data as LessonRow | null) ?? null;
}

export async function questionCounts(admin: SupabaseClient, lessonId: string) {
  const { data: scoped } = await admin
    .from("memory_lesson_questions")
    .select("question_type, question_fingerprint")
    .eq("lesson_id", lessonId);
  const list = scoped ?? [];
  const checkpoints = list.filter((row: { question_type: string }) => row.question_type === "checkpoint").length;
  const finals = list.filter((row: { question_type: string }) => row.question_type === "final").length;
  const fingerprints = list.map((row: { question_fingerprint?: string | null }) => row.question_fingerprint).filter(Boolean);
  const unique = new Set(fingerprints);
  return {
    checkpoints,
    finals,
    duplicateQuestions: fingerprints.length !== unique.size,
  };
}

export async function mediaProgress(admin: SupabaseClient, lessonId: string, narrationKey: string | null) {
  const { data: scenes } = await admin.from("memory_lesson_scenes").select("id, asset_key").eq("lesson_id", lessonId);
  const list = scenes ?? [];
  const sceneReady = list.filter((row: { asset_key: string | null }) => Boolean(row.asset_key)).length;
  const total = list.length + 1;
  const done = sceneReady + (narrationKey ? 1 : 0);
  return { done, total, sceneReady, sceneTotal: list.length, narrationReady: Boolean(narrationKey) };
}

export function hasText(lesson: LessonRow | null) {
  return Boolean(lesson?.narration) || lesson?.generation_status === "succeeded";
}

export function pedagogyOk(lesson: LessonRow | null) {
  return typeof lesson?.pedagogy_score === "number" && lesson.pedagogy_score >= 75;
}

export { ACTIVE };
