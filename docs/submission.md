# Scalaxy: Junction 2026 submission

Challenge: Make Unicorns Real (350), partner Cala. Tech challenges: Aiven (43), ElevenLabs (50). Repo: `chocoliticekreem/junction26-cala`. Field limits are from `CHALLENGE.md`.

## Form fields

### Project Name (max 30)

```
Scalaxy
```

### Punchline (max 200)

```
Simulate your startup's path through real Cala funding rounds: 5,000 futures, your odds of the next round, the investors to call and the real companies that walked it before you.
```

### Description (Markdown, max 5000)

````markdown
**Scalaxy simulates a startup's path to its next round, and to a unicorn.** A founder names the company, pitches it (typed or spoken) and says where they want to be in five years. Scalaxy runs 5,000 Monte Carlo futures through real funding rounds from Cala's knowledge graph, then shows the odds, the realities ahead, which investors to approach next and the real companies that took similar paths.

## The problem

Founders raise from scattered, stale information. The question that matters is a path: which first cheque leads to the strongest next round, and who leads after them. Funding databases list past rounds; they do not say what your odds are from where you stand. Investors have the mirror problem: finding early companies that look like past unicorns' early paths.

## What it does

**Founder side (`/`).**
- One company input: an existing company (matched to Cala by name) or a new idea.
- A pitch, typed or spoken, and a five-year vision such as "become a unicorn". Claude Haiku reads both.
- Simulate. Headline: the odds of raising the next round, and the odds of reaching the vision against a typical company at the same stage.
- Possible realities, best to worst. Next moves: the next lead investors and what each choice does to the odds.
- A star map: every star is an investor from Cala's knowledge graph, with the chosen path highlighted.
- Case studies of real precedent companies with their real rounds, including ones that stalled.
- Actions: intro email drafts for each lead. Nothing is sent. A company file keeps what Scalaxy knows about the company.

**Investor side (`/path/investor`).** A 20-second showcase. Pick a fund, read its taste in one line (built from its own rounds), and see five early companies whose first rounds resemble the early paths of past unicorns.

## How Cala is core

Remove Cala and Scalaxy stops working. The simulator is fitted on `data/cohort.json`: 486 real companies, 1,975 real funding rounds and 2,978 investors read from Cala (FundingRound entities with lead flags, dates, amounts and sources, and `INVESTED_IN` links). Every investor agent is fitted on what that investor really led, how large and how fast, who co-invested and who led after it. Every star on the map, every precedent and every number traces to Cala entities. Existing companies are matched to Cala by name.

## Why it is different

Dealroom, Crunchbase and a LinkedIn search show you who invested. Scalaxy answers what happens next: it turns the round graph into agents and simulates the future, and it checks itself by rewinding to an earlier year and seeing where later unicorns land. Every claim comes with the real company and rounds behind it.

## Tech challenges

**Aiven.** Aiven for Valkey sits in front of Cala. An uncached Cala query takes 20-70 s and costs a credit. Panel and Cala responses are served from Valkey first, with the committed snapshot and a file cache behind it, and live Cala only within a budget. The live-call budget is an atomic counter in Valkey, so it holds across instances. If Valkey is unset or slow, every step falls through to the file cache and the app keeps working. A cache hit and miss counter with per-tier latency is visible in the app and at `/api/cache/stats`.

**ElevenLabs.** Founders can speak the pitch and the vision. The server mints a single-use ElevenLabs realtime speech-to-text token (`/api/stt-token`) so the key never reaches the browser; the browser streams audio and shows words as they arrive. The mic stops by itself after the founder goes quiet and keeps the words in the text box, where they stay editable.

**Other tools.** Claude Haiku reads the pitch and the vision and narrates branches from the simulation's own numbers. Context.dev reads a company's website for the company file when a website is given.

## Real versus mocked

Real: the cohort, the rounds, the investors, the simulation and its backtest, the matches to Cala, the precedents. Fallbacks when a key is missing: keyword parsers instead of Haiku, the browser's speech recognition instead of ElevenLabs, the file cache instead of Valkey. A company that is not in Cala's cohort starts from the pitch alone, and the page says so. Odds are simulated from past rounds, not a forecast of any one company. Pitch audio is not stored. LinkedIn is linked, never scraped.

## What is next

Scalaxy becomes a network built inside Cala: founders and investors on the same graph, so a founder's path and an investor's taste meet in one place.
````

## Demo script (2 minutes)

| Time | Show | Say |
|---|---|---|
| 0:00 | Founder page, one input | "Founders raise from scattered data. Scalaxy simulates your path." |
| 0:10 | Type a company that is in Cala (existing company, matched by name); press the mic and speak the pitch, then the vision | "Spoken with ElevenLabs. It stops when I stop." |
| 0:35 | Simulate; the star map fills | "5,000 futures through real Cala rounds." |
| 0:50 | Headline odds and the comparison with a typical company | "Odds of the next round, and of the vision, against a typical company." |
| 1:05 | Realities and next moves; click a path | "Best to worst. The chosen path lights up on the map of Cala's investors." |
| 1:25 | A precedent case study, then an intro email draft | "Real companies, real rounds. A draft to the lead, nothing is sent." |
| 1:40 | `/path/investor`: five early companies for a fund | "For investors: early companies on past unicorns' paths, in 20 seconds." |
| 1:52 | Cache counter | "Aiven Valkey keeps Cala fast. Next: Scalaxy inside Cala, founders and investors on one graph." |

## Tech challenge notes

- Aiven: Valkey cache and shared budget in front of Cala (`lib/valkey.ts`, `lib/routeCache.ts`, `lib/cala.ts`).
- ElevenLabs: realtime speech-to-text (`app/api/stt-token/route.ts`, `lib/stt.ts`). Claim the code at mlh.link/junction-26.
