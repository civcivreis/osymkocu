import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { r2SignedGet } from "../_shared/r2.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";

function json(payload: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: { code: "UNAUTHORIZED", message: "Oturum gerekli." } }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const payload = (body?.payload ?? body ?? {}) as Record<string, unknown>;
  const mediaId = String(payload.mediaId ?? payload.id ?? "");
  if (!mediaId) return json({ error: { code: "INVALID_INPUT", message: "mediaId gerekli." } }, 400);

  const { data: allowed, error } = await supabase.rpc("user_can_access_media", {
    p_user: user.id,
    p_id: mediaId,
  });
  if (error || !allowed) {
    return json({ error: { code: "FORBIDDEN", message: "Bu görsele erişemezsin." } }, 403);
  }

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!service) return json({ error: { code: "AI_NOT_CONFIGURED", message: "Servis anahtarı yok." } }, 500);
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: media } = await admin
    .from("media")
    .select("storage_key, width, height, mime_type")
    .eq("id", mediaId)
    .maybeSingle();
  if (!media?.storage_key) {
    return json({ error: { code: "FORBIDDEN", message: "Bu görsele erişemezsin." } }, 403);
  }

  try {
    const url = await r2SignedGet(media.storage_key, 600);
    return json({
      data: {
        url,
        expiresIn: 600,
        width: media.width,
        height: media.height,
        mimeType: media.mime_type,
      },
    });
  } catch (err) {
    console.error("signed get", err);
    return json({ error: { code: "PROVIDER_ERROR", message: "Görsel açılamadı." } }, 500);
  }
});
