# Room: submission notes

Junction 2026, Cala challenge "Make Unicorns Real". Repo: `chocoliticekreem/junction26-cala`.

Every number below was computed from `data/investors.json`, `data/replay/demo-pitch.json`, `data/founders.seed.json` or the code in this repo on 14 Nov 2026. Numbers taken from `docs/CALA.md` (the ingest log) are marked "ingest log".

## One-line pitch

Say your pitch out loud, and watch London's investors sort themselves around you in real time. They are ranked by what they actually invested in, not what their websites claim, with the easiest door into each one. Interested investors ask to meet you, and the best fits meet in a small curated room.

## What it does

- **Founder, live ranking.** Speak a pitch (or press `R` to replay a recorded one). Claude Haiku extracts sector, stage, raise, traction and team signals from the transcript every few seconds. A force graph of 193 investors active in London reorders around the founder as the profile fills in.
- **Founder, evidence.** Each of the top 10 matches shows a score out of 100, a one-line reason, and the portfolio deals behind it with round, date and source link. Selecting an investor draws evidence edges to those companies.
- **Founder, honesty and doors.** Where a fund's stated thesis disagrees with its recent deals, a contradiction badge says so with counted deals. Each investor lists the easiest door in: a warm-intro path through its Cala-linked partners, or a request to be considered for a room.
- **Investor, founder feed.** Pick an investor at `/investor`. The same engine runs in reverse and ranks the founder pool (40 seeded profiles plus the live pitch) against that investor's revealed thesis, with group, sort and filter. When 12 or more matched founders share a sector, it suggests a themed room.
- **Investor, interest and verification.** The investor taps Interested. The founder accepts in an inbox. Both sides pass verification (investor name checked against Cala partner records, founder website and company email), then the lock opens and chat unlocks.

## How Cala is core

Without Cala there is no ranking, no evidence, no contradiction badge and no investor verification. The investor universe, every deal, every stated thesis and every partner link comes from Cala. Nothing is typed in by hand except the programme list for doors (`data/programmes.json`, 20 programmes with source links).

### Endpoints (base `https://api.cala.ai`, header `X-API-KEY`; client `lib/cala.ts`)

| Endpoint | Where it is used |
|---|---|
| `POST /v1/knowledge/query` | Ingest: discovery of investor names (14 query variants) and one deals query per investor |
| `POST /v1/knowledge/search` | Ingest: stated thesis, partners and deal citations per investor. Live: `app/api/cala/search/route.ts` |
| `GET /v1/entities?name=&entity_types=` | Ingest: resolve investor names that discovery did not link to an entity |
| `POST /v1/entities/{id}` | Ingest: investor edges, partners, website. Live: `app/api/cala/entity/[id]/route.ts` |
| `GET /v1/entities/{id}/introspection` | `scripts/introspect.ts`, to find which relationships exist on real funds |

Full shapes and caveats: `docs/CALA.md`.

### Relationships read

- `INVESTED_IN` (investor to portfolio company, with per-edge sources): the portfolio and the source URLs for deals. Fetched with limit 300 per investor.
- `PARTICIPATES_IN_CORPORATE_EVENT` (investor to a funding round, with `event_date` and `round_type`): found by `scripts/introspect.ts` and documented in `docs/CALA.md`, but not read at ingest. Reading it costs one retrieve per round, too slow for 193 investors, so the dated round list comes from the dot-notation query below.
- `WORKS_AT` (Person to fund, incoming, limit 25): partners. Person entities named in `knowledge/search` results are merged in. This is what the verification check and warm-intro doors read.

### The per-investor knowledge query

Quoted from `scripts/ingest.ts` (`DEALS_SINCE = "2024-05-01"`):

```
funding_rounds.investors=<Fund>.date>=2024-05-01.return(company, round_type, date, amount, sector).order_by=date DESC.limit=40
```

`docs/CALA.md` records why: one dot-notation call returned 35 dated rounds for LocalGlobe and 23 for Seedcamp, while the plain-English version of the same question returned 6 rows. The thesis call for each investor is `knowledge/search`: "What does <Fund> (London investor) say it invests in: which sectors, stages and cheque sizes? Who are its partners, and which startups has it backed since 2025?"

### Where each product feature comes from

| Feature | Cala data behind it |
|---|---|
| Revealed thesis | Per-investor `funding_rounds` rows from the query above (round type, date, amount, sector), weighted by recency. See Method |
| Evidence chips and edges | The deals that contribute most to a match, each with its sources: `INVESTED_IN` edge sources for the same company plus origins of `knowledge/search` KnowBits that mention it. Deals with no URL source keep `companyCalaId`, so the app can live-retrieve that company's sources |
| Stated thesis | `knowledge/search` text, mapped by Haiku to sector and stage weights, once at ingest |
| Contradiction badge | Distance between stated thesis (Cala search text) and revealed vector (Cala deals). The line is built only from counted deals |
| Investor verification | The name a visitor types must match a partner in `partners[]` of that fund, which is built from Cala `WORKS_AT` and Person entities (`lib/verification.ts`, `verifyInvestor`) |
| Live panels | When an investor is selected, `ProfilePanel` calls `/api/cala/entity/{calaId}` and `/api/cala/search` ("What does <investor> invest in?") and shows the answer with its sources. Cold queries take 20-60 s, so the UI shows a loading state |

### Numbers from the shipped dataset (`data/investors.json`)

Computed with a short Python script over the committed file.

| Measure | Value |
|---|---|
| Investors | 193 (148 funds, 17 accelerators, 14 CVCs, 14 angel networks) |
| Fixture records | 0 |
| Deals | 2,632 (4 duplicate rounds merged), between 2024-01-10 and 2026-11-12 |
| Deals with a date | 2,622 (99.6%) |
| Deals with a parsed USD amount | 2,132 (81.0%) |
| Deals with a known round type | 2,162 (82.1%) |
| Deals with at least one URL source | 1,792 (68.1%) |
| Deals with a Cala company ID | 1,865 (70.9%) |
| Deals classified sector `other` | 107 (4.1%) |
| Investors with 3+ dated deals in 24 months | 161 |
| Investors flagged thin history | 32 |
| Investors with at least one partner linked to a Cala Person | 133 (350 partner links in total) |
| Investors with a contradiction score above 0.4 | 22 |
| Investors with a contradiction line (the badge) | 12 |
| Stated-thesis sources | 1,139 across the 193 investors; 192 investors have at least one URL |

From the ingest log in `docs/CALA.md` (not recomputed): about 725 successful Cala calls in the ingest, 155 further requests that were 429 retries, 201 candidates reduced to 193 investors.

### One real contradiction

London Business Angels, taken verbatim from `contradictionLine` in `data/investors.json`:

> Says seed and Series A; 9 of last 10 deals were pre-seed

Checked independently: 10 London Business Angels deals fall in the 24-month window (as of 14 Nov 2026). 9 are pre-seed and 1 is seed. The stated-thesis stage weights from Cala search are seed 0.60 and Series A 0.40, and the distance score is 0.92, above the 0.4 threshold. The newest of these deals is dated 2026-08-15, which looks like a month-only date pinned to the 15th (the file cannot tell). Its deals carry only a "Cala knowledge query" source with no URL (0 of its 13 deals have a URL source), so the badge is backed by counted deals but not by a clickable link. It is #9 in the replay's top 10, with a score of 49.9.

## Method

Code: `lib/revealed.ts` (revealed vector, contradiction), `lib/scoring.ts` (score), `lib/mergeProfile.ts` (live profile).

**Revealed vector per investor.** Over deals dated in the last 24 months (a deal up to one month in the future counts as today):
- Sector distribution `S` and stage distribution `G`, each deal weighted by `0.5^(months / 12)` (12-month half-life), then normalised. Unknown rounds are left out of `G`.
- Cheque band: the 25th to 75th percentile of USD amounts, plus the median.
- Activity: `log(1 + deals in last 12 months) / log(1 + 12)`, capped at 1.
- Thin history: fewer than 3 counted deals. These investors blend their stated thesis into `S` and `G` (blend weight rises with the deal count, full revealed at 3).

**Contradiction.** The average of the total variation distance between stated and revealed sectors and between stated and revealed stages (over the dimensions both sides have). A badge shows above 0.4 and only for investors that are not thin. The line picks the strongest counted contrast between the stated thesis and the deals, from sector or stage, preferring one where the off-thesis category is at least 40% of counted deals. A stated distribution with no clear lead (top share below 0.4, or a tie for first) counts as no stated preference: it neither scores nor words a line. A score above 0.4 with no qualifying contrast shows no badge, which is why 22 investors score above 0.4 and 12 carry a line.

**Score** (0-100), computed in the browser on every profile update:

```
score = 100 * (0.40 * sectorFit + 0.30 * stageFit + 0.15 * chequeFit + 0.10 * activity + 0.05 * debriefAdj)
```

- `sectorFit`: sum over the founder's sector weights times the investor's revealed sector share.
- `stageFit`: the investor's share at the founder's stage plus half the share at the adjacent stages, capped at 1.
- `chequeFit`: 1 inside the cheque band, falling linearly to 0 at 3 times outside it. Neutral if the band or raise is unknown.
- `activity`: as above.
- `debriefAdj`: Beta(1,1)-smoothed room debrief outcome, 0.5 when there are none. A repeated majority "stage" or "sector" tag from debriefs also shifts the sector and stage weights.
- Each founder field is pulled toward neutral (0.5) by its extraction confidence, so a half-heard field moves the score half as much. An unknown field is neutral.
- There is no fund-size, brand or prestige term. Only pitch content is scored.

**Reasons and evidence.** The two largest contributing terms become the reason line. Evidence chips are the 2-3 counted deals that contribute most to sector and stage fit.

**Taxonomy.** 18 sectors plus an `other` fallback, and 5 stages (pre-idea, pre-seed, seed, Series A, Series B+).

**Extraction.** Server route `app/api/extract/route.ts` uses `claude-haiku-4-5` with a strict tool schema. A keyword fallback (`lib/fallbackExtract.ts`) produces the same shape offline.

## Honesty

- **Real data.** `data/investors.json` is the real Cala ingest: 193 investors, 0 fixture records. `data/investors.fixture.json` is synthetic and only loads if `investors.json` is empty; a "FIXTURE DATA" banner shows whenever any synthetic investor is loaded.
- **Approximated dates.** Cala often returns month-only or year-only dates. The ingest pins them (month to the 15th, year to 1 July, "Late 2025" to 1 Oct 2025, quarter to mid-quarter). It computes an approximate flag per deal but discards it, so the committed file cannot tell exact dates from pinned ones. Month-only dates for November 2026 had been pinned to the 15th, which put 57 deals after the ingest date. The data was re-finalized: those dates are clamped to the 1st of their month, and 0 deals are now dated after 14 Nov 2026. Treat all dates as month-accurate at best.
- **Amounts and rounds.** 19.1% of deals have no parsed USD amount and 18.0% have no round type. Amounts in GBP or EUR are converted at fixed rates (x1.27, x1.08).
- **Contradictions are classifier-dependent.** Stated-thesis weights come from a Haiku classification of Cala search text. A badge is a prompt to look at the deals, not a verdict. Only 12 investors carry one, and each line is built from counted deals.
- **Mocked or local.**
  - Seeded founders: 40 synthetic profiles in `data/founders.seed.json`, labelled seeded, plus the demo pitch from a fictional founder (Amara, Helixa Bio).
  - Seeded debriefs in `data/debriefs.seed.json`, labelled seeded in reasons.
  - Interest, verification and chat state live in the browser's localStorage. Two windows of the same browser sync through the `storage` event. There are no accounts and no server-side chat.
  - Email checks are format checks only: the domain must match the fund's website, or must not be a personal mailbox when the fund has no website in the data (113 of 193 investors have no website). No email is sent or verified.
  - The founder's optional "found on Cala" check exists in `verifyFounder` but no UI passes it, so it never runs.
  - Room pages and seat requests are mock screens.
- **Live Cala panels depend on a key.** With no `CALA_API_KEY`, or with `E2E_MOCK=1`, `/api/cala/*` returns a labelled mock. Rankings and evidence do not depend on the key because they read the committed file.
- **No invented statistics.** The problem-section figures are placeholders until quotes are collected at Junction (SPEC section 2): outreach volume per raise `[N emails per raise]`, reply rate `[x%]`, time spent `[__ hours]`, share of first meetings that are a wrong fit `[share of first meetings that are wrong-fit]`. Quotes come only from `data/quotes.json`.
- **Privacy.** Pitch audio is not stored. LinkedIn is linked, never scraped. Investor partner records carry no LinkedIn links in the current data (0 of 350).
- **Match checks.** `scripts/check-matches.ts` runs six test pitches (biotech, fintech, climate, AI infrastructure, consumer, off-taxonomy defence) through the ranking: all 60 top-10 rows have a reason, and 58 have at least 2 evidence chips. The other 2 are thin-history investors, which the check accepts with fewer chips.
- **Latency.** `knowledge/query` and `knowledge/search` take 40-70 s on a cold input (`docs/CALA.md`), which is why the shipped ranking uses an ingest-time cache and the live panels show a loading state.

## Roadmap

From SPEC F15, F16 and 9.4:

- **Accounts and payments (F15).** Replace the role switcher with login. Move interest, verification, message and seat-request state from localStorage to hosted Postgres, one table each.
- **Founder progress over time (F16).** Debriefs and repeat pitches give a trace of how a founder's profile and matches change as traction grows.
- **Real debriefs.** After each room, collect the three debrief questions and let them adjust scores, replacing the seeded debriefs.
- **Business model.** Ranking never changes with payment. Investor-side subscription for the matched feed, interest requests and room seats; free for founders.
- **Retention.** Founders return for rooms and re-pitch as traction changes. Investors get a weekly matched feed and interest requests.
- **Beyond London.** The ingest is parameterised by city; London first because density makes rooms possible.
- **Fresher data.** Refresh the ingest on a schedule so revealed vectors track the last 24 months, and read round-level dates through `PARTICIPATES_IN_CORPORATE_EVENT` where budget allows.
