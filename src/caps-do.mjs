// Serialized budget authority for model calls (Durable Object).
// One global instance serializes every reserve/settle, so concurrent requests
// cannot lose updates the way KV read-modify-write could. Worst-case tokens
// are reserved BEFORE the model call and settled to actual usage after, so
// the cumulative ceiling cannot be exceeded by concurrent bursts.
export const DAY_LIMIT = 40;
export const THINK_DAY_LIMIT = 5;
export const TOTAL_TOKEN_LIMIT = 500_000;
export const PROMPT_WORST_TOKENS = 3000; // conservative bound on prompt tokens

const today = () => new Date().toISOString().slice(0, 10);
const fresh = () => ({ day: today(), dayCalls: 0, thinkCalls: 0, totalTokens: 0 });

export class CapsDO {
  constructor(ctx) {
    this.ctx = ctx;
    this.s = fresh();
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get("state");
      if (stored) this.s = stored;
    });
  }
  #persist() { this.ctx.storage.put("state", this.s); }
  #roll() {
    const d = today();
    if (d !== this.s.day) this.s = { day: d, dayCalls: 0, thinkCalls: 0, totalTokens: this.s.totalTokens };
  }
  async fetch(request) {
    this.#roll();
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    if (url.pathname === "/reserve") {
      const worst = Math.max(1, Math.min(body.worstTokens | 0, 20000));
      const tier = String(body.tier || "");
      // All mutations below are synchronous on in-memory state: the single
      // threaded Durable Object makes this check-and-reserve atomic.
      if (this.s.totalTokens + worst > TOTAL_TOKEN_LIMIT) return Response.json({ ok: false, reason: "demo budget exhausted" }, { status: 429 });
      if (this.s.dayCalls >= DAY_LIMIT) return Response.json({ ok: false, reason: "daily demo limit reached, try again tomorrow" }, { status: 429 });
      if (tier === "think" && this.s.thinkCalls >= THINK_DAY_LIMIT) return Response.json({ ok: false, reason: "daily strategy limit reached" }, { status: 429 });
      this.s.dayCalls += 1;
      if (tier === "think") this.s.thinkCalls += 1;
      this.s.totalTokens += worst;
      this.#persist();
      return Response.json({ ok: true, reserved: worst });
    }
    if (url.pathname === "/settle") {
      const actual = Math.max(0, body.actualTokens | 0);
      const reserved = Math.max(0, body.reserved | 0);
      this.s.totalTokens = Math.max(0, this.s.totalTokens + actual - reserved);
      this.#persist();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/status") {
      return Response.json({ capped: true, callsToday: this.s.dayCalls, dayLimit: DAY_LIMIT, thinkCallsToday: this.s.thinkCalls, thinkDayLimit: THINK_DAY_LIMIT, tokensTotal: this.s.totalTokens, tokenLimit: TOTAL_TOKEN_LIMIT });
    }
    return new Response("not found", { status: 404 });
  }
}
