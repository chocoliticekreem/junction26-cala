# Room: Junction 2026 submission pack

Challenge: Make Unicorns Real (350), partner Cala. Repo: `chocoliticekreem/junction26-cala`. Form rules are from `CHALLENGE.md`. Character counts were measured with `wc -m` on the exact pasted text.

## Form fields (paste as is)

### Project Name (max 30)

```
Room
```

4 characters.

### Punchline (max 200)

```
Founders raising in London: speak your pitch and 193 investors active in London rank themselves by the deals they actually backed, sourced from Cala, not by the thesis on their website.
```

185 characters.

### Description (Markdown, max 5000)

4261 characters, measured on the text between the fences and nothing else.

````markdown
**Room is a live investor-matching tool for founders raising a pre-seed or seed round in London.** You say your pitch out loud. Within seconds, 193 investors active in London rearrange around you, ranked by what they actually invested in, not what their website says. It is built to be used at Slush next week.

## The problem

Raising in London runs on networks. First-time founders cold-email long lists of investors who were never a fit, and partners lose first meetings to founders outside their stage or sector. Fund websites describe a thesis, but recent deals often say something else. Figures to be filled from quotes collected at Junction, not invented: [N emails per raise], [x% reply rate], [__ hours spent], [share of first meetings that are wrong-fit].

## What we built

- **Live ranking.** Speak a pitch (or press `R` to replay a recorded one). Claude Haiku extracts company, sector, stage, raise, traction and team signals from the transcript every few seconds. A force graph reorders around the founder as the profile fills in.
- **Evidence.** Each of the top 10 matches shows a score out of 100, a one-line reason, and the portfolio deals behind it with round, date and source link. Selecting an investor draws edges to those companies.
- **Contradictions.** Where a fund's stated thesis disagrees with its deals, a badge says so using counted deals. Example from the data: London Business Angels says seed and Series A, but 9 of its last 10 deals were pre-seed.
- **Doors.** Each investor lists the easiest way in: a warm-intro path through its Cala-linked partners, or a request to be considered for a room.
- **Investor side.** Pick an investor at `/investor`. The same engine ranks a founder pool against that investor's revealed thesis. When 12 or more matched founders share a sector, it suggests a themed room. The investor taps Interested, the founder accepts, both sides verify, and chat unlocks.

## How Cala is core

Remove Cala and Room stops working. The investor universe, every deal, every stated thesis and every partner link come from Cala. Nothing in the ranking is typed in by hand.

- **Investors and deals.** 193 investors and 2,632 deals (between 2024-01-10 and 2026-11-12) come from Cala `knowledge/query` (one dated funding-rounds query per investor), `knowledge/search` and entity retrieval. Investors link to portfolio companies through `INVESTED_IN`.
- **Evidence chips.** Each chip is a Cala deal with its sources: 68% of deals have at least one URL source and 71% carry a Cala company ID.
- **Contradictions.** The badge compares the thesis text Cala returns with the revealed vector built from Cala deals. 12 investors carry one.
- **Verification.** An investor's name is checked against partners built from Cala `WORKS_AT` and Person entities: 133 of 193 investors have a linked partner, 350 partner links in all.
- **Live panels.** Selecting an investor calls Cala's entity and knowledge-search endpoints at runtime and shows the answer with its sources. Cold queries take 20-60 s, so the ranking itself reads an ingest-time cache.

## Why it is different

Dealroom, Crunchbase and LinkedIn search are databases you query by filter, and they show stated focus. Room listens to your pitch, ranks by revealed behaviour with a source on every claim, shows where a fund's words and deals disagree, and gives a way in. The score has no fund-size or brand term. Only pitch content is scored.

## Real versus mocked

Real: the 193 investors, 2,632 deals, sources, partners, scoring, extraction and the live Cala panels (with a key). Local or mocked: 40 seeded founder profiles and the demo pitch from a fictional founder (Amara, Helixa Bio); seeded debriefs; interest, verification and chat state live in the browser's localStorage; email checks are format checks only and no email is sent; room pages are mock screens. Dates are month-accurate at best, because Cala often returns month-only dates. 19% of deals have no parsed amount. A contradiction badge is a prompt to look at the deals, not a verdict. Pitch audio is not stored. LinkedIn is linked, never scraped.

## Stack

Next.js, TypeScript, Claude Haiku for extraction, the Cala API for all investor data, the Web Speech API for the microphone. MIT licensed.
````

### Challenge

Make Unicorns Real (350), partner Cala.

### Tech challenges genuinely used

Tick **Best Use of Aiven (43)** in "Tech Challenge Participation".

- **Aiven (43): Aiven for Valkey, the shared cache in front of Cala.** Uncached Cala knowledge searches take 40-70 s (`docs/CALA.md`) and every call costs a credit, while the existing cache was a folder on one laptop. Every investor panel now reads from Valkey first: the routes keep the panel's own responses in Valkey (`lib/routeCache.ts`), and below that the Cala client chain is memory -> Valkey -> disk -> live Cala (`lib/cala.ts`, `lib/valkey.ts`), with live answers written through and disk hits back-filled. The committed snapshot is only the fallback when Valkey is unset or down. `npm run seed-valkey` loaded 1,122 entries (741 raw Cala responses + 381 panel responses for all 193 investors, 11.2 MB) in about 1.4 s, so any deploy pointed at it is warm with 0 Cala calls. The live-call budget is an atomic `INCR` in Valkey, so the credit cap holds across serverless instances. If Valkey is missing or slow, every step falls through within 800 ms. Measured on 14 Nov against the Aiven service from a local `next start` (live budget 0): 12 of 12 panel requests for Zinc, 13Books Capital and London Business Angels were served by Valkey, p50 34 ms (about 260-320 ms on the first request of a fresh server, which includes the TLS connect), 0 Cala calls; with `AIVEN_VALKEY_URI` unset the same requests fell back to the snapshot. `GET /api/cache/stats` reports hits, misses and p50 latency per tier, and the profile panel shows which tier answered and how long it took, with a hit/miss counter.
- ElevenLabs (50): a realtime speech-to-text client exists (`lib/stt.ts`, `app/api/stt-token/route.ts`), but Web Speech is the default and `ELEVENLABS_API_KEY` is not set. Claim it only after the key is set, a live run through ElevenLabs is verified, and the code is claimed at mlh.link/junction-26 (see `BLOCKED.md`).
- Gemini, Context.dev, Oxylabs: not used.

### 2-minute demo script

Total running time: 1:55 (115 s), 5 s under the 2:00 limit. Record at 1440 px wide in Chrome, founder window first. Facts come from `docs/DEMO.md` (scores computed 14 Nov 2026; check the order on screen before recording). Setup: clear localStorage for `localhost:3000`, open `/` and `/investor` side by side, and open Zinc's profile once beforehand so the live Cala panel is warm (cold queries take 20-60 s).

The recorded pitch runs 60.8 s. Segment 0:15-0:40 shows it sped up in the edit, or cut to the key moments ("therapeutics", "pre-seed", "raising"). No voiceover over that segment.

| Time | Secs | Screen | Voiceover / action |
|---|---|---|---|
| 0:00-0:08 | 8 | Founder view loads. 193 investor points sit dim before any pitch | "A hundred and ninety-three investors active in London. Ranked by what they did, not what they say." |
| 0:08-0:15 | 7 | Press `R`. Transcript starts streaming | Replay audio or caption: "Hi, I'm Amara, founder of Helixa Bio, a London startup." |
| 0:15-0:40 | 25 | Words stream. The "Helixa Bio" company chip appears, then the biotech chip on "therapeutics" and the pre-seed chip. Biotech investors move inward | Silent. The motion carries it |
| 0:40-0:52 | 12 | Graph settles. Top 10 cards: Zinc, 4BIO Capital, Syncona at the top | "Ten matches. Every one is backed by real deals from Cala." |
| 0:52-1:05 | 13 | Click Zinc. Evidence edges light to Serenatis Bio, Microsol and Nascent Therapeutics with round and year. Source links and the live Cala panel visible | "Zinc: five biotech deals in 24 months. Rounds, dates and sources, straight from Cala." |
| 1:05-1:15 | 10 | Click London Business Angels (#9). Contradiction badge | "This one says seed and Series A. Nine of its last ten deals were pre-seed." |
| 1:15-1:22 | 7 | Easiest-door section in the investor panel | "And the easiest way in, for each one." |
| 1:22-1:45 | 23 | Split screen. Investor window: pick Zinc, show "15 matched founders in biotech/therapeutics". Switch to Medicxi, tap Interested on the live founder. Founder window: accept in the inbox. Investor verifies as Francesco De Rubertis with a `medicxi.com` address ("Partner on Cala" passes). Lock opens, chat appears | "Investors reach out only when the fit is real. Zinc can fill a biotech room with fifteen matched founders. Medicxi taps interested and verifies against its Cala partner record. Then you talk." |
| 1:45-1:55 | 10 | Title card: "Room. Built on Cala." | "Two thousand six hundred deals, a hundred and ninety-three investors, all from Cala." |

Sum: 8 + 7 + 25 + 12 + 13 + 10 + 7 + 23 + 10 = 115 s = 1:55.

Say aloud or caption that chat and email checks are local to the browser (format check only). Do not imply an email was sent. Do not narrate the order of matches #4 to #10 (scores are close). Do not show a cluster or halo count. "193 investors" and "2,632 deals" are from `data/investors.json`.

### Peer review (3 minutes)

Scored on Innovation, Impact and Implementation. Flow follows the "3-minute live pitch flow" in `docs/DEMO.md`. If the mic or Wi-Fi fails, press `R`.

- **Innovation.** Investor tools show what a fund says. Room ranks investors by what they did: it extracts sector, stage and raise from a spoken pitch every few seconds and re-ranks 193 investors active in London against their dated deals. A contradiction badge shows where a fund's stated thesis disagrees with its deals (London Business Angels: says seed and Series A, 9 of its last 10 deals were pre-seed). The score has no fund-size or brand term.
- **Impact.** The user is a founder raising pre-seed or seed in London, often first-time, who cold-emails investors who were never a fit. On the investor side the need is fewer wrong-fit first meetings. Room gives the 10 best-fit investors, the evidence behind each and an easiest door in. Do not quote a statistic: the problem-section numbers are placeholders until quotes are collected at Junction. Quote only what is in `data/quotes.json`.
- **Implementation.** Works end to end on real data: 193 investors and 2,632 deals from Cala, no fixture records. Ranking is a pure function in the browser. Every match traces to Cala entity IDs and rounds, and Cala is required: without it there is no investor universe, evidence or verification. Be upfront about what is local: seeded founders and debriefs, localStorage interest and chat, format-only email checks, mock room pages. Roadmap: accounts and hosted Postgres, real debriefs, scheduled re-ingest.

---

Source notes for everything below: every number was computed from `data/investors.json`, `data/replay/demo-pitch.json`, `data/founders.seed.json` or the code in this repo on 14 Nov 2026. Numbers taken from `docs/CALA.md` (the ingest log) are marked "ingest log".

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
