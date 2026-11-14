# How Room uses Cala

Base `https://api.cala.ai`, auth header `X-API-KEY`. Shapes confirmed against `https://api.cala.ai/openapi.json` on 14 Nov 2026. Client: `lib/cala.ts` (server-only, concurrency limit, exponential backoff on 429/5xx, disk cache for scripts, in-memory LRU for routes).

## Endpoints used

| Endpoint | Request | Response we read | Used by |
|---|---|---|---|
| `POST /v1/knowledge/query` | `{ "input": "<natural language or dot-notation>" }` | `results[]` (free-form rows, keys depend on the query) + `entities[]` (`id`, `name`, `entity_type`, `mentions[]`) | ingest: discovery, per-investor deals |
| `POST /v1/knowledge/search` | `{ "input": "...", "explainability": false }` | `content` (markdown answer), `context[]` (KnowBits with `origins[].document.{name,url}`), `entities[]` | ingest: stated thesis, partners, deal citations; `/api/cala/search` |
| `GET /v1/entities?name=&entity_types=` | query string, `entity_types` repeated | `entities[]` with `id`, `name`, `entity_type`, `description` | ingest: resolve names discovery did not link |
| `GET /v1/entities/{id}/introspection` | none | `properties[]`, `relationships.{outgoing,incoming}[]` | `scripts/introspect.ts` |
| `POST /v1/entities/{id}` | optional projection `{ properties: [...], relationships: { outgoing: { REL: { limit } }, incoming: {...} } }` | `properties.<name>.{value, sources[]}`, `relationships.<dir>.<REL>[]` each with `properties.sources[]` (`name`, `document` URL, `date`) | ingest (investor edges, people, website); `/api/cala/entity/[id]` (coarse, no body) |

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
