import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/handler.mjs";
import { MODELS } from "../src/config.mjs";
import { CapsDO } from "../src/caps-do.mjs";

// These tests use a MOCK of Token Factory to check routing and request shape. They do not prove live model quality.
function mockFetch(seen, opts = {}) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes("tokenfactory.nebius.com")) {
      seen.push({ url: u, auth: init.headers.Authorization, body: JSON.parse(init.body) });
      if (opts.throwError) throw new TypeError("fetch failed");
      if (opts.failModel) return new Response("boom", { status: opts.providerStatus ?? 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: opts.tokens ?? 1 } }));
    }
    if (u.includes("/channels?")) return new Response(JSON.stringify([{ id: "c1", handle: "demo", name: "Demo" }]));
    if (u.includes("/posts?")) return new Response(JSON.stringify([{ title: "a", kind: "text", views: 3 }]));
    return new Response("[]");
  };
}
// Real CapsDO over in-memory storage, exposed like the CAPS_DO binding.
async function fakeCaps(seed, reserveLog) {
  const store = new Map(seed ? [["state", seed]] : []);
  let ready;
  const ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
    blockConcurrencyWhile: (fn) => { ready = fn(); },
    waitUntil: () => {},
  };
  const instance = new CapsDO(ctx);
  await ready;
  return { idFromName: () => "global", get: () => ({ fetch: (u, i) => { if (reserveLog && String(u).includes("/reserve")) reserveLog.push(JSON.parse(i.body)); return instance.fetch(new Request(u, i)); } }), _instance: instance };
}
const today = () => new Date().toISOString().slice(0, 10);
const seedState = (over = {}) => ({ day: today(), dayCalls: 0, thinkCalls: 0, totalTokens: 0, ...over });
const post = (path, body, env, f) => handle(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body) }), env, f);
const capsStatus = async (env) => (await (await handle(new Request("http://x/health"), env)).json()).caps;

test("routes each task to the intended Nemotron tier", async () => {
  const seen = []; const f = mockFetch(seen); const env = { NEBIUS_API_KEY: "test-key", CAPS_DO: await fakeCaps() };
  const r = await post("/api/ad", { title: "Pack", language: "fr" }, env, f);
  await post("/api/translate", { text: "salam", to: "en" }, env, f);
  await post("/api/strategy", { channel_handle: "demo", language: "en" }, env, f);
  assert.deepEqual(seen.map((s) => s.body.model), [MODELS.write, MODELS.fast, MODELS.think]);
  assert.ok(seen.every((s) => s.auth === "Bearer test-key"));
  assert.equal((await r.json()).mode, "model");
});

test("caps: daily limit blocks with 429 once reached", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps(seedState({ dayCalls: 40 })) };
  const r = await post("/api/ad", { title: "Pack" }, env, mockFetch([]));
  assert.equal(r.status, 429); assert.match((await r.json()).error, /daily demo limit/);
});

test("caps: concurrency - 45 simultaneous requests, exactly 40 pass, no lost updates", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps() };
  const results = await Promise.all(Array.from({ length: 45 }, () => post("/api/hashtags", { text: "x" }, env, mockFetch([]))));
  const ok = results.filter((r) => r.status === 200).length;
  const limited = results.filter((r) => r.status === 429).length;
  assert.equal(ok, 40); assert.equal(limited, 5);
  const caps = await capsStatus(env);
  assert.equal(caps.callsToday, 40, "every reservation counted exactly once");
});

test("caps: near-ceiling - worst-case reservation blocks before the call, settlement frees the difference", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps(seedState({ totalTokens: 495_000 })) };
  const f = mockFetch([], { tokens: 160 });
  const r1 = await post("/api/hashtags", { text: "x" }, env, f); // worst ~270 -> settles to actual 160
  const r2 = await post("/api/hashtags", { text: "x" }, env, f); // same again
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  const caps = await capsStatus(env);
  assert.equal(caps.tokensTotal, 495_320, "settled to actual usage, not worst case");
  // Push to the ceiling: seed just under it and confirm a worst-case that would cross is refused before any call
  const env2 = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps(seedState({ totalTokens: 499_900 })) };
  const seen = [];
  const r4 = await post("/api/hashtags", { text: "x" }, env2, mockFetch(seen));
  assert.equal(r4.status, 429); assert.match((await r4.json()).error, /budget exhausted/);
  assert.equal(seen.length, 0, "no Token Factory call once the worst case would cross the ceiling");
});

test("caps: provider 5xx keeps the worst-case reservation (uncertain outcome)", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps() };
  const r = await post("/api/ad", { title: "Pack" }, env, mockFetch([], { failModel: true }));
  assert.equal(r.status, 502);
  const caps = await capsStatus(env);
  assert.equal(caps.callsToday, 1);
  assert.ok(caps.tokensTotal > 0, "a 5xx says nothing about billing - the worst case stays reserved");
});

test("caps: network error keeps the worst-case reservation (uncertain outcome)", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps() };
  const r = await post("/api/ad", { title: "Pack" }, env, mockFetch([], { throwError: true }));
  assert.equal(r.status, 500);
  const caps = await capsStatus(env);
  assert.ok(caps.tokensTotal > 0, "the provider may already have processed a billable request");
});

test("caps: provider 4xx rejection frees the reservation (evidence of no billable call)", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps() };
  const r = await post("/api/ad", { title: "Pack" }, env, mockFetch([], { failModel: true, providerStatus: 401 }));
  assert.equal(r.status, 502);
  const caps = await capsStatus(env);
  assert.equal(caps.tokensTotal, 0, "a 4xx rejection proves no billable processing happened");
});

test("bounds: an oversized field is rejected before any model call, no reservation spent", async () => {
  const seen = []; const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps() };
  const r = await post("/api/translate", { text: "x".repeat(2001), to: "en" }, env, mockFetch(seen));
  assert.equal(r.status, 400); assert.match((await r.json()).error, /field too long: text/);
  assert.equal(seen.length, 0, "no Token Factory call");
  const caps = await capsStatus(env);
  assert.deepEqual([caps.callsToday, caps.tokensTotal], [0, 0], "no budget consumed by rejected input");
});

test("bounds: a body over the size cap is rejected before any model call", async () => {
  const seen = []; const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps() };
  const big = JSON.stringify({ text: "x".repeat(9000), to: "en" });
  const r = await handle(new Request("http://x/api/translate", { method: "POST", headers: { "content-length": String(big.length) }, body: big }), env, mockFetch(seen));
  assert.equal(r.status, 413);
  assert.equal(seen.length, 0, "no Token Factory call");
});

test("caps: reservation = max_tokens + real UTF-8 prompt bytes + framing (exact, Arabic input)", async () => {
  const reserveLog = []; const seen = [];
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps(undefined, reserveLog) };
  const arabic = "تسويق المنتجات المغربية التقليدية"; // every letter is 2 UTF-8 bytes
  const r = await post("/api/hashtags", { text: arabic, language: "darija" }, env, mockFetch(seen));
  assert.equal(r.status, 200);
  const msgs = seen[0].body.messages;
  const enc = new TextEncoder();
  const promptBytes = enc.encode(msgs[0].content).length + enc.encode(msgs[1].content).length;
  const promptChars = msgs[0].content.length + msgs[1].content.length;
  assert.ok(promptBytes > promptChars, "test input really is multibyte");
  assert.equal(reserveLog[0].worstTokens, 120 + promptBytes + 64, "reserved = max_tokens + real prompt bytes + framing allowance");
  assert.ok(reserveLog[0].worstTokens > 120 + promptChars + 64, "byte accounting reserves more than char accounting for Arabic - chars would under-reserve");
});

test("caps: an oversized reservation is rejected by the DO, never silently clamped", async () => {
  const caps = await fakeCaps();
  const stub = caps.get();
  const big = await stub.fetch("https://caps/reserve", { method: "POST", body: JSON.stringify({ tier: "fast", worstTokens: 25000 }) });
  assert.equal(big.status, 400); assert.match((await big.json()).reason, /too large/);
  const zero = await stub.fetch("https://caps/reserve", { method: "POST", body: JSON.stringify({ tier: "fast", worstTokens: 0 }) });
  assert.equal(zero.status, 400);
  const s = await (await stub.fetch("https://caps/status")).json();
  assert.deepEqual([s.callsToday, s.tokensTotal], [0, 0], "a rejected reservation consumes nothing");
});

test("caps: think tier has its own smaller daily limit", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps(seedState({ thinkCalls: 5 })) };
  const r = await post("/api/strategy", { channel_handle: "demo" }, env, mockFetch([]));
  assert.equal(r.status, 429); assert.match((await r.json()).error, /strategy limit/);
});

test("caps: a key without the CAPS_DO binding fails closed (503, no call)", async () => {
  const seen = [];
  const r = await post("/api/ad", { title: "Pack" }, { NEBIUS_API_KEY: "k" }, mockFetch(seen));
  assert.equal(r.status, 503); assert.equal(seen.length, 0, "no Token Factory call when the limiter is missing");
});

test("caps: calls and tokens are counted at actuals", async () => {
  const env = { NEBIUS_API_KEY: "k", CAPS_DO: await fakeCaps() };
  await post("/api/ad", { title: "Pack" }, env, mockFetch([], { tokens: 1 }));
  const caps = await capsStatus(env);
  assert.equal(caps.callsToday, 1);
  assert.equal(caps.tokensTotal, 1);
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
