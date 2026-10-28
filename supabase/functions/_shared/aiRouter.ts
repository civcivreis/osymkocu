import { serviceClient } from "./lessonHttp.ts";
import {
  COACH_SPEECH_INSTRUCTIONS,
  speechProviderAdapter,
  speechRouteForModel,
} from "./speechProviderAdapter.ts";

export type QualityTier = "economy" | "balanced" | "premium";
export type AiTaskType =
  | "curriculum_discovery"
  | "curriculum_diff"
  | "curriculum_decomposition"
  | "canonical_topic_matching"
  | "lesson_generation"
  | "memory_pedagogy_generation"
  | "exam_technique_validation"
  | "lesson_quality_validation"
  | "question_generation"
  | "question_validation"
  | "question_similarity_check"
  | "bot_conversation"
  | "social_post_generation"
  | "social_comment_generation"
  | "image_generation"
  | "premium_image_generation"
  | "tts_generation"
  | "coach_voice_preview"
  | "content_moderation_text"
  | "content_moderation_image";

export type AiModelConfig = {
  taskType: string;
  provider: string;
  primaryModel: string;
  fallbackModel: string | null;
  economyModel: string | null;
  premiumModel: string | null;
  qualityTier: QualityTier;
  minimumQualityTier: QualityTier;
  maxOutputTokens: number | null;
  temperature: number | null;
  reasoningEffort: string | null;
  isEnabled: boolean;
  configVersion: number;
  estimatedCostClass: string;
  notes: string | null;
};

export type ResolvedRoute = AiModelConfig & {
  model: string;
  runtimeMode: QualityTier;
  ttsVoice: string;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | unknown };

export type RunAiOptions = {
  promptVersion?: string;
  lessonId?: string;
  questionId?: string;
  jobId?: string;
  profileId?: string;
  cache?: boolean;
  forcePremium?: boolean;
  timeoutMs?: number;
  voice?: string;
  instructions?: string;
};

type UsageMeta = {
  inputTokens?: number;
  outputTokens?: number;
  fallbackUsed: boolean;
  model: string;
  provider: string;
  taskType: string;
  latencyMs: number;
  cached?: boolean;
  configVersion: number;
  runtimeMode: QualityTier;
  adapter?: string;
  endpointType?: string;
};

const TIER_RANK: Record<QualityTier, number> = { economy: 0, balanced: 1, premium: 2 };

let configCache: { at: number; tasks: Map<string, AiModelConfig>; mode: QualityTier; ttsVoice: string; ttsInstructions: string; caps: { ai: number | null; image: number | null; tts: number | null } } | null = null;

function openaiKey() {
  const key = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  return key;
}

function envModelOverride(taskType: string) {
  const key = `AI_MODEL_${taskType.toUpperCase()}`;
  return canonicalizeModel((Deno.env.get(key) ?? "").trim()) || null;
}

const MODEL_ALIASES: Record<string, string> = {
  "gpt-6.1-sol": "gpt-5.6-sol",
  "gpt-6-sol": "gpt-5.6-sol",
  "gpt-6-luna": "gpt-5.6-luna",
};

function canonicalizeModel(model: string) {
  const key = model.trim();
  if (!key) return "";
  return MODEL_ALIASES[key] ?? key;
}

function isSpeechTask(taskType: string) {
  return taskType === "tts_generation" || taskType === "coach_voice_preview";
}

function isReasoningChatModel(model: string) {
  return /^(gpt-5|gpt-6|o[1-9])/.test(model);
}

function chatCompletionBody(
  model: string,
  messages: ChatMessage[],
  cfg: AiModelConfig,
  extra: Record<string, unknown> = {},
) {
  const body: Record<string, unknown> = { model, messages, ...extra };
  const max = cfg.maxOutputTokens ?? 4000;
  if (isReasoningChatModel(model)) {
    body.max_completion_tokens = max;
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;
  } else {
    body.max_tokens = max;
    body.temperature = cfg.temperature ?? 0.4;
  }
  return body;
}

function providerErrorCode(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string; type?: string } };
    return String(parsed.error?.code || parsed.error?.type || parsed.error?.message || "").slice(0, 120);
  } catch {
    return raw.slice(0, 120);
  }
}

function asTier(value: unknown, fallback: QualityTier): QualityTier {
  return value === "economy" || value === "balanced" || value === "premium" ? value : fallback;
}

async function loadRuntime() {
  const now = Date.now();
  if (configCache && now - configCache.at < 30_000) return configCache;
  const admin = serviceClient();
  const [{ data: tasks }, { data: settings }] = await Promise.all([
    admin.from("ai_model_config").select("*").eq("is_enabled", true),
    admin.from("ai_runtime_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const map = new Map<string, AiModelConfig>();
  for (const row of tasks ?? []) {
    const taskType = String(row.task_type);
    map.set(taskType, {
      taskType,
      provider: String(row.provider ?? "openai"),
      primaryModel: canonicalizeModel(String(row.primary_model)),
      fallbackModel: row.fallback_model ? canonicalizeModel(String(row.fallback_model)) : null,
      economyModel: row.economy_model ? canonicalizeModel(String(row.economy_model)) : null,
      premiumModel: row.premium_model ? canonicalizeModel(String(row.premium_model)) : null,
      qualityTier: asTier(row.quality_tier, "balanced"),
      minimumQualityTier: asTier(row.minimum_quality_tier, "economy"),
      maxOutputTokens: row.max_output_tokens == null ? null : Number(row.max_output_tokens),
      temperature: row.temperature == null ? null : Number(row.temperature),
      reasoningEffort: row.reasoning_effort ? String(row.reasoning_effort) : null,
      isEnabled: row.is_enabled !== false,
      configVersion: Number(row.config_version ?? 1),
      estimatedCostClass: String(row.estimated_cost_class ?? "medium"),
      notes: row.notes ? String(row.notes) : null,
    });
  }
  configCache = {
    at: now,
    tasks: map,
    mode: asTier(settings?.mode, "balanced"),
    ttsVoice: String(settings?.tts_voice ?? "marin"),
    ttsInstructions: String(settings?.tts_instructions ?? COACH_SPEECH_INSTRUCTIONS),
    caps: {
      ai: settings?.max_daily_ai_jobs == null ? null : Number(settings.max_daily_ai_jobs),
      image: settings?.max_daily_image_jobs == null ? null : Number(settings.max_daily_image_jobs),
      tts: settings?.max_daily_tts_jobs == null ? null : Number(settings.max_daily_tts_jobs),
    },
  };
  return configCache;
}

export async function getAiModelConfig(taskType: string): Promise<AiModelConfig> {
  const runtime = await loadRuntime();
  const row = runtime.tasks.get(taskType);
  if (!row || !row.isEnabled) throw new Error("AI_TASK_DISABLED");
  const env = envModelOverride(taskType);
  return env ? { ...row, primaryModel: env } : row;
}

export async function resolveAiRoute(taskType: string, options?: { forcePremium?: boolean }): Promise<ResolvedRoute> {
  const runtime = await loadRuntime();
  let cfg = await getAiModelConfig(taskType);
  let desired: QualityTier = runtime.mode;
  if (options?.forcePremium) desired = "premium";
  if (TIER_RANK[desired] < TIER_RANK[cfg.minimumQualityTier]) desired = cfg.minimumQualityTier;
  let model = cfg.primaryModel;
  const eligibleForPremiumUpgrade = TIER_RANK[cfg.qualityTier] >= TIER_RANK["balanced"] || options?.forcePremium;
  if (desired === "premium" && eligibleForPremiumUpgrade) model = cfg.premiumModel || cfg.primaryModel;
  else if (desired === "economy") model = cfg.economyModel || cfg.primaryModel;
  const env = envModelOverride(taskType);
  if (env) model = env;
  if (isSpeechTask(taskType)) {
    const route = speechRouteForModel(model);
    if (!route.ready) throw new Error("SPEECH_ADAPTER_NOT_READY:realtime_speech");
    model = route.model;
  }
  return { ...cfg, model, runtimeMode: runtime.mode, ttsVoice: runtime.ttsVoice };
}

export class ProviderRateLimitError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`AI_RETRYABLE:429:${retryAfterMs}`);
    this.name = "ProviderRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseRetryAfterHeader(headers: Headers, attempt = 0) {
  const raw = headers.get("retry-after");
  if (raw) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum >= 0) return Math.min(Math.max(Math.ceil(asNum * 1000), 1500), 90_000);
    const when = Date.parse(raw);
    if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 1500), 90_000);
  }
  const exp = Math.min(4000 * (2 ** attempt), 45_000);
  return exp + Math.floor(Math.random() * 1200);
}

export function isRateLimitError(error: unknown) {
  return error instanceof ProviderRateLimitError ||
    (error instanceof Error && (
      error.message.startsWith("AI_RETRYABLE:429") ||
      error.message === "AI_RETRYABLE" ||
      error.message.startsWith("RATE_LIMITED")
    ));
}

export function retryAfterMsFromError(error: unknown, attempt = 0) {
  if (error instanceof ProviderRateLimitError) return error.retryAfterMs;
  if (error && typeof error === "object" && "retryAfterMs" in error && Number.isFinite(Number((error as { retryAfterMs: number }).retryAfterMs))) {
    return Number((error as { retryAfterMs: number }).retryAfterMs);
  }
  if (error instanceof Error) {
    const match = error.message.match(/AI_RETRYABLE:429:(\d+)/) || error.message.match(/RATE_LIMITED:(\d+)/);
    if (match) return Number(match[1]);
  }
  return parseRetryAfterHeader(new Headers(), attempt);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBoundedBackoff<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isRateLimitError(error) || i === attempts - 1) throw error;
      const wait = Math.min(retryAfterMsFromError(error, i), 20_000);
      console.error("provider backoff", i + 1, wait);
      await sleep(wait);
    }
  }
  throw last;
}

function throwIfProviderFailed(response: Response, raw: string, retryAfterMs: number, fallbackCode: string) {
  if (response.ok) return;
  if (response.status === 429) throw new ProviderRateLimitError(retryAfterMs || parseRetryAfterHeader(response.headers, 0));
  if (isRetryableProvider(response.status, raw)) throw new Error("AI_RETRYABLE");
  throw new Error(fallbackCode);
}

function isRetryableProvider(status: number, body: string) {
  if ([408, 409, 429, 500, 502, 503, 529].includes(status)) return true;
  if (status === 404 && /model/i.test(body)) return true;
  if (status === 400 && /model[_ ]not[_ ]found|does not exist|invalid model/i.test(body)) return true;
  return false;
}

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function inputHash(value: unknown) {
  return sha256(JSON.stringify(value));
}

async function enforceCaps(taskType: string) {
  const runtime = await loadRuntime();
  const admin = serviceClient();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const dayIso = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const { count } = await admin
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${dayIso}T00:00:00+03:00`);
  if (runtime.caps.ai != null && (count ?? 0) >= runtime.caps.ai) throw new Error("AI_DAILY_CAP");
  if (taskType.includes("image") && runtime.caps.image != null) {
    const { count: images } = await admin
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .in("task_type", ["image_generation", "premium_image_generation"])
      .gte("created_at", `${dayIso}T00:00:00+03:00`);
    if ((images ?? 0) >= runtime.caps.image) throw new Error("AI_DAILY_CAP");
  }
  if ((taskType === "tts_generation" || taskType === "coach_voice_preview") && runtime.caps.tts != null) {
    const { count: tts } = await admin
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .in("task_type", ["tts_generation", "coach_voice_preview"])
      .gte("created_at", `${dayIso}T00:00:00+03:00`);
    if ((tts ?? 0) >= runtime.caps.tts) throw new Error("AI_DAILY_CAP");
  }
}

async function logUsage(meta: UsageMeta & { success: boolean; errorCode?: string; options?: RunAiOptions }) {
  try {
    const admin = serviceClient();
    await admin.from("ai_usage_log").insert({
      task_type: meta.taskType,
      provider: meta.provider,
      model: meta.model,
      success: meta.success,
      fallback_used: meta.fallbackUsed,
      latency_ms: meta.latencyMs,
      input_tokens: meta.inputTokens ?? null,
      output_tokens: meta.outputTokens ?? null,
      profile_id: meta.options?.profileId ?? null,
      lesson_id: meta.options?.lessonId ?? null,
      question_id: meta.options?.questionId ?? null,
      job_id: meta.options?.jobId ?? null,
      error_code: meta.errorCode ?? null,
      adapter: meta.adapter ?? null,
      endpoint_type: meta.endpointType ?? null,
    });
  } catch (error) {
    console.error("ai_usage_log", error instanceof Error ? error.message : error);
  }
}

async function openaiFetch(path: string, body: unknown, timeoutMs = 180_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openaiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const retryAfterMs = parseRetryAfterHeader(response.headers, 0);
    const raw = await response.text();
    return { response, raw, retryAfterMs };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("AI_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiTask(
  taskType: string,
  payload: {
    kind?: "text" | "structured" | "image" | "speech";
    messages?: ChatMessage[];
    schema?: unknown;
    prompt?: string;
    input?: string;
    size?: string;
  },
  options?: RunAiOptions,
) {
  const kind = payload.kind ?? (payload.schema ? "structured" : payload.prompt ? "image" : "text");
  if (kind === "structured") {
    return generateStructured(taskType, payload.messages ?? [], payload.schema, options);
  }
  if (kind === "image") {
    const imageTask = taskType === "premium_image_generation" ? "premium_image_generation" : "image_generation";
    return generateImage(imageTask, String(payload.prompt ?? ""), { ...options, size: payload.size });
  }
  if (kind === "speech") {
    return generateSpeech(taskType || "tts_generation", String(payload.input ?? ""), options?.voice, options?.instructions, options);
  }
  return generateText(taskType, payload.messages ?? [], options);
}

async function withFallback<T>(
  taskType: string,
  options: RunAiOptions | undefined,
  run: (model: string) => Promise<T>,
  attempts = 3,
): Promise<{ value: T; meta: UsageMeta }> {
  await enforceCaps(taskType);
  const route = await resolveAiRoute(taskType, { forcePremium: options?.forcePremium });
  const started = Date.now();
  try {
    const value = await withBoundedBackoff(() => run(route.model), attempts);
    return {
      value,
      meta: {
        fallbackUsed: false,
        model: route.model,
        provider: route.provider,
        taskType,
        latencyMs: Date.now() - started,
        configVersion: route.configVersion,
        runtimeMode: route.runtimeMode,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = message.startsWith("AI_RETRYABLE") || message === "AI_TIMEOUT";
    if (!retryable || !route.fallbackModel || route.fallbackModel === route.model) {
      await logUsage({
        fallbackUsed: false,
        model: route.model,
        provider: route.provider,
        taskType,
        latencyMs: Date.now() - started,
        configVersion: route.configVersion,
        runtimeMode: route.runtimeMode,
        success: false,
        errorCode: message.slice(0, 80),
        options,
      });
      throw error;
    }
    try {
      const value = await run(route.fallbackModel);
      const meta: UsageMeta = {
        fallbackUsed: true,
        model: route.fallbackModel,
        provider: route.provider,
        taskType,
        latencyMs: Date.now() - started,
        configVersion: route.configVersion,
        runtimeMode: route.runtimeMode,
      };
      return { value, meta };
    } catch (fallbackError) {
      await logUsage({
        fallbackUsed: true,
        model: route.fallbackModel,
        provider: route.provider,
        taskType,
        latencyMs: Date.now() - started,
        configVersion: route.configVersion,
        runtimeMode: route.runtimeMode,
        success: false,
        errorCode: (fallbackError instanceof Error ? fallbackError.message : "FAIL").slice(0, 80),
        options,
      });
      throw fallbackError;
    }
  }
}

function parseUsage(payload: { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } }) {
  return {
    inputTokens: Number(payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0) || undefined,
    outputTokens: Number(payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0) || undefined,
  };
}

function cloneWithoutArrayBounds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneWithoutArrayBounds);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === "minItems" || key === "maxItems") continue;
      out[key] = cloneWithoutArrayBounds(nested);
    }
    return out;
  }
  return value;
}

export type ProviderAdapter = {
  generateText: (model: string, messages: ChatMessage[], cfg: AiModelConfig) => Promise<{ text: string; usage: { inputTokens?: number; outputTokens?: number } }>;
  generateStructured: (model: string, messages: ChatMessage[], schema: unknown, cfg: AiModelConfig) => Promise<{
    text: string;
    usage: { inputTokens?: number; outputTokens?: number };
    responseFormat: string;
    schemaError?: string;
  }>;
  generateImage: (model: string, prompt: string, size?: string) => Promise<Uint8Array>;
  generateSpeech: (model: string, input: string, voice: string, instructions?: string) => Promise<{
    bytes: Uint8Array;
    mimeType: string;
    durationMs: number | null;
    speechPath: string;
    usedModel: string;
    adapter: string;
    endpointType: string;
  }>;
};

const openaiAdapter: ProviderAdapter = {
  async generateText(model, messages, cfg) {
    const { response, raw, retryAfterMs } = await openaiFetch("chat/completions", chatCompletionBody(model, messages, cfg));
    if (!response.ok) {
      throwIfProviderFailed(response, raw, retryAfterMs, `AI_PROVIDER:${providerErrorCode(raw)}`);
    }
    const payload = JSON.parse(raw) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: String(payload.choices?.[0]?.message?.content ?? ""), usage: parseUsage(payload) };
  },
  async generateStructured(model, messages, schema, cfg) {
    const base = chatCompletionBody(model, messages, { ...cfg, temperature: cfg.temperature ?? 0.2 });
    let responseFormat = schema ? "json_schema" : "json_object";
    let schemaError: string | undefined;
    let { response, raw } = await openaiFetch("chat/completions", {
      ...base,
      response_format: schema ? { type: "json_schema", json_schema: schema } : { type: "json_object" },
    });
    if (response.status === 400 && schema) {
      schemaError = providerErrorCode(raw);
      console.error("ai json_schema 400", model, schemaError, raw.slice(0, 360));
      const loose = cloneWithoutArrayBounds(schema);
      ({ response, raw } = await openaiFetch("chat/completions", {
        ...base,
        response_format: { type: "json_schema", json_schema: loose },
      }));
      responseFormat = "json_schema_loose";
    }
    if (response.status === 400 && schema) {
      schemaError = `${schemaError ?? ""}|loose:${providerErrorCode(raw)}`.slice(0, 180);
      console.error("ai json_schema_loose 400", model, providerErrorCode(raw));
      ({ response, raw } = await openaiFetch("chat/completions", {
        ...base,
        response_format: { type: "json_object" },
      }));
      responseFormat = "json_object";
    }
    if (!response.ok) {
      throwIfProviderFailed(response, raw, 0, `AI_PROVIDER:${providerErrorCode(raw)}`);
    }
    const payload = JSON.parse(raw) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = String(payload.choices?.[0]?.message?.content ?? "{}");
    if (payload.choices?.[0]?.finish_reason === "length") {
      console.error("ai structured truncated", model, text.length);
    }
    return { text, usage: parseUsage(payload), responseFormat, schemaError };
  },
  async generateImage(model, prompt, size = "1792x1024") {
    const landscape = String(size || "1792x1024");
    const [w, h] = landscape.split("x").map(Number);
    const safeSize = Number(w) > 0 && Number(h) > Number(w) ? "1792x1024" : landscape || "1792x1024";
    const attempt = async (payload: Record<string, unknown>) => openaiFetch("images/generations", payload);
    let { response, raw, retryAfterMs } = await attempt({
      model,
      prompt,
      n: 1,
      size: safeSize,
      response_format: "b64_json",
    });
    if (response.status === 400) {
      ({ response, raw, retryAfterMs } = await attempt({ model, prompt, n: 1, size: safeSize === "1792x1024" ? "1536x1024" : "1792x1024" }));
    }
    if (!response.ok) {
      throwIfProviderFailed(response, raw, retryAfterMs, "IMAGE_FAILED");
    }
    const payload = JSON.parse(raw) as { data?: { b64_json?: string; url?: string }[] };
    const b64 = String(payload.data?.[0]?.b64_json ?? "");
    if (b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    const url = String(payload.data?.[0]?.url ?? "");
    if (!url) throw new Error("IMAGE_FAILED");
    const img = await fetch(url);
    if (!img.ok) throw new Error("IMAGE_FAILED");
    return new Uint8Array(await img.arrayBuffer());
  },
  async generateSpeech(model, input, voice, instructions) {
    const spoken = await speechProviderAdapter({
      model,
      voice,
      instructions,
      input,
      format: "mp3",
    });
    return {
      bytes: spoken.bytes,
      mimeType: spoken.mimeType,
      durationMs: spoken.durationMs,
      speechPath: spoken.speechPath,
      usedModel: spoken.model,
      adapter: spoken.adapter,
      endpointType: spoken.endpointType,
    };
  },
};

function adapterFor(provider: string): ProviderAdapter {
  if (provider !== "openai") throw new Error("AI_PROVIDER_UNSUPPORTED");
  return openaiAdapter;
}

async function readCache(taskType: string, hash: string, promptVersion: string, model: string) {
  const admin = serviceClient();
  const { data } = await admin
    .from("ai_generation_cache")
    .select("result")
    .eq("task_type", taskType)
    .eq("input_hash", hash)
    .eq("prompt_version", promptVersion)
    .eq("model", model)
    .maybeSingle();
  return data?.result ?? null;
}

async function writeCache(taskType: string, hash: string, promptVersion: string, model: string, result: unknown) {
  const admin = serviceClient();
  await admin.from("ai_generation_cache").upsert({
    task_type: taskType,
    input_hash: hash,
    prompt_version: promptVersion,
    model,
    result,
  }, { onConflict: "task_type,input_hash,prompt_version,model" }).then(() => undefined, () => undefined);
}

export async function generateText(
  taskType: AiTaskType | string,
  messages: ChatMessage[],
  options?: RunAiOptions,
) {
  const route = await resolveAiRoute(taskType, { forcePremium: options?.forcePremium });
  const provider = adapterFor(route.provider);
  const { value, meta } = await withFallback(taskType, options, (model) => provider.generateText(model, messages, route));
  await logUsage({ ...meta, ...value.usage, success: true, options });
  return { text: value.text, ...meta, ...value.usage };
}

export async function generateStructured(
  taskType: AiTaskType | string,
  messages: ChatMessage[],
  schema: unknown,
  options?: RunAiOptions,
) {
  const route = await resolveAiRoute(taskType, { forcePremium: options?.forcePremium });
  const promptVersion = options?.promptVersion ?? "";
  const hash = await inputHash({ messages, schema, promptVersion });
  if (options?.cache !== false) {
    const cached = await readCache(taskType, hash, promptVersion, route.model);
    if (cached && typeof cached === "object" && "text" in (cached as object)) {
      return {
        text: String((cached as { text: string }).text),
        parsed: JSON.parse(String((cached as { text: string }).text)),
        responseFormat: "cache",
        rawResponseLength: String((cached as { text: string }).text).length,
        cached: true,
        fallbackUsed: false,
        model: route.model,
        provider: route.provider,
        taskType,
        latencyMs: 0,
        configVersion: route.configVersion,
        runtimeMode: route.runtimeMode,
      };
    }
  }
  const provider = adapterFor(route.provider);
  const { value, meta } = await withFallback(taskType, options, (model) => provider.generateStructured(model, messages, schema, route));
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(value.text || "{}");
  } catch {
    await logUsage({ ...meta, ...value.usage, success: false, errorCode: "SCHEMA_PARSE_FAILED", options });
    throw new Error("SCHEMA_PARSE_FAILED");
  }
  await logUsage({ ...meta, ...value.usage, success: true, options });
  if (options?.cache !== false) await writeCache(taskType, hash, promptVersion, meta.model, { text: value.text });
  return {
    text: value.text,
    parsed,
    responseFormat: value.responseFormat,
    schemaError: value.schemaError,
    rawResponseLength: value.text.length,
    ...meta,
    ...value.usage,
  };
}

export async function generateImage(
  taskType: "image_generation" | "premium_image_generation",
  prompt: string,
  options?: RunAiOptions & { size?: string },
) {
  const route = await resolveAiRoute(taskType, { forcePremium: options?.forcePremium });
  const provider = adapterFor(route.provider);
  const { value, meta } = await withFallback(taskType, options, (model) => provider.generateImage(model, prompt, options?.size));
  await logUsage({ ...meta, success: true, options });
  return { bytes: value, ...meta };
}

export async function generateSpeech(
  taskType: string,
  script: string,
  voice?: string,
  instructions?: string,
  options?: RunAiOptions,
) {
  let speechTask = isSpeechTask(taskType) ? taskType : "tts_generation";
  try {
    await getAiModelConfig(speechTask);
  } catch {
    speechTask = "tts_generation";
  }
  const route = await resolveAiRoute(speechTask);
  const runtime = await loadRuntime();
  const provider = adapterFor(route.provider);
  const resolvedVoice = voice || route.ttsVoice;
  const resolvedInstructions = instructions || runtime.ttsInstructions || COACH_SPEECH_INSTRUCTIONS;
  const { value, meta } = await withFallback(
    speechTask,
    options,
    (model) => provider.generateSpeech(model, script, resolvedVoice, resolvedInstructions),
    1,
  );
  const actualModel = value.usedModel || meta.model;
  await logUsage({
    ...meta,
    success: true,
    options,
    model: actualModel,
    adapter: value.adapter,
    endpointType: value.endpointType,
  });
  return {
    bytes: value.bytes,
    mimeType: value.mimeType,
    durationMs: value.durationMs,
    speechPath: value.speechPath,
    adapter: value.adapter,
    endpointType: value.endpointType,
    voice: resolvedVoice,
    instructionsSupported: Boolean(resolvedInstructions),
    ...meta,
    model: actualModel,
  };
}

export async function moderateWithRouter(kind: "text" | "image", input: unknown) {
  const taskType = kind === "text" ? "content_moderation_text" : "content_moderation_image";
  const route = await resolveAiRoute(taskType);
  const started = Date.now();
  const { response, raw } = await openaiFetch("moderations", { model: route.model, input });
  if (!response.ok) {
    if (isRetryableProvider(response.status, raw) && route.fallbackModel) {
      const retry = await openaiFetch("moderations", { model: route.fallbackModel, input });
      if (!retry.response.ok) throw new Error(`MODERATION_${retry.response.status}`);
      await logUsage({
        taskType,
        provider: route.provider,
        model: route.fallbackModel,
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        success: true,
        configVersion: route.configVersion,
        runtimeMode: route.runtimeMode,
      });
      return JSON.parse(retry.raw);
    }
    throw new Error(`MODERATION_${response.status}`);
  }
  await logUsage({
    taskType,
    provider: route.provider,
    model: route.model,
    fallbackUsed: false,
    latencyMs: Date.now() - started,
    success: true,
    configVersion: route.configVersion,
    runtimeMode: route.runtimeMode,
  });
  return JSON.parse(raw);
}

export function generationMeta(meta: { model: string; provider: string; taskType: string; fallbackUsed: boolean; configVersion: number; runtimeMode: QualityTier }, extra?: Record<string, unknown>) {
  return {
    provider: meta.provider,
    model: meta.model,
    task_type: meta.taskType,
    fallback_used: meta.fallbackUsed,
    runtime_mode: meta.runtimeMode,
    config_version: meta.configVersion,
    generated_at: new Date().toISOString(),
    ...extra,
  };
}

export function friendlyAiError(error: unknown, kind: "lesson" | "question" | "image" | "tts" | "generic" = "generic") {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "AI_NOT_CONFIGURED") return { code: "AI_NOT_CONFIGURED", text: "AI yapılandırması eksik." };
  if (message === "AI_DAILY_CAP") return { code: "AI_DAILY_CAP", text: "Günlük AI kotası doldu." };
  if (message === "AI_TASK_DISABLED") return { code: "AI_TASK_DISABLED", text: "Bu AI görevi kapalı." };
  if (kind === "lesson") return { code: "PROVIDER_ERROR", text: "Ders içeriği üretilemedi." };
  if (kind === "question") return { code: "PROVIDER_ERROR", text: "Soru üretimi tamamlanamadı." };
  if (kind === "image") return { code: "PROVIDER_ERROR", text: "Görsel oluşturulamadı." };
  if (kind === "tts") return { code: "PROVIDER_ERROR", text: "Seslendirme oluşturulamadı." };
  return { code: "PROVIDER_ERROR", text: "İşlem tamamlanamadı." };
}
