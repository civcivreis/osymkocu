import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  friendlyAiError,
  generateImage,
  generateStructured,
  generateText,
  type ChatMessage,
} from "../_shared/aiRouter.ts";
import { moderateImageBytes } from "../_shared/imageModeration.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ACTIONS = new Set([
  "generateExplanation",
  "generateQuestion",
  "analyzeAnswer",
  "generateStudyPlan",
  "analyzeWeakTopics",
  "generateRevisionQuestions",
  "solveImageQuestion",
  "pulseBotStory",
  "moderateChatImage",
]);

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(req: Request) {
    console.log("ai hit", req.method);
    if (req.method === "OPTIONS") return json({ ok: true });

    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      console.log("has auth header", authHeader.startsWith("Bearer "));

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
        {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error("auth failed", userError?.message ?? "no user");
        return json({
          error: { code: "UNAUTHORIZED", message: "Oturum gerekli. Çıkış yapıp tekrar gir." },
        });
      }

      const body = await req.json().catch(() => null);
      const action = String(body?.action ?? "");
      const payload = (body?.payload ?? {}) as Record<string, unknown>;
      console.log("action", action, "user", user.id);

      if (!ALLOWED_ACTIONS.has(action)) {
        return json({ error: { code: "INVALID_INPUT", message: "Geçersiz AI aksiyonu" } });
      }

      const providerKey = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
      if (!providerKey && action === "moderateChatImage") {
        console.error("missing OPENAI_API_KEY");
        return json({
          error: {
            code: "AI_NOT_CONFIGURED",
            message: "AI yapılandırması eksik.",
          },
        });
      }

      if (action === "pulseBotStory") {
        const story = await pulseBotStory();
        return json({ data: story });
      }

      if (action === "moderateChatImage") {
        const moderated = await moderateChatImage(providerKey ?? "", user.id, payload);
        if ("error" in moderated) return json({ error: moderated.error });
        return json({ data: moderated.data });
      }

      const result = await callOpenAI(action, payload);
      if ("error" in result) {
        console.error("openai error", result.error);
        return json({ error: result.error });
      }

      const bump = supabase.rpc("bump_ai_usage", {
        p_tokens: result.tokens,
        p_cost: Number((result.tokens * 0.0000004).toFixed(6)),
      });
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
        .EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(bump);
      else void bump;

      return json({ data: result.data });
    } catch (error) {
      console.error("ai crash", error);
      const friendly = friendlyAiError(error, "generic");
      return json({
        error: {
          code: friendly.code,
          message: friendly.text,
        },
      });
    }
  },
};

async function callOpenAI(action: string, payload: Record<string, unknown>) {
  const mode = String(payload.mode ?? "simple");
  const question = String(payload.question ?? "");
  const imageBase64 = typeof payload.imageBase64 === "string" ? payload.imageBase64 : "";
  const imageUrl = typeof payload.imageUrl === "string" ? payload.imageUrl : "";
  const imagePath = typeof payload.imagePath === "string" ? payload.imagePath : "";
  const history = Array.isArray(payload.history) ? payload.history : [];
  const appContext = sanitizeAppContext(payload.appContext);
  const short = mode !== "detailed";
  const hasImage = Boolean(imageBase64 || imageUrl || imagePath);
  const academic =
    hasImage ||
    action === "solveImageQuestion" ||
    action === "generateExplanation" ||
    action === "analyzeAnswer" ||
    action === "generateQuestion" ||
    action === "generateRevisionQuestions";
  const taskType = academic ? "lesson_generation" : "bot_conversation";
  const system = `Sen Koçum uygulamasının eğitim koçusun. Adın Koç. TYT, AYT ve KPSS öğretmenisin.
Cevabı yalnızca JSON ver: kind, reply, answer.
kind=chat: selam/sohbet/hatırlama. reply doğal. answer boş string.
kind=lesson: ders, konu veya ekrandaki soru. reply öğrencinin okuyacağı tek metin. answer sadece şık harfi (A-E) ise doldur, yoksa boş bırak.
APP CONTEXT varsa "hangi soru?" diye sorma; oradaki soru/ders/konu budur.
"Neye çalışmalıyım?" sorusunda genel müfredat ezberi yok. APP CONTEXT'teki weakTopics, openWrongs, planPct, weeklySummary varsa bunlardan somut 1-2 öneri ver. Veri yoksa az soru çözdüğünü söyle, uydurma yüzde verme.
Önceki CHAT HISTORY mesajlarına bak. "Bir de örnek ver" gibi devamlar önceki cevaba bağlıdır.
Kim üretti, hangi model, OpenAI, GPT, ChatGPT, şirket, API sorularında reply TAM OLARAK: "Koçum uygulamasının yapay zeka modeliyim." Başka isim, araç veya biyografi yok.
reply asla "Doğru:" diye başlamasın.
ASLA görsel üretme, ASLA resim URL'si / markdown image / base64 image döndürme. Sadece metin anlat.
Uydurma konu-zorluk-ÖSYM şablonu yok. Formül uydurma.
Anlatım: ${short ? "kısa, net" : "adım adım, sade"}.`;

  const userContent: Array<Record<string, unknown>> = [];
  if (question) userContent.push({ type: "text", text: question });
  if (imageBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
    });
  } else if (imageUrl.startsWith("http")) {
    userContent.push({ type: "image_url", image_url: { url: imageUrl } });
  } else if (imagePath && (imagePath.startsWith("http") || imagePath.startsWith("data:"))) {
    userContent.push({ type: "image_url", image_url: { url: imagePath } });
  }

  const historyMessages = history
    .slice(-24)
    .map((item) => {
      const row = item as { role?: string; content?: string };
      const role = row.role === "assistant" ? "assistant" : "user";
      const content = String(row.content ?? "").slice(0, 2000);
      return content ? { role, content } : null;
    })
    .filter(Boolean);

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  if (appContext) {
    messages.push({
      role: "system",
      content: `APP CONTEXT (yalnızca eğitim ekranı; kişisel veri yok):\n${JSON.stringify(appContext)}`,
    });
  }
  messages.push(...(historyMessages as ChatMessage[]));
  messages.push({
    role: "user",
    content: userContent.length ? userContent : question || "Devam et.",
  });

  let parsed: Record<string, unknown> = {};
  let tokens = 0;
  try {
    const result = await generateStructured(taskType, messages, null, {
      cache: false,
      profileId: undefined,
    });
    parsed = (result.parsed ?? {}) as Record<string, unknown>;
    tokens = Number(result.inputTokens ?? 0) + Number(result.outputTokens ?? 0);
  } catch (error) {
    console.error("openai http", error);
    const friendly = friendlyAiError(error, academic ? "lesson" : "generic");
    return { error: { code: friendly.code, message: friendly.text } };
  }

  const kind = hasImage || parsed.kind === "lesson" ? "lesson" : "chat";
  const reply = String(parsed.reply ?? parsed.solution ?? "");
  const answer = kind === "chat" ? "" : String(parsed.answer ?? "");

  return {
    tokens,
    data: {
      kind,
      reply: reply || (kind === "chat" ? String(parsed.answer ?? "") : reply),
      answer,
      solution: reply,
      shortMethod: "",
      topic: "",
      difficulty: "medium" as const,
      commonMistake: "",
      osymTip: "",
    },
  };
}

function sanitizeAppContext(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const allow = new Set([
    "route",
    "examType",
    "subject",
    "topic",
    "lessonId",
    "questionId",
    "questionText",
    "questionOptions",
    "selectedAnswer",
    "correctAnswer",
    "explanation",
    "questionElapsedSeconds",
    "lessonProgress",
    "imageUrl",
    "imagePath",
    "weakTopics",
    "openWrongs",
    "planPct",
    "weeklySummary",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!allow.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function moderateChatImage(
  apiKey: string,
  userId: string,
  payload: Record<string, unknown>,
): Promise<{ data: { approved: boolean } } | { error: { code: string; message: string } }> {
  const path = String(payload.path ?? "");
  if (!path.startsWith(`${userId}/pending/`)) {
    return { error: { code: "INVALID_INPUT", message: "Görsel yolu geçersiz." } };
  }
  const admin = adminClient();
  if (!admin) {
    return { error: { code: "AI_NOT_CONFIGURED", message: "Görsel kontrolü yapılandırılmamış." } };
  }

  const { data: asset } = await admin
    .from("chat_image_assets")
    .select("id, status")
    .eq("storage_path", path)
    .eq("user_id", userId)
    .maybeSingle();
  if (!asset || asset.status !== "pending_moderation") {
    return { error: { code: "IMAGE_NOT_APPROVED", message: "Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi." } };
  }

  const downloaded = await admin.storage.from("chat-images").download(path);
  if (downloaded.error || !downloaded.data) {
    await admin.from("chat_image_assets").update({ status: "rejected", moderated_at: new Date().toISOString() }).eq("id", asset.id);
    return { error: { code: "INVALID_INPUT", message: "Görsel okunamadı." } };
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const mime = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";

  let verdict;
  try {
    verdict = await moderateImageBytes(apiKey, bytes, mime, { mediaId: asset.id });
  } catch (error) {
    console.error("[media-moderation]", { mediaId: asset.id, event: "failed", error: String(error) });
    await admin.storage.from("chat-images").remove([path]);
    await admin.from("chat_image_assets").update({ status: "rejected", moderated_at: new Date().toISOString() }).eq("id", asset.id);
    return {
      error: {
        code: "IMAGE_MODERATION_UNAVAILABLE",
        reason: "moderation_unavailable",
        message: "Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.",
      },
    };
  }

  const recorded = await admin.rpc("record_chat_image_moderation", {
    p_path: path,
    p_user: userId,
    p_approved: !verdict.reject,
    p_category: verdict.category,
    p_confidence: verdict.confidence,
    p_high_risk: verdict.highRisk,
  });
  if (recorded.error) {
    console.error("record moderation", recorded.error.message);
    await admin.storage.from("chat-images").remove([path]);
    return { error: { code: "IMAGE_NOT_APPROVED", message: "Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi." } };
  }
  if (verdict.reject) {
    return {
      error: {
        code: "IMAGE_REJECTED",
        reason: "unsafe_content",
        message: "Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi.",
      },
    };
  }
  return { data: { approved: true } };
}

async function pulseBotStory() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!service) return { skipped: true };

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: clock } = await admin.from("bot_clock").select("last_story_at").eq("id", 1).maybeSingle();
  const last = clock?.last_story_at ? Date.parse(String(clock.last_story_at)) : 0;
  if (last && Date.now() - last < 18 * 60 * 1000) return { skipped: true };

  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: recentStories } = await admin.from("stories").select("user_id").gte("created_at", since);
  const busy = new Set((recentStories ?? []).map((row: { user_id: string }) => row.user_id));

  const { data: bots } = await admin.from("profiles").select("id, display_name, bio").eq("is_bot", true);
  const free = (bots ?? []).filter((row: { id: string }) => !busy.has(row.id));
  if (!free.length) return { skipped: true };
  const bot = free[Math.floor(Math.random() * free.length)] as {
    id: string;
    display_name?: string;
    bio?: string | null;
  };

  const categories = [
    {
      prompt: "Simple flat illustration of a warm study desk with lamp notebook and tea, cream and orange, no text no letters",
      caption: "Masa başındayım",
      key: "desk",
    },
    {
      prompt: "Simple flat illustration of tidy study notes and a small bookmark, navy cream orange, no text no letters",
      caption: "Kısa konu özeti",
      key: "summary",
    },
    {
      prompt: "Simple flat illustration of a small checklist and a pencil, warm cream orange navy, no text no letters",
      caption: "Bugünkü hedef 20 soru",
      key: "goal",
    },
    {
      prompt: "Simple flat illustration of a practice test booklet and eraser, cream orange navy, no text no letters",
      caption: "Soru çözüyorum",
      key: "questions",
    },
    {
      prompt: "Simple flat illustration of a coffee cup beside a closed notebook, warm cream orange, no text no letters",
      caption: "Kısa mola",
      key: "break",
    },
    {
      prompt: "Simple flat illustration of an exam hall clock and a quiet desk, navy cream orange, no text no letters",
      caption: "Deneme bitti, analiz",
      key: "mock",
    },
  ];
  const picked = categories[Math.floor(Math.random() * categories.length)];
  let caption = picked.caption;
  const persona = `${bot.display_name ?? "Öğrenci"}${bot.bio ? ` · ${bot.bio}` : ""}`;
  try {
    const chat = await generateText(
      "social_post_generation",
      [
        {
          role: "system",
          content: "ÖSYM öğrencisi story yazıyorsun. Tek kısa Türkçe cümle, en fazla 8 kelime. Hashtag yok, tırnak yok.",
        },
        {
          role: "user",
          content: `Persona: ${persona}. Kategori: ${picked.key}. Doğal bir story metni yaz.`,
        },
      ],
      { cache: false },
    );
    const text = String(chat.text ?? "").replace(/["']/g, "").trim();
    if (text.length >= 4 && text.length <= 80) caption = text;
  } catch {
    // caption fallback
  }

  let bytes: Uint8Array;
  try {
    const img = await generateImage("image_generation", picked.prompt, { size: "256x256", cache: false });
    bytes = img.bytes;
  } catch (error) {
    console.error("story image", error);
    return { skipped: true };
  }
  if (!bytes?.length) return { skipped: true };
  const path = `${bot.id}/${crypto.randomUUID()}.png`;
  const upload = await admin.storage.from("stories").upload(path, bytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (upload.error) {
    console.error("story upload", upload.error.message);
    return { skipped: true };
  }
  const pub = admin.storage.from("stories").getPublicUrl(path);
  const { error } = await admin.from("stories").insert({
    user_id: bot.id,
    image_url: pub.data.publicUrl,
    caption,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) {
    console.error("story insert", error.message);
    return { skipped: true };
  }
  await admin.from("bot_clock").update({ last_story_at: new Date().toISOString() }).eq("id", 1);
  return { skipped: false };
}
