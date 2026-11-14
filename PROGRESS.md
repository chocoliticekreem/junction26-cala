# Progress log

**Start time:** 2026-11-14 05:32 EET (Helsinki). Minimum run until 08:32 EET, then polish backlog.
**Mode:** hackathon (project CLAUDE.md).

## Done
- 05:33 Repo created: github.com/chocoliticekreem/junction26-cala (private), first commit on `main`.
- 05:40 PR #1 Scaffold: Next.js 16, TS strict, Tailwind 4, Vitest, Playwright, shared `lib/types.ts` + `lib/taxonomy.ts`.
- 05:42 PR #2 Content data: 40 seeded founders, 30 seeded debriefs, 20 London programmes, 60 s replay pitch (+ build script), loaders.
- 05:52 PR #3 Core engine: scoring (spec 5.3), revealed vector + contradiction (5.2), keyword extractor, merge, interest state machine, verification, room builder, 200 fixture investors. 87 unit tests.
- 05:58 PR #4 Investor view, rooms, seat requests, debrief panel, interest inbox, verification, chat, two-window sync.
- 06:05 PR #5 Founder view: force graph, transcript rail, chips, top 10, evidence edges, profile panel, doors; live loop for replay + mic (fallback extractor on every chunk, one-in-flight LLM).
- E2E: founder-smoke, replay (biotech chip + biotech investor in top 3), interest two-window flow, room seat flow: 4/4 green.

## In progress
- Track C (opus): Cala client, introspection, real ingest of London investors, `/api/extract`, `/api/cala/*`, `/api/stt-token`.

## Next
- Merge Track C, rebuild `data/investors.json` from real Cala data, check the fixture banner disappears and contradictions are real.
- Investor e2e spec + screenshot spec (12.5), mic test, adversarial review.
- Polish: label overlap in the dense cluster, integer scores, chip trigger per sector.

## Decisions
- Disabled Next 16 `cacheComponents`/`partialPrefetching` from the scaffold: app is client-heavy, avoids Suspense-boundary build errors.
- `typecheck` script runs `next typegen` first (Next 16 global `LayoutProps` type needs it).
- Default branch renamed `master` -> `main`.
- Confidence pulls a field toward neutral 0.5 rather than toward 0 (unknown and zero-confidence score the same).
- Thin-history investors (< 3 dated deals in 24 months) never get a contradiction badge.
- A founder amount with no currency is treated as GBP (London product); raise is stored in USD and shown in pounds.
- Programme doors only attach to an investor when the programme is that investor's own (explicit link or name match). No cold-email door anywhere.
- Interest: decline is final for a pair; expired can be renewed; accept goes straight to `chat_open` or `pending_verification`.
- Track worktrees live in `.claude/worktrees/` (gitignored).

## Elapsed
- 06:07 — 35 min.
