# How Room uses Cala

Base `https://api.cala.ai`, auth header `X-API-KEY`. Shapes confirmed against `https://api.cala.ai/openapi.json` on 14 Nov 2026. Client: `lib/cala.ts` (server-only, concurrency limit, exponential backoff on 429/5xx, disk cache for scripts, in-memory LRU for routes).

## Endpoints used

| Endpoint | Request | Response we read | Used by |
|---|---|---|---|
| `POST /v1/knowledge/query` | `{ "input": "<natural language or dot-notation>" }` | `results[]` (free-form rows, keys depend on the query) + `entities[]` (`id`, `name`, `entity_type`, `mentions[]`) | ingest: discovery, per-investor deals |
| `POST /v1/knowledge/search` | `{ "input": "...", "explainability": false }` | `content` (markdown answer), `context[]` (KnowBits with `origins[].document.{name,url}`), `entities[]` | ingest: stated thesis, partners, deal citations; `/api/cala/search` |
| `GET /v1/entities?name=&entity_types=` | query string, `entity_types` repeated | `entities[]` with `id`, `name`, `entity_type`, `description` | ingest: resolve names discovery did not link |
| `GET /v1/entities/{id}/introspection` | none | `properties[]`, `relationships.{outgoing,incoming}[]` | `scripts/introspect.ts` |
| `POST /v1/entities/{id}` | optional projection `{ properties: [...], relationships: { outgoing: { REL: { limit } }, incoming: {...} } }` | `properties.<name>.{value, sources[]}`, `relationships.<dir>.<REL>[]` each with `properties.sources[]` (`name`, `document` URL, `date`) | ingest (investor edges, people, website); ingest-rounds (FundingRound edges and entities) and ingest-events (Event participants), see "Entity graph" below; `/api/cala/entity/[id]` (coarse, no body) |

Not used: `POST /v1/entities/lookup` (needs an LEI/CIK/Companies House number).

## What introspection found (`npx tsx scripts/introspect.ts`)

| Fund | Entity used | Name variants in Cala | Outgoing relationships | Incoming |
|---|---|---|---|---|
| Seedcamp | Seedcamp Limited (Organization, `d2d11954-6bab-5ac9-8684-a54406623104`) | 19 (Seedcamp, SEEDCAMP GP LLP, SEEDCAMP III L.P., ... and the unrelated "Israeli SeedCamp") | INVESTED_IN, PARTICIPATES_IN_FUNDING_ROUND, PARTICIPATES_IN_CORPORATE_EVENT, IS_CONTROL_PERSON_OF, IS_BENEFICIARY_OWNER_OF | INVESTED_IN, IS_MEMBER_OF |
| LocalGlobe | LocalGlobe (Company, `1516c337-36cb-4357-ba0c-03b9c6c0d0e0`) | 2 | INVESTED_IN, PARTICIPATES_IN_FUNDING_ROUND, PARTICIPATES_IN_CORPORATE_EVENT, OPERATES_IN_INDUSTRY, HAS_PRESENCE_IN | INVESTED_IN, IS_MEMBER_OF |
| Balderton | Balderton Capital (Organization, `c96fa533-91c0-5674-bcbe-0d0dc934b7fa`) | 9 | INVESTED_IN, PARTICIPATES_IN_FUNDING_ROUND, PARTICIPATES_IN_CORPORATE_EVENT, OPERATES_IN_INDUSTRY, IS_CONTROL_PERSON_OF, IS_BENEFICIARY_OWNER_OF | INVESTED_IN |
| Index Ventures | Index Ventures (Company, `4a7ccd5d-1310-46b0-bd42-4ff8b409acc5`) | 19 | INVESTED_IN, PARTICIPATES_IN_FUNDING_ROUND, PARTICIPATES_IN_CORPORATE_EVENT, OPERATES_IN_INDUSTRY, IS_BENEFICIARY_OWNER_OF | **WORKS_AT** (Person: Danny Rimer, Bastian Hasslinger, ...), INVESTED_IN, DESIGNED_BY |
| Kindred Capital | KINDRED CAPITAL LLP (Company, `88163809-92cf-4df8-8ba8-92e82403a36b`) | 5 | INVESTED_IN, PARTICIPATES_IN_FUNDING_ROUND, PARTICIPATES_IN_CORPORATE_EVENT, HAS_HEADQUARTERS_IN, IS_REGISTERED_IN, IS_CONTROL_PERSON_OF, ... | IS_CONTROL_PERSON_OF (Companies House people), INVESTED_IN, OPERATED_BY |

Relationship semantics observed:
- `INVESTED_IN` (investor -> Company): portfolio company with per-edge `sources` (tracxn, press, fund blog), but **no round type, date or amount**. Seedcamp Limited has 55 edges; the bare "Seedcamp" Organization has 3. Which vehicle holds the edges varies, so the ingest picks the London-described Organization when several match.
- `PARTICIPATES_IN_CORPORATE_EVENT` (investor -> `PrivateCompanyFundingRound`, `role: INVESTOR`, `event_date`): the round entity has `round_type`, `event_date` and a description ("Arcane (AI). Round: Seed. Approximate date: 2023-07-15"), but reading it costs one retrieve per round. Too expensive for 200 investors.
- `PARTICIPATES_IN_FUNDING_ROUND` (investor -> `FundingRound` named "Seed", "Series A"): no company or date on the edge.
- People: `WORKS_AT` exists for some funds (Index); most funds only have Companies House control persons, which are not always partners.

## Ingest strategy (what actually worked)

Per investor, 3 Cala calls (4 if the name needs resolving):
1. `POST /v1/entities/{id}` projecting `name, description, website`, outgoing `INVESTED_IN` (limit 300) and incoming `WORKS_AT` (limit 25). Projecting a relationship an entity lacks returns empty, not an error.
2. `POST /v1/knowledge/query` with dot notation: `funding_rounds.investors=<Fund>.date>=2024-05-01.return(company, round_type, date, amount, sector).order_by=date DESC.limit=40`. One call returned 35 dated rounds for LocalGlobe and 23 for Seedcamp. Plain English ("funding rounds in 2025 where Seedcamp was an investor...") returned only 6 rows.
3. `POST /v1/knowledge/search` "What does <Fund> (London investor) say it invests in: which sectors, stages and cheque sizes? Who are its partners, and which startups has it backed since 2025?" gives the stated-thesis text, cited KnowBits and Person entity IDs.

Deal sources: a query row has no citations, so each deal gets (a) the `INVESTED_IN` edge sources for the same company, plus (b) the origins of search KnowBits that mention the company. Deals with neither are marked with a "Cala knowledge query" source (no URL) and keep `companyCalaId`, so the app can live-retrieve that company with `/api/cala/entity/[id]` for its sources.

Discovery: 14 `knowledge/query` variants (seed/pre-seed/Series A, sector-specific London VCs, angel networks, accelerators, CVCs, spinout funds) gave ~150 unique names; a name list of well-known London investors widens it to 201. Names are deduped with `investorKey` (strips legal suffixes, fund numerals, GP/LLP/holdings noise, and generic words like Ventures/Capital). The final build also drops a second record that resolves to the same Cala entity.

Normalisation (`lib/cala.ts`, tests in `tests/unit/cala.test.ts`):
- dates: "1 Oct 2025" exact; "Oct 2025" -> 15th, "Late 2025" -> 2025-10-01, "Q3 2025" -> mid-quarter, "2025" -> 2025-07-01, all flagged approximate;
- amounts: prefer the explicit USD figure ("$1.6M (EUR 1.3M)" -> 1.6M), else convert GBP x1.27, EUR x1.08;
- rounds: Pre-Seed/Angel -> pre-seed, Seed/Seed+/Pre-Series A -> seed, Series A -> series-a, Series B and later/Growth -> series-b-plus, "—"/Convertible -> unknown; Grant, Debt, IPO, M&A and "Non-Equity Assistance" are dropped as not venture deals.

Classification (Haiku `claude-haiku-4-5`, strict tool use): portfolio companies to the 18-sector taxonomy in batches of 40 (cached by company in `data/raw/sector-cache.json`), using the query's sector field and a snippet from the search context as hints; stated thesis text to sector and stage weights, with sector-agnostic funds getting no sector weights (so a generalist's long sector list never produces a fake contradiction).

## Entity graph: FundingRound

Following Cala's field guide (entity introspection then projected retrieval), `scripts/ingest-rounds.ts` rebuilds deal history from `FundingRound` entities. Measured on 14 Nov 2026; request shapes checked against `https://api.cala.ai/openapi.json` (relationship projections take `limit` up to 1000, and `offset`).

### Probe (12 calls)

| Investor (our `calaId`) | Introspection | Outgoing `PARTICIPATES_IN_FUNDING_ROUND` | `INVESTED_IN` |
|---|---|---|---|
| Zinc (`6e715493…`, a Companies House LLP) | no funding relationships at all; registry properties and mortgage metrics only | 0 | 0 |
| 4BIO Capital (`30b28644…`) | has both | 4 (Seed x2, Series A, Series B) | 3 |
| London Business Angels (`1c6aaf71…`) | no funding-round relationship | 0 | 1 |

What the investor -> round **edge** carries: the round's name ("Seed", "Series A"), `role` (`INVESTOR`), `is_lead: true` on led rounds only (absent otherwise), and `sources` (`document` URL, `date`, `date_precision`, sometimes `source_rank`). It carries **no** issuer, amount or event date.

What needs a **round retrieve** (1 call per round; FundingRound introspection lists `name, round_label, transaction_value, transaction_value_units, event_date, event_date__precision`, plus `instrument` and `announcement_date` where present, and only incoming `PARTICIPATES_IN_FUNDING_ROUND`): the issuer (participant with `role: ISSUER`), every other participant with `role` and `is_lead`, `round_label`, `transaction_value` + units and the date. One retrieve with `relationships.incoming.PARTICIPATES_IN_FUNDING_ROUND {limit: 50}` returns all of it, so a round fetched for one investor also yields the deal for every other investor of ours in that round.

Of the 129 rounds retrieved: 125 have an issuer, 127 a date (61 from `event_date`, the rest from `announcement_date`), 118 an amount, 105 name at least one lead, 107 carry a `source_rank` on their best source, 4 are non-equity (dropped). `event_date__precision` was never returned, so `datePrecision` is left unset everywhere.

`is_lead` semantics used: an investor is `isLead: true` when its participant edge says so, `false` when the round names some other lead, and unknown (field omitted) when no participant is flagged.

Filing-based financing events: the 99 listed investors have 834 outgoing `PARTICIPATES_IN_CORPORATE_EVENT` edges to `PrivateCompanyFundingRound` ("FINANCING_RAISED_OR_FACILITY_ENTERED", `role: INVESTOR`, `event_date` on the edge, tracxn/registry sources). The edge has no issuer or amount, so matching one to a FundingRound would cost a retrieve per event; none were retrieved. `lib/rounds.ts` `dedupeFinancings` (same issuer, dates within 45 days, amounts within 10%, else the same known round) runs over the FundingRound deals of each investor and is unit-tested for the filing case.

### Cost model (measured)

- Listing: 99 investors listed (the demo order: the replay pitch's top 15 first, then by score), 167 round edges, 133 of them `INVESTOR` with a source dated since 2024-05 (118 unique rounds). 48 of 99 listed investors have no round edges on the entity we hold.
- **Demo top 15** (replay pitch, `rankInvestors`): 15 list calls + 21 unique rounds = **36 calls**.
- **All 193**: 188 investors have a `calaId`; at the measured 1.19 unique rounds per listed investor that is 188 + ~224 = **~412 calls**, plus 5 entity searches for the investors without a `calaId`. Finishing the remaining 89 investors from here: ~89 + ~106 = ~195 calls (rounds already fetched are free).

### Run (14 Nov 2026)

- **300 successful Cala calls in total** for this branch (cap 400): FundingRound probe 12, Slush pages 3, round ingest 202 (99 investor lists + 103 rounds), event-participant investors 29 (16 retrieves with description + 13 led rounds), accelerator alumni probe 52, event metadata 2. Not billed and not counted as successes: 2 rejected `limit: 5000` requests (422) and 38 rate-limited attempts (429). The script's budget counts every attempt (`data/raw/rounds/usage.json`: 340).
- Rate limit: bursts of about 10 requests drew 429s that outlasted 3 retries; pacing requests 6-9 s apart at concurrency 1 ran mostly clean.
- Result: **120 deals from FundingRound entities on 48 investors** (42 replaced a knowledge-query deal for the same company and round, 78 are new; total deals 2,632 -> 2,710). 7 investors (Accel, Crane, Notion Capital, Plural, Point Nine, Salesforce Ventures, Systemiq Capital) got graph deals only from rounds fetched for another investor or event participant. **Lead status is known for 106 of 120 (88%); 46 were led.** 41 investors now carry `leadShare`.
- Best source per graph deal: 44 FILING (Companies House filing history), 41 PRIMARY, 17 PRESS, 1 AGGREGATOR, 17 unranked.
- Contradiction lines: 2 changed (Point Nine's counts grew; Entrepreneur First gained one with its 3 graph deals), so 13 investors now carry a line (was 12).
- Sectors: graph deals reuse the sector already classified for the same company (in `investors.json` or the ingest's sector cache). Haiku was unavailable (Anthropic account usage limit), so issuers with no earlier classification stay sector `other`, the ingest's documented fallback: 41 of the 120 graph deals (34 issuers, several plainly biotech by name, e.g. Atalanta Therapeutics) are `other`, and the dataset's `other` share went 4.1% -> 5.4%. Re-running `npm run ingest-rounds -- --merge` once Haiku is back classifies them with 0 Cala calls.

### Events (`scripts/ingest-events.ts --event <id>`)

Generic: any Cala `Event` id. Per event: introspection, one retrieve of its name and date properties, and incoming `PARTICIPATES_IN_EVENT` at `limit: 1000` per page with `offset`. Investors in the participant list (by Cala id, else a strict name match) get `events: [{ id, name, date, source }]`; the UI shows one neutral chip per event with the event's name. A name-matched participant is the same investor under another Cala entity, so `ingest-rounds` also counts that entity's rounds (`--event-investors` lists them).

Run so far: one event, Slush 2026 (`bc844d56-6ab4-452b-96bf-2661e86e592b`, `date` 2026-11-18): **2,989 participants in 3 calls**, all `Company` entities with `role: ATTENDEE` and one source (`Slush`, `https://slush.org/`, dated 2026-11-14). **2 of our 193 investors are participants:** EWOR (same entity id) and Point Nine (name match: participant "Point Nine Capital" is a different entity from the one we hold). The name fallback is deliberately narrow: it rejected "Form" for Form Ventures and "Techstars" for Techstars London.

Who the 2,989 Slush participants are (all `Company` entities; the edge carries only id, name, role and the slush.org source, so this is names first, then a retrieve with `description` for the candidates, 16 calls):
- Same entity id as one of our 193: **1** (EWOR). Name match to ours: **1** (Point Nine Capital, a separate entity from the Point Nine we hold; its rounds now count for our Point Nine).
- Named like an investor (capital, ventures, VC, partners, fund, angels, invest, accelerator): 16. By their Cala description, **3 are VC funds** (Point Nine Capital, Capnamic Ventures, Helsinki University Funds), 1 an accelerator (Atlas Accelerator, Norway), 1 a venture studio (Windhill Capital / Teyo Labs), 1 a platform for emerging fund managers (Plug Capital); the other 10 are startups with investor-sounding names (LTS Ventures is a Laos fintech, Pacer Ventures a sports app, Brickbro a property portal, Angel a Finnish search tool, Data Driven VC a newsletter).
- Known accelerators by name: Techstars (1, the global entity, not our Techstars London), EWOR. No Entrepreneur First, Antler, Seedcamp, Y Combinator, Founders Factory, Zinc or Conception X attendee.
- So **about 6 of 2,989 attendees are investors or accelerators**. Cala's Slush 2026 list is a startup list.
- Recent led rounds of the attendee funds: Point Nine Capital 6 led of 11 round edges (TesterArmy Seed $8M 2026-11, Tornyol Pre-Seed $3.5M 2025-09, Cardino Seed EUR 4M 2024-06, older OMNEA and SuperAnnotate); Capnamic 2 (Paebbl Series A EUR 22.8M 2024-10, yasp Seed $5M 2025-09); Helsinki University Funds 1 (Ferrivia EUR 50k 2026-06).
- The other direction is much denser and costs nothing: **65 of our 193 investors have a deal whose company (by Cala entity id) is a Slush 2026 attendee** (e.g. Northzone 5, Fuel Ventures 5, Ventures Together 5, Haatch 4, Plug and Play 4, Balderton 3, Earlybird 3, Lightspeed 3). Not built into the app; listed here for the headline decision.

### Accelerator alumni paths

Probe (`data/raw/alumni.ts`, raw output `data/raw/alumni.json`, both local): accelerator -> portfolio company -> the company's rounds -> the next equity round after the accelerator's cheque -> its lead, plus `FOUNDED` / `IS_CEO_OF` people. 52 calls (EF and Seedcamp 28, Antler 24; 9 more were cache hits).

Entities: Entrepreneur First has 20 name matches; the one we hold (`097cd5c6…`, Company) has 47 `INVESTED_IN` and 3 round participations, an `EducationalInstitution` "Entrepreneur First" (`77286430…`) has 14 `INVESTED_IN`, the C.I.C. and Operations Ltd have none. Seedcamp Limited (ours): 55 `INVESTED_IN`, 13 rounds. Antler: the entity we hold (ANTLER LIMITED, `839c988a…`) has 5 `INVESTED_IN` and no rounds; the global "Antler" (`d3b95646…`) has 60 `INVESTED_IN` and 34 round participations, ANTLER SA 50 and 2.

| Path (accelerator round -> next equity round, lead) | Founders found | Calls |
|---|---|---|
| EF -> AgileRL: Pre-Seed 2023-08 -> Seed 2026-01, $7.5M, led by Fusion Fund | 2 | 3 |
| EF -> Scarlet, Unitary, Magdrive, VFlowTech: no rounds in the graph | 1-2 each | 1 each |
| Seedcamp -> Permutation Labs (Dust): Seed 2023-06 -> Series A 2024-06, $16M, led by Sequoia Capital | 2 | 4 |
| Seedcamp -> Linkup: Pre-Seed 2024-11 (led by Seedcamp) -> Seed 2026-03, $10M, led by Gradient | 3 | 3 |
| Seedcamp -> Sunrise Robotics: Seed 2025-06 (led by Plural) -> Series A, no date, no lead | 3 | 3 |
| Seedcamp -> DaltonTx: Seed 2025-04 -> only a Gates Foundation grant (2026-10) | 4 | 3 |
| Seedcamp -> Verax AI: Seed 2024 only | 2 | 2 |
| Antler -> Two.inc: Series A 2023-03 (co-led with 747 Shine) -> Series B 2025-07, EUR 13M, led by IDEKAPITAL and 747 Shine (a EUR 150M debt facility in between is skipped) | 2 | 4 |
| Antler -> OTee: Pre-Seed 2024-02 -> Seed 2026-04, EUR 5.3M, led by North Ventures (a grant in between is skipped) | 2 | 4 |
| Antler -> QMill: Seed 2024-09 (with Maki.vc) -> grants only | 4 | 4 |
| Antler -> Voltrac, MultivisionDx: accelerator round only | 2 and 5 | 2 each |
| Antler (ANTLER LIMITED / first 5 INVESTED_IN of the other entities) -> Ad Auris, AlertMend, Aiden, AiCare, Aevy: no rounds | 0-2 | 1 each |

Coverage: of 20 companies, **5 have a later equity round with a named lead** (EF 1/5, Seedcamp 2/5, Antler 2/10). Picking companies from the accelerator's own FundingRound participations works far better than from `INVESTED_IN`: 4 of 10 vs 1 of 10, because an `INVESTED_IN` company often has no rounds in the graph. **Founders: 19 of 20 companies have at least one `FOUNDED` or `IS_CEO_OF` person** (1-5 distinct people; the same person often appears twice, as founder and CEO or from two sources). The next-round rule must skip grants and debt (the probe's first pass picked them; the table above applies the fix by hand).

Cost of a full build: about 3 calls per company (1 company retrieve with rounds and founders, then 1 per round of the company; plus 1 to name the issuer when starting from the accelerator's round). EF ~55 companies -> ~165 calls, Seedcamp ~41 -> ~125, Antler starting from its 34 rounds -> ~110: **~400 calls for the three**, before overlap with rounds already cached.

### Scoring use

A led round weighs `LEAD_WEIGHT = 1.5` against 1.0 for a joined or unknown one in the sector and stage distributions (`lib/revealed.ts`); `leadShare` (spec L_i) is led / lead-known over counted deals. Reasons gain a clause such as "led 2 fintech rounds since 2025" when the investor led counted rounds in the sector it shares with the pitch (narrowed to the founder's stage when any match). `scripts/refinalize.ts` reproduces every stored vector after the change (0 drift, 0 lines changed).

## Live use in the app

- `GET /api/cala/entity/[id]`: coarse `POST /v1/entities/{id}` (no body), returns properties and flattened `sources`; LRU-cached per server process.
- `POST /api/cala/search`: `knowledge/search` with `explainability: false`; returns `answer`, `sources` (from KnowBit origins) and entities; cached. Expect 20-60 s on a cold query, so the UI should show a loading state.
- Both return a labelled mock when `CALA_API_KEY` is unset or `E2E_MOCK=1`.

## Caveats

- Latency: `knowledge/query` and `knowledge/search` take 40-70 s each on a cold input. Entity retrieve and entity search take ~1 s.
- Rate limit: unpublished; ~15 quick calls in a row triggered `429 rate_limit_exceeded` that cleared after ~1 min. Responses carry no rate-limit or credit headers.
- Coverage: the query sometimes returns non-venture rows (grants, accelerator "non-equity assistance") and rows with "—" round type; some companies come back without a sector. Very broad discovery prompts return `{"error": "This question is too complex..."}` as a row.
- Fund vehicles: one fund is many entities (Seedcamp: 19 name matches). Edges live on different vehicles.
- Dates in the future month: a month-only date for the current month is pinned to the 15th, which can be a day or two ahead of today.

## Calls and coverage

Filled in from the final ingest log (`data/raw/ingest.log`):

Full run, 14 Nov 2026 (`--concurrency 4`; concurrency 6 hit sustained 429s, 3-4 is safe):
- 201 candidates -> 193 investors in `data/investors.json` (148 funds, 17 accelerators, 14 CVCs, 14 angel networks). 8 dropped: no matching Cala entity, or a second name for an entity already kept.
- 2,636 deals since May 2024: 100% dated (month- or year-only dates are pinned and approximate), 81% with a parsed USD amount, 82% with a known round type, 68% with at least one URL source (the rest carry the "Cala knowledge query" provenance plus `companyCalaId`). 4% of deals classify as sector `other`.
- 161 investors have 3+ dated deals in 24 months; 32 are `thinHistory`. 133 have at least one partner linked to a Cala Person entity. 53 carry a stated-vs-revealed contradiction line.
- Cala usage: ~725 successful calls in the ingest (150 knowledge/query + 150 knowledge/search + 147 entity retrieves + 108 entity searches in the main pass, 14 discovery queries, plus the 5-investor trial) and ~30 for probing and introspection. 155 requests were 429 retries. Haiku: one thesis call per investor plus sector batches of 40.

Real contradictions found (counted deals, from `contradictionLine`):
- Fuel Ventures: "Says seed; 12 of last 14 deals were pre-seed".
- London Business Angels: "Says seed; 9 of last 10 deals were pre-seed".
- Creator Fund (Creator Ventures): "Says pre-seed; 10 of last 17 deals were seed".
