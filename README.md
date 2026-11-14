# Scalaxy (styled sCALAxy)

Scalaxy simulates a startup's path to its next round and to a unicorn. A founder names a company, gives a pitch and a five-year vision; Scalaxy runs 5,000 Monte Carlo futures through real funding rounds from Cala's knowledge graph and shows the odds, the realities, the next investors to approach and the real companies that walked similar paths. Investors get a 20-second showcase of early companies that look like past unicorns' early paths.

Built at Junction 2026 for Cala's "Make Unicorns Real" challenge. Long term, Scalaxy becomes a network built inside Cala, with founders and investors on the same graph.

## How it works

1. **Data.** `data/cohort.json` holds real companies, funding rounds and investors read from Cala (486 companies, 1,975 rounds, 2,978 investors, as of 2026-11-14). Cala entities are the source of every round, lead and date.
2. **Simulation** (`lib/sim/`). Investor agents are fitted on their real behaviour in the cohort: what they lead, round sizes, pace, co-investors, who leads after them, how their companies fare. `/api/simulate` draws 5,000 futures from the company's current stage. Claude Haiku reads the pitch and the vision (keyword parsers answer when it fails).
3. **Results** (`/`, route code in `app/path/page.tsx`):
   - headline: the odds of raising the next round, and the odds of the vision against a typical company at the same stage;
   - possible realities, best to worst;
   - next moves: the next lead investors and what each branch does to the odds;
   - star map: every star is an investor from Cala's graph, the chosen path highlighted;
   - case studies: real precedent companies with their real rounds;
   - actions: intro email drafts, opened in your mail app (nothing is sent);
   - company file: what Scalaxy knows about the company, with sources.
4. **Investor side** (`/path/investor`). Pick a fund, read its taste in one line (built from its own rounds), see five early companies whose first rounds resemble past unicorns' early paths.

Input: one company field (Existing company, matched to Cala by name, or New idea). The pitch is typed or spoken (ElevenLabs realtime speech-to-text; the mic stops after 2.5 s of silence and keeps the words). Without an ElevenLabs key the browser's Web Speech API is used (Chrome).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in keys; every key is optional
npm run dev                  # http://localhost:3000, Chrome for the mic
```

| Env var | Used for | Without it |
|---|---|---|
| `CALA_API_KEY` | Live Cala entity and search lookups, ingest scripts | Committed data and snapshot answer; misses fall back to mock |
| `CALA_LIVE_BUDGET` | Cap on live Cala calls (default 150) | Default cap |
| `ANTHROPIC_API_KEY` | Claude Haiku: pitch, vision, branch narration, tags | Keyword parsers |
| `ELEVENLABS_API_KEY` | Realtime speech-to-text token (`/api/stt-token`) | Browser Web Speech |
| `AIVEN_VALKEY_URI` | Aiven for Valkey cache and shared call budget | File cache and per-instance budget |
| `CONTEXT_DEV_API_KEY` | Company website facts for the company file (Context.dev) | Website facts skipped |
| `E2E_MOCK` | Set to `1` by tests: no external calls | Not needed |

Scripts (`package.json`): `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `gate`, `ingest`, `ingest-rounds`, `ingest-events`, `introspect`, `prewarm`, `build-snapshot`, `seed-valkey`, `verify-data`, `make-fixtures`, `build-replay`. Ingest details and Cala endpoints: `docs/CALA.md`.

## Cache (Aiven for Valkey)

Cala queries take 20-70 s and cost a credit each. Panel and Cala responses are served from Valkey first (`lib/routeCache.ts`, `lib/valkey.ts`), then the committed `data/cala-snapshot.json`, then in-process LRU, `data/cala-cache/`, and only then live Cala within `CALA_LIVE_BUDGET`. The budget is an atomic counter in Valkey, so it holds across instances. With the URI unset or Valkey slow (over 800 ms), every Valkey step is a miss and the file cache answers. `GET /api/cache/stats` shows hits, misses and latency per tier. `npm run seed-valkey` loads the local cache into Valkey with no Cala calls.

## Architecture

| Folder | What is there |
|---|---|
| `app/` | Pages: `/` (founder, alias of `/path`), `/path/investor` (showcase); older `/match`, `/investor`, `/room`. API routes in `app/api/`: `simulate`, `network`, `company/resolve`, `context`, `actions`, `spotter`, `extract`, `stt-token`, `cala`, `cache/stats` |
| `components/path/` | Founder results UI: interview, realities, next moves, precedents, case study, star map, company file |
| `components/spotter/` | Investor showcase |
| `lib/sim/` | Simulator: investor agents (`fit.ts`), futures (`simulate.ts`), vision parsing, precedents, similarity, spotter (`spotter.ts`, `spotter/`), backtest |
| `lib/ai/`, `lib/anthropic.ts` | Claude Haiku calls |
| `lib/context/` | Company file, Cala facts, website facts (Context.dev), intro email actions |
| `lib/stt.ts`, `lib/usePitch.ts` | Speech-to-text and silence auto-stop |
| `lib/cala.ts`, `lib/valkey.ts`, `lib/routeCache.ts` | Cala client and cache chain |
| `data/` | `cohort.json`, `investors.json`, `cala-snapshot.json`, fixtures |
| `scripts/` | Ingest, snapshot, seed, backtest |
| `docs/` | `submission.md`, `CALA.md`, `DEMO.md`, `DATA-AUDIT.md`, research |

## Tests

```bash
npm run gate        # typegen, typecheck, lint, unit tests (vitest), build
npm run test:e2e    # Playwright, E2E_MOCK=1
```

Tests never call Cala, Anthropic, ElevenLabs or Valkey. The simulator backtest (`lib/sim/backtest.ts`, `scripts/backtest.ts`) rewinds the cohort to an earlier year and checks where later unicorns land.

## Deploy and rules

Not deployed; Anson decides. On a read-only filesystem the snapshot is bundled and nothing writes to disk. No secrets in git; keys live in `.env.local`. LinkedIn is linked, never scraped. MIT licensed.
