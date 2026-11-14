# Room

Say your pitch out loud and watch London's investors sort themselves around you in real time, ranked by what they actually invested in (revealed thesis from Cala deal data), not what their websites claim. Each match shows the deals behind it, where a fund's stated thesis contradicts its deals, and the easiest door in. Investors see founders matched to their revealed thesis, express interest (double opt-in, verified both sides) and fill curated rooms.

Built at Junction 2026 for Cala's "Make Unicorns Real" challenge.

## Run

```bash
npm install
cp .env.example .env.local   # fill in keys; every key is optional
npm run dev                  # http://localhost:3000 (use Chrome for the mic)
```

| Key | Used for | Without it |
|---|---|---|
| `CALA_API_KEY` | Ingest, live entity and knowledge-search panels | Panels answer from the committed `data/cala-snapshot.json`, mock for anything outside it; app runs on committed `data/investors.json` |
| `ANTHROPIC_API_KEY` | Live pitch extraction (Claude Haiku), ingest classification | Offline keyword extractor drives the graph |
| `ELEVENLABS_API_KEY` | Realtime speech-to-text | Browser Web Speech API (Chrome) |

## Demo

1. Founder view (`/`): press **R** (or Replay) to play the recorded biotech pitch, or press the mic and pitch live.
2. Click an investor: evidence edges to the portfolio companies behind the match, live Cala sources, stated vs revealed thesis, easiest door.
3. Investor view (`/investor`) in a second window: pick an investor, see the ranked founder feed and room suggestion, tap **Interested**. The founder window's inbox badge lights up; accept, both sides verify, chat unlocks.

## Ingest (Cala)

```bash
npm run introspect               # discover relationship types on known funds
npm run ingest -- --dry-run      # plan only, no calls
npm run ingest -- --limit 5      # small real run
npm run ingest                   # full run, checkpointed and resumable
npm run ingest -- --build        # rebuild data/investors.json from the raw cache
```

See `docs/CALA.md` for the endpoints, relationship names and caveats.

### Live Cala credits

Every live Cala call costs one credit. The `/api/cala/*` routes cache successful responses in memory and on disk (`data/cala-cache/`, shared with the ingest), so a repeat click or a restart is free. Real calls count in `data/.cala-live-usage.json`; at `CALA_LIVE_BUDGET` (default 150) the routes return `budgetExhausted: true` with a "lookup paused" message instead of calling Cala. Delete the file to reset the count.

```bash
npm run prewarm                  # cache the panel's requests for the demo investors (max 15 calls)
npm run prewarm -- zinc syncona  # or chosen investor ids; --dry-run lists the requests
npm run build-snapshot           # data/cala-cache -> committed data/cala-snapshot.json (no calls)
```

The panel's two live requests (entity and "What does X invest in?") are answered first from the committed `data/cala-snapshot.json`, which holds the displayed fields (name, type, description, answer text, cited sources) for all 193 investors. Only a request the snapshot cannot answer reaches the disk cache and then live Cala. Each response carries `source: "snapshot" | "cache" | "live"`. Re-run `npm run build-snapshot` after a new ingest or prewarm.

## Deploy

Not deployed; deploy only when Anson says so. The app runs on a read-only filesystem (e.g. Vercel): the snapshot is bundled with the routes, the disk cache simply stays empty there, and nothing writes to disk.

| Env var | Deploy value | Effect |
|---|---|---|
| `CALA_LIVE_BUDGET` | `25` (recommended) | Normal panel visits cost 0 (snapshot). Only requests outside the snapshot call Cala, up to 25. `0` = zero-spend mode: Cala is never called, misses show "Live Cala lookup paused". |
| `CALA_API_KEY` | set, or leave unset | Unset: snapshot answers still work; misses fall back to mock. |
| `ANTHROPIC_API_KEY` | optional | Unset: the offline keyword extractor drives the graph. Set: every visitor pitch spends Anthropic credits. |
| `ELEVENLABS_API_KEY` | optional | Unset: browser Web Speech. |

On a deploy the live-call counter file (`data/.cala-live-usage.json`) cannot be written and is not shared between instances, so the routes count in memory instead, with the same cap. The cap is per server instance and resets on a cold start: treat `CALA_LIVE_BUDGET` there as approximate, not a hard account limit.

The repo becomes public at submission. `data/cala-snapshot.json` then publishes display fields of Cala data (entity names, descriptions, search answers and source links).

## Test

```bash
npm run gate                     # typegen, typecheck, lint, unit tests, build
npx playwright test              # e2e (replay, investor, interest, screenshots)
```

Tests never call Cala, Anthropic or ElevenLabs (`E2E_MOCK=1`).

## Honesty rules

- Fixture data is labelled; a "FIXTURE DATA" banner shows whenever any synthetic investor is loaded.
- No invented statistics. Quotes come only from `data/quotes.json`.
- LinkedIn is linked, never scraped.
