import { handle } from "./handler.mjs";
export { CapsDO } from "./caps-do.mjs";
export default { fetch: (request, env) => handle(request, env) }; // NEBIUS_API_KEY via `wrangler secret put` (optional; without it the app runs in template mode)
