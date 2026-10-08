import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getAiModelConfig } from "../_shared/aiRouter.ts";
import { moderateImageBytes } from "../_shared/imageModeration.ts";
import { r2Delete, r2Put, r2SignedGet } from "../_shared/r2.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const PURPOSES = new Set(["chat_image", "avatar", "story", "status_image", "question_image"]);

function json(payload: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

async function moderationProviderLabel() {
  try {
    const cfg = await getAiModelConfig("content_moderation_image");
    return `${cfg.provider}:${cfg.primaryModel}`;
  } catch {
    return "openai";
  }
}

function sniffMime(bytes: Uint8Array, claimed: string) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (claimed === "image/jpeg" || claimed === "image/png" || claimed === "image/webp") {
    return null;
  }
  return null;
}

function extFor(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function decodeBase64(value: string) {
  const clean = value.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readPayload(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const purpose = String(form.get("purpose") ?? "chat_image");
    const conversationId = String(form.get("conversationId") ?? "");
    const groupSlug = String(form.get("groupSlug") ?? "");
    const otherUserId = String(form.get("otherUserId") ?? "");
    const width = Number(form.get("width") ?? 0) || null;
    const height = Number(form.get("height") ?? 0) || null;
    if (!(file instanceof File)) return { error: "Dosya yok." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      purpose,
      conversationId,
      groupSlug,
      otherUserId,
      width,
      height,
      claimedMime: file.type || "application/octet-stream",
      bytes,
    };
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const payload = (body?.payload ?? body ?? {}) as Record<string, unknown>;
  const base64 = String(payload.base64 ?? payload.imageBase64 ?? "");
  if (!base64) return { error: "Dosya yok." };
  return {
    purpose: String(payload.purpose ?? "chat_image"),
    conversationId: String(payload.conversationId ?? ""),
    groupSlug: String(payload.groupSlug ?? ""),
    otherUserId: String(payload.otherUserId ?? payload.otherId ?? ""),
    width: Number(payload.width ?? 0) || null,
    height: Number(payload.height ?? 0) || null,
    claimedMime: String(payload.mime ?? payload.mimeType ?? "image/jpeg"),
    bytes: decodeBase64(base64),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: { code: "UNAUTHORIZED", message: "Oturum gerekli." } });

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!service) return json({ error: { code: "AI_NOT_CONFIGURED", message: "Servis anahtarı yok." } });
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: stale } = await admin.rpc("stale_media_for_cleanup");
    for (const row of (stale ?? []) as { id: string; storage_key: string }[]) {
      await r2Delete(row.storage_key);
      await admin.rpc("mark_media_deleted", { p_id: row.id });
    }
  } catch {
    // cleanup best-effort
  }

  const parsed = await readPayload(req);
  if ("error" in parsed) return json({ error: { code: "INVALID_INPUT", message: parsed.error } });

  if (!PURPOSES.has(parsed.purpose)) {
    return json({ error: { code: "INVALID_INPUT", message: "Geçersiz medya türü." } });
  }
  if (parsed.purpose === "question_image") {
    const { data: staff } = await admin.from("profiles").select("app_role").eq("id", user.id).maybeSingle();
    if (!staff || (staff.app_role !== "admin" && staff.app_role !== "super_admin")) {
      return json({ error: { code: "ADMIN_ONLY", message: "Soru görseli yalnızca admin yükler." } });
    }
  }
  if (parsed.bytes.byteLength < 24 || parsed.bytes.byteLength > MAX_BYTES) {
    return json({ error: { code: "INVALID_INPUT", message: "Dosya boyutu uygun değil." } });
  }
  const mime = sniffMime(parsed.bytes, parsed.claimedMime);
  if (!mime) {
    return json({ error: { code: "INVALID_INPUT", message: "Yalnızca JPEG, PNG veya WebP." } });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("image_upload_restricted_until")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.image_upload_restricted_until && Date.parse(profile.image_upload_restricted_until) > Date.now()) {
    return json({ error: { code: "IMAGE_RESTRICTED", message: "Şu an fotoğraf gönderemezsin. Bir süre sonra dene." } });
  }

  let conversationId: string | null = null;
  let groupSlug: string | null = null;

  if (parsed.purpose === "chat_image") {
    if (parsed.conversationId) {
      const { data: conv } = await admin
        .from("dm_conversations")
        .select("id, user_a, user_b")
        .eq("id", parsed.conversationId)
        .maybeSingle();
      if (!conv || (conv.user_a !== user.id && conv.user_b !== user.id)) {
        return json({ error: { code: "UNAUTHORIZED", message: "Bu sohbete fotoğraf gönderemezsin." } });
      }
      conversationId = conv.id;
    } else if (parsed.otherUserId && parsed.otherUserId !== user.id) {
      const otherId = parsed.otherUserId;
      const { data: blocked } = await admin
        .from("user_blocks")
        .select("blocker_id")
        .or(
          `and(blocker_id.eq.${user.id},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${user.id})`,
        )
        .maybeSingle();
      if (blocked) {
        return json({ error: { code: "UNAUTHORIZED", message: "Bu sohbete fotoğraf gönderemezsin." } });
      }
      const a = user.id < otherId ? user.id : otherId;
      const b = user.id < otherId ? otherId : user.id;
      const { data: conv } = await admin
        .from("dm_conversations")
        .select("id, user_a, user_b")
        .eq("user_a", a)
        .eq("user_b", b)
        .maybeSingle();
      conversationId = conv?.id ?? null;
    } else if (parsed.groupSlug && ["tyt", "ayt", "kpss"].includes(parsed.groupSlug)) {
      const { data: member } = await admin
        .from("exam_chat_members")
        .select("user_id")
        .eq("slug", parsed.groupSlug)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!member) {
        const joined = await admin.from("exam_chat_members").insert({ slug: parsed.groupSlug, user_id: user.id });
        if (joined.error) {
          return json({ error: { code: "UNAUTHORIZED", message: "Bu gruba fotoğraf gönderemezsin." } });
        }
      }
      groupSlug = parsed.groupSlug;
    } else {
      return json({ error: { code: "INVALID_INPUT", message: "Sohbet bilgisi gerekli." } });
    }
  }

  // Roles never skip moderation. Admin/super_admin follow the same sexual-content gate.
  const key = `chat-temp/${user.id}/${crypto.randomUUID()}.${extFor(mime)}`;
  try {
    await r2Put(key, parsed.bytes, mime);
  } catch (error) {
    console.error("r2 put", error);
    return json({ error: { code: "PROVIDER_ERROR", message: "Fotoğraf yüklenemedi." } });
  }

  const insert = await admin.from("media").insert({
    owner_user_id: user.id,
    storage_key: key,
    purpose: parsed.purpose,
    mime_type: mime,
    size_bytes: parsed.bytes.byteLength,
    width: parsed.width,
    height: parsed.height,
    moderation_status: "pending",
    conversation_id: conversationId,
    group_slug: groupSlug,
  }).select("id").single();

  if (insert.error || !insert.data) {
    await r2Delete(key);
    return json({ error: { code: "PROVIDER_ERROR", message: "Kayıt oluşturulamadı." } });
  }

  const mediaId = insert.data.id as string;
  await admin.from("media_moderation").insert({
    uploader_user_id: user.id,
    asset_key: key,
    conversation_id: conversationId,
    media_id: mediaId,
    status: "pending",
    moderation_provider: await moderationProviderLabel(),
  });
  const openai = Deno.env.get("OPENAI_API_KEY") ?? "";

  async function dropPending(status: "rejected" | "error", extra?: Record<string, unknown>) {
    await r2Delete(key);
    await admin.from("media").update({
      moderation_status: "rejected",
      deleted_at: new Date().toISOString(),
    }).eq("id", mediaId);
    await admin.from("media_moderation").update({
      status,
      categories: extra?.categories ?? {},
      moderated_at: new Date().toISOString(),
    }).eq("media_id", mediaId);
    if (status === "rejected") {
      await admin.from("user_safety_events").insert({
        user_id: user.id,
        event_type: extra?.highRisk ? "sexual_media_rejected" : "sexual_media_rejected",
        source: parsed.purpose,
        metadata: { media_id: mediaId, category: extra?.category ?? "sexual" },
      });
    }
  }

  if (!openai) {
    await dropPending("error");
    return json({
      error: {
        code: "IMAGE_MODERATION_UNAVAILABLE",
        reason: "moderation_unavailable",
        message: "Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.",
      },
    });
  }

  try {
    let signedUrl: string | undefined;
    try {
      signedUrl = await r2SignedGet(key, 120);
    } catch (error) {
      console.error("[media-moderation]", { mediaId, event: "signed_url_failed", error: String(error) });
    }
    const verdict = await moderateImageBytes(openai, parsed.bytes, mime, { mediaId, signedUrl });
    if (verdict.reject) {
      await dropPending("rejected", {
        category: verdict.category,
        highRisk: verdict.highRisk,
        categories: { sexual: verdict.sexual, flagged: verdict.flagged },
      });
      await admin.from("image_moderation_violations").insert({
        user_id: user.id,
        category: verdict.category ?? "sexual",
        confidence: verdict.confidence,
        high_risk: verdict.highRisk,
      });
      await admin.from("content_moderation_events").insert({
        actor_id: user.id,
        target_id: user.id,
        kind: verdict.highRisk ? "image_high_risk" : "image_rejected",
        payload: { category: verdict.category, confidence: verdict.confidence, high_risk: verdict.highRisk, media_id: mediaId },
      });
      if (verdict.highRisk) {
        const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await admin.from("profiles").update({ image_upload_restricted_until: until }).eq("id", user.id);
      }
      return json({
        error: {
          code: "IMAGE_REJECTED",
          reason: "unsafe_content",
          message: "Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi.",
        },
      });
    }
  } catch (error) {
    console.error("[media-moderation]", { mediaId, event: "failed", error: String(error) });
    await dropPending("error");
    return json({
      error: {
        code: "IMAGE_MODERATION_UNAVAILABLE",
        reason: "moderation_unavailable",
        message: "Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.",
      },
    });
  }

  const dest =
    parsed.purpose === "chat_image"
      ? `chat-media/${conversationId ?? groupSlug ?? user.id}/${mediaId}.${extFor(mime)}`
      : `media/${parsed.purpose}/${user.id}/${mediaId}.${extFor(mime)}`;
  try {
    await r2Put(dest, parsed.bytes, mime);
    await r2Delete(key);
  } catch (error) {
    console.error("r2 promote", error);
    await dropPending("error");
    return json({
      error: {
        code: "IMAGE_MODERATION_UNAVAILABLE",
        reason: "moderation_unavailable",
        message: "Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.",
      },
    });
  }

  const approved = await admin
    .from("media")
    .update({ moderation_status: "approved", storage_key: dest })
    .eq("id", mediaId)
    .eq("moderation_status", "pending")
    .select("id")
    .maybeSingle();
  if (approved.error || !approved.data) {
    await r2Delete(dest);
    await dropPending("error");
    return json({
      error: {
        code: "IMAGE_MODERATION_UNAVAILABLE",
        reason: "moderation_unavailable",
        message: "Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.",
      },
    });
  }

  await admin.from("media_moderation").update({
    status: "approved",
    asset_key: dest,
    moderated_at: new Date().toISOString(),
    categories: { safe: true },
  }).eq("media_id", mediaId);

  return json({
    data: {
      mediaId,
      purpose: parsed.purpose,
      mimeType: mime,
      width: parsed.width,
      height: parsed.height,
      sizeBytes: parsed.bytes.byteLength,
    },
  });
});
