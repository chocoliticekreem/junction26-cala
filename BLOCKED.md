# Blocked / needs Anson

## Cala
- Nothing blocking. `CALA_API_KEY` works. The real ingest ran against it (see `docs/CALA.md` for calls used).
- Cala does not report remaining credits in response headers. Check the balance in console.cala.ai (Billing) before re-running the full ingest. A re-run is free for anything already in `data/cala-cache/` (gitignored, on this machine only).
- **Credits: about 260 left** (about 275 on 14 Nov, minus 10 spent by the first `npm run prewarm`, minus 5 entity retrieves that filled the snapshot's gaps for plug-and-play, elaia, anamcara-capital, kembara and eos-ventures). An estimate only: confirm in console.cala.ai, and other runs on other machines spend from the same account.
- **Live budget.** The `/api/cala/*` routes and `npm run prewarm` read and write the same disk cache as the ingest (`data/cala-cache/`), so a repeat click or a server restart costs nothing. Every request actually sent to Cala counts in Valkey (`room:cala:v1:live-usage`, shared) when `AIVEN_VALKEY_URI` is set, otherwise in `data/.cala-live-usage.json` (gitignored, per checkout). At `CALA_LIVE_BUDGET` (default 150) the routes stop calling Cala and answer with `budgetExhausted: true` and a "Live Cala lookup paused" message instead. Cached answers keep working. Reset by deleting the file; raise the cap by setting `CALA_LIVE_BUDGET` and restarting. Live routes retry a 429 or 5xx once and never retry a timeout (it may still be billed).
- **Before the demo:** run `npm run prewarm` (default: zinc, 4bio-capital, syncona, london-business-angels, medicxi; or pass investor ids). It sends the exact requests the panel makes, stops at 15 live calls per run, and prints calls spent vs cache hits. Already done once on this machine; a second run spent 0.
- UI note: the panel shows the budget message as the live answer with a "mock" tag. A dedicated "paused" tag needs a `components/ProfilePanel.tsx` change (read `budgetExhausted` from the response).
- Rate limit: bursts of fast calls (introspection, entity search) hit `429 rate_limit_exceeded` within ~15 requests; it cleared after about a minute. The client backs off up to 8 times (max 60 s per wait). If a run logs repeated 429s, re-run with `--concurrency 2`; it resumes from the checkpoint.

## Aiven for Valkey
- Nothing blocking. `AIVEN_VALKEY_URI` is in `.env.local` and works: `npm run seed-valkey` loaded all 741 cached Cala responses (10.1 MB) into Valkey with 0 Cala calls.
- `.env.example` still needs the line `AIVEN_VALKEY_URI=` (empty): the agent's file guard blocks editing env files, so add it by hand.
- After a new ingest or prewarm on any machine, re-run `npm run seed-valkey` there so the new responses reach every deploy. Writes from the routes and scripts already go to Valkey directly; seeding only covers files written before that.

## ElevenLabs (optional)
- `/api/stt-token` returns `200 {"configured":false}` until `ELEVENLABS_API_KEY` is in `.env.local`. Web Speech stays the default, so nothing breaks without it. To enable: get a key (MLH code at mlh.link/junction-26), add `ELEVENLABS_API_KEY=...` to `.env.local`, restart `npm run dev`. The route mints a 15-minute single-use `realtime_scribe` token; the key never reaches the browser.

## Needs a human (cannot be done headless)
1. **Real-mic check (DoD item 3).** In Chrome: `npm run dev`, open localhost:3000, click Mic, allow the microphone, say "We are a pre-seed therapeutics company developing antibody drugs in London". Expected: within ~2.5 s the Biotech chip appears and Zinc / 4BIO Capital / Syncona move into the top 3. Do it three times (click Mic to stop, then again to restart). Everything after the microphone is already proven by `tests/e2e/live-loop.spec.ts`.
2. **Quotes.** Paste the founder and investor quotes collected at Junction into `data/quotes.json` as `{ "text", "name", "role", "consent": true }`. The UI shows no quotes until then.
3. **Optional demo audio.** Record the script in `data/replay/demo-pitch.script.md` as `data/replay/demo-pitch.webm`.
4. **Before any public deploy** (see README "Deploy"; nothing is deployed, deploy only when you say so):
   - Set `CALA_LIVE_BUDGET=25` on Vercel. The committed `data/cala-snapshot.json` answers both panel requests for all 193 investors, so normal visits cost 0 Cala credits; only requests outside the snapshot call Cala, capped. `CALA_LIVE_BUDGET=0` is zero-spend mode (Cala never called).
   - Set `AIVEN_VALKEY_URI` on Vercel too. The live-call cap is then an atomic `INCR` in Valkey, shared by every instance and kept across cold starts, and requests outside the snapshot are served from the seeded Valkey cache instead of Cala. Without it (or while Valkey is unreachable) the usage file cannot be written on Vercel, so the cap falls back to an in-memory count per server instance that resets on a cold start: approximate, not an account limit.
   - `ANTHROPIC_API_KEY` is optional (extraction falls back to keywords). Left set on a public deploy, every visitor pitch spends Anthropic credits; `/api/extract` has no rate limit or shared secret.
   - The repo goes public at submission, and `data/cala-snapshot.json` contains display fields of Cala data (names, descriptions, search answers, source links). Confirm that is acceptable to Cala.
5. **Data judgement calls, left as-is:** some real VCs carry registry-style Cala descriptions ("consulting", "construction"): kiko-ventures, deep-science-ventures, zero-carbon-capital, pale-blue-dot, antler and about 15 London funds. Galore's and Kembara's partner records may come from the wrong legal entity.
