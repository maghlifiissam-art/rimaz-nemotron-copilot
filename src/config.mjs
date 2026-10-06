export const SUPABASE_URL = "https://eyasbfywyatrkpkljxek.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1hlN6DuTPcl-rCJufPHBZw_gAr502Jq"; // public by design, RLS protects data
export const TOKEN_FACTORY_URL = "https://api.tokenfactory.nebius.com/v1/chat/completions";

// NVIDIA Nemotron model IDs on Nebius Token Factory (https://tokenfactory.nebius.com/model-catalog.md).
export const MODELS = {
  fast: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",   // cheap, quick: translation, hashtags
  write: "nvidia/nemotron-3-super-120b-a12b",      // balanced: ad copy
  think: "nvidia/Nemotron-3-Ultra-550b-a55b",      // heavy reasoning: weekly strategy
};
export const ALLOWED_ORIGINS = ["https://maghlifiissam-art.github.io", "http://127.0.0.1:8788", "http://localhost:8788"];
