export const COACH_SPEECH_INSTRUCTIONS = [
  "Speak in natural Turkish, as a warm personal exam coach talking directly to one student.",
  "Conversational pacing. Short sentences. Confident, not theatrical.",
  "Slight emphasis on keywords. Medium pace. Natural short pauses.",
  "Slow down on rules, definitions, and formulas.",
  "Energetic enough to keep attention. Never monotone or robotic.",
  "Do not sound like a presenter, influencer, or textbook reader.",
  "The student should feel: a coach is explaining this directly to me.",
].join(" ");

export const AUDIO_SPEECH_TRANSITIONAL_MODEL = "gpt-4o-mini-tts";
export const REALTIME_SPEECH_MODEL = "gpt-realtime-2.1-mini";
export const AUDIO_SPEECH_ADAPTER = "audio_speech_transitional";
export const REALTIME_SPEECH_ADAPTER = "realtime_speech";

export type SpeechAdapterInput = {
  model: string;
  voice: string;
  instructions?: string;
  input: string;
  format?: "mp3" | "wav" | "opus";
};

export type SpeechAdapterResult = {
  bytes: Uint8Array;
  mimeType: string;
  durationMs: number | null;
  model: string;
  adapter: string;
  endpointType: string;
  speechPath: string;
  request: {
    endpoint: string;
    model: string;
    voice: string;
    instructions: boolean;
    format: string;
  };
};

function openaiKey() {
  const key = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  return key;
}

function mimeFor(format: string) {
  if (format === "wav") return "audio/wav";
  if (format === "opus") return "audio/ogg";
  return "audio/mpeg";
}

function retryAfterMs(headers: Headers) {
  const raw = headers.get("retry-after");
  if (raw) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum >= 0) return Math.min(Math.max(Math.ceil(asNum * 1000), 1500), 90_000);
    const when = Date.parse(raw);
    if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 1500), 90_000);
  }
  return 8000 + Math.floor(Math.random() * 2500);
}

export function speechRouteForModel(model: string) {
  const key = model.trim();
  if (!key) {
    return {
      adapter: AUDIO_SPEECH_ADAPTER,
      endpointType: "audio_speech" as const,
      model: AUDIO_SPEECH_TRANSITIONAL_MODEL,
      ready: true,
    };
  }
  if (key === REALTIME_SPEECH_MODEL || /realtime/i.test(key)) {
    return {
      adapter: REALTIME_SPEECH_ADAPTER,
      endpointType: "realtime_audio" as const,
      model: key,
      ready: false,
    };
  }
  if (key === "tts-1" || key === "tts-1-hd") {
    throw new Error("SPEECH_MODEL_DEPRECATED");
  }
  return {
    adapter: AUDIO_SPEECH_ADAPTER,
    endpointType: "audio_speech" as const,
    model: key,
    ready: true,
  };
}

export function preprocessNarrationScript(input: string) {
  let text = String(input ?? "");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`+/g, "");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/[*_~]+/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/\s*[;:]\s*/g, ". ");
  text = text.replace(/\s+[—–]\s+/g, ". ");
  text = text.replace(/\b(Örn|orn)\.\s*/gi, "Örneğin ");
  text = text.replace(/\b(vb|vs)\.\s*/gi, "ve benzeri ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/([^.!?…]{140,}?)\s+(ve|ama|fakat|çünkü|ancak)\s+/gi, "$1. $2 ");
  return text;
}

/** Explicit adapter A — not production-ready. Never silently remap to /v1/audio/speech. */
export async function realtimeSpeechAdapter(_args: SpeechAdapterInput): Promise<SpeechAdapterResult> {
  throw new Error("SPEECH_ADAPTER_NOT_READY:realtime_speech");
}

/** Explicit adapter B — POST /v1/audio/speech. Caller must pass the model that will be sent. */
export async function audioSpeechTransitionalAdapter(args: SpeechAdapterInput): Promise<SpeechAdapterResult> {
  const format = args.format ?? "mp3";
  const model = args.model.trim() || AUDIO_SPEECH_TRANSITIONAL_MODEL;
  const supportsInstructions = model === AUDIO_SPEECH_TRANSITIONAL_MODEL || model.startsWith("gpt-4o");
  const body: Record<string, unknown> = {
    model,
    voice: args.voice,
    input: args.input,
    response_format: format,
  };
  if (supportsInstructions && args.instructions) body.instructions = args.instructions;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openaiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const wait = retryAfterMs(response.headers);
      if (response.status === 429) throw new Error(`AI_RETRYABLE:429:${wait}`);
      const raw = await response.text();
      if ([408, 409, 500, 502, 503, 529].includes(response.status)) throw new Error("AI_RETRYABLE");
      if (response.status === 400 && /model[_ ]not[_ ]found|does not exist|invalid model/i.test(raw)) {
        throw new Error("AI_RETRYABLE");
      }
      throw new Error(`TTS_FAILED:${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      mimeType: mimeFor(format),
      durationMs: null,
      model,
      adapter: AUDIO_SPEECH_ADAPTER,
      endpointType: "audio_speech",
      speechPath: "audio.speech.transitional",
      request: {
        endpoint: "/v1/audio/speech",
        model,
        voice: args.voice,
        instructions: Boolean(body.instructions),
        format,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("AI_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function speechProviderAdapter(args: SpeechAdapterInput): Promise<SpeechAdapterResult> {
  const route = speechRouteForModel(args.model);
  if (route.adapter === REALTIME_SPEECH_ADAPTER) {
    return realtimeSpeechAdapter({ ...args, model: route.model });
  }
  return audioSpeechTransitionalAdapter({ ...args, model: route.model });
}
