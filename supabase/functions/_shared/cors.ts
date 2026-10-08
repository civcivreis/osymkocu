const DEFAULT_ORIGINS = [
  "https://osymkocu.com",
  "https://www.osymkocu.com",
  "https://admin.osymkocu.com",
  "http://localhost:8081",
  "http://localhost:19006",
  "http://127.0.0.1:8081",
  "http://localhost:3000",
];

function extraOrigins() {
  return String(Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function allowedOrigins() {
  return [...DEFAULT_ORIGINS, ...extraOrigins()];
}

function allowOrigin(req?: Request) {
  const origin = req?.headers.get("Origin") ?? "";
  if (origin && allowedOrigins().includes(origin)) return origin;
  return "";
}

export function corsHeaders(req?: Request) {
  const origin = allowOrigin(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": [
      "authorization",
      "x-client-info",
      "apikey",
      "content-type",
      "x-supabase-api-version",
      "prefer",
      "x-region",
      "x-factory-wake",
    ].join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  else headers["Access-Control-Allow-Origin"] = "https://admin.osymkocu.com";
  return headers;
}

export function preflight(req: Request) {
  return new Response("ok", { status: 200, headers: corsHeaders(req) });
}
