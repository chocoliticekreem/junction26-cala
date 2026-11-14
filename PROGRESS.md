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
- 06:15 PR #7 E2E specs: investor feed, full two-window interest flow (cap, decline), screenshots spec.
- 06:22 PR #8 Founder graph polish: label collision avoidance, integer scores, per-chip triggers + transcript highlight, evidence draw-on, contradiction micro-chart, idle hint; 60 fps measured with 200 nodes.
- 06:30 PR #9 Investor view: founders orbit the selected investor (group-by halos), shared top bar, pounds formatting, mobile layout; fixed investor persona reset on reload.
- 06:33 Adversarial reviewer (opus, given only SPEC.md + code): 4 P1 (all = Cala track still in flight: API routes, ingest, ElevenLabs, live verification), 11 P2, 12 P3.
- 06:58 PR #11 Review fixes (logic): honest debrief wording, founder-aware easiest doors, off-taxonomy 'other', live-loop race + LLM-overrides-fallback per chunk, R before hydration, 24-month inbox evidence, scheme-less website crash, human error copy, periodic expiry, lazy seed room, ElevenLabs realtime STT client.
- 07:08 PR #12 Review fixes (UI): spec alpha 0.3 reheat + idle drift, sector names visible (no colour-only signal), valid match-row HTML, hover evidence edges, #N badges for unplaceable labels, fixture banner on all pages.
- 07:45 PR #14 Real Cala data: 193 London investors (148 funds, 17 accelerators, 14 CVCs, 14 angel networks), 2,636 sourced deals since May 2024, 133 with Cala-linked partners, real contradiction lines from counted deals; live Cala entity/search routes, Haiku strict-tool extraction route, ElevenLabs token route. ~725 Cala calls. Fixture banner gone. E2E repointed to real investors (4BIO Capital, Medicxi): 14/14.
- E2E: founder-smoke, replay (biotech chip + biotech investor in top 3), interest two-window flow, room seat flow: 4/4 green.

## In progress
- DoD proofs agent (opus): offline replay e2e, live-loop timing e2e (3 pitches < 2.5 s, mic path minus the mic), contradiction visible on screen, stronger contradiction lines, UI copy audit for invented stats, top-10 evidence check over 6 pitches, slow Cala search loading state, per-signal team triggers.

## Next
- Second adversarial review on the full product (with real data), fix findings.
- Manual for Anson: one live-mic run in Chrome (headless has no Web Speech).
- Submission notes (Cala usage, video script).
- Polish backlog 12.7 after DoD.

## Findings
- Real London pre-seed biotech money is thin: for the biotech pre-seed demo pitch the top scores on real data are 56-62 (Zinc, 4BIO Capital, Syncona) versus 80+ on fixtures, so the biotech halo (>= 5 investors inside 0.35 R_max) rarely forms. Not tuned away: it is the honest picture and a talking point.
- Cala: funds link to portfolio via INVESTED_IN (no round/date/amount) and to rounds via PARTICIPATES_IN_CORPORATE_EVENT; useful deal rows came from one dot-notation knowledge query per investor. Uncached query/search takes 40-70 s; 3-4 concurrent is the safe rate.

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
- Full e2e suite: 14/14 green on main after PR #12; 111 unit tests.
- Live-extract queue appends pending text instead of dropping it (deviation from 5.6 'newest replaces queued'; no words lost, still one request in flight).

## Elapsed
- 07:50 — 2 h 18 min.
