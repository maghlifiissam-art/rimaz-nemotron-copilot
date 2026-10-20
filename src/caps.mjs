// Client helpers for the CapsDO budget authority. Fail-closed: when the
// CAPS_DO binding is missing, model calls are refused (503), never uncapped.
import { PROMPT_WORST_TOKENS } from "./caps-do.mjs";

function stub(env) {
  if (!env?.CAPS_DO) throw Object.assign(new Error("rate limiter not configured"), { status: 503 });
  return env.CAPS_DO.get(env.CAPS_DO.idFromName("global"));
}

// Worst-case tokens for one call: completion budget + a conservative prompt bound.
export const worstFor = (maxTokens) => maxTokens + PROMPT_WORST_TOKENS;

// Reserve worst-case tokens BEFORE the model call. Throws 429 over any cap.
export async function reserve({ env, tier, maxTokens }) {
  const res = await stub(env).fetch("https://caps/reserve", { method: "POST", body: JSON.stringify({ tier, worstTokens: worstFor(maxTokens) }) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.reason || "rate limited"), { status: res.status });
  return data.reserved;
}

// Settle to actual usage after the call; settle to 0 after a failed call.
export async function settle({ env, actualTokens, reserved }) {
  if (!env?.CAPS_DO) return;
  try {
    await stub(env).fetch("https://caps/settle", { method: "POST", body: JSON.stringify({ actualTokens, reserved }) });
  } catch { /* a lost settlement only inflates the counted total - safe direction */ }
}

export async function status(env) {
  if (!env?.CAPS_DO) return { capped: false };
  const res = await stub(env).fetch("https://caps/status");
  return res.json();
}
