# rimaz-nemotron-copilot

A creator and seller copilot for [RIMAZ](https://maghlifiissam-art.github.io/spider-network/reels/index.html), a reels platform for Moroccan creators. It runs on **NVIDIA Nemotron models served by Nebius Token Factory**. Built for the Nebius x NVIDIA Global AI Hackathon, track "Best Apps and Agents". Status: early build (v0.1).

## How it uses Nemotron on Token Factory
Every task makes a runtime call to the Token Factory chat completions API (`https://api.tokenfactory.nebius.com/v1/chat/completions`) and routes to the model that fits the job:

| Task | Endpoint | Model | Why |
|---|---|---|---|
| Ad script (Darija, French, English) | `/api/ad` | `nvidia/nemotron-3-super-120b-a12b` | balanced writing quality and cost |
| Translate, hashtags | `/api/translate`, `/api/hashtags` | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | fast and cheap for small calls |
| Weekly plan from a channel's own public stats | `/api/strategy` | `nvidia/Nemotron-3-Ultra-550b-a55b` | heavier reasoning, called rarely |

The strategy task reads the creator's posts from RIMAZ's public API and is told to say when data is too thin. With no key configured the server returns HTTP 503. It never fakes a model answer.

## Run it
```bash
npm test                         # 3 offline tests (Token Factory is mocked)
NEBIUS_API_KEY=... npm start     # http://127.0.0.1:8788
```
Deploy free on Cloudflare Workers (`src/worker.mjs`); set the key with `wrangler secret put NEBIUS_API_KEY`. No secret belongs in this repo. The RIMAZ publishable key in `src/config.mjs` is public by design.

## What is tested
- Offline tests check tier routing, request shape, the 503 without a key, and origin rejection. They use a mock of Token Factory.
- Live model output has not been tested yet (status will be updated here once it is).

## License
MIT. See `LICENSE`.
