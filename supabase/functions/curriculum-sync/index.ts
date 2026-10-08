import { json, mapHttpError, preflight, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);
  try {
    const auth = await requireLessonAdmin(req);
    const body = (await req.json().catch(() => ({}))) as { exam_id?: string; force?: boolean };
    const admin = serviceClient();
    const { data, error } = await admin.rpc("admin_curriculum_sync", {
      p_exam_id: body.exam_id ?? null,
      p_force: Boolean(body.force),
    });
    if (error) throw error;
    return json({
      ...((data ?? {}) as Record<string, unknown>),
      actor: auth.userId,
      remote_fetch: false,
      ai_called: false,
    });
  } catch (error) {
    return mapHttpError(error, req);
  }
});
