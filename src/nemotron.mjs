import { TOKEN_FACTORY_URL, MODELS } from "./config.mjs";
import { NOTICE } from "./templates.mjs";

// One call to Nemotron on Nebius Token Factory (OpenAI-compatible).
// With no key configured it returns a clearly labelled TEMPLATE answer (mode "template", model null). It never claims a model answer.
export async function chat({ tier, system, user, env, fetchImpl = fetch, maxTokens = 500, temperature = 0.6, template }) {
  if (!env?.NEBIUS_API_KEY) {
    if (typeof template !== "function") throw Object.assign(new Error("NEBIUS_API_KEY is not configured"), { status: 503 });
    return { text: template(), model: null, usage: null, mode: "template", notice: NOTICE };
  }
  const model = MODELS[tier];
  if (!model) throw new Error(`unknown tier ${tier}`);
  const res = await fetchImpl(TOKEN_FACTORY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw Object.assign(new Error(`Token Factory ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: 502 });
  const data = await res.json();
  return { text: (data.choices?.[0]?.message?.content || "").trim(), model, usage: data.usage || null, mode: "model" };
}
