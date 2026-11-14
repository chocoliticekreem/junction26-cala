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
| `AIVEN_VALKEY_URI` | Shared Cala cache and live-call budget on Aiven for Valkey (`rediss://...`) | File cache on this machine and a per-checkout budget counter |

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

# Entity graph: FundingRound deals (is_lead, source_rank), then Cala Event participants
npm run ingest-rounds -- --dry-run          # plan + measured cost estimate, no calls
npm run ingest-rounds -- --event-investors --limit 0  # rounds of event participants named as investors
npm run ingest-rounds -- --limit 15         # demo top-15 first, then by score
npm run ingest-rounds -- --ids zinc,4bio-capital
npm run ingest-rounds -- --merge            # checkpoint -> data/investors.json, no calls
npm run ingest-events -- --event <id> [--event <id>]  # Cala Event participants -> investors' events
npm run ingest-events -- --merge            # cached events -> data/investors.json (run after ingest-rounds)
```

`ingest-rounds` stops at `--budget` live call attempts in total across runs (default 426, counted in `data/raw/rounds/usage.json`; failed attempts count too, so on 14 Nov 340 counted for 300 successful calls) and paces requests 5 s apart. `ingest-events` shares that budget file. See `docs/CALA.md` for the endpoints, relationship names and caveats.

### Live Cala credits

Every live Cala call costs one credit. The `/api/cala/*` routes cache successful responses in memory, in Aiven Valkey (see below) and on disk (`data/cala-cache/`, shared with the ingest), so a repeat click or a restart is free. Real calls count against `CALA_LIVE_BUDGET` (default 150): in Valkey when it is configured, otherwise in `data/.cala-live-usage.json`. At the cap the routes return `budgetExhausted: true` with a "lookup paused" message instead of calling Cala. Reset by deleting the file, or the `room:cala:v1:live-usage` key in Valkey.

```bash
npm run prewarm                  # cache the panel's requests for the demo investors (max 15 calls)
npm run prewarm -- zinc syncona  # or chosen investor ids; --dry-run lists the requests
npm run build-snapshot           # data/cala-cache -> committed data/cala-snapshot.json (no calls)
```

The panel's two live requests (entity and "What does X invest in?") are answered first from Aiven Valkey (the panel's own responses, `lib/routeCache.ts`), then from the committed `data/cala-snapshot.json`, which holds the displayed fields (name, type, description, answer text, cited sources) for all 193 investors and is the fallback when Valkey is unset or down. Only a request neither can answer goes down the cache chain and then to live Cala. Each response carries `source: "memory" | "snapshot" | "valkey" | "file" | "live"` and `latencyMs`. Re-run `npm run build-snapshot` after a new ingest or prewarm.

### Aiven for Valkey (shared Cala cache)

An uncached Cala knowledge search takes 40-70 s and every call costs a credit, while the disk cache lives on one machine. Aiven for Valkey makes the cache and the credit cap shared by every server instance and every script run.

- **Chain**: the routes check the panel responses in **Valkey** first (`lib/routeCache.ts`), then the committed snapshot (back-filled into Valkey); below that the Cala client (`lib/cala.ts`, `createRouteCala`) goes in-process LRU, **Valkey**, `data/cala-cache/`, then live Cala within the budget. A live answer is written to Valkey, disk and memory; a disk hit back-fills Valkey. The ingest and prewarm scripts read and write the same Valkey keys.
- **Keys**: `room:cala:v1:<sha1 of the request>` (the same hash as the disk file name), JSON values, 30-day TTL (Cala data changes slowly). The live-call budget is an atomic `INCR` on `room:cala:v1:live-usage`; per-tier hit/miss counts are a hash at `room:cala:v1:stats`.
- **Failure mode** (`lib/valkey.ts`): with `AIVEN_VALKEY_URI` unset, Valkey down or a command slower than 800 ms, every Valkey step is a miss or no-op and the app answers from the disk cache as before. A failed connect waits 30 s before the next attempt. It logs once and never logs the URI.
- **Stats**: `GET /api/cache/stats` returns hits, misses and p50 latency per tier for this instance, plus shared totals from Valkey. The profile panel's live Cala section shows which tier answered and how long it took, with a hit/miss counter.

```bash
npm run seed-valkey              # load data/cala-cache + the snapshot's panel responses into Valkey (idempotent, no Cala calls)
```

Seeding means a fresh deploy pointed at the same Valkey answers everything in the cache with zero Cala calls.

## Investor side: the early spotter

`POST /api/spotter { investorId | investorName, asOf? }` lists up to 20 companies on a unicorn-shaped path for one investor. Each investor gets a different list, because the list is built from that investor's own rounds in Cala. Code: `lib/sim/spotter.ts` and `lib/sim/spotter/*`.

1. **Taste.** From the investor's rounds before `asOf`: sector and stage mix (a led round counts 1.5, a participation 1), lead share, the stage it usually enters at, round-size band (IQR), co-investors, and follow-on behaviour (re-up rate). If the investor is one of the 193 in `data/investors.json` and has fewer than 8 rounds in the cohort, its revealed vectors are blended in. This never happens in a backtest, because those vectors are present-day.
2. **Candidates.** The company's first dated round falls within 36 months before `asOf`. The company is not already in the investor's portfolio, is not already a unicorn and is not closed. Its fit (0.6 × sector + 0.4 × next-stage, each relative to the investor's top one) is at least 0.3. If fewer than 40 companies pass, the best 40 by fit are used instead.
3. **Unicorn shape.** A kNN (K = 12) compares the company's first 1–3 stage steps with the same number of steps at every cohort company whose outcome is known as of `asOf`: unicorn (valued at $1B or more) or stalled (no round for 24 months, or closed). It compares lead kinds, specific leads, months between rounds, round sizes, participants, investor overlap, and headcount growth when present. The score is the similarity-weighted unicorn share, shrunk toward the base rate. Each pick names its 2–3 nearest unicorns and its nearest stalled company.
4. **Simulated futures.** 500 runs start from the last real round, using the founder simulator's rules (raise-or-stall rates, real gaps and step-ups, next lead drawn through co-investor ties). Each pick reports P(unicorn-shaped: Series B+ with $100M or more raised in 5 years), the median months to the next round, and P(this investor leads or joins one of the next two rounds).
5. **Rank.** `fit^0.2 × shape^0.35 × P(unicorn)^0.3 × (0.05 + P(on path))^0.15`. Every component, sample size and `lowConfidence` flag is in the response.

Responses are cached in Valkey per investor, `asOf` and cohort version. `E2E_MOCK=1` returns a fixed mock. A request takes about 85 ms on a synthetic 900-company cohort, including the cold index build. The backtest (`tests/unit/spotterBacktest.test.ts`) runs as soon as `data/cohort.json` exists. It ranks as of 2015 and 2016 and prints where later unicorns such as Tractable, Revolut and Wise landed.

## Deploy

Not deployed; deploy only when Anson says so. The app runs on a read-only filesystem (e.g. Vercel): the snapshot is bundled with the routes, the disk cache simply stays empty there, and nothing writes to disk.

| Env var | Deploy value | Effect |
|---|---|---|
| `CALA_LIVE_BUDGET` | `25` (recommended) | Normal panel visits cost 0 (snapshot). Only requests outside the snapshot call Cala, up to 25. `0` = zero-spend mode: Cala is never called, misses show "Live Cala lookup paused". |
| `CALA_API_KEY` | set, or leave unset | Unset: snapshot answers still work; misses fall back to mock. |
| `ANTHROPIC_API_KEY` | optional | Unset: the offline keyword extractor drives the graph. Set: every visitor pitch spends Anthropic credits. |
| `ELEVENLABS_API_KEY` | optional | Unset: browser Web Speech. |
| `AIVEN_VALKEY_URI` | set (recommended) | Shared, warm cache (run `npm run seed-valkey` once) and a live-call cap that holds across instances. Unset: per-instance cap, see below. |

With `AIVEN_VALKEY_URI` set, the live-call cap is counted in Valkey with an atomic `INCR`, so it holds across serverless instances and cold starts. Without it (or while Valkey is unreachable) the counter file cannot be written on a deploy, so the routes count in memory with the same cap per server instance, reset on a cold start: treat `CALA_LIVE_BUDGET` then as approximate, not a hard account limit.

The repo becomes public at submission. `data/cala-snapshot.json` then publishes display fields of Cala data (entity names, descriptions, search answers and source links).

## Test

```bash
npm run gate                     # typegen, typecheck, lint, unit tests, build
npx playwright test              # e2e (replay, investor, interest, screenshots)
```

Tests never call Cala, Anthropic, ElevenLabs or Valkey (`E2E_MOCK=1`; unit tests mock the Valkey client).

## Honesty rules

- Fixture data is labelled; a "FIXTURE DATA" banner shows whenever any synthetic investor is loaded.
- No invented statistics. Quotes come only from `data/quotes.json`.
- LinkedIn is linked, never scraped.
