# REM Academy — Photo Critique Bot

A shareable web app: anyone with the link uploads a property photo and gets a scored, pro-level
critique with ranked fixes — graded to professional standards (5–10 scale). Powered by Claude
(Opus 4.8) vision. No login required for visitors.

## How it works
- `index.html` — the REM-branded front-end (upload → calls the API → renders the scorecard).
- `api/critique.js` — Vercel serverless function: sends the photo + the critique engine to the
  Anthropic Messages API (forced tool call) and returns structured JSON. The API key stays
  server-side and is never exposed to the browser.
- The critique logic (the "engine") lives inside `api/critique.js` as `SYSTEM_PROMPT`. The master,
  human-readable copy is in `../REM Photo Critique Bot/critique-engine.md` — keep them in sync.

## Deploy (GitHub → Vercel)
1. Push this folder to a **private** GitHub repo.
2. In Vercel: **Add New → Project → Import** that repo. Framework preset: **Other** (no build step).
3. **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` = your key from
   console.anthropic.com. (Optional: `ACCESS_CODE` to gate the link with a shared passcode.)
4. **Deploy.** You get a `*.vercel.app` URL immediately.
5. **Settings → Domains** → add `bot.remacademy.co` (recommended) and create the CNAME Vercel
   shows you at your DNS provider. (Or map `remacademy.co/bot` via a rewrite if your main site is
   also on Vercel.)

## Local dev
```
npm i -g vercel
vercel dev          # runs the function + static site locally
# create .env.local with ANTHROPIC_API_KEY first (see .env.example)
```

## Notes
- Images are downscaled in the browser to ~1568px before upload (smaller payload, faster, matches
  Claude's vision sizing). Nothing is stored.
- Cost: a few cents per critique on Opus 4.8. To cut it ~5x, change `MODEL` in `api/critique.js`
  to a Sonnet model.
- Before this is a truly public/paid asset, add real gating (passcode via `ACCESS_CODE`, or proper
  auth) so the link can't be abused on your API key.
