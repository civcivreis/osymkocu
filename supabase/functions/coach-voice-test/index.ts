import { json, mapHttpError, preflight, requireFactoryCaller } from "../_shared/lessonHttp.ts";
import { generateSpeech } from "../_shared/aiRouter.ts";
import { COACH_SPEECH_INSTRUCTIONS } from "../_shared/speechProviderAdapter.ts";
import { r2Put, r2SignedGet } from "../_shared/r2.ts";
import { serviceClient } from "../_shared/lessonHttp.ts";

const SAMPLE =
  "Bu soruda bütün paragrafı okumana gerek yok. Önce giriş cümlesini bulacağız. Bu, çünkü ve böylece gibi bağlayıcı ifadeleri gördüğünde dikkat et. Bunlar önceki düşünceye bağlı olabileceğini gösterir. Hazırsan birlikte çözelim.";

async function previewUrl(voice: string, key: string | null) {
  if (!key) return null;
  try {
    return await r2SignedGet(key, 3600);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json({ error: { code: "METHOD", message: "POST gerekli." } }, 405, req);
  try {
    const caller = await requireFactoryCaller(req);
    const admin = serviceClient();
    if (caller.kind === "admin" && caller.user) {
      const { data: profile } = await admin.from("profiles").select("app_role").eq("id", caller.user.id).maybeSingle();
      if (profile?.app_role !== "super_admin") {
        return json({ error: { code: "ADMIN_ONLY", message: "Ses testi süper admin." } }, 403, req);
      }
    }
    const body = await req.json().catch(() => ({})) as { voice?: string; choose?: string; force?: boolean };
    if (body.choose && ["marin", "cedar"].includes(body.choose)) {
      await admin.from("ai_runtime_settings").update({ tts_voice: body.choose, updated_at: new Date().toISOString() }).eq("id", 1);
      return json({ ok: true, tts_voice: body.choose });
    }

    const voices = body.voice ? [body.voice] : ["marin", "cedar"];
    const samples: Record<string, string> = {};
    const stored: Record<string, { bytes: number; key: string }> = {};

    const { data: existing } = await admin.from("coach_voice_previews").select("voice, r2_key, byte_size, created_at").in("voice", voices);
    const byVoice = new Map((existing ?? []).map((row) => [String(row.voice), row]));

    for (const voice of voices) {
      const row = byVoice.get(voice);
      const fresh = row?.created_at && Date.now() - new Date(String(row.created_at)).getTime() < 14 * 86400_000;
      if (!body.force && row?.r2_key && fresh) {
        const url = await previewUrl(voice, String(row.r2_key));
        if (url) {
          samples[voice] = url;
          stored[voice] = { bytes: Number(row.byte_size ?? 0), key: String(row.r2_key) };
          continue;
        }
      }
      const spoken = await generateSpeech("coach_voice_preview", SAMPLE, voice, COACH_SPEECH_INSTRUCTIONS);
      const key = `coach-voice/preview-${voice}.mp3`;
      await r2Put(key, spoken.bytes, "audio/mpeg");
      await admin.from("coach_voice_previews").upsert({
        voice,
        r2_key: key,
        byte_size: spoken.bytes.byteLength,
        sample_text: SAMPLE,
        created_at: new Date().toISOString(),
      }, { onConflict: "voice" });
      const url = await previewUrl(voice, key);
      if (!url) throw new Error("VOICE_URL_FAILED");
      samples[voice] = url;
      stored[voice] = { bytes: spoken.bytes.byteLength, key };
    }

    return json({
      ok: true,
      sample_text: SAMPLE,
      samples,
      stored,
      voices: Object.keys(samples),
      note: "Mevcut ders sesleri yenilenmez. Önizleme imzalı URL olarak döner.",
    });
  } catch (error) {
    return mapHttpError(error, req);
  }
});
