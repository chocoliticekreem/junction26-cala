# Landscape: investor/founder intelligence tools vs a typed, sourced graph (Cala)

Method: web search + 3 page fetches, 2026-11-14. Most pricing and comparison pages are vendor or affiliate blogs (Harmonic, Specter, Crustdata, Metal all sell something), so treat claims as biased. [UNCERTAIN] marks weakly sourced items. No hard HN/Reddit threads surfaced; "who complains" is mostly from vendor and review-site summaries.

## 1. Tool map

| Tool | User | Data source / freshness | People data | Price | Gap |
|---|---|---|---|---|---|
| Dealroom | EU investors, ecosystem bodies, corporates | Aggregated + curated, EU-strong | Founder strength scoring; depth limited | ~EUR 12-13.5k/yr | Weak US early-stage, shallow people data ([crustdata](https://crustdata.com/blog/7-best-startup-databases-for-investors-in-2026), [harmonic blog](https://harmonic.ai/blog/top-crunchbase-competitors-and-alternatives-in-2026)) |
| Crunchbase | Everyone | Crowdsourced + news; slow refresh | Exec profiles, inconsistent contacts | $49-199/mo, enterprise custom | Stale below big US rounds, unverified user edits ([G2](https://www.g2.com/products/Crunchbase/reviews), [Exa](https://insights.exa.ai/why-crunchbase-misses-companies-key-data-gaps-impacting-sales)) |
| PitchBook | Institutional VC/PE | 1,800+ human researchers | Fund/LP level, not talent | ~$18-70k/yr | Price, no founder workflow ([metal.so](https://www.metal.so/guides/the-best-ai-fundraising-platforms-for-startup-founders-in-2026/)) |
| Harmonic | VCs | Web crawl, hiring, domains, founder moves; near real time | Strongest: stealth founders leaving Big Tech, Scout agent with natural-language signals ([Harmonic](https://harmonic.ai/blog/how-to-find-track-stealth-startup-founders)) | ~$20-25k+/yr, sales call | No CRM; broad result sets; every fund runs the same filters ([crustdata](https://crustdata.com/learn/why-harmonic-doesnt-give-your-fund-a-sourcing-edge), biased) |
| Specter | VCs, growth teams | Claims 60k+ news sources, confidence scores and source attribution, 1,000+ talent signals/day ([Specter](https://www.tryspecter.com/features/vs-harmonic)) | Talent, "investor interest" signals | ~$15k+/yr, credits | Self-reported claims; modeled revenue estimates are inferred, not filed |
| Signal (NFX) | Founders | Investor database + Gmail intro mapping | Investor-founder network graph | Free ([causo](https://hub.causo.ai/compare/openvc-vs-signal-nfx)) | Investor thesis is self-described |
| OpenVC | Pre-seed founders | Community-edited, 10k investors | none | Free / premium | Self-declared thesis, manual |
| Metal | Founders | Investor pattern intel + Gmail/LinkedIn warm-path | Network | Custom | Founder-side only; paid ([metal.so](https://www.metal.so/guides/the-best-ai-fundraising-platforms-for-startup-founders-in-2026/)) |
| Affinity | VCs | Email/calendar capture | Relationship graph (private) | ~$500-2,000+/mo | Needs your own data; not discovery ([vcbeast](https://vcbeast.com/best-vc-crm-software)) |
| Folk, Clay | Sales/ops, some VCs | Enrichment waterfalls | Contact enrichment | Low hundreds/mo [UNCERTAIN, not fetched] | Not investment-specific |
| Visible | Founders post-raise | Investor updates, KPIs | none | $49-299/mo | Not for raising |
| Tracxn | Corporate scouts | ML + analysts, 300+ sectors | Not primary | ~$4-8k/yr | Sector reports, thin people |
| Sifted data, Unicorn Nest | EU founders, investors | Editorial/curated lists | Thin | Sifted Pro subscription; Unicorn Nest tiered [UNCERTAIN] | Lists, not reasoning |
| AI-native newcomers | Founders | LLM matching over scraped profiles | Warm-intro mapping | Mostly custom | Fundraisly, Evalyze, Deckmatch, Finta, ThatRound (UK, Mar 2025), Venturai (Jan 2026), SaaStr.ai VC matching ([list](https://www.metal.so/guides/the-best-ai-fundraising-platforms-for-startup-founders-in-2026/), [SaaStr](https://www.saastr.com/find-the-best-vcs-for-your-startup-with-new-saastr-ai-research-vcs)). Matching is mostly profile/thesis text, not shown evidence |

Takeaway: the investor-matching-for-founders slot is crowded with free (OpenVC, Signal) and low-cost tools. The common method is self-declared thesis + a network graph. Deal-based "revealed thesis" with per-claim sources is rarer, but Dealroom/Crunchbase/PitchBook data can already compute "investor X's last 20 deals by sector". That is the founder's moat worry, and it is valid for the matching half.

## 2. What investors pay for, and early signals

- Investors pay $15-70k/yr to find companies before competitors: Harmonic claims surfacing companies 6-12 months before funding announcements (vendor claim, [crustdata](https://crustdata.com/blog/7-best-startup-databases-for-investors-in-2026)). The sold product is people movement (stealth founders from high-signal employers), hiring bursts, and funding-intent feeds ([Harmonic](https://harmonic.ai/blog/how-to-find-track-stealth-startup-founders), [Specter](https://www.tryspecter.com/platform)).
- Signals with some evidence: GitHub commit velocity at 2x trailing average for 3+ windows preceded fundraises across ~4,200 orgs in one author's 6-month tracking ([dev.to](https://dev.to/data_nerd/i-tracked-4200-startup-github-orgs-for-six-months-heres-what-actually-predicts-a-fundraise-52cd)); this is a blog study, not peer reviewed [UNCERTAIN]. Hiring bursts and contributor growth are cited the same way. Founder-market fit beats generic pedigree ([rivus founder research](https://rivus-static.pages.dev/intel/people/gym/reports/2026-03-09-dimension-research.html), [UNCERTAIN] quality). Early revenue of a few hundred thousand at seed is a positive signal ([bsg](https://bsg-newsletter-c0ed52.beehiiv.com/p/the-5-hidden-signals-of-a-unicorn-startup)).
- I found no rigorous public study of which signals predict unicorns; most evidence is vendor or newsletter. Say that on stage rather than claim one.

## 3. Unsolved problems

- Warm paths: tools map your own email/LinkedIn (Signal, Metal, Affinity). Nobody maps shared public context (same event, same cap table, same ex-employer) with sources.
- Thesis mismatch: founders lose weeks on polite no's; "thesis drift" means stated thesis differs from what the fund actually backs ([vcbeast](https://vcbeast.com/venture-capital-glossary/thesis-drift), [cherrypitch](https://cherrypitch.beehiiv.com/p/wrong-investor-wrong-thesis)). This is the revealed-thesis wedge.
- Claim verification: pitch traction/team claims are checked manually; data integrity is a known weak spot ([Bloomberg 2022](https://www.bloomberg.com/news/articles/2022-02-07/startup-data-integrity-vexes-crunchbase-cb-insights-pitchbook)).
- Seed funds priced out: Affinity at ~$2k/mo vs 80% noisy deal flow; indie VCs lack an affordable tool ([confluence/vcbacked summary](https://confluencevcweekly.beehiiv.com/p/the-best-sourcing-tools-2025)).
- Co-founder finding, newly-funded-company first-customer lists, competitor funding radar, market maps: supported by general-purpose DBs only as search results [UNCERTAIN, no direct complaint threads found].

## 4. Retention and churn

- Retains: embedded in daily workflow (CRM sync, Affinity-style relationship capture), alerts on named entities, saved-search digests, free/low-friction entry plus data the user adds (their own pipeline) ([Affinity](https://www.affinity.co/solutions/venture-capital)). Signals that arrive "within hours, not quarters" are the pitch ([altss](https://altss.com/blog/the-death-of-static-investor-databases-why-real-time-intelligence-matters)).
- Kills: stale data (Altss claims 18-22% of allocator contact data decays in 90 days, vendor figure), invalid contacts, unexplained scores, enterprise-only pricing, and result sets too broad to act on ([crustdata](https://crustdata.com/blog/7-best-startup-databases-for-investors-in-2026)). Trust in sources is the common thread.

## 5. Where a typed, sourced graph helps, and where it does not

Real edges:
1. Per-field source rank (filing/company/press/aggregator) lets the UI say why a number is trusted. Specter shows confidence scores; Dealroom/Crunchbase mostly hide provenance. Honest framing: this is a trust UX edge, not unique data.
2. Typed links (round -> lead investor -> person -> role -> event) permit multi-hop queries: "investors who led rounds in companies whose CTO came from X and who attended Slush". Flat DB exports can do it only with joins you build yourself.
3. Event attendance (Slush) is a live, shared-context warm-path signal that Dealroom does not sell.
4. Time series (headcount/ARR) supports claim checks: pitch says "3x ARR growth" vs the series.

Where it does not:
- Dealroom API can replicate "investor's actual deals" in a day. Revealed-thesis matching alone is not a moat.
- Coverage: a hackathon graph is far smaller than Harmonic/Crunchbase (60M companies at Crustdata scale). Missing coverage kills trust faster than good provenance builds it.
- Freshness is bounded by Cala's refresh and your credit budget; real-time talent signals (new LinkedIn job titles) are Harmonic/Specter territory. We cannot scrape LinkedIn (project rule).
- People depth in Cala is "roles/career links", which is not Harmonic's stealth-founder crawl.
- Moat in practice = workflow + provenance + data you accumulate (user pitches, outcomes), not the dataset.

## 6. Five directions, ranked for demo

1. **Verified Pitch ("claim checker + investor fit").** User: founder before a raise. Problem: investors discount unverifiable pitch claims, founders don't know which investors would believe them. Loop: speak pitch -> extract claims (ARR, headcount, team background, "backed by") -> each claim checked against the graph with source and rank -> investors ranked by deals similar to the verified profile. Fields: ARR/headcount series, roles/career, round lead+amount, source rank. Dealroom cannot: per-claim provenance and a verified-vs-unverified badge. Demo: a claim flips amber because only an aggregator source supports it; "verified by filing" turns green. Retention: re-verify as the company updates, shareable verified-profile link.
2. **Warm-path map from shared context.** User: founder. Problem: cold email response is low; no tool maps public shared context. Loop: pick a target investor -> show paths via Slush attendance, shared ex-employers, co-investments, past board links, each edge sourced -> draft intro ask. Fields: event attendees, career links, round co-investors. Dealroom cannot: event links and typed people edges. Demo: "You and Partner X were both at Slush 2026; her portfolio CTO is your ex-colleague." Retention: alert when a path appears (new event, new hire).
3. **Thesis drift radar.** User: founder and VC associate. Problem: stated thesis vs actual deals diverge. Loop: investor profile shows stated sector vs last 24 months of deals, drift score, and the next likely check size/stage. Fields: rounds, amounts, sector, dates. Dealroom can partially; the edge is rank-labelled sourcing and people on each deal. Demo: a famous fund visibly drifts from "fintech" into AI infra. Retention: monthly drift digest.
4. **Newly-funded customer radar.** User: B2B founder. Problem: freshly funded companies buy tools within weeks; no easy filter by round + hiring. Loop: choose ICP -> list rounds in last 30 days with headcount growth and the hiring leader -> weekly email. Fields: rounds, headcount series, roles. Dealroom can partly (funding feed). Edge is weak vs Specter. Demo is easy; moat is thin. Best retention hook (weekly digest) of the five.
5. **Competitor funding radar + market map.** User: founder/strategy lead. Problem: need to know who funded rivals and who is hiring. Loop: enter your company -> auto cluster peers -> alert on a rival's round/lead/headcount jump. Fields: peers, rounds, time series. Dealroom and Tracxn do market maps well already; lowest differentiation.

Recommended ship: combine 1 and 2 (verified profile + warm path) as the story. Pitch line to answer "Dealroom API?": "Dealroom tells you who invests. We tell you who would believe you, and who can introduce you, with a source on every line." Retention hook: weekly "paths and claims" digest.

## Open items to verify before the pitch
- Folk, Clay, Sifted, Unicorn Nest details (not directly verified).
- Cala's actual coverage counts and refresh cadence for people/event data.
- Whether Slush attendee data includes investors; if sparse, direction 2 weakens.
