# Case study: Y Combinator (2025-2026)

Confidence tags: [C] confirmed on a primary or near-primary page, [S] secondary blog/aggregator, [?] uncertain or conflicting.

## 1. Model, process, what partners look for
- **Deal.** $500K per company: $125K for 7% fixed, plus $375K on an uncapped MFN SAFE. YC keeps pro rata rights, charges no fees, and invests on acceptance, not on milestones. [C] https://www.ycombinator.com/deal
- **Cadence.** Four batches a year since 2025 (moved from two, Sept 2024), each cohort about half the old size. [S] https://www.rebelfund.vc/blog-posts/y-combinator-vs-techstars-2025-acceptance-rates-equity-outcomes
- **Size and acceptance.** Batches run roughly 140-200 companies; Summer 2025 acceptance was 0.6% (lowest recorded), Winter 2026 about 1% with 196 funded. Applications are 20-40K per cycle, but YC does not publish the count, so the rate is an estimate. [S] https://www.wearefounders.uk/y-combinator-acceptance-rate-2026/ [?] Winter 2026 size is reported as ~190 and ~230 elsewhere: https://www.thevccorner.com/p/yc-w26-demo-day-2026-complete-breakdown
- **Process.** Partners read every written application; shortlisted founders get a ~10-minute Zoom interview with 2-3 partners; roughly 20-30% of those interviewed get offers (estimate). Looked for: traction, clear explanation, domain expertise, persistence (reapplying is common). Recent batches skew B2B (84%) and AI-native (88% in S25). [S] https://www.wearefounders.uk/y-combinator-acceptance-rate-2026/
- Scale: 5,000+ companies funded, 100+ valued at $1B+, combined valuation "$600B+" (one section of the same page says $800B). [C, internally inconsistent] https://www.ycombinator.com/press

## 2. Network effects and investor access
- **Bookface** (accepted founders only, access persists after the batch): founder directory, forum with intro requests, vendor deals ($12M+ claimed), tools, and an **investor database with profiles and founder-written reviews of 50,000+ investors**. Startup School participants and rejected applicants have no access. [S] https://www.roundfunded.com/en/blogs/yc-bookface-explained-2026 (the 50K figure is from YC's homepage as archived May 2025, per that page; I did not open the archive).
- **Alumni as customers:** vendor deals and forum intro requests are the documented mechanisms. No primary source quantifies alumni-to-alumni revenue. [?]
- **Demo Day:** invite-only, about 1,000-1,500 investors and press. S25: ~160 startups, one minute and one slide each; W26: four minutes each (reported). [S] https://www.thevccorner.com/p/y-combinator-summer-2025-ycs25-demo-day-startups , https://www.vcbacked.co/blog/yc-demo-day-guide
- **Post-Demo Day.** YC built software for "Investor Day" because founders used to scramble to book hundreds of investor meetings themselves. [C, excerpt only] https://www.ycombinator.com/blog/author/finbarr-taylor . I could not retrieve the full post, so the matching logic is unknown. [?]
- Demo Day pull is now partly priced in before the event: https://newcomer.co/p/yc-startups-land-funding-ahead-of [S, headline only]

## 3. Outcomes and how the hit rate is measured
- Counts: "100+" unicorns per YC (press page above); 82 per a Failory list https://www.failory.com/startups/y-combinator-unicorns [S]; 90+ of 4,000+ companies (~2-2.5%) per https://valueaddvc.com/blog/yc-batch-outcomes-the-exit-data-behind-y-combinators-top-companies [S]. The definitions differ (valuation basis, exited companies, date), so treat 2-2.5% as an order of magnitude.
- Measures used by outsiders: unicorn rate, share reaching $100M+ exits (~2%), and Series A conversion of ~40% within 12 months of Demo Day (3-4x baseline; source's own estimate). Top 10 companies carry 60-70% of returns, and "the median YC company does not become a unicorn." [S] same valueaddvc page.
- Notable: Airbnb, Stripe, Coinbase, DoorDash, Dropbox (same page).
- No audited per-batch unicorn rate was found; the 2009-2014 cohorts are said to be strongest. [?]

## 4. One unicorn end to end: Algolia (Paris, YC W14)
Founders Nicolas Dessaigne and Julien Lemoine applied for Summer 2013, passed the online stage, flew to SF for the 10-minute interview and were rejected; they were advised to retry after their first raise and got in for Winter 2014. [S] https://en.wikipedia.org/wiki/Algolia , https://www.alexanderjarvis.com/algolia-doing-things-that-dont-scale

| Date | Round | Amount | Lead / notable | Source |
|---|---|---|---|---|
| Oct 2013 | Seed | $1.5M | lead not found [?] | https://www.longtermwiki.com/funding-rounds/algolia-seed [S] |
| Mar 2014 | YC | $120K | YC | same [S] |
| Jun 2014 | Seed ext. | $1.3M | Storm Ventures | same [S] |
| May 2015 | A | $18.3M | Accel; Point Nine, Storm | https://techcrunch.com/?p=1501130 [S] |
| Jun 2017 | B | $53M | Accel; SaaStr fund, Alven, Point Nine, Storm | https://techcrunch.com/?p=1501130 [S] |
| Oct 2019 | C | $110M | Accel; Salesforce Ventures | https://www.zoominfo.com/financial/algolia/358828270 [S] |
| Jul 2021 | D | $150M at $2.25B post | Lone Pine; Fidelity, Twilio, Accel | https://www.algolia.com/about/news/algolia-advances-api-first-software-development-valuation-soars-to-2-25-billion-with-150-million-series-d-funding [C] |

Customers: the founders implemented the product by hand for early users; Product Hunt was an early reference customer, then Medium, Stripe, Twitch, Slack. Paying customers went 17 (end 2013) to 400 (end 2014). [S] https://www.alexanderjarvis.com/algolia-doing-things-that-dont-scale , https://www.algolia.com/about/news/the-real-reasons-for-the-growth-of-a-btob-startup-the-algolia-case

**What I could not confirm:** that YC made the Accel intro, or that Product Hunt came via YC (Product Hunt was itself YC W14, which is plausible but not sourced here). [?] Two lessons that are sourced: (1) YC checks were tiny ($120K) against $1.3M from a specialist seed fund, so the value was signalling plus access; (2) one lead (Accel) led A, B and C, a repeat-lead pattern a graph would show directly.

## 5. Founder pain points (partly solved by YC)
- Warm intros act as an investor filter; one cited stat says warm-intro founders are 13x likelier to reach an investment committee (uncited secondary, treat as [?]). https://geekchamp.com/?p=723474
- Non-YC founders lack a "founder-review layer" on investors, YC's Bookface database being the closest thing. https://www.roundfunded.com/en/blogs/yc-bookface-explained-2026
- Accelerators are described as the cleanest access path for outsiders because the process is visible and standardized. https://redbud.vc/latest/which-us-venture-funds-back-nontraditional-founders-and-offer-open-access-before-a-warm-intro-in-2026 [S]
- I did not pull primary HN or Paul Graham threads. Search results were thin; add direct quotes before using this in the pitch. [?]
- Unsolved without YC: who is *actively* writing cheques at your stage and sector, who has led comparable rounds, and who is connected to whom.

## 6. Where a graph reproduces part of the advantage
These are my proposals, not sourced claims. Fields assume Cala's typed entities.

1. **Warm-path finder (founder).** Job: from a target investor, find the shortest chain via co-investors, ex-colleagues and shared board seats. Fields: person-employment history, investor-person links, round participants, board roles. Weekly use: every new target on the pipeline list gets a ranked path and a drafted intro ask.
2. **Active-cheque radar (founder).** Job: list investors who led a round in your stage and sector in the last 6-12 months, with median size. Fields: round lead, date, amount, stage, sector, geography. Weekly use: a refreshed list as new rounds close.
3. **Investor ratings, structural version.** Job: replace YC's reviews with computed signals: repeat-lead rate, follow-on rate into next rounds, co-investor quality, founder-to-founder reference count. Fields: round participants by round order, company outcomes. Retention: a living scorecard that changes whenever a portfolio company raises.
4. **Breakout spotter (investor/scout).** Job: flag companies whose pattern resembles pre-unicorn ones (the Algolia pattern: top specialist seed fund, then repeat lead, team from tier-1 employers). Fields: round sequence, lead identity, founder histories, event appearances (Slush, etc.). Weekly use: a ranked watchlist digest with a "what changed" diff.
5. **Event-to-pipeline (both).** Job: before Slush, list who attends and who raised recently, then log who you met and what happened to them. Fields: event attendance, person-company links, round dates. Retention: every event cycle produces a follow-up list, and outcomes train the ranking.

Pitch angle consistent with the case: YC's edge is mostly information (who funds what, who is trustworthy) plus signal. A typed, sourced graph can sell the information half to non-YC founders, and the Algolia table above shows data that is already structured enough to query.
