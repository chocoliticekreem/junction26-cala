# Blocked / needs Anson

## Cala
- Nothing blocking. `CALA_API_KEY` works. The real ingest ran against it (see `docs/CALA.md` for calls used).
- Cala does not report remaining credits in response headers. Check the balance in console.cala.ai (Billing) before re-running the full ingest. A re-run is free for anything already in `data/cala-cache/` (gitignored, on this machine only).
- **Credits: about 265 left** (about 275 on 14 Nov, minus 10 spent by the first `npm run prewarm`). An estimate only: confirm in console.cala.ai, and other runs on other machines spend from the same account.
- **Live budget.** The `/api/cala/*` routes and `npm run prewarm` read and write the same disk cache as the ingest (`data/cala-cache/`), so a repeat click or a server restart costs nothing. Every request actually sent to Cala counts in `data/.cala-live-usage.json` (gitignored, per checkout). At `CALA_LIVE_BUDGET` (default 150) the routes stop calling Cala and answer with `budgetExhausted: true` and a "Live Cala lookup paused" message instead. Cached answers keep working. Reset by deleting the file; raise the cap by setting `CALA_LIVE_BUDGET` and restarting. Live routes retry a 429 or 5xx once and never retry a timeout (it may still be billed).
- **Before the demo:** run `npm run prewarm` (default: zinc, 4bio-capital, syncona, london-business-angels, medicxi; or pass investor ids). It sends the exact requests the panel makes, stops at 15 live calls per run, and prints calls spent vs cache hits. Already done once on this machine; a second run spent 0.
- UI note: the panel shows the budget message as the live answer with a "mock" tag. A dedicated "paused" tag needs a `components/ProfilePanel.tsx` change (read `budgetExhausted` from the response).
- Rate limit: bursts of fast calls (introspection, entity search) hit `429 rate_limit_exceeded` within ~15 requests; it cleared after about a minute. The client backs off up to 8 times (max 60 s per wait). If a run logs repeated 429s, re-run with `--concurrency 2`; it resumes from the checkpoint.

## ElevenLabs (optional)
- `/api/stt-token` returns `200 {"configured":false}` until `ELEVENLABS_API_KEY` is in `.env.local`. Web Speech stays the default, so nothing breaks without it. To enable: get a key (MLH code at mlh.link/junction-26), add `ELEVENLABS_API_KEY=...` to `.env.local`, restart `npm run dev`. The route mints a 15-minute single-use `realtime_scribe` token; the key never reaches the browser.

## Needs a human (cannot be done headless)
1. **Real-mic check (DoD item 3).** In Chrome: `npm run dev`, open localhost:3000, click Mic, allow the microphone, say "We are a pre-seed therapeutics company developing antibody drugs in London". Expected: within ~2.5 s the Biotech chip appears and Zinc / 4BIO Capital / Syncona move into the top 3. Do it three times (click Mic to stop, then again to restart). Everything after the microphone is already proven by `tests/e2e/live-loop.spec.ts`.
2. **Quotes.** Paste the founder and investor quotes collected at Junction into `data/quotes.json` as `{ "text", "name", "role", "consent": true }`. The UI shows no quotes until then.
3. **Optional demo audio.** Record the script in `data/replay/demo-pitch.script.md` as `data/replay/demo-pitch.webm`.
4. **Before any public deploy:** `/api/extract` and `/api/cala/search` are unauthenticated and spend Anthropic and Cala credits. Add a rate limit or shared secret first. Nothing is deployed; deploy only when you say so.
5. **Data judgement calls, left as-is:** some real VCs carry registry-style Cala descriptions ("consulting", "construction"): kiko-ventures, deep-science-ventures, zero-carbon-capital, pale-blue-dot, antler and about 15 London funds. Galore's and Kembara's partner records may come from the wrong legal entity.
