import { ALLOWED_ORIGINS } from "./config.mjs";
import { adCopy, translate, hashtags, strategy } from "./tasks.mjs";
import { PAGE } from "./page.mjs";
import { status as capsStatus } from "./caps.mjs";

const ROUTES = { "/api/ad": adCopy, "/api/translate": translate, "/api/hashtags": hashtags, "/api/strategy": strategy };

// Hard input bounds. They keep every prompt (and therefore every worst-case
// token reservation) bounded, so the 500k cumulative ceiling always holds.
const MAX_BODY_BYTES = 8192;
const FIELD_LIMITS = {
  "/api/ad": { title: 200, description: 2000, price: 40, language: 10 },
  "/api/translate": { text: 2000, to: 10 },
  "/api/hashtags": { text: 2000, language: 10 },
  "/api/strategy": { channel_handle: 60, language: 10 },
};
const bad = (message, status) => new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });

export async function handle(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin && !ALLOWED_ORIGINS.includes(origin)) return new Response("Forbidden origin", { status: 403 });
  const h = { "content-type": "application/json" };
  if (origin) { h["access-control-allow-origin"] = origin; h["access-control-allow-headers"] = "content-type"; h["access-control-allow-methods"] = "POST, OPTIONS"; }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (request.method === "GET" && url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true, mode: env?.NEBIUS_API_KEY ? "model" : "template", caps: await capsStatus(env) }), { headers: h });
  const fn = ROUTES[url.pathname];
  if (!fn || request.method !== "POST") return new Response("Not found", { status: 404 });
  // Body-size cap, enforced on both the declared length and the real payload.
  if ((+request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return bad("request too large", 413);
  let args;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return bad("request too large", 413);
    args = JSON.parse(raw);
  } catch {
    return bad("invalid JSON body", 400);
  }
  // Per-field length bounds, checked BEFORE any model call.
  for (const [field, max] of Object.entries(FIELD_LIMITS[url.pathname] || {})) {
    if (args?.[field] != null && String(args[field]).length > max) return bad(`field too long: ${field} (max ${max} chars)`, 400);
  }
  try {
    const out = await fn(args, { env, fetchImpl });
    return new Response(JSON.stringify(out), { headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: e.status || 500, headers: h });
  }
}
