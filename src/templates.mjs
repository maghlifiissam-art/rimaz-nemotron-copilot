// Fixed templates used only when no model key is configured. No network, no model, no translation.
export const NOTICE = "TEMPLATE OUTPUT - no AI model was called";
const FRAME = {
  darija: (t, d, p) => `${t}. ${d}${p != null ? ` Ktman: ${p}.` : ""} Jarrbo daba.`,
  fr: (t, d, p) => `${t}. ${d}${p != null ? ` Prix : ${p}.` : ""} Essayez-le maintenant.`,
  en: (t, d, p) => `${t}. ${d}${p != null ? ` Price: ${p}.` : ""} Try it now.`,
  ar: (t, d, p) => `${t}. ${d}${p != null ? ` السعر: ${p}.` : ""}`,
};
export function adTemplate(a) {
  const f = FRAME[a.language] || FRAME.darija;
  return f(a.title || "", a.description || "", a.price ?? null).split(/\s+/).slice(0, 70).join(" ");
}
export const translateTemplate = (a) => `${a.text || ""}\n\n[Template mode cannot translate; the text is returned unchanged.]`;
export function hashtagsTemplate(a) {
  const words = [...new Set(String(a.text || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].slice(0, 5);
  return [...words, "rimaz", "maroc", "reels"].slice(0, 8).map((w) => "#" + w).join(" ");
}
export function strategyTemplate(ch, posts) {
  if (!Array.isArray(posts) || posts.length < 5) return `Data too thin to conclude: ${posts?.length || 0} public post(s) found for ${ch.handle}.`;
  const total = posts.reduce((s, p) => s + (p.views || 0), 0);
  const top = posts.reduce((m, p) => ((p.views || 0) > (m.views || 0) ? p : m), posts[0]);
  return `Channel ${ch.handle}: ${posts.length} recent public posts, ${total} total views. Top post: "${top.title}" (${top.views || 0} views). Repeat the format of the top post and post on a steady schedule.`;
}
