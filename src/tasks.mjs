import { chat } from "./nemotron.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.mjs";

const LANG = { darija: "Moroccan Darija (Arabic script)", en: "English", fr: "French", ar: "Modern Standard Arabic" };
const L = (l) => LANG[l] || LANG.darija;

// Super: write a short ad script.
export const adCopy = (a, ctx) => chat({ ...ctx, tier: "write",
  system: `You write 20-second spoken ad scripts for small sellers. Language: ${L(a.language)}. Max 70 words. Do not invent features, prices or claims. Output the script only.`,
  user: `Product: ${a.title}\nDescription: ${a.description || "(none)"}\nPrice: ${a.price ?? "(not set)"}` });

// Nano: fast translation / hashtags.
export const translate = (a, ctx) => chat({ ...ctx, tier: "fast", maxTokens: 300,
  system: `Translate the user's text into ${L(a.to)}. Keep meaning and tone. Output only the translation.`, user: a.text });
export const hashtags = (a, ctx) => chat({ ...ctx, tier: "fast", maxTokens: 120,
  system: `Give 8 short hashtags in ${L(a.language)} for this post. One line, space separated.`, user: a.text });

// Ultra: weekly strategy from the creator's own public stats (read from RIMAZ).
export async function strategy(a, ctx) {
  const f = ctx.fetchImpl || fetch;
  const h = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` };
  const q = (p) => f(`${SUPABASE_URL}/rest/v1/${p}`, { headers: h }).then((r) => r.json());
  const [ch] = await q(`channels?select=id,handle,name&handle=eq.${encodeURIComponent(a.channel_handle)}&limit=1`);
  if (!ch) throw Object.assign(new Error("channel not found"), { status: 404 });
  const posts = await q(`posts?select=title,kind,views,created_at&channel_id=eq.${ch.id}&order=created_at.desc&limit=30`);
  return chat({ ...ctx, tier: "think", maxTokens: 700, temperature: 0.4,
    system: `You are a growth coach for a small creator on a Moroccan short-video platform. Using ONLY the posts data, give a 5-bullet plan for next week in ${L(a.language)}. Say when the data is too thin to conclude. No invented numbers.`,
    user: JSON.stringify({ channel: ch.handle, posts }) });
}
