# Blocked / needs Anson

## Cala
- Nothing blocking. `CALA_API_KEY` works. The real ingest ran against it (see `docs/CALA.md` for calls used).
- Cala does not report remaining credits in response headers. Check the balance in console.cala.ai (Billing) before re-running the full ingest. A re-run is free for anything already in `data/cala-cache/` (gitignored, on this machine only).
- Rate limit: bursts of fast calls (introspection, entity search) hit `429 rate_limit_exceeded` within ~15 requests; it cleared after about a minute. The client backs off up to 8 times (max 60 s per wait). If a run logs repeated 429s, re-run with `--concurrency 2`; it resumes from the checkpoint.

## ElevenLabs (optional)
- `/api/stt-token` returns `404 {"error":"not_configured"}` until `ELEVENLABS_API_KEY` is in `.env.local`. Web Speech stays the default, so nothing breaks without it. To enable: get a key (MLH code at mlh.link/junction-26), add `ELEVENLABS_API_KEY=...` to `.env.local`, restart `npm run dev`. The route mints a 15-minute single-use `realtime_scribe` token; the key never reaches the browser.
