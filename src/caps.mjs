// Client helpers for the CapsDO budget authority. Fail-closed: when the
// CAPS_DO binding is missing, model calls are refused (503), never uncapped.

// Worst-case prompt sizing. A character count is NOT an upper bound on tokens
// for multilingual text: byte-level BPE tokenizers (the Llama/Nemotron family)
// can emit up to one token per UTF-8 BYTE, and an Arabic letter is two bytes.
// A token always covers at least one byte, so the UTF-8 byte length of the
// prompt is the documented hard upper bound on its token count.
// FRAMING_TOKENS covers the server-side chat template that is not visible in
// system+user (role headers, eot markers, generation priming): the Llama-3
// style template costs ~6 special tokens per message, so 64 is generous.
export const FRAMING_TOKENS = 64;
export const worstFor = (maxTokens, promptBytes) => maxTokens + Math.max(0, promptBytes | 0) + FRAMING_TOKENS;

function stub(env) {
  if (!env?.CAPS_DO) throw Object.assign(new Error("rate limiter not configured"), { status: 503 });
  return env.CAPS_DO.get(env.CAPS_DO.idFromName("global"));
}

// Reserve worst-case tokens BEFORE the model call. Throws 429 over any cap.
export async function reserve({ env, tier, maxTokens, promptBytes }) {
  const res = await stub(env).fetch("https://caps/reserve", { method: "POST", body: JSON.stringify({ tier, worstTokens: worstFor(maxTokens, promptBytes) }) });
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
