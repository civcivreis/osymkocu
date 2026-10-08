import { json, mapHttpError, preflight, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import { r2Delete } from "../_shared/r2.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  try {
    await requireLessonAdmin(req);
    const admin = serviceClient();
    const { data, error } = await admin.rpc("virtual_student_engine_tick");
    if (error) throw error;
    const keys = (data as { stories?: { r2_keys?: string[] } } | null)?.stories?.r2_keys ?? [];
    for (const key of keys) {
      if (typeof key === "string" && key.length > 4) await r2Delete(key);
    }
    return json({ ok: true, data });
  } catch (error) {
    return mapHttpError(error, req);
  }
});
