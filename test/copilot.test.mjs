import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/handler.mjs";
import { MODELS } from "../src/config.mjs";

// These tests use a MOCK of Token Factory to check routing and request shape. They do not prove live model quality.
function mockFetch(seen) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes("tokenfactory.nebius.com")) { seen.push({ url: u, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 1 } })); }
    if (u.includes("/channels?")) return new Response(JSON.stringify([{ id: "c1", handle: "demo", name: "Demo" }]));
    if (u.includes("/posts?")) return new Response(JSON.stringify([{ title: "a", kind: "text", views: 3 }]));
    return new Response("[]");
  };
}
const post = (path, body, env, f) => handle(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body) }), env, f);

test("routes each task to the intended Nemotron tier", async () => {
  const seen = []; const f = mockFetch(seen); const env = { NEBIUS_API_KEY: "test-key" };
  await post("/api/ad", { title: "Pack", language: "fr" }, env, f);
  await post("/api/translate", { text: "salam", to: "en" }, env, f);
  await post("/api/strategy", { channel_handle: "demo", language: "en" }, env, f);
  assert.deepEqual(seen.map((s) => s.body.model), [MODELS.write, MODELS.fast, MODELS.think]);
  assert.ok(seen.every((s) => s.auth === "Bearer test-key"));
});

test("without a key it fails loudly (503), never fakes an answer", async () => {
  const r = await post("/api/ad", { title: "Pack" }, {}, mockFetch([]));
  assert.equal(r.status, 503);
});

test("foreign origin is rejected", async () => {
  const r = await handle(new Request("http://x/api/ad", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }));
  assert.equal(r.status, 403);
});
