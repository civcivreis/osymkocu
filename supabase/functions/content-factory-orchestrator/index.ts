import { json, mapHttpError, preflight, requireFactoryCaller, serviceClient } from "../_shared/lessonHttp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405, req);
  try {
    await requireFactoryCaller(req);
    const admin = serviceClient();
    const { data: planned, error } = await admin.rpc("factory_orchestrate_internal");
    if (error) throw error;
    const { data: settings } = await admin.from("content_factory_settings").select("engine_state, production_enabled, wake_secret").eq("id", 1).maybeSingle();
    if (settings?.engine_state === "running") {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/content-factory-process`;
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
          "x-factory-wake": String(settings.wake_secret ?? ""),
        },
        body: JSON.stringify({ source: "orchestrator" }),
      }).catch(() => undefined);
    }
    return json({
      ok: true,
      planned,
      engine_state: settings?.engine_state ?? "paused",
      production_enabled: Boolean(settings?.production_enabled),
    }, 200, req);
  } catch (error) {
    return mapHttpError(error, req);
  }
});
