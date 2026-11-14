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
- 07:55 PR #15 Lint/typecheck exclude agent worktrees. PR #16 docs/submission.md + docs/DEMO.md (every number computed from repo).
- 08:10 PR #17 DoD proofs: offline replay e2e; live-loop e2e via test hook on the exact STT handlers (3 pitches: 9/11/4 ms to biotech top-3 + chip, keyword path); real contradiction visible in replay top 10 (London Business Angels: 'Says seed and Series A; 9 of last 10 deals were pre-seed', recounted in test); contradiction lines = strongest counted contrast, flat stated = no preference (65 -> 22 badges, 53 -> 12 lines); 57 future-dated deals clamped; copy audit; Cala search loading state; per-signal team triggers. E2E 18/18, unit 188.
- 08:20 PR #19 Submission docs refreshed after re-finalization (LBA contradiction example; 58/60 top-10 rows across 6 pitches have >= 2 chips, the other 2 tagged thin history).
- 08:55 PR #22 MIT LICENSE + CHALLENGE.md (judging brief). PR #23 live pitch captures company / one-liner / founder name (never scored; tested). PR #24 submission pack in CHALLENGE.md's form format.
- 09:04 PR #25 First screen states user + problem; calm idle top-10 rail; company on the graph centre; integer scores everywhere; investor group-by sweep (12.7 #4); orbit label obstacles. Unit 213, e2e 22/22.
- 08:36 PR #20 Second adversarial review fixes (reviewer saw a stale snapshot; each finding re-confirmed first): default investor can verify (Speedinvest), 5 mis-resolved Cala entities re-pointed + 5 cleared, 'investors active in London' copy, LLM overrides only the fields it reports, extract maxRetries 0, 4 duplicate deals removed, DATA_AS_OF for all counting, withdraw interest, P3 hardening. Unit 201, e2e 22/22.
- 13:00 (14 Nov) Branch `cala-graph-rounds`: deal history from Cala's FundingRound entity graph per the official field guide. `scripts/ingest-rounds.ts` (cached, checkpointed, budget-enforced, paced): 120 graph deals on 48 investors (42 replaced query deals, 78 new; 2,632 -> 2,710 deals), `isLead` known for 88%, `sourceRank` (Filing/Company/Press/Database) and `roundId` on each. Led rounds weigh 1.5x (`LEAD_WEIGHT`), `leadShare` on 41 investors, reasons gain "led N <sector> rounds since <year>". Generic event chips: `scripts/ingest-events.ts --event <id>` -> `events[]` (Slush 2026 loaded: 2,989 participants, 2 of our investors). Probes in docs/CALA.md: Slush participant composition (~6 investors/accelerators of 2,989; 65 of our investors back a participant), accelerator alumni paths (EF/Seedcamp/Antler, 5 of 20 with a later led round, founders for 19 of 20). 300 successful Cala calls. Anthropic usage limit hit (BLOCKED.md).

## Definition of done (spec 12.6), status 08:38: all met except the real-mic run (needs a human, see BLOCKED.md)
- [x] build, typecheck, lint, unit (201) and e2e (22) pass.
- [x] Replay reproduces the demo with the network off (tests/e2e/offline.spec.ts).
- [~] Live mic moves the right cluster within ~2.5 s, three times: proven for everything after the microphone (tests/e2e/live-loop.spec.ts drives the same handlers the STT session calls; 4-11 ms on the keyword path, plus ~600 ms graph settle). **Needs Anson: one real-mic run in Chrome** (headless has no Web Speech).
- [x] Every top-10 match shows a reason and >= 2 evidence chips (6 pitches: 60/60 rows have a reason, 58/60 have >= 2 chips, the other 2 are tagged thin history as the DoD allows).
- [x] Real stated-vs-revealed contradiction from Cala data on screen with counted deals (tests/e2e/contradiction.spec.ts).
- [x] Investor view ranks the founder pool and suggests a room (Zinc, 4BIO Capital, Syncona reach the 12-founder biotech threshold).
- [x] Two-window interest flow: interested, accept, both verified, chat unlocks; caps enforced (tests/e2e/interest*.spec.ts).
- [x] No keys in the repo; example env file present; README explains run, ingest, replay, demo.
- [x] No invented statistics in UI copy; no quotes shown (data/quotes.json empty until Anson collects them).

## CHALLENGE.md self-check (09:06, evidence per line)
- [x] **Real need.** User: a founder raising pre-seed or seed in London (and the investor on the other side). Problem: cold outreach to investors who were never a fit, because fund websites describe a thesis their deals don't follow. The first screen says it: idle overlay "Raising pre-seed or seed in London? Pitch out loud. Investors rank themselves by the deals they actually did, sourced from Cala." (PR #25; screenshot scratchpad/shots/final/founder-idle.png).
- [x] **Focus.** One core flow: speak a pitch -> investors re-rank by revealed deals -> evidence, contradiction, easiest door. Investor view, rooms and interest reuse the same engine. tests/e2e/replay.spec.ts, live-loop.spec.ts.
- [x] **Execution.** Runs start to finish on real data: e2e 22/22 on a production build; offline replay (offline.spec.ts); no console errors (screenshots.spec.ts); the slow Cala search has a bounded loading state (cala-panel.spec.ts); no fixture banner (founder-smoke asserts it is gone). Seeded founders are labelled "seeded" because they are seeded.
- [x] **Originality.** Matching on what investors did (dated Cala rounds, 24-month window, 12-month half-life), not their stated thesis; contradiction badges from counted deals (London Business Angels: "Says seed and Series A; 9 of last 10 deals were pre-seed", contradiction.spec.ts recounts it); live voice pitch as the query; investor-initiated, verified double opt-in. Dealroom/Crunchbase/LinkedIn search filter on stated profiles.
- [x] **Use of Cala is core.** 193 investors and 2,632 deals come from Cala (knowledge/query, knowledge/search, entities); 188/193 investors carry a Cala entity ID; investor verification checks Cala partner (Person/WORKS_AT) records; profile panels call Cala live. Remove Cala and there is no investor universe, ranking, evidence or verification.
- [x] **Slush-ready.** Runs locally in Chrome with `npm run dev`; replay works offline; usable by a founder next week for London investors. Not deployed (needs Anson's go and auth on the API routes, see BLOCKED.md).
- [~] **Sourced.** Every deal carries Cala sources: 1,792/2,632 (68%) with a URL; 2,260/2,632 (86%) with a URL or the portfolio company's Cala entity ID (live lookup in the panel); the other 372 show the source "Cala knowledge query" without a link, because Cala's query rows carry no citation.
- [x] **Junction rules.** MIT LICENSE (PR #22); README with run, ingest, replay, demo; no keys in git (.env* ignored; grepped); all code written this session from SPEC.md, nothing from Raise or 8x; nothing scraped from LinkedIn (the few LinkedIn URLs are citation links Cala returned, shown as links).
- [x] **Submission pack.** docs/submission.md (PR #24): name "Room" 4/30, punchline 185/200, description 4,261/5,000 (measured), 2-minute demo script totalling 1:55, tech challenges: none claimed (ElevenLabs only after a verified live run with a key).
- [x] **Peer review.** 3-minute flow in docs/DEMO.md and talking points for Innovation / Impact / Implementation in docs/submission.md.

## In progress
- Polish backlog 12.7.

## Next
- Polish backlog 12.7 (remaining: 4 investor group-by transitions, 6 optional 3D toggle; 9 deploy only when Anson says so).
- Human items for Anson are in BLOCKED.md (real-mic check, quotes, optional audio, auth before any deploy).

## Findings
- Real London pre-seed biotech money is thin: for the biotech pre-seed demo pitch the top scores on real data are 56-62 (Zinc, 4BIO Capital, Syncona) versus 80+ on fixtures, so the spec halo (>= 5 investors inside 0.35 R_max, absolute radius curve) never formed for the replay. Founder redesign (Anson: "I can't see the clustering") replaced it: radius comes from the score's place in the current set blended with rank, sectors own arcs sized by investor count, and the halo rule is >= 3 investors ranked in the top 12 inside the inner band. "Biotech · 6 investors" now forms on real data. Investor view keeps the spec physics.
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
- Interest gets a `withdrawn` state (not in 4.1's list) so investors can free their cap from founders who never answer; founders don't see withdrawn requests.
- Live-extract queue appends pending text instead of dropping it (deviation from 5.6 'newest replaces queued'; no words lost, still one request in flight).
- Founder graph deviates from 5.5 on Anson's feedback: ranked/stretched radius instead of the absolute curve, count-weighted sector arcs with gaps and filled territories, only the top 5 named on canvas (6-10 glow), halo relaxed as above. Idle state is a centred hero with Replay / Pitch live buttons; top-bar subtitle and the bottom legend are gone; evidence chips show for the top 3, hover and selection only.

## Elapsed
- 09:07 — 3 h 35 min. DoD met (bar the human mic check), CHALLENGE.md self-check answered; continuing polish.
