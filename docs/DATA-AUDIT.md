# Data audit: Cala-derived data in Room Path

14 Nov 2026. Scope: Cala's own company record (the live demo shows it to Cala's CTO), `data/investors.json` (193 investors, 2,710 deals), `data/cala-snapshot.json` (188 investor entities), the cohort (`data/cohort.json` from the cohort ingest, read at 1,128 rounds / 290 companies while it was still being written; and `data/cohort.fixture.json`). Method: static checks over every record, the raw Cala responses in `data/cala-cache/` (1,250 files), and a page-checked sample of 90 claims (139 source pages fetched; Haiku on the borderline ones). Re-run with `npm run verify-data`.

## 1. Cala's own round: what is true

| Field | Verified value | Evidence |
|---|---|---|
| Round | Pre-Seed, equity | startup.eu, Dealroom News, Dealflow.es #513 |
| Amount | EUR 7,000,000 (~$7.56M at the app's fixed 1.08) | all three |
| Date | **announced 11 May 2026** (Cala came out of stealth that day) | startup.eu "Startup.eu Editorial May 11, 2026"; El Periódico 11 May 2026; Cala's and Elisenda Bou-Balust's LinkedIn posts of 11 May (linked, not fetched) |
| Lead | Lightspeed Venture Partners (its first investment in Spain) | startup.eu lists "Lightspeed Venture Partners — Lead"; Dealroom; Dealflow |
| Participants | Kfund, Kibo Ventures, Masia | same three pages |
| Founders | Elisenda Bou-Balust (CEO), Issey Masuda Mora; both built Vilynx (acquired by Apple) | Dealflow, startup.eu, Dealroom, masia.vc |
| Founded | 2025 (BORME filing 10 Mar 2025, rank FILING) | `81cfdabc` founding_date sources; jobfluent says 2024 |

Sources: [startup.eu](https://www.startup.eu/investments/cala-7-m-pre-seed-05-2026), [Dealflow.es #513](https://newsletter.dealflow.es/p/dealflowes-513-embat-raised-30m-lightspeed), [Dealroom News](https://dealroom.co/news/130391-barcelonas-cala-raises-7m-pre-seed-to-build-a-knowledge-layer-for-ai-age/).

**The Dealflow citation is not misattributed.** The URL slug is truncated; the issue's title is "Embat raised €30M. Lightspeed makes 1st investment in Spain (Cala)". The page says: "Cala, the new startup of Elisenda Bou and Issey Masuda ... announced a €7M pre-seed round led by Lightspeed, with participation from us at Kfund, as well as Kibo Ventures, and Masia." (Embat's €30M was led by Cathay Innovation, not Lightspeed.) Note the newsletter is written by a Kfund partner, so Cala's `PRIMARY` rank on it is right: it is an investor's own publication, not independent press.

### What was wrong or unverified in Cala's data

| # | What the app showed | Truth | Root cause | Status |
|---|---|---|---|---|
| 1 | Round date **2025-01-01** | 2026-05-11 | Cala's `event_date` is a year-only pin (`2025-01-01`, no `event_date__precision`), sourced to infiniteloop, kiboventures.com and a LinkedIn post saying "14 months ago". Our `roundFromEntity` and `parseFundingRound` took `event_date` over `announcement_date` unconditionally. | **Fixed**: `pickRoundDate` (lib/rounds.ts) uses the announcement when the event date is a Jan-1 pin more than 6 months earlier. Context doc now says 2026-05-11. |
| 2 | Investor **Creandum Kommanditbolag** | No source says Creandum invested | `INVESTED_IN` edge on entity `2bdea5e8` with 38 sources, every one a bare homepage (`https://pitchbook.com/`, `https://www.linkedin.com/`...). The only Creandum-named source is "Euro Seed 50 \| Creandum", a list Creandum curates; it described Cala in July 2025 as bootstrapped with 6 people. Cala's extractor read list membership as an investment. | Filter: `unverified`, hidden from the facts view |
| 3 | Investor **Clara Ventures** | Unsupported | One source: `https://www.clara.ventures` homepage dated 2019-01-01, six years before Cala existed. | `unverified`, hidden |
| 4 | Investor **Pepe Borrell** (Person) | Plausible via Masia (he co-founded it), not confirmed as a personal investor | One LinkedIn post about Masia's launch. | `unverified` (LinkedIn is linked, never fetched) |
| 5 | Elisenda Bou-Balust cited to `zonebourse.com/insider/BALUST-ELISENDA-BOU-A2617K` | Right person (Ferrovial non-executive director since 2026; MarketScreener's copy lists her as founder/CEO of Cala AI), wrong evidence: a stock-insider profile about her Ferrovial board seat, and it returns 403 | `bestSource` picks the first URL'd source; Cala lists the insider page first | Founder is `verified` through Dealflow + masia.vc; the doc still displays the zonebourse link (see fixes) |
| 6 | Issey Masuda Mora cited to euroseed50.com and nordic9.com dated **2016-01-01** | Founder confirmed (Dealflow, El Periódico, Dealroom) | euroseed50 renders client-side (no text); nordic9's source date is impossible for a 2025 company | `verified` |
| 7 | Headcount **10–50** | One aggregator: jobfluent.com's self-reported band (the same page says "Founded 2024") | Single AGGREGATOR source; the cohort has 6 (Jul 2025) and 20 (May 2026) from other sources | `single_source`: dropped from the facts view, listed as unconfirmed |
| 8 | Two Cala entities | "Cala" `2bdea5e8` holds founders and `INVESTED_IN`, no round; "Cala AI" `81cfdabc` holds the round, total funding, headcount | Cala models brand and legal layers separately | Handled: `fetchCalaFacts` merges siblings when the primary has no rounds. The cohort's Lightspeed is entity `02f2eee1`, the round's is `5a9d0c1c` (split investor entities) |

After the fix and the filter, the demo company file shows: Pre-Seed EUR 7M, 2026-05-11, led by Lightspeed, with Kfund, Kibo, Masia (verified); both founders (verified). Creandum, Clara Ventures, Pepe Borrell and the headcount move to an "unconfirmed" list. This was checked by building the doc from the cached entities (0 live Cala calls) and running `contextTrust` on it.

## 2. Gap classes across the datasets

| Class | Count / rate | Root cause | Fix |
|---|---|---|---|
| **(a) Citation not about the claim** | Query deals with a URL: 1,758. **862 (49%) cite only investor profile pages** (theventurecodex.com/funds, tracxn /d/venture-capital, seedtable /investors, pitchbook /profiles/investor); **878 (50%) cite only URLs reused across ≥3 different companies** (northzone.com/portfolio for 17, one Homa Games article for 12, one PitchBook company profile for 12). Cohort: 144 rounds with a URL, 55 profile-only, 29 only reused URLs. Page-checked sample: 79 claims, **3 misattributed** and **5 more with one unrelated source** (8 of 79, 10%); 10 unreadable. | **Our ingest.** `scripts/ingest.ts buildDeals` gives a query row (which has no source) (1) the `INVESTED_IN` edge sources for that company, which prove a relationship, not a round, and (2) every origin of any search KnowBit whose text contains the company name as a substring, so "Tem" matches "system" and a portfolio-list KnowBit cites one page for every company in it. The cohort ingest attaches one search's citations to several rows (TechCrunch's 2019 Billie article and a PitchBook page for Olix are cited for SEON, Rillet, Olix...). | Filter: a cited page that does not name the company = `conflict`; profile pages never count as corroboration. Ingest: match KnowBits on whole words, attach only origins whose title or text names the company and the round; drop edge sources from deal citations. |
| **(b) Entity resolution** | Investor entities: **59 of 188** in the snapshot are Companies House shells with non-investor descriptions; clear wrong picks: ACF Investors -> "ACF VENTURES LTD, transportation and logistics, Warsop"; Kiko Ventures -> construction; Cavalry Ventures (Berlin VC) -> "CAVALRY HOLDINGS, healthcare services"; Point Nine (Berlin) -> "POINT NINE LIMITED, incorporated in London in 2025"; Zinc -> "ZINC GROUP LIMITED, banking, Stratford-upon-Avon". Deals: 34 company ids carry 2+ names, **44 names map to 2+ ids** (Granola, ElevenLabs, Fireworks AI, Tem). Cohort: 76 of 290 companies (26%) and 1,358 of 5,146 participants (26%) have no Cala id; 1 duplicate (InfiniteWatch id vs name). Self-loop: Entrepreneur First `INVESTED_IN` Entrepreneur First. | Cala models every legal vehicle as its own entity; **our** name-first resolution picks a London shell when the brand entity is elsewhere. | Resolve by website first (`scoreCandidate` already does for founders; the investor ingest does not); filter adds an entity warning that caps the level at `single_source`. |
| **(c) No per-row source** | `knowledge/query`: **4,199 rows in 434 cached calls, 0 with a source**. 2,590 of 2,710 deals (96%) come from query rows; 832 deals have no URL at all. **Cohort: 1,127 of 1,128 rounds are query rows (`q:`); 984 (87%) have no URL.** | Cala's query endpoint returns answers, not citations. | Prefer FundingRound entities (sourced, `is_lead`) for anything shown as fact; query rows are `unverified` until a page check confirms them. |
| **(d) Dates** | Deals: **0 carry `datePrecision`** although 1,550 (57%) are month-only pinned to the 15th and 136 year-only pinned to 1 Jul; 10 undated. FundingRounds: `event_date__precision` never returned (0 of 140); **12 of 48** rounds with both dates have `event_date` >6 months before `announcement_date`, 4 are Jan-1 pins (Cala's included). Cohort: 32 Jan-1 dates, 13 undated. Source dates: nordic9 2016-01-01 on a 2025 founder. | Cala: precision missing, year pins. **Ours**: `normaliseDate` knows when it pinned (`approximate`) but the ingest never writes `datePrecision`. | `pickRoundDate` (shipped); write `datePrecision` in the ingest; filter flags pins, future dates and pin-vs-announcement gaps (`dateSane: false`, caps at `single_source`). |
| **(e) Amounts / currency** | 501 deals (18%) without an amount; 343 converted from EUR/GBP at fixed 1.08/1.27 regardless of date; **45 claims fail the stage band**: pre-seed > $25M (Cambridge Aerospace $36M), "seed $1.1B" (Ineffable Intelligence), "Applied Intuition $1.5B (expected)" (not a closed round), Google Ventures/Rox "— (val. $1.2B)" (a valuation parsed as the amount). One NOK round has no FX rate, so no USD. | Cala's free-text amounts; **our** `parseAmountUsd` reads the first figure, including valuations and "expected". | Filter: stage bands + unconverted-currency check (`amountSane`). Ingest: skip figures next to "val"/"valuation"/"expected"; add NOK/SEK/DKK/CHF rates. |
| **(f) Round labels and leads** | 467 deals (17%) round `unknown`; **lead unknown on 2,604 of 2,710 deals (96%)**: query rows have no lead column. FundingRounds: 22 of 140 name no lead. Cohort: 257 rounds with no lead, 78 stage unknown. Label mapping folds "Series B" through "Series E-2" and "Growth" into `series-b-plus`, and "Angel"/"Accelerator" into `pre-seed`. | Query rows; Cala's own labels ("Venture Round", "Crowdfunding"). | Show leads only from FundingRound `is_lead` or confirmed press; see the lead check below. |
| **(g) Coverage** | 48 of 99 listed investors had no round edges on the entity we hold; Antler's legal entity has 5 `INVESTED_IN`, the global "Antler" 60; deals start 2024-05 by design. Angels: Pepe Borrell is a Person `INVESTED_IN` Cala with a LinkedIn-only source; 1,358 cohort participants are names without ids (mostly angels). | Entity choice (b) and the ingest window. | Union the investor's sibling entities (same website) before listing rounds. |
| **(h) Source smear** | **4,154 of 9,988 relationship edges (42%)** in the cache cite only homepages: the document URL is cut to the site root. Cala's headquarters_address has 38 such sources, including a Seeking Alpha Ferrovial transcript. Companies House filing-history links are PDFs (SH01 allotments) that confirm a share issue, never a named round or investor. | Cala truncates documents to the domain on aggregated edges. | Filter treats homepage-only citations as no evidence. |

### Cross-query lead consistency

Cala's query answers vary between calls, and the lead is the least stable field. Tractable's 2017 Series A comes back in the cohort as led by "Entrepreneurs First"; an earlier probe with a different column set said "Ignition Partners". Press from 2017 says Ignition Partners led the $8M round, with Zetta. The cohort row is wrong (Entrepreneurs First backed Tractable's 2015 seed). Measured over the cache: 1,333 answers name a lead across 408 companies, but most companies were queried once, so only **10 claims could be cross-checked**. Of those, Lovable's Dec 2025 Series B is a real conflict: the FundingRound entity flags Accel as lead (`is_lead`), the query answer says CapitalG and Menlo Ventures. Matching answers to rounds needs date (±60 days), stage and the round's own label: a coarser year-and-stage match wrongly paired Ramp's Series B with its Series C and Monzo's crowdfunding with its Series D, and produced 85 false "conflicts" before it was fixed.

## 3. Verification filter (`lib/verify/`)

Each claim (a deal, a cohort round, or a founder, investor, round or headcount in the company file) gets:

```ts
trust: { level: "verified" | "corroborated" | "single_source" | "unverified" | "conflict",
         reasons: string[],
         checks: { sourceMentionsSubject?, sourceRank?, corroborations, entityConfidence?, dateSane, amountSane, leadAnswers? },
         fields?: { lead?: TrustLevel } }
```

Rules (`lib/verify/rules.ts`):

| Level | When |
|---|---|
| `verified` | a FILING source confirms it, or a PRIMARY source (the company or an investor) plus one more independent site. For a deal (this investor took part), the filing or primary page must name the investor: a Form D records the money, never who invested. |
| `corroborated` | 2+ independent sites (different registrable domains) confirm it |
| `single_source` | 1 site confirms it, or only an investor's profile page lists it |
| `unverified` | nothing confirms it: no source, a query row, homepage-only or LinkedIn-only citations, not checked yet, or synthetic fixture data |
| `conflict` | a cited page was read and does not name the company, and nothing confirms it. Never shown as fact. |

"Confirms" = the page (or the source's own title, as Cala returned it) names the company and, if the claim states them, the amount or one of the investors (founder claims: the person). Failed date or amount sanity, or an entity warning, caps the level at `single_source`. Lead field: another answer naming a different lead -> `fields.lead = "conflict"` (the round can still be shown, the lead is marked unverified); agreement -> `corroborated` and lifts a sourceless query row to `single_source`; no other answer -> `single_source` from FundingRound `is_lead`, `unverified` from query text.

Display rule (`showAsFact`): show `verified` and `corroborated` plainly; mark `single_source` and `unverified` as unconfirmed; never show `conflict` as fact.

Where it runs:
- `npm run verify-data` (`scripts/verify-data.ts`): title checks on every claim (free), page checks on a deterministic sample (Cala's own claims first), Haiku on borderline pages, Context.dev only for pages a plain fetch cannot read. Budgeted and incremental: pages and Haiku verdicts are cached in `data/verify-cache/` (gitignored), counters in `data/verify-cache/usage.json`. LinkedIn is never fetched. Writes `data/verify.json` (`trust` and `evidence` keyed by claim id) and Valkey `room:verify:v1`.
- Load time: `lib/verify/store.ts trustFor(claim)` reads `data/verify.json` at runtime (the build does not depend on it) and assesses any claim with no stored result from its own source titles. Hooks: `loadCohortTrust()` in `lib/cohort.ts` (trust by round id, for the simulator), `loadInvestorsWithTrust()` / `withDealTrust()` in `lib/verify/load.ts`, and `contextTrust(doc)`, which returns the facts-only company file plus an "unconfirmed" list. `GET /api/context/[id]` and `POST /api/context/build` now return `verification: { trust, unconfirmed }` next to the doc.

Current result (`data/verify.json`):

| Group | verified | corroborated | single_source | unverified | conflict |
|---|---|---|---|---|---|
| Cala company file (11 claims) | 7 | 0 | 1 | 3 | 0 |
| Deals from FundingRounds (120) | 5 | 6 | 9 | 99 | 1 |
| Deals from query rows (2,590) | 0 | 23 | 144 | 2,422 | 1 |
| Cohort rounds (1,128) | 0 | 4 | 25 | 1,098 | 1 |
| Lead field (918 claims with a lead) | 0 | 6 | 45 | 863 | 4 |

Most claims are `unverified` because nothing has been checked yet, not because they are wrong: the page check covers 90 claims. In the sample, 66 of 79 had at least one confirming page. Raising coverage is a budget question (plain fetches are free; PitchBook, Tracxn and Crunchbase block them).

## 4. Fixes, in order

1. **Done**: Cala's round date (`pickRoundDate` in lib/rounds.ts, used by the context doc and the round ingest); the filter and the company-file split.
2. Before the demo, show the company file through `contextTrust(doc).facts` and the unconfirmed list (the routes already return it); cite a confirming page for each founder instead of `bestSource`'s first URL (zonebourse).
3. Ingest: whole-word KnowBit matching, no edge sources on deals, write `datePrecision`, skip valuation/"expected" figures, website-first investor resolution.
4. Cohort ingest: per-row citations only when the cited page names the company; a second lead query (different column set) for the companies the demo shows, so the lead check has two answers.
5. Run `npm run verify-data -- --sample 300` for wider page coverage (about 400 free fetches; Haiku budget 60 per run).

## Spend

Cala: 0 live calls (every entity, round and query was a cache hit). Context.dev: 17 attempts of 40. Haiku: 44 of 60. Plain page fetches: 152 (free), plus 8 manual fetches and 6 web searches for Part 1.
