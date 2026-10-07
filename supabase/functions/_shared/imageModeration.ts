export type ModerationVerdict = {
  reject: boolean;
  highRisk: boolean;
  category: string | null;
  confidence: number;
  flagged: boolean;
  sexual: boolean;
  violenceGraphic: boolean;
};

type ModerationResult = {
  flagged?: boolean;
  categories?: Record<string, boolean>;
  category_scores?: Record<string, number>;
  category_applied_input_types?: Record<string, string[]>;
};

const IMAGE_SCORED_CATEGORIES = ["sexual", "violence", "violence/graphic", "self-harm"] as const;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function flag(categories: Record<string, boolean> | undefined, key: string) {
  return Boolean(categories?.[key]);
}

function imageWasScored(result: ModerationResult) {
  const applied = result.category_applied_input_types;
  if (!applied || typeof applied !== "object") return true;
  return IMAGE_SCORED_CATEGORIES.some((key) => (applied[key] ?? []).includes("image"));
}

export function decideImage(result: ModerationResult | undefined): ModerationVerdict {
  if (!result || !result.categories || typeof result.flagged !== "boolean") {
    throw new Error("MODERATION_INVALID_RESPONSE");
  }
  if (!imageWasScored(result)) {
    throw new Error("MODERATION_IMAGE_NOT_SCORED");
  }

  const categories = result.categories;
  const scores = result.category_scores ?? {};
  const score = (key: string) => Number(scores[key] ?? 0);

  const sexual = flag(categories, "sexual");
  const minors = flag(categories, "sexual/minors");
  const violence = flag(categories, "violence");
  const graphic = flag(categories, "violence/graphic");
  const selfHarm = flag(categories, "self-harm") || flag(categories, "self-harm/intent");

  const reject =
    result.flagged === true || sexual || minors || violence || graphic || selfHarm;

  const category = minors
    ? "sexual/minors"
    : sexual
      ? "sexual"
      : graphic
        ? "violence/graphic"
        : violence
          ? "violence"
          : selfHarm
            ? "self-harm"
            : result.flagged
              ? "flagged"
              : null;

  return {
    reject,
    highRisk: minors,
    category,
    confidence: score(category ?? "sexual"),
    flagged: result.flagged === true,
    sexual,
    violenceGraphic: graphic,
  };
}

async function postModeration(apiKey: string, imageUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          {
            type: "image_url",
            image_url: { url: imageUrl },
          },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`MODERATION_${response.status}:${raw.slice(0, 180)}`);
    }
    const body = JSON.parse(raw) as { results?: ModerationResult[] };
    const result = body?.results?.[0];
    if (!result) throw new Error("MODERATION_EMPTY_RESULTS");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetryWithDataUrl(error: unknown) {
  const message = String(error instanceof Error ? error.message : error);
  return /MODERATION_(400|404|415|422|EMPTY_RESULTS|INVALID_RESPONSE|IMAGE_NOT_SCORED)|download|fetch|unable to load|invalid image|image_url|abort/i.test(
    message,
  );
}

export async function moderateImageBytes(
  apiKey: string,
  bytes: Uint8Array,
  mime: string,
  options?: { mediaId?: string; signedUrl?: string },
) {
  const mediaId = options?.mediaId ?? null;
  console.log("[media-moderation]", { mediaId, event: "started" });

  const scoreUrl = async (url: string) => decideImage(await postModeration(apiKey, url));

  if (options?.signedUrl) {
    try {
      const verdict = await scoreUrl(options.signedUrl);
      console.log("[media-moderation]", {
        mediaId,
        flagged: verdict.flagged,
        sexual: verdict.sexual,
        violenceGraphic: verdict.violenceGraphic,
        event: verdict.reject ? "rejected" : "approved",
      });
      console.log("[media-moderation]", { mediaId, event: "completed" });
      return verdict;
    } catch (error) {
      if (!shouldRetryWithDataUrl(error) || !bytes.byteLength) throw error;
      console.log("[media-moderation]", { mediaId, event: "retry_data_url" });
    }
  }

  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  const verdict = await scoreUrl(dataUrl);
  console.log("[media-moderation]", {
    mediaId,
    flagged: verdict.flagged,
    sexual: verdict.sexual,
    violenceGraphic: verdict.violenceGraphic,
    event: verdict.reject ? "rejected" : "approved",
  });
  console.log("[media-moderation]", { mediaId, event: "completed" });
  return verdict;
}
