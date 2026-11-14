# Cala challenge spec: Raise v2 (working name "Room")

Target: **Make Unicorns Real** (Cala, challenge 350). Judging is 25% each: real need, execution, originality, use of Cala (core, not an add-on). The Cala API or MCP must be core.
Built from scratch at Junction. We reuse the domain knowledge and the lessons from the original Raise (a London investor map plus a pitch matcher on mock Dealroom data). **No Raise code and no 8x code.**
Status: build-ready spec. An autonomous agent should be able to build the whole product from an empty folder using sections 0 and 12, with sections 1-11 as the product definition. Local only, not pushed.

## 0. Manual steps for Anson (do these first in the morning, in this order)

**Status (Sat 14 Nov, 05:45):** done: `ANTHROPIC_API_KEY` and `JEV_API_KEY` are in `.env.local` (Jev is not used by this project). In progress: Anson is creating the Cala account; `CALA_API_KEY` goes into `.env.local` next. Still to do: the 11:00 workshop answers, optional ElevenLabs key, optional Vercel login.

Everything is designed so the agent can build and test the whole product on fixtures and mocks first. Real keys drop into `.env.local` later; no code changes needed.

| # | Step | Where | Time | Env var | Build blocked without it? |
|---|---|---|---|---|---|
| 1 | Sign up for Cala, redeem the promo code from the Junction platform's Cala challenge page (console: Billing, Extra credits, Add credits, Add promo code; no card needed), create an API key | console.cala.ai | 5 min | `CALA_API_KEY` | No. The agent builds on `data/investors.fixture.json` (synthetic, labelled FIXTURE). The key is needed for the real ingest and for any submission claim about real data |
| 2 | Anthropic API key (existing account, or create one) | console.anthropic.com | 2 min | `ANTHROPIC_API_KEY` | No. The keyword fallback extractor drives the graph without it; the LLM extractor and ingest classification need it for the real demo |
| 3 | Go to the Cala workshop (Sat 11:00, Loft, 4th floor) with section 11 printed; write the answers into section 11's "Answer" column | In person | 30 min | none | No, but the ingest strategy (section 5.1 step 4 vs fallback ladder) depends on it |
| 4 | Optional: ElevenLabs key via the MLH code at mlh.link/junction-26 | elevenlabs.io | 5 min | `ELEVENLABS_API_KEY` | No. Browser Web Speech API (Chrome) is the default live transcription |
| 5 | Optional: record the 60 s demo pitch in your own voice (a rehearsed biotech pitch, script in `data/replay/demo-pitch.script.md` written by the agent) | Phone or laptop mic, save as `data/replay/demo-pitch.webm` | 10 min | none | No. Replay mode works from the text timeline alone; audio makes the video better |
| 6 | Optional: `vercel login` once, then the agent deploys with `vercel --prod` | Terminal | 2 min | none | No. The demo runs locally; deploy only for a public link |
| 7 | Collect 3 founder quotes and 1-2 investor quotes (section 2) and paste them into `data/quotes.json` | At Junction, Sat afternoon | 30 min | none | No. Deck placeholders stay bracketed until filled |

No database, no Supabase, no other accounts.

## 1. One-line pitch

Say your pitch out loud, and watch London's investors sort themselves around you in real time. They're ranked by **what they actually invested in**, not what their websites claim, with the easiest door into each one. Interested investors ask to meet you, and the best fits meet in a small curated room.

## 2. Problem

**Founders.** Raising in London runs on networks. First-time and student founders send cold emails to long lists of investors who were never a fit.
- Every number below is a placeholder until we collect it at Junction.
- Placeholders: outreach volume per raise `[N emails per raise]`, reply rate `[x%]`, time spent `[__ hours]`.

**Investors.** Partners spend first meetings on founders who don't fit their stage or sector, and their inboxes fill with cold pitches. A VC's feedback on the original Raise: "double down on events, because talking to real people is the best way" (the logic behind EF selection days).
- Placeholder: `[share of first meetings that are wrong-fit]`.

**Stated vs revealed thesis.** Fund websites describe a thesis. Their recent deals often say something else. A founder who targets the website's thesis wastes the first contact.
- Placeholder: `[one real example from Cala data, e.g. "says pre-seed, N of last M deals were Series A"]`, filled only from real query results.

**Quotes to collect at Junction** (Sat afternoon; name and role, with consent):
1. 3 founders: "How many investors did you contact last raise, and how many replied?"
2. 1-2 investors, mentors or judges: "What share of your first meetings are a wrong fit?"
3. 1 accelerator person (EF, EWOR or similar, if present): "What do founders get wrong about your stage?"

No invented statistics anywhere in the deck or video.

## 3. Users and jobs

| User | Job to be done | What they get |
|---|---|---|
| Founder (pre-seed to seed, London) | "Find the 10 investors who actually back companies like mine, and the easiest way into each" | Live ranked matches with reasons and evidence, an easiest-door plan per investor, meet requests from interested investors, and a seat request for a curated room |
| Investor (partner, scout, programme lead) | "Only meet founders who fit what I actually invest in" | A feed of founders matched to their revealed thesis; group, sort and filter; one-tap interest; suggested themed rooms when a cluster is big enough |
| Room host (us, at first) | "Fill a room of 6 founders and 3 investors where every pairing makes sense" | A room builder that proposes a lineup and collects a debrief afterwards |

## 4. Features

Classification: **IN** = built and live in the demo. **MOCK** = a real screen with seeded or local-only data. **OUT** = pitch and roadmap only.

| # | Feature | Class | Design notes |
|---|---|---|---|
| F1 | Live pitch capture | IN | Mic in the browser. Default: browser Web Speech API (Chrome, interim results on). Upgrade: ElevenLabs realtime speech-to-text when `ELEVENLABS_API_KEY` is set (a server route mints a short-lived token; check the current ElevenLabs realtime STT docs at build time). Last resort: replay mode (F17). The transcript scrolls in the right rail |
| F2 | Rolling feature extraction | IN | Every ~3 s, or on sentence end, the new transcript chunk plus the running profile go to `claude-haiku-4-5` with a strict JSON schema: `sectors[]` (taxonomy below), `stage`, `raise_amount`, `traction{revenue, users, growth}`, `team_signals[]`, `geography`, `business_model`, each with a confidence. Merged into the running profile, never overwritten wholesale. A keyword fallback extractor (`lib/fallbackExtract.ts`) produces the same shape offline |
| F3 | Investor universe | IN | ~200 London investors (funds, angel networks, accelerators, CVCs) pulled from Cala once by `scripts/ingest.ts` and cached to `data/investors.json` (committed). Each has a profile plus a revealed-thesis vector. Until the real ingest runs, `data/investors.fixture.json` stands in |
| F4 | Revealed thesis | IN | Per investor: distribution of last 24 months of deals by sector, stage and cheque size, each deal with its source. Stated thesis from Cala's description or knowledge_search over the fund. A **contradiction badge** shows when the two disagree past a threshold |
| F5 | Live force graph | IN | Canvas force-directed graph (`react-force-graph-2d`). Founder node fixed at the centre, investors free. Match score sets the radial target, sector sets the angle; clusters form by sector. Details in 5.5 |
| F6 | Match cards | IN | Top 10 beside the graph: score out of 100, a one-line reason, 2-3 evidence chips (portfolio company, round, date, source link), contradiction badge where relevant |
| F7 | Evidence edges | IN | Hover or select an investor: lines to the actual portfolio companies that drive the match, labelled with round and year |
| F8 | Easiest door | IN (rules) | Per investor, cheapest route in, in order: open application or programme (EF for pre-idea, EWOR for revenue stage, etc.), office hours, scout, warm-intro path via Cala people relationships, then "ask to be considered for a room". Programme facts hand-curated for ~20 London programmes in `data/programmes.json` with source links and a checked-on date. No cold-email door: founders reach investors through doors, rooms or investor interest (F14) |
| F9 | Investor profile panel | IN | Fund, partners (Cala Person entities), recent deals with sources, stated vs revealed thesis, LinkedIn link if known (link only, never scraped) |
| F10 | Investor view: founder feed | IN (seeded) | Same engine in reverse: given a selected investor, rank the founder pool by fit to their revealed thesis. Pool: ~40 synthetic founder profiles (`data/founders.seed.json`, labelled seeded) plus the live demo pitch. Group by sector or stage, sort by fit, filter by traction |
| F11 | Room suggestion | IN (seeded) | When an investor's matched founder cluster in one sector reaches a threshold (default 12), suggest a themed room: "14 matched founders in biotech: host a biotech room". Room builder proposes 6 founders and 3 investors by maximising pairwise fit |
| F12 | Room page and seat request | MOCK | Room page: lineup, date, venue placeholder. Founders press "Request a seat"; state per 4.1 |
| F13 | Post-room debrief | MOCK, data path designed | 3 questions per pairing: "Fit? (yes/maybe/no)", "Would you meet again?", "One tag: stage / sector / team / traction / timing". Used as a small learned score adjustment (5.4). Seeded debriefs, labelled as seeded |
| F14 | Interest and verified chat | IN (state machine, verification checks, request inbox); MOCK (chat persistence is local to the browser) | Investor-initiated double opt-in. Design in 4.1 |
| F15 | Accounts, payments | OUT | Roadmap only. The demo uses a role switcher (Founder / Investor) instead of login |
| F16 | Founder progress tracking over time | OUT | Roadmap only; it comes from debriefs and repeat pitches |
| F17 | Replay mode | IN | A recorded pitch as a timeline of transcript tokens and extractor outputs (`data/replay/demo-pitch.json`), optionally with audio. One keypress (`R`) or a button plays it with visuals identical to live. The demo and e2e tests depend on it |

The in-platform call with live transcription is **removed**: it duplicated F1's live-transcription moment, needed two live people on stage, used no Cala data, cost 6-8 build hours and raised consent questions about recording investor calls. F14 covers "show interest and start talking" at a fraction of the cost.

**Sector taxonomy** (fixed, 18 labels, so the extractor and the investor vectors share one space): AI infrastructure, applied AI/vertical SaaS, fintech, insurtech, healthtech, biotech/therapeutics, medtech/devices, climate/energy, mobility, proptech, consumer, marketplaces, edtech, developer tools, cybersecurity, deep tech/hardware, B2B SaaS (other), crypto/web3. Plus `other` for off-taxonomy pitches.
**Stage labels:** pre-idea, pre-seed, seed, Series A, Series B+.

### 4.1 Interest mechanism (F14 and F12)

**Chosen pattern: investor-initiated double opt-in, gated by verification, with one founder-side lever (a capped room-seat request).**

Why: if founders can initiate contact, the product becomes another cold-pitch firehose and investors leave, which kills the founder side too. If the investor initiates, every request is pre-qualified by revealed-thesis fit and costs the investor one tap. Founders keep agency through accepting or declining and through one seat request per room, which feeds the room format the VC told us to double down on. Verification on both sides stops fake investors fishing for decks and fake founders spamming rooms, and it demos well as two badges and a lock that opens.

**Verification prerequisites (checked before chat unlocks):**

| Side | Check | Class |
|---|---|---|
| Investor | Their name matches a Cala `Person` entity linked to the fund in `investors.json` partners (real check against cached Cala data), plus a fund-domain email (format check only in the demo) | IN for the Cala match; MOCK for email verification |
| Founder | Company website or LinkedIn URL provided, plus a company-domain email (format check only in the demo). Optionally the company resolves to a Cala entity (shows "found on Cala") | MOCK for email; IN for the optional Cala lookup |

**Interest states (one record per investor-founder pair):**

```
none
  -> interested        (investor taps "Interested" on a founder card in the investor feed)
  -> accepted          (founder accepts in the request inbox)
       -> chat_open    (automatic when both sides pass verification)
       -> pending_verification (if either side has not passed; shows what is missing)
  -> declined          (founder declines; investor sees "not now", no reason required)
  -> expired           (14 days with no founder response)
```

**Seat request states (one per founder per room):** `none -> requested -> seated | waitlisted`. A founder can hold at most one open seat request at a time. The room host (investor view or admin) seats or waitlists.

**Rules:**
- An investor can have at most 10 open `interested` requests at once, so interest stays a meaningful signal.
- A founder sees, for each request, the investor's revealed-thesis evidence ("backed 3 pre-seed therapeutics companies since 2025") before accepting. The match evidence is the reason to say yes.
- Declines are silent to third parties and never affect scores.

**UI:**
- Investor feed card: an "Interested" button, disabled with a tooltip when the cap is reached.
- Founder view: a request inbox badge on the top bar; each request shows the investor card, the evidence chips, and Accept / Decline.
- After accept: verification checklist with two ticks (yours, theirs); when both tick, the lock icon opens and a chat thread appears with a suggested first message drafted from the match reason (the founder edits before sending).
- Room page: "Request a seat" button with the one-open-request rule.

**Data model** (stored in the browser's localStorage in the demo; syncs between two windows of the same browser through the `storage` event, so a two-window demo shows the request arriving live):

```ts
type Interest = { id: string; investorId: string; founderId: string; state: "interested" | "accepted" | "pending_verification" | "chat_open" | "declined" | "expired"; createdAt: string; updatedAt: string };
type Verification = { subjectId: string; side: "investor" | "founder"; checks: { name: string; passed: boolean; detail?: string }[] };
type Message = { interestId: string; from: "investor" | "founder"; text: string; at: string };
type SeatRequest = { roomId: string; founderId: string; state: "requested" | "seated" | "waitlisted"; at: string };
```

debt: interest, verification and chat state live in localStorage. ceiling: single browser, no real multi-user. upgrade: when there are real accounts, move these four types to a hosted Postgres table each.

## 5. Architecture and data flow

```
[Once, before demo] Cala API --> scripts/ingest.ts --> data/investors.json (cached, ~200 records, committed)
[Live loop]         mic --> STT stream --> transcript chunks --> /api/extract (Haiku, JSON)
                       --> running founder profile --> scorer (pure maths, in browser)
                       --> graph targets (radius, angle) --> force simulation --> render
[Replay]            data/replay/demo-pitch.json --> same profile updates on a timeline --> same render
[Investor view]     investor revealed vector --> scorer over founder pool --> feed / room builder / interest
```

All keys stay server-side: `/api/extract`, `/api/cala/*` and `/api/stt-token` are Next.js route handlers. No key reaches the browser.

### 5.1 Ingest (Cala, run once, before the demo)

Base `https://api.cala.ai`, header `X-API-KEY`. The MCP server is `https://api.cala.ai/mcp/`, with tools knowledge_search, knowledge_query, entity_search, entity_introspection and entity_retrieval. Confirm each request shape against `https://api.cala.ai/openapi.json` before writing the client.

| Step | Call | Purpose |
|---|---|---|
| 1 | `POST /v1/knowledge/query` with natural language, e.g. "venture capital firms headquartered in London investing in seed stage startups", plus Cala QL variants once the schema is known | Candidate investor list as typed rows plus matching entities |
| 2 | `GET /v1/entities?name=<fund>&entity_types=Company&entity_types=Organization` | Resolve each candidate to a Cala entity ID |
| 3 | entity_introspection on 3-5 known funds (`scripts/introspect.ts`) | **Discover which relationship types exist** for investors and funding rounds. Documented relationship names include `OPERATES_IN_INDUSTRY`, `PARTICIPATES_IN_CORPORATE_EVENT`, `IS_BOARD_MEMBER_OF`, `IS_CEO_OF`; investor-to-round links are not shown in the docs |
| 4 | `POST /v1/entities/{id}` with a projection of `properties` plus the investment relationships found in step 3, with limits | Per-investor deals: portfolio company, round type, date, amount, with `sources` per field |
| 5 | `POST /v1/knowledge/query` per investor, e.g. "funding rounds where <fund> participated since 2024 with round type, sector, amount, date" | Fallback or cross-check if step 4 lacks investor-round relationships |
| 6 | `POST /v1/knowledge/search` per investor: "What does <fund> say it invests in?" | Stated thesis text with citations |
| 7 | `POST /v1/entities/{id}` for partner Person entities | Partner names and roles for profiles, warm-intro paths and investor verification (4.1) |

Entity types relevant here (documented enum): `Company`, `Organization`, `Person`, `PrivateCompanyFundingRound`, `FundingRound`, `FundingRoundTranche`, `Industry`, `CorporateEvent`. There is **no `Investor` type**; investors are Company or Organization entities.

**Credit plan:** ~200 investors × (1 search + 1 retrieve + 1-2 queries + 1 knowledge_search) ≈ 800-1,000 calls for the full ingest. Run once, cache, never call Cala in the live loop. Rate limits exist (429 `rate_limit_exceeded`) but numbers aren't published, so ingest runs with concurrency 4, exponential backoff, and resumes from `data/.ingest-checkpoint.json`.

**Live Cala use** (so Cala visibly powers the product):
- clicking an investor or portfolio company runs a live `retrieve_entity` through `/api/cala/entity/[id]` and shows its sources;
- the "why this match" panel can call `knowledge_search` for a fresh, cited summary; cached after first call;
- investor verification (4.1) checks against Cala partner data.

### 5.2 Revealed-thesis vector

For investor *i*, over deals in the last 24 months, with weight decay (half-life 12 months):
- `S_i`: sector distribution over the 18-label taxonomy, normalised.
- `G_i`: stage distribution over the 5 labels.
- `C_i`: cheque or round-size band (median and interquartile range of rounds participated in).
- `A_i`: activity, deals in the last 12 months, log-scaled to 0..1.
- `L_i`: lead share, if Cala marks the lead investor. Optional.
- `D_i`: stated thesis mapped to the same sector and stage labels (Haiku classification of the knowledge_search text, once at ingest).

**Contradiction score** = total variation distance between `D_i` and revealed `(S_i, G_i)`. Badge when > 0.4, with an auto-generated line such as "Says pre-seed; 9 of last 14 deals were Series A", built only from counted deals.

Mapping a Cala deal's sector to the taxonomy: Haiku classification of the portfolio company's description and industry, once at ingest, cached.

### 5.3 Scoring (pure function, in the browser, on every profile update)

```
score(f, i) = 100 * ( 0.40 * sectorFit + 0.30 * stageFit + 0.15 * chequeFit + 0.10 * activity + 0.05 * debriefAdj )
sectorFit   = sum over sectors s of f.sector_weight[s] * S_i[s]      (founder weights sum to 1)
stageFit    = G_i[f.stage], softened: 0.5 * G_i[adjacent stages]
chequeFit   = 1 if f.raise in C_i IQR, decays linearly to 0 at 3x outside
activity    = A_i
debriefAdj  = 5.4, 0.5 neutral when no data
```

Each field is multiplied by its extraction confidence, so a half-heard stage moves nodes less than a clearly stated one. Unknown founder fields contribute 0.5 of their weight (neutral), so the graph does not collapse before the founder mentions them.

**Change from the original Raise:** revealed deals now drive sector and stage fit; in Raise, they came from the stated profile and activity was only 5%.

**Reasons:** for each top-10 match, the top 2 contributing terms become the reason line. Evidence chips are the 2-3 deals with the highest contribution to `sectorFit` and `stageFit`.

### 5.4 Debrief adjustment (designed, seeded in the demo)

Per investor, a Beta prior on "fit = yes", updated by debriefs: yes = 1, maybe = 0.5, no = 0. `debriefAdj` is the posterior mean. Repeated tags shift weighting per investor; e.g. repeated "stage" tags raise that investor's stage weight from 0.30 to 0.35 (sector drops to 0.35). Labelled "learning from N debriefs (seeded)".

### 5.5 Graph physics (score to position)

- **Founder node:** fixed at (0, 0), larger, glowing.
- **Radial target:** `r_i = R_max * (1 - score/100)^1.3`. Custom radial force, strength 0.08.
- **Angular target:** each sector owns an arc, ordered so related sectors are adjacent (biotech, medtech, healthtech together). An investor's angle is the weighted mean of its sector angles; weak tangential force, strength 0.03. That makes clusters form.
- **Collision force** keeps nodes apart; charge weak and negative.
- **Updates:** on each profile update, only target radii change; the simulation reheats with alpha 0.3, giving a ~600 ms drift, not a jump.
- **Top 10:** brighter fill, label shown, thin connector to the centre with opacity following the score.
- **Sector halo:** when ≥5 investors from one sector are inside 0.35 × R_max, a soft labelled halo fades in ("Biotech, 7 investors").

### 5.6 Latency budget (live loop)

| Stage | Budget | Notes |
|---|---|---|
| Speech to partial transcript | 300-700 ms | Web Speech or ElevenLabs partials |
| Chunk boundary | ≤3 s | Extract on sentence end or every 3 s |
| Extractor LLM | 400-900 ms | Haiku, strict JSON, ~300 input tokens of new chunk plus a compact running profile, ~150 output tokens. One in flight; a new chunk replaces any queued one |
| Keyword fallback | <5 ms | Runs on every partial transcript in parallel, so chips and the graph react even before the LLM returns; the LLM result overrides it |
| Merge + score 200 investors | <5 ms | Browser |
| Graph re-target and settle | ~600 ms animation | Perceived response starts immediately |
| **Speech to visible movement** | **~1-2.5 s** | |

## 6. Visual design

**Direction:** dark observatory. Near-black blue background (`#0B0E17`), investor nodes as small luminous points coloured by sector, the founder as a warm white core. Thin, low-opacity edges. One accent (`#FF6A3D`) reserved for "this is about you": top-match labels, the contradiction badge, selected evidence edges and the interest request badge.

- **Type:** one geometric sans for UI (Inter or Host Grotesk), one monospace for numbers and live transcript tokens.
- **Layout (16:9):** graph fills the left ~68%. The right rail stacks the live transcript (newest words highlighted), the extracted profile chips (each fades in when first detected) and the top-10 list. Top bar: role switcher (Founder / Investor), request inbox badge, Replay button.
- **Motion rules:** nothing moves without a cause in the transcript; each new sector chip flashes once and its cluster is pulled inward over 600 ms; cubic-out easing; idle is a barely visible drift; reduced-motion mode snaps.
- **Investor view:** same canvas inverted; the selected investor sits at the centre and founders orbit. Group-by draws halos; the room suggestion card pulses once; "Interested" buttons on founder cards.
- **Interest moment:** in a two-window demo, the investor taps "Interested" and the founder window's inbox badge pulses within a second; accepting shows both verification ticks landing, then the lock opening.
- **Accessibility:** the top-10 list duplicates everything the graph shows; labels carry the sector name, so colour is never the only signal.

## 7. Demo choreography

### 7.1 Two-minute submission video

| Time | Screen | Voiceover / action |
|---|---|---|
| 0:00-0:10 | Black, then 200 dim points fade in | "Every investor in London. Ranked by what they did, not what they say." |
| 0:10-0:20 | Founder hits record | A founder pitch starts (pre-recorded, ~60 s, biotech example) |
| 0:20-0:50 | Words stream on the right. On "therapeutics" the biotech chip appears and the biotech cluster swings inward. On "pre-seed" the stage chip appears and later-stage funds drift out | Silent; the motion carries it |
| 0:50-1:05 | Graph settles, halo "Biotech, 7 investors" | "Ten matches. Every one backed by real deals." |
| 1:05-1:15 | Click top match: evidence edges light up to 3 portfolio companies with round and year; source links visible | "Three pre-seed therapeutics deals in the last 18 months, sourced from Cala." |
| 1:15-1:25 | Contradiction badge on another fund | "This one says pre-seed. Its last 14 deals say Series A." |
| 1:25-1:35 | Easiest-door panel | "And the easiest way in, for each one." |
| 1:35-1:50 | Split screen, investor view: founder halos, room suggestion, tap "Interested"; founder window: request arrives, accept, both verified, chat unlocks | "Investors only reach out when the fit is real. Both sides verified, then you talk, or you meet in the room." |
| 1:50-2:00 | Logo plus "Built on Cala" | End |

### 7.2 Live three-minute pitch (peer review and stage)

1. **0:00-0:30** The problem in one sentence each for founders and investors. One real quote collected at Junction.
2. **0:30-1:40** **Live**: a teammate pitches into the mic, or a judge volunteers a one-line idea. The graph reacts on stage. Fallback: Replay (`R`), always one keypress away.
3. **1:40-2:10** Evidence, contradiction, easiest door.
4. **2:10-2:40** Investor view, room suggestion, interest request arriving in the second window. Origin story: "A VC told us the value is the room."
5. **2:40-3:00** Why Cala: revealed thesis needs typed, sourced deal data. Close.

## 8. Data model (JSON files)

```ts
type Sector = string; // one of the 18 taxonomy labels or "other"
type Stage = "pre-idea" | "pre-seed" | "seed" | "series-a" | "series-b-plus";
type Investor = {
  id: string; calaId: string; name: string; kind: "fund" | "angel_network" | "accelerator" | "cvc";
  statedThesis: { text: string; sectors: Record<Sector, number>; stages: Record<Stage, number>; sources: Source[] };
  deals: Deal[];
  revealed: { S: Record<Sector, number>; G: Record<Stage, number>; chequeBand: [number, number]; activity: number; leadShare?: number };
  contradiction: number;
  thinHistory: boolean;
  partners: { calaId: string; name: string; role?: string; linkedinUrl?: string }[];
  doors: { kind: "programme" | "office_hours" | "scout" | "warm_intro" | "room"; label: string; url?: string; via?: string[] }[];
  fixture?: true;
};
type Deal = { company: string; companyCalaId?: string; round: Stage | "unknown"; date?: string; amount?: string; sector: Sector; sources: Source[] };
type Source = { name: string; url?: string; date?: string };
type FounderProfile = { id: string; name?: string; sectors: Record<Sector, number>; stage?: Stage; raise?: number; traction?: { revenue?: string; users?: string; growth?: string }; teamSignals: string[]; confidence: Record<string, number>; website?: string; seeded?: true };
type Debrief = { roomId: string; founderId: string; investorId: string; fit: "yes" | "maybe" | "no"; again: boolean; tag: "stage" | "sector" | "team" | "traction" | "timing"; seeded: boolean };
type ReplayEvent = { t: number; kind: "transcript" | "profile"; text?: string; profile?: Partial<FounderProfile> };
```

Interest types are in 4.1.

## 9. Stress test

Each attack is followed by the fix that is now part of this spec.

### 9.1 Demo failure modes

| Attack | Fix |
|---|---|
| Venue wifi dies mid-pitch | Investor cache is local JSON; scoring runs in the browser; the keyword fallback extractor runs offline. Replay mode (F17) reproduces the demo with no network. Practise switching to it |
| STT mishears jargon ("CRISPR" heard as "crisper") | Extractor prompt includes the taxonomy and tolerates misspellings; the keyword fallback has synonym lists; rehearsed pitch; replay backstop |
| Extractor latency spikes | One request in flight; newest chunk replaces queued; keyword fallback moves the graph meanwhile; a "listening" pulse covers gaps |
| Graph looks like a hairball | Edges hidden by default; only top-10 connectors and selected evidence edges render |
| Judge pitches off-taxonomy ("defence tech") | Nearest label plus `other`; graph still moves on stage and cheque; cards say "sector unclear, matched on stage" |
| Web Speech unavailable (not Chrome) | Demo laptop runs Chrome; ElevenLabs if keyed; replay otherwise |

### 9.2 Data risks

| Attack | Fix |
|---|---|
| Cala has no investor-to-round links for London seed deals | **Open question 1.** Fallback ladder: (a) knowledge_query for rounds by company and participant; (b) query `PrivateCompanyFundingRound` entities for London startups and read their participants; (c) shrink to the investors with usable history and say so. Never fake revealed data; mark low-data investors `thinHistory` and weight their stated thesis |
| Round type or date often null | Unknown-stage deals count toward sector only; card confidence follows the share of complete deals |
| Stated-thesis text missing | No contradiction badge for that investor; never invent one |
| Cold start: no debriefs | `debriefAdj` neutral 0.5 at 5% weight |
| Sparse investors drift to the edge unfairly | Activity is only 10%; thin-history investors keep stated-thesis sector fit, flagged on the card |
| Fixture data mistaken for real in the submission | Fixture records carry `fixture: true`; the UI shows a "FIXTURE DATA" banner whenever any fixture record is loaded; the done-when list requires the banner to be gone |

### 9.3 Interest mechanism (F14)

| Attack | Fix |
|---|---|
| "Why can't founders message investors? That's the founder's main job" | Founders reach investors through easiest doors (programmes, office hours, warm intros) and through room seat requests; in-app, the investor initiates so every request is pre-qualified by revealed fit. Investors stay on the platform, which is what keeps it valuable for founders |
| Fake investor fishing for decks | Chat unlocks only after the investor matches a Cala partner record for the fund; unverified investors see "pending verification" and get no founder contact details |
| Founder spam via seat requests | One open seat request per founder; the room host curates |
| Investor spams "Interested" | Cap of 10 open requests per investor |
| Demo needs two people | Two browser windows, one per role, synced through localStorage `storage` events; one presenter can drive both |
| State lost on reload or between devices | Accepted for the demo (debt marker in 4.1); state persists in localStorage across reloads in the same browser |
| Judge asks "is the chat real?" | Honest answer: messages are local in the prototype; the gate (verification plus double opt-in) is the product, the transport is commodity |

### 9.4 Judge questions

| Question | Answer built into the product |
|---|---|
| "Isn't this Dealroom or Crunchbase?" | Those are databases you search. This listens to your pitch, ranks by revealed behaviour with sources, gives the easiest door, gates contact by real fit, and runs the room. Cala supplies typed, cited data an agent can use directly |
| "Why is Cala core?" | The score, evidence edges, contradiction badge and investor verification all come from Cala entities and relationships; profile panels make live Cala calls. Without Cala there is no product |
| "How do you retain users?" | Founders return for rooms and re-pitch as traction changes; investors get a weekly matched feed and interest requests; debriefs improve matching for both |
| "Bias: does this send everyone to the same famous funds?" | Score is fit, not prestige: no brand or fund-size term. Only pitch content is extracted; no name, school, gender or nationality fields are scored. Thin-history investors get a stated-thesis fallback |
| "How do you make money?" | Ranking never changes with payment. Investor-side subscription for the matched feed, interest requests and room seats; free for founders |
| "What about privacy?" | Pitch audio isn't stored. Transcripts stay in the session unless the founder opts in to the founder pool. Investor data is public and sourced. LinkedIn linked, never scraped |
| "Does it work beyond London?" | Ingest is parameterised by city; London first because density makes rooms possible |

### 9.5 Scope risks

| Attack | Fix |
|---|---|
| Two-sided means two products in 28 hours | One engine, both directions; the investor view reuses the graph component with a different centre |
| Polishing the graph eats all the hours | Polish is after the definition of done (12.6) is met; replay and the top-10 list must work first |
| Programme facts (EF, EWOR) go stale or are wrong | ~20 hand-curated with source link and checked-on date; cards link out |
| Interest feature sprawls into a messaging product | Fixed scope: state machine, two checks per side, inbox, one thread with a drafted first message. No notifications, attachments or read receipts |

## 10. Hosting and accounts

- Local demo: `npm run dev` on the demo laptop (Chrome).
- Public link: Vercel, one project, framework preset Next.js. Env vars set in the Vercel dashboard or `vercel env add`. Hobby plan is enough.
- No database. No Supabase: all product data is committed JSON or browser localStorage (4.1 debt marker).

## 11. Open questions for the Cala workshop (Sat 11:00, Loft, 4th floor)

| # | Question | Why it matters | Fallback if "no" | Answer |
|---|---|---|---|---|
| 1 | Can we get, per London investor, the funding rounds they participated in, with round type, date and amount? Which relationship name links an investor to a round? | Revealed thesis is the core | Ladder in 9.2 | **YES (probed Sat 05:55).** Seedcamp (Organization `aa87dde8-7dc3-4fc0-957f-143da6ddc0b7`) has outgoing `INVESTED_IN` and `PARTICIPATES_IN_CORPORATE_EVENT` relationships; it has only id, name and description as properties. `POST /v1/knowledge/query` with plain English ("funding rounds in 2025 where Seedcamp was an investor, with company, round type, date and amount") returned 6 rows: company, round_type (Pre-Seed/Seed/Series A/B), date, amount, plus linked company entity IDs. Caveats: dates and amounts are free-text strings ("Late 2025", "~$2.7M", "$1.6M (EUR 1.3M)"), so normalise them; one fund has several entities (Seedcamp has 6+ name variants), so dedupe; a single query may not return every round, so page or ask per year. Auth header: `X-API-KEY`. |
| 2 | Is lead vs follow-on marked? | Lead share is a fit signal | Drop `L_i` | |
| 3 | Coverage of UK pre-seed and seed rounds and angel networks? | Our users are early-stage | Add accelerators from `programmes.json`; label thin coverage | |
| 4 | Are partner Person entities linked to funds? Co-board or co-investment links usable for warm intros? | Profiles, warm-intro doors, investor verification | Partners from knowledge_search text with citations; verification by fund-domain email only | |
| 5 | Rate limits and best way to bulk-pull ~200 investors? | Ingest plan | Concurrency 2, overnight ingest | |
| 6 | MCP server or REST API preferred; does showing Cala QL count toward "Cala core"? | Judging framing | REST in the app; one Cala QL query shown in the pitch | |

## 12. Agent build instructions

### 12.1 Stack

| Choice | Pick | Why |
|---|---|---|
| Framework | Next.js (App Router), TypeScript strict, Tailwind CSS | One app for UI and server routes that hide keys; deploys to Vercel as-is |
| Graph | `react-force-graph-2d` | Built on d3-force, so the custom radial and angular forces in 5.5 are a few lines each; canvas rendering handles 250 nodes at 60 fps; custom node painting gives the glow look. sigma.js uses graphology and ForceAtlas2, which is harder to steer toward per-node live targets. Upgrade to `react-force-graph-3d` only as a polish item if 2D is done |
| LLM | `@anthropic-ai/sdk`, model `claude-haiku-4-5` for extraction and ingest classification | Fast, cheap, strict JSON via tool use |
| STT | Browser Web Speech API by default; ElevenLabs realtime when keyed | Zero-key default |
| Tests | Vitest (unit), Playwright (e2e and screenshots) | |
| Data | JSON files in `data/`; localStorage for interest state | No database needed (section 10) |

### 12.2 Repo layout

```
app/
  page.tsx                      founder view (graph, transcript rail, chips, top 10, inbox)
  investor/page.tsx             investor view (feed, group/sort/filter, room suggestion, Interested)
  room/[id]/page.tsx            room page with seat request (MOCK)
  api/extract/route.ts          Haiku extraction, strict JSON
  api/cala/entity/[id]/route.ts live retrieve_entity proxy with cache
  api/cala/search/route.ts      knowledge_search proxy with cache
  api/stt-token/route.ts        ElevenLabs short-lived token (only if keyed)
components/  Graph.tsx TranscriptRail.tsx ProfileChips.tsx MatchList.tsx ProfilePanel.tsx EvidenceEdges.tsx
             DoorPanel.tsx InterestInbox.tsx VerificationChecklist.tsx ChatThread.tsx RoleSwitcher.tsx FixtureBanner.tsx
lib/         taxonomy.ts scoring.ts revealed.ts physics.ts extractSchema.ts fallbackExtract.ts mergeProfile.ts
             replay.ts interest.ts verification.ts roomBuilder.ts cala.ts stt.ts
data/        investors.json investors.fixture.json founders.seed.json debriefs.seed.json programmes.json quotes.json
             replay/demo-pitch.json replay/demo-pitch.script.md .ingest-checkpoint.json (gitignored)
scripts/     introspect.ts ingest.ts make-fixtures.ts build-replay.ts
tests/unit/  scoring.test.ts revealed.test.ts fallbackExtract.test.ts mergeProfile.test.ts interest.test.ts roomBuilder.test.ts
tests/e2e/   replay.spec.ts investor.spec.ts interest.spec.ts screenshots.spec.ts
.env.example .gitignore README.md
```

### 12.3 Env vars

`.env.local` (never committed; `.gitignore` covers `.env*` except `.env.example`). `.env.example` committed with empty values:

```
CALA_API_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
```

Every route checks for its key and falls back cleanly (fixture data, keyword extractor, Web Speech) instead of erroring.

### 12.4 Build order (mock data first)

1. Scaffold Next.js + Tailwind + Vitest + Playwright; `.env.example`, `.gitignore`, README stub.
2. `lib/taxonomy.ts`; `scripts/make-fixtures.ts` generates `investors.fixture.json` (200 synthetic investors with plausible deal histories across the taxonomy, every record `fixture: true`, fake names clearly fictional) and `founders.seed.json` (40, `seeded: true`).
3. `lib/scoring.ts`, `lib/revealed.ts` with unit tests on hand-made cases (a biotech pre-seed founder must rank a biotech pre-seed investor above a fintech Series A one; contradiction badge fires only above 0.4).
4. `components/Graph.tsx` + `lib/physics.ts`: radial and angular forces, collision, halos, top-10 styling.
5. `lib/replay.ts` + `data/replay/demo-pitch.json` + script: replay drives profile updates; `R` key and button.
6. `lib/fallbackExtract.ts` + `lib/mergeProfile.ts` with tests.
7. `/api/extract` with Haiku and strict JSON; one-in-flight queue on the client.
8. Mic + Web Speech; ElevenLabs path behind the key check.
9. Match cards, evidence edges, profile panel, door panel, `programmes.json` (~20 London programmes with source URLs and checked-on date).
10. Investor view: feed, group/sort/filter, room builder, room suggestion card, room page.
11. Interest: `lib/interest.ts` state machine with tests, verification checks, inbox, checklist, chat thread, two-window sync.
12. Cala client and `scripts/introspect.ts`, `scripts/ingest.ts` (checkpointed, resumable). Run only when `CALA_API_KEY` exists; otherwise leave ready with a dry-run mode that hits nothing.
13. Live Cala calls in the profile panel and "why this match".
14. Fixture banner logic; README with run, ingest and demo instructions; Cala usage notes for the submission.

### 12.5 Test plan

| Layer | What | Command |
|---|---|---|
| Unit | Scoring, revealed vector, contradiction, fallback extractor, profile merge, interest state machine (every transition, caps, expiry), room builder | `npx vitest run` |
| E2E | Replay: press `R`, assert the biotech chip appears and a biotech investor enters the top 3 within the replay window | `npx playwright test tests/e2e/replay.spec.ts` |
| E2E | Investor view: select investor, founder feed ranks, room suggestion appears at threshold | `npx playwright test tests/e2e/investor.spec.ts` |
| E2E | Interest: two browser contexts sharing storage state, or two pages in one context; investor taps Interested, founder inbox shows it, accept, both checks pass, chat unlocks | `npx playwright test tests/e2e/interest.spec.ts` |
| Visual | Screenshots of the graph at replay t=0, t=30 s, settled; investor view; interest unlocked. Inspect them (no hairball, labels legible, halo visible) | `npx playwright test tests/e2e/screenshots.spec.ts` |
| Gate | Typecheck, lint, build | `npx tsc --noEmit && npm run lint && npm run build` |

Never call real Cala, Anthropic or ElevenLabs in tests; mock the route handlers.

### 12.6 Definition of done

- [ ] `npm run build`, typecheck, lint, all unit and e2e tests pass.
- [ ] Replay mode reproduces the demo end to end with the network off (except the page itself).
- [ ] Live mic pitch moves the right cluster inward within ~2.5 s, three times in a row.
- [ ] Every top-10 match shows a reason and ≥2 evidence chips (real Cala data, or marked thin history; fixture only while the banner shows).
- [ ] At least one real stated-vs-revealed contradiction from Cala data on screen, with counted deals (requires the real ingest).
- [ ] Investor view ranks the founder pool and suggests at least one room from the threshold rule.
- [ ] Two-window interest flow works: interested, accept, both verified, chat unlocks; caps enforced.
- [ ] No keys in the repo; `.env.example` present; README explains run, ingest, replay and demo.
- [ ] No invented statistics in UI copy; quotes only from `data/quotes.json`.

### 12.7 Polish backlog (keep iterating after done, in this order)

1. Graph glow, particle trails on drift, smooth halo fade, label collision avoidance.
2. Profile chip animations synced to the transcript token that triggered them (highlight the word).
3. Evidence edge animation (draw-on along the line) and source link previews.
4. Investor view group-by transitions (founders sweep into sector halos).
5. Contradiction badge micro-chart (stated vs revealed bars).
6. `react-force-graph-3d` variant behind a toggle, only if 2D is flawless.
7. Performance pass: 60 fps on the demo laptop with 250 nodes; memoise scoring.
8. Mobile-width layout for the investor feed.
9. Deploy to Vercel and run the e2e suite against the deployed URL.

## 13. Done when (submission)

- Section 12.6 is all ticked, with real Cala data loaded and the fixture banner gone.
- The submission has the 2-minute video, repo, deck and Cala usage notes; there are no invented statistics; no keys are in the repo.
