import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) throw new Error("SERVICE_NOT_CONFIGURED");
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireLessonAdmin(req: Request): Promise<User> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  }
  const admin = serviceClient();
  const { data: profile } = await admin.from("profiles").select("app_role, account_status").eq("id", user.id).maybeSingle();
  const role = profile?.app_role as string | undefined;
  if (
    !profile ||
    profile.account_status === "banned" ||
    (role !== "admin" && role !== "super_admin")
  ) {
    throw Object.assign(new Error("ADMIN_ONLY"), { status: 403 });
  }
  return user;
}

export function mapHttpError(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHORIZED") {
    return json({ error: { code: "UNAUTHORIZED", message: "Oturum gerekli." } }, 401);
  }
  if (message === "ADMIN_ONLY") {
    return json({ error: { code: "ADMIN_ONLY", message: "Bu işlem yalnızca admin." } }, 403);
  }
  if (message === "LESSON_R2_NOT_CONFIGURED" || message === "SERVICE_NOT_CONFIGURED") {
    return json({ error: { code: "NOT_CONFIGURED", message: "Ders depolama henüz yapılandırılmamış." } }, 503);
  }
  if (message.startsWith("LESSON_R2_")) {
    return json({ error: { code: "STORAGE_ERROR", message: "Depolama isteği başarısız." } }, 502);
  }
  return json({ error: { code: "PROVIDER_ERROR", message: "İşlem tamamlanamadı." } }, 500);
}
