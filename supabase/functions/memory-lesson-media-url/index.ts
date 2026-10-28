import { json, mapHttpError, preflight, requireUser, serviceClient } from "../_shared/lessonHttp.ts";
import {
  createLessonSignedPutUrl,
  createLessonSignedUrl,
  lessonAssetPrefix,
} from "../_shared/lessonR2.ts";

const TTL = 600;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "METHOD", message: "POST gerekli." } }, 405);

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({})) as {
      lesson_id?: string;
      action?: string;
      content_type?: string;
    };
    const lessonId = String(body.lesson_id ?? "").trim();
    if (!lessonId) return json({ error: { code: "INVALID", message: "lesson_id gerekli." } }, 400);

    const admin = serviceClient();
    const { data: profile } = await admin.from("profiles").select("app_role").eq("id", user.id).maybeSingle();
    const isAdmin = profile?.app_role === "admin" || profile?.app_role === "super_admin";

    const { data: lesson, error: lessonError } = await admin
      .from("memory_lessons")
      .select("id, exam_type, subject, slug, version, narration_key, thumbnail_key, video_key, status")
      .eq("id", lessonId)
      .maybeSingle();
    if (lessonError) throw lessonError;
    if (!lesson) return json({ error: { code: "NOT_FOUND", message: "Ders bulunamadı." } }, 404);
    if (lesson.status !== "published" && !isAdmin) {
      return json({ error: { code: "NOT_FOUND", message: "Ders bulunamadı." } }, 404);
    }

    if (body.action === "sign_put") {
      if (!isAdmin) return json({ error: { code: "ADMIN_ONLY", message: "Admin yetkisi gerekir." } }, 403);
      const contentType = String(body.content_type ?? "video/mp4");
      const prefix = lessonAssetPrefix({
        examType: String(lesson.exam_type),
        subject: String(lesson.subject),
        lessonSlug: String(lesson.slug),
        version: Number(lesson.version ?? 1),
      });
      const key = `${prefix}/master-16x9.mp4`;
      const putUrl = await createLessonSignedPutUrl(key, contentType, TTL);
      await admin.from("memory_lessons").update({ video_key: key }).eq("id", lessonId);
      await admin.from("memory_lesson_assets").upsert({
        lesson_id: lessonId,
        asset_type: "video",
        r2_key: key,
        mime_type: contentType,
      }, { onConflict: "lesson_id,r2_key" });
      return json({ key, put_url: putUrl, expires_in: TTL });
    }

    const { data: scenes, error: scenesError } = await admin
      .from("memory_lesson_scenes")
      .select("id, asset_key")
      .eq("lesson_id", lessonId);
    if (scenesError) throw scenesError;

    const keys = new Set<string>();
    if (lesson.narration_key) keys.add(String(lesson.narration_key));
    if (lesson.thumbnail_key) keys.add(String(lesson.thumbnail_key));
    if (lesson.video_key) keys.add(String(lesson.video_key));
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
    return mapHttpError(error, req);
  }
});
