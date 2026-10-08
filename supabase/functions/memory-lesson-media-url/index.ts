import { json, mapHttpError, requireUser, serviceClient } from "../_shared/lessonHttp.ts";
import { createLessonSignedUrl } from "../_shared/lessonR2.ts";

const TTL = 600;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: { code: "METHOD", message: "POST gerekli." } }, 405);

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({})) as { lesson_id?: string };
    const lessonId = String(body.lesson_id ?? "").trim();
    if (!lessonId) return json({ error: { code: "INVALID", message: "lesson_id gerekli." } }, 400);

    const admin = serviceClient();
    const { data: profile } = await admin.from("profiles").select("app_role").eq("id", user.id).maybeSingle();
    const isAdmin = profile?.app_role === "admin" || profile?.app_role === "super_admin";

    const { data: lesson, error: lessonError } = await admin
      .from("memory_lessons")
      .select("id, narration_key, thumbnail_key, status")
      .eq("id", lessonId)
      .maybeSingle();
    if (lessonError) throw lessonError;
    if (!lesson) return json({ error: { code: "NOT_FOUND", message: "Ders bulunamadı." } }, 404);
    if (lesson.status !== "published" && !isAdmin) {
      return json({ error: { code: "NOT_FOUND", message: "Ders bulunamadı." } }, 404);
    }

    const { data: scenes, error: scenesError } = await admin
      .from("memory_lesson_scenes")
      .select("id, asset_key")
      .eq("lesson_id", lessonId);
    if (scenesError) throw scenesError;

    const keys = new Set<string>();
    if (lesson.narration_key) keys.add(String(lesson.narration_key));
    if (lesson.thumbnail_key) keys.add(String(lesson.thumbnail_key));
    for (const scene of scenes ?? []) {
      if (scene.asset_key) keys.add(String(scene.asset_key));
    }

    const urls: Record<string, string> = {};
    for (const key of keys) {
      urls[key] = await createLessonSignedUrl(key, TTL);
    }

    return json({ urls, expires_in: TTL });
  } catch (error) {
    console.error("memory-lesson-media-url", error);
    return mapHttpError(error);
  }
});
