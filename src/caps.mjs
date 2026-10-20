// Client helpers for the CapsDO budget authority. Fail-closed: when the
// CAPS_DO binding is missing, model calls are refused (503), never uncapped.

function stub(env) {
  if (!env?.CAPS_DO) throw Object.assign(new Error("rate limiter not configured"), { status: 503 });
  return env.CAPS_DO.get(env.CAPS_DO.idFromName("global"));
}

// Worst-case tokens for one call: completion budget + a hard upper bound on
// prompt tokens. A BPE token always covers at least one character, so the
// prompt's character count is a true ceiling on its token count; the caller
// passes the REAL prompt size (inputs are length-bounded in handler.mjs), so
// this reservation always covers the worst billable case.
export const worstFor = (maxTokens, promptChars) => maxTokens + Math.max(0, promptChars | 0);

// Reserve worst-case tokens BEFORE the model call. Throws 429 over any cap.
export async function reserve({ env, tier, maxTokens, promptChars }) {
  const res = await stub(env).fetch("https://caps/reserve", { method: "POST", body: JSON.stringify({ tier, worstTokens: worstFor(maxTokens, promptChars) }) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.reason || "rate limited"), { status: res.status });
  return data.reserved;
}

// Settle to actual usage after the call; settle to 0 only when there is
// evidence no billable call happened. A lost settlement only inflates the
// counted total - the safe direction.
export async function settle({ env, actualTokens, reserved }) {
  if (!env?.CAPS_DO) return;
  try {
    await stub(env).fetch("https://caps/settle", { method: "POST", body: JSON.stringify({ actualTokens, reserved }) });
  } catch { /* safe direction */ }
}

export async function status(env) {
  if (!env?.CAPS_DO) return { capped: false };
  const res = await stub(env).fetch("https://caps/status");
  return res.json();
}
