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
| `CALA_API_KEY` | Ingest, live entity and knowledge-search panels | Mock panels; app runs on committed `data/investors.json` |
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
