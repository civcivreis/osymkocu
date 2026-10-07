import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

export function r2Client() {
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
  const endpoint = (Deno.env.get("R2_ENDPOINT") ?? "").replace(/\/$/, "");
  const bucket = Deno.env.get("R2_BUCKET") ?? "";
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) return null;
  const aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: "auto",
    service: "s3",
  });
  return { aws, endpoint, bucket };
}

function objectUrl(endpoint: string, bucket: string, key: string) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${bucket}/${encoded}`;
}

export async function r2Put(key: string, body: Uint8Array, mime: string) {
  const client = r2Client();
  if (!client) throw new Error("R2_NOT_CONFIGURED");
  const url = objectUrl(client.endpoint, client.bucket, key);
  const res = await client.aws.fetch(url, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": mime,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2_PUT_${res.status}:${text.slice(0, 180)}`);
  }
}

export async function r2Delete(key: string) {
  const client = r2Client();
  if (!client) return;
  const url = objectUrl(client.endpoint, client.bucket, key);
  await client.aws.fetch(url, { method: "DELETE" }).catch(() => undefined);
}

export async function r2SignedGet(key: string, expiresSec = 600) {
  const client = r2Client();
  if (!client) throw new Error("R2_NOT_CONFIGURED");
  const url = `${objectUrl(client.endpoint, client.bucket, key)}?X-Amz-Expires=${expiresSec}`;
  const signed = await client.aws.sign(url, {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}
