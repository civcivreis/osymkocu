import { generateText } from "../_shared/aiRouter.ts";
import { json, mapHttpError, preflight, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";
import { r2Delete } from "../_shared/r2.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);

  try {
    const admin = serviceClient();
    const wake = req.headers.get("x-virtual-wake") ?? req.headers.get("x-factory-wake") ?? "";
    if (wake) {
      const { data } = await admin.from("virtual_ai_budget_policy").select("wake_secret").eq("id", 1).maybeSingle();
      if (!data?.wake_secret || wake !== data.wake_secret) {
        throw Object.assign(new Error("ADMIN_ONLY"), { status: 403 });
      }
    } else {
      await requireLessonAdmin(req);
    }

    const body = await req.json().catch(() => ({})) as { drainOnly?: boolean };
    let tick: unknown = null;
    if (!body.drainOnly) {
      const { data, error } = await admin.rpc("virtual_student_engine_tick");
      if (error) throw error;
      tick = data;
      const keys = (data as { stories?: { r2_keys?: string[] } } | null)?.stories?.r2_keys ?? [];
      for (const key of keys) {
        if (typeof key === "string" && key.length > 4) await r2Delete(key);
      }
    }

    const drained = await drainVirtualAi(admin);
    return json({ ok: true, data: tick, ai: drained });
  } catch (error) {
    return mapHttpError(error, req);
  }
});

type PendingAi = {
  id: string;
  profile_id: string;
  activity_type: string;
  requested_tier: number;
  context: Record<string, unknown>;
};

async function drainVirtualAi(admin: ReturnType<typeof serviceClient>) {
  const { data, error } = await admin.rpc("virtual_ai_pending", { p_limit: 2 });
  if (error) return { error: error.message, processed: 0 };
  const rows = (Array.isArray(data) ? data : []) as PendingAi[];
  let processed = 0;
  let fallback = 0;
  for (const row of rows) {
    const gate = await admin.rpc("virtual_ai_allow", {
      p_profile: row.profile_id,
      p_activity: row.activity_type,
      p_requested_tier: row.requested_tier,
    });
    const allowed = (gate.data as { allowed?: boolean; tier?: number; task?: string } | null)?.allowed;
    const task = String((gate.data as { task?: string } | null)?.task ?? "bot_conversation");
    if (!allowed) {
      await admin.rpc("virtual_ai_fallback_tier1", { p_id: row.id });
      fallback += 1;
      continue;
    }
    const prev = String(row.context?.prev_body ?? "");
    try {
      const chat = await generateText(
        row.requested_tier >= 3 ? "lesson_generation" : task,
        [
          {
            role: "system",
            content:
              row.requested_tier >= 3
                ? "KPSS/TYT öğrencisisin. En fazla 2 kısa cümle, doğal Türkçe, hashtag yok. Sadece istenen akademik noktayı sade anlat."
                : "KPSS öğrencisi sohbeti. En fazla 2 kısa cümle, şablon gibi durmasın, hashtag yok.",
          },
          { role: "user", content: prev || "kısa doğal bir tepki yaz" },
        ],
        { cache: false, profileId: row.profile_id, jobId: row.id },
      );
      const text = String(chat.text ?? "").replace(/["']/g, "").trim().slice(0, 180);
      const tokens = Number(chat.inputTokens ?? 0) + Number(chat.outputTokens ?? 0);
      const applied = await admin.rpc("virtual_ai_apply_result", {
        p_id: row.id,
        p_text: text,
        p_tokens: tokens,
      });
      if (applied.error) {
        await admin.rpc("virtual_ai_fallback_tier1", { p_id: row.id });
        fallback += 1;
      } else processed += 1;
    } catch {
      await admin.rpc("virtual_ai_fallback_tier1", { p_id: row.id });
      fallback += 1;
    }
  }
  return { processed, fallback, queued: rows.length };
}
