// Hard cost caps for the public demo. Fail-closed: if the CAPS KV binding is
// missing or unreadable, model calls are refused (503) rather than uncapped.
// Limits are chosen so the absolute worst case stays well under the $1 trial:
//   - at most 40 model calls per UTC day (5 for the expensive "think" tier)
//   - at most 500k total tokens ever, across all tiers; with blended Nemotron
//     pricing on Token Factory this is ~$0.50 worst case.
const DAY_LIMIT = 40;
const THINK_DAY_LIMIT = 5;
const TOTAL_TOKEN_LIMIT = 500_000;

const int = (v) => parseInt(v || "0", 10) || 0;

async function readAll(env, day) {
  try {
    const [d, t, h] = await Promise.all([
      env.CAPS.get(`day:${day}`), env.CAPS.get("total_tokens"), env.CAPS.get(`think:${day}`),
    ]);
    return { day: int(d), total: int(t), think: int(h) };
  } catch (e) {
    throw Object.assign(new Error("rate limiter unavailable"), { status: 503 });
  }
}

// Reserve one call before it happens. Throws 429 when any cap is hit.
export async function reserve({ env, tier }) {
  if (!env?.CAPS) throw Object.assign(new Error("rate limiter not configured"), { status: 503 });
  const day = new Date().toISOString().slice(0, 10);
  const c = await readAll(env, day);
  if (c.total >= TOTAL_TOKEN_LIMIT) throw Object.assign(new Error("demo budget exhausted"), { status: 429 });
  if (c.day >= DAY_LIMIT) throw Object.assign(new Error("daily demo limit reached, try again tomorrow"), { status: 429 });
  if (tier === "think" && c.think >= THINK_DAY_LIMIT) throw Object.assign(new Error("daily strategy limit reached"), { status: 429 });
  await env.CAPS.put(`day:${day}`, String(c.day + 1), { expirationTtl: 172800 });
  if (tier === "think") await env.CAPS.put(`think:${day}`, String(c.think + 1), { expirationTtl: 172800 });
}

// Add real usage after the call; over-estimate when the API omits usage.
export async function settle({ env, usage, maxTokens }) {
  if (!env?.CAPS) return;
  const used = usage?.total_tokens > 0 ? usage.total_tokens : maxTokens + 500;
  const t = int(await env.CAPS.get("total_tokens"));
  await env.CAPS.put("total_tokens", String(t + used));
}

// Exposed by /health so the page can show the remaining demo budget.
export async function status(env) {
  if (!env?.CAPS) return { capped: false };
  const day = new Date().toISOString().slice(0, 10);
  const c = await readAll(env, day);
  return { capped: true, callsToday: c.day, dayLimit: DAY_LIMIT, tokensTotal: c.total, tokenLimit: TOTAL_TOKEN_LIMIT };
}
