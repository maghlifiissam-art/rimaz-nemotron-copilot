import { ALLOWED_ORIGINS } from "./config.mjs";
import { adCopy, translate, hashtags, strategy } from "./tasks.mjs";
import { PAGE } from "./page.mjs";
import { status as capsStatus } from "./caps.mjs";

const ROUTES = { "/api/ad": adCopy, "/api/translate": translate, "/api/hashtags": hashtags, "/api/strategy": strategy };

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
  try {
    const args = await request.json();
    const out = await fn(args, { env, fetchImpl });
    return new Response(JSON.stringify(out), { headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: e.status || 500, headers: h });
  }
}
