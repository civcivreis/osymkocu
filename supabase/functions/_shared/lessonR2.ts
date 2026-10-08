import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

type LessonR2Client = {
  aws: AwsClient;
  endpoint: string;
  bucket: string;
};

function required(name: string) {
  const value = (Deno.env.get(name) ?? "").trim();
  if (!value) throw new Error("LESSON_R2_NOT_CONFIGURED");
  return value;
}

export function lessonR2Client(): LessonR2Client {
  const accessKeyId = required("LESSON_R2_ACCESS_KEY_ID");
  const secretAccessKey = required("LESSON_R2_SECRET_ACCESS_KEY");
  const endpoint = required("LESSON_R2_ENDPOINT").replace(/\/$/, "");
  const bucket = required("LESSON_R2_BUCKET");
  const aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: "auto",
    service: "s3",
  });
  return { aws, endpoint, bucket };
}

export function lessonR2Bucket() {
  return required("LESSON_R2_BUCKET");
}

function objectUrl(endpoint: string, bucket: string, key: string) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${bucket}/${encoded}`;
}

function asBytes(body: string | Uint8Array | ArrayBuffer) {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

export function slugSegment(value: string) {
  const folded = value
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıIİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u");
  return folded.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

export function lessonAssetPrefix(input: {
  examType: string;
  subject: string;
  lessonSlug: string;
  version: number;
}) {
  return `lessons/${slugSegment(input.examType)}/${slugSegment(input.subject)}/${slugSegment(input.lessonSlug)}/v${input.version}`;
}

export async function putLessonObject(
  key: string,
  body: string | Uint8Array | ArrayBuffer,
  contentType: string,
) {
  const client = lessonR2Client();
  const url = objectUrl(client.endpoint, client.bucket, key);
  const bytes = asBytes(body);
  const res = await client.aws.fetch(url, {
    method: "PUT",
    body: bytes,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LESSON_R2_PUT_${res.status}`);
  }
  return { key, bucket: client.bucket, bytes: bytes.byteLength };
}

export async function deleteLessonObject(key: string) {
  const client = lessonR2Client();
  const url = objectUrl(client.endpoint, client.bucket, key);
  const res = await client.aws.fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`LESSON_R2_DELETE_${res.status}`);
  }
}

export async function createLessonSignedUrl(key: string, expiresIn = 600) {
  const client = lessonR2Client();
  const ttl = Math.min(Math.max(expiresIn, 30), 3600);
  const url = `${objectUrl(client.endpoint, client.bucket, key)}?X-Amz-Expires=${ttl}`;
  const signed = await client.aws.sign(url, {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}
