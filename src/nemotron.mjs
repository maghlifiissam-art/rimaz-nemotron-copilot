import { TOKEN_FACTORY_URL, MODELS } from "./config.mjs";
import { NOTICE } from "./templates.mjs";
import { reserve, settle } from "./caps.mjs";

// One call to Nemotron on Nebius Token Factory (OpenAI-compatible).
// With no key configured it returns a clearly labelled TEMPLATE answer (mode "template", model null). It never claims a model answer.
export async function chat({ tier, system, user, env, fetchImpl = fetch, maxTokens = 500, temperature = 0.6, template }) {
  if (!env?.NEBIUS_API_KEY) {
    if (typeof template !== "function") throw Object.assign(new Error("NEBIUS_API_KEY is not configured"), { status: 503 });
    return { text: template(), model: null, usage: null, mode: "template", notice: NOTICE };
  }
  // Reserve the true worst case BEFORE the call: max_tokens plus the real
  // prompt size. UTF-8 BYTES are the hard upper bound on prompt tokens (one
  // token per byte is the worst case for byte-level BPE; a character count
  // would under-count Arabic and other multibyte scripts). A framing
  // allowance for the server-side chat template is added inside reserve().
  // Inputs are length-bounded upstream, so this number is bounded too.
  const enc = new TextEncoder();
  const reserved = await reserve({ env, tier, maxTokens, promptBytes: enc.encode(system).length + enc.encode(user).length });
  const model = MODELS[tier];
  if (!model) { await settle({ env, actualTokens: 0, reserved }); throw new Error(`unknown tier ${tier}`); }
  try {
    const res = await fetchImpl(TOKEN_FACTORY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) {
      const e = Object.assign(new Error(`Token Factory ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: 502 });
      // A 4xx from the provider is evidence the request was rejected before any
      // billable processing (auth, bad request, rate limit) - the reservation
      // can be freed. 5xx says nothing about billing: it stays reserved.
      if (res.status >= 400 && res.status < 500) e.billable = false;
      throw e;
    }
    const data = await res.json();
    const actual = data.usage?.total_tokens > 0 ? data.usage.total_tokens : reserved;
    await settle({ env, actualTokens: actual, reserved });
    return { text: (data.choices?.[0]?.message?.content || "").trim(), model, usage: data.usage || null, mode: "model" };
  } catch (e) {
    // Free the reservation ONLY when there is evidence no billable call
    // happened (never sent, or provider rejected with 4xx). Network, read or
    // JSON errors are uncertain - the provider may already have processed a
    // billable request - so the worst case stays reserved.
    if (e.billable === false) await settle({ env, actualTokens: 0, reserved });
    throw e;
  }
}
