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
// In-memory stand-in for the CAPS KV namespace.
function fakeKV(store = {}) {
  return { _store: store, get: async (k) => (k in store ? store[k] : null), put: async (k, v) => { store[k] = String(v); } };
}
const today = () => new Date().toISOString().slice(0, 10);
const post = (path, body, env, f) => handle(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body) }), env, f);

test("routes each task to the intended Nemotron tier", async () => {
  const seen = []; const f = mockFetch(seen); const env = { NEBIUS_API_KEY: "test-key", CAPS: fakeKV() };
  const r = await post("/api/ad", { title: "Pack", language: "fr" }, env, f);
  await post("/api/translate", { text: "salam", to: "en" }, env, f);
  await post("/api/strategy", { channel_handle: "demo", language: "en" }, env, f);
  assert.deepEqual(seen.map((s) => s.body.model), [MODELS.write, MODELS.fast, MODELS.think]);
  assert.ok(seen.every((s) => s.auth === "Bearer test-key"));
  assert.equal((await r.json()).mode, "model");
});

test("caps: daily limit blocks with 429 once reached", async () => {
  const kv = fakeKV({ [`day:${today()}`]: "40" });
  const r = await post("/api/ad", { title: "Pack" }, { NEBIUS_API_KEY: "k", CAPS: kv }, mockFetch([]));
  assert.equal(r.status, 429); assert.match((await r.json()).error, /daily demo limit/);
});

test("caps: cumulative token budget blocks with 429 once reached", async () => {
  const kv = fakeKV({ total_tokens: "500000" });
  const r = await post("/api/ad", { title: "Pack" }, { NEBIUS_API_KEY: "k", CAPS: kv }, mockFetch([]));
  assert.equal(r.status, 429); assert.match((await r.json()).error, /budget exhausted/);
});

test("caps: think tier has its own smaller daily limit", async () => {
  const kv = fakeKV({ [`think:${today()}`]: "5" });
  const r = await post("/api/strategy", { channel_handle: "demo" }, { NEBIUS_API_KEY: "k", CAPS: kv }, mockFetch([]));
  assert.equal(r.status, 429); assert.match((await r.json()).error, /strategy limit/);
});

test("caps: a key without the CAPS binding fails closed (503, no call)", async () => {
  const seen = [];
  const r = await post("/api/ad", { title: "Pack" }, { NEBIUS_API_KEY: "k" }, mockFetch(seen));
  assert.equal(r.status, 503); assert.equal(seen.length, 0, "no Token Factory call when the limiter is missing");
});

test("caps: calls and tokens are counted", async () => {
  const kv = fakeKV();
  const env = { NEBIUS_API_KEY: "k", CAPS: kv };
  await post("/api/ad", { title: "Pack" }, env, mockFetch([]));
  assert.equal(kv._store[`day:${today()}`], "1");
  assert.equal(kv._store.total_tokens, "1");
});

test("without a key every route returns a labelled TEMPLATE answer, never a model claim", async () => {
  const seen = []; const f = mockFetch(seen);
  const calls = [["/api/ad", { title: "Pack", description: "50 backgrounds", language: "en" }], ["/api/translate", { text: "salam", to: "en" }],
    ["/api/hashtags", { text: "Zellige pack", language: "fr" }], ["/api/strategy", { channel_handle: "demo", language: "en" }]];
  for (const [p, b] of calls) {
    const r = await post(p, b, {}, f); assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.mode, "template"); assert.equal(j.model, null); assert.match(j.notice, /TEMPLATE/);
    assert.ok(!/nemotron/i.test(JSON.stringify(j)));
  }
  assert.equal(seen.length, 0, "no Token Factory call without a key");
});

test("template strategy says data is too thin for few posts", async () => {
  const j = await (await post("/api/strategy", { channel_handle: "demo" }, {}, mockFetch([]))).json();
  assert.match(j.text, /too thin/);
});

test("health reports the mode", async () => {
  const t = await (await handle(new Request("http://x/health"), {})).json();
  const m = await (await handle(new Request("http://x/health"), { NEBIUS_API_KEY: "k" })).json();
  assert.deepEqual([t.mode, m.mode], ["template", "model"]);
});

test("page is served and shows the template badge code", async () => {
  const r = await handle(new Request("http://x/"), {});
  assert.equal(r.status, 200); assert.match(await r.text(), /TEMPLATE - no model called/);
});

test("foreign origin is rejected, same origin allowed", async () => {
  const bad = await handle(new Request("http://x/api/ad", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }));
  assert.equal(bad.status, 403);
  const ok = await handle(new Request("http://x/api/ad", { method: "POST", headers: { origin: "http://x" }, body: JSON.stringify({ title: "a" }) }), {});
  assert.equal(ok.status, 200);
});
