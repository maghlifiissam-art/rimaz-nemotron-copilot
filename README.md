# rimaz-nemotron-copilot

A creator and seller copilot for RIMAZ, a reels platform for Moroccan creators. It is built for NVIDIA Nemotron models served by Nebius Token Factory. Built for the Nebius x NVIDIA Global AI Hackathon, track "Best Apps and Agents". Status: v0.3.

## Two modes (read this first)

- **Model mode** (a `NEBIUS_API_KEY` is configured): every task makes a runtime call to the Token Factory chat completions API (`https://api.tokenfactory.nebius.com/v1/chat/completions`) and routes to the model that fits the job. The page shows the model id under each answer.
- **Template mode** (no key): the app does NOT call any model. Each route returns a fixed template answer labelled `TEMPLATE - no model called`. Template mode is a fallback so the app is runnable without credentials. It is not a model answer and not Nemotron output.

Live Nemotron output is verified on all four routes (Oct 19, 2026): the page shows the model id under each answer. Model mode is capped by a single serialized budget authority (a Cloudflare Durable Object): requests and every prompt field are length-bounded, worst-case tokens (max_tokens plus the real bounded prompt size, at one token per character) are reserved before each call and settled to actual usage after, and a reservation is released only when the provider provably never billed the call - uncertain failures keep the worst case counted. The caps are hard: 40 calls/day, 5 strategy calls/day, 500k total tokens, and calls fail closed if the binding is missing.

| Task | Endpoint | Model (model mode) | Why |
|---|---|---|---|
| Ad script (Darija, French, English) | /api/ad | nvidia/nemotron-3-super-120b-a12b | balanced writing quality and cost |
| Translate, hashtags | /api/translate, /api/hashtags | nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B | fast and cheap for small calls |
| Weekly plan from a channel's own public stats | /api/strategy | nvidia/Nemotron-3-Ultra-550b-a55b | heavier reasoning, called rarely |

The strategy task reads the creator's posts from RIMAZ's public API and says when data is too thin. In template mode it only reports counts and the top post.

## Run it
```
npm test                         # offline tests (Token Factory is mocked)
npm start                        # template mode, http://127.0.0.1:8788
NEBIUS_API_KEY=... npm start     # model mode
```
`GET /health` returns `{ ok, mode }` with mode `template` or `model`.

Deploy free on Cloudflare Workers (`src/worker.mjs`, also serves the page at `/`). To enable model mode set the key with `wrangler secret put NEBIUS_API_KEY` AND bind the `CapsDO` Durable Object as `CAPS_DO` (see `src/caps-do.mjs`): model calls fail closed with 503 when the binding is missing, and the serialized caps stop usage at 40 calls/day and 500k reserved tokens, a worst case of about $0.50, inside the $1 trial credit (the trial itself does not stop spending: Nebius auto-charges the card if the balance goes negative, so these caps are the real protection). No secret belongs in this repo. The RIMAZ publishable key in `src/config.mjs` is public by design. After editing `web/index.html` run `node scripts/gen-page.mjs`.

## What is tested
Offline tests check tier routing, request shape, template mode on all four routes (no model call, no Nemotron claim), the health mode, the page, and origin rejection. They use a mock of Token Factory and do not prove live model quality.

## License
MIT. See LICENSE.
