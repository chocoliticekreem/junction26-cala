# Progress log

**Start time:** 2026-11-14 05:32 EET (Helsinki). Minimum run until 08:32 EET, then polish backlog.
**Mode:** hackathon (project CLAUDE.md).

## Done
- 05:33 Repo created: github.com/chocoliticekreem/junction26-cala (private), first commit on `main`.
- 05:40 Scaffold: Next.js 16 (App Router, TS strict, Tailwind 4), Vitest, Playwright, shared `lib/types.ts` + `lib/taxonomy.ts`.

## In progress
- Fan-out of work tracks (see Plan).

## Next
- See Plan.

## Plan (work tracks)
| Track | Owner model | Scope | Done when |
|---|---|---|---|
| A. Core engine | opus | scoring, revealed vector, contradiction, fallback extractor, merge, room builder, interest state machine, verification + unit tests | `npx vitest run` green with spec 12.5 cases |
| B. Fixtures + data | sonnet | make-fixtures (200 investors, 40 founders), programmes.json, debriefs seed, replay pitch json + script, quotes.json placeholder | JSON files validate against types |
| C. Cala ingest | opus | Cala client, introspect, ingest (checkpointed), live proxy routes | real investors.json written from Cala |
| D. Founder UI | fable | graph, physics, transcript rail, chips, match list, panels, replay, mic | replay works in Playwright, screenshots look right |
| E. Investor + interest UI | fable | investor feed, room builder UI, room page, inbox, verification, chat, 2-window sync | e2e interest + investor specs green |

## Decisions
- Disabled Next 16 `cacheComponents`/`partialPrefetching` from the scaffold: app is client-heavy, avoids Suspense-boundary build errors.
- `typecheck` script runs `next typegen` first (Next 16 global `LayoutProps` type needs it).
- Default branch renamed `master` -> `main`.

## Elapsed
- 05:40 — 8 min.
