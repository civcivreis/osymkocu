import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: { code: "UNAUTHORIZED", message: "Oturum gerekli." } }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    temp_asset_key?: string;
    conversation_id?: string;
    mime_type?: string;
  };
  const key = String(body.temp_asset_key ?? "");
  if (!key.startsWith(`chat-temp/${user.id}/`) && !key.startsWith(`pending/${user.id}/`)) {
    return json({
      error: { code: "IMAGE_NOT_APPROVED", message: "Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi." },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: media } = await admin
    .from("media")
    .select("id, owner_user_id, moderation_status, storage_key")
    .eq("storage_key", key)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!media) {
    return json({
      error: { code: "IMAGE_NOT_APPROVED", message: "Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi." },
    });
  }
  if (media.moderation_status !== "approved") {
    return json({
      error: {
        code: media.moderation_status === "rejected" ? "IMAGE_REJECTED" : "IMAGE_MODERATION_UNAVAILABLE",
        message: media.moderation_status === "rejected"
          ? "Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi."
          : "Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.",
      },
    });
  }
  return json({ data: { mediaId: media.id, approved_asset_key: media.storage_key } });
});
