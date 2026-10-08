import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, preflight } from "./cors.ts";

export { corsHeaders, preflight };

export const cors = corsHeaders();

export function json(payload: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
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

export async function requireUser(req: Request): Promise<User> {
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
  return user;
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

export async function requireFactoryCaller(req: Request) {
  const wake = req.headers.get("x-factory-wake") ?? "";
  if (wake) {
    const admin = serviceClient();
    const { data } = await admin.from("content_factory_settings").select("wake_secret").eq("id", 1).maybeSingle();
    if (data?.wake_secret && wake === data.wake_secret) return { kind: "wake" as const, user: null };
  }
  const user = await requireLessonAdmin(req);
  return { kind: "admin" as const, user };
}

export function mapHttpError(error: unknown, req?: Request) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHORIZED") {
    return json({ error: { code: "UNAUTHORIZED", message: "Oturum gerekli." } }, 401, req);
  }
  if (message === "ADMIN_ONLY") {
    return json({ error: { code: "ADMIN_ONLY", message: "Bu işlem yalnızca admin." } }, 403, req);
  }
  if (message === "LESSON_R2_NOT_CONFIGURED" || message === "SERVICE_NOT_CONFIGURED") {
    return json({ error: { code: "NOT_CONFIGURED", message: "Ders depolama henüz yapılandırılmamış." } }, 503, req);
  }
  if (message.startsWith("LESSON_R2_")) {
    return json({ error: { code: "STORAGE_ERROR", message: "Depolama isteği başarısız." } }, 502, req);
  }
  if (message === "AI_NOT_CONFIGURED") {
    return json({ error: { code: "AI_NOT_CONFIGURED", message: "AI yapılandırması eksik." } }, 503, req);
  }
  if (message === "AI_DAILY_CAP") {
    return json({ error: { code: "AI_DAILY_CAP", message: "Günlük AI kotası doldu." } }, 429, req);
  }
  if (message === "AI_TASK_DISABLED") {
    return json({ error: { code: "AI_TASK_DISABLED", message: "Bu AI görevi kapalı." } }, 503, req);
  }
  if (message === "IMAGE_FAILED") {
    return json({ error: { code: "PROVIDER_ERROR", message: "Görsel oluşturulamadı." } }, 502, req);
  }
  if (message === "TTS_FAILED") {
    return json({ error: { code: "PROVIDER_ERROR", message: "Seslendirme oluşturulamadı." } }, 502, req);
  }
  if (
    message === "AI_PROVIDER" ||
    message === "AI_TIMEOUT" ||
    message.startsWith("AI_RETRYABLE")
  ) {
    return json({ error: { code: "PROVIDER_ERROR", message: "İşlem tamamlanamadı." } }, 502, req);
  }
  return json({ error: { code: "PROVIDER_ERROR", message: "İşlem tamamlanamadı." } }, 500, req);
}
