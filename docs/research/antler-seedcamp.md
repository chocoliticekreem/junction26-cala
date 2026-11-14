# Case study: Antler vs Seedcamp, and what a graph data product could add

Research date 2026-11-14. Web research only. [UNSURE] marks claims from secondary sources or not verified against a primary page.

## 1. The two models

| | Antler | Seedcamp |
|---|---|---|
| Stage | "Day zero": forms teams from solo founders before a company exists | Pre-seed/seed, angel rounds up to ~$1M, some Series B |
| Terms | EUR 100K for 10% in Europe; $150K for 10% in Singapore, with extra equity fixed at the next round ([Antler SG](https://www.antler.co/blog/antler-singapore-announces-improved-investment-terms-and-6-week-residency), [summary](https://www.antler.co/blog/the-antler-disrupt-deal)) | Stakes kept below 10% so angels can fit into rounds ([TechCrunch](https://techcrunch.com/2023/05/17/how-seedcamps-networked-approach-to-europe-helped-it-secure-new-180m-fund)) |
| Mechanics | 6-10 week residency, cohorts of roughly 180 founders across hubs, 27-30+ cities ([Antler PR](https://www.antler.co/press-releases/antler-raises-additional-510-million-within-the-last-12-months-to-support-founders-from-inception-to-scale)); Antler Elevate ($285M) for later-stage follow-on | Fund VI $180M for ~100 companies; Fund V was $95M. A $320M raise was announced June 2026 ([BusinessWire](https://www.businesswire.com/news/home/20260622584739/en/Europes-Original-First-Check-Investor-Seedcamp-Raises-$320-Million)) |
| Scale | 1,800+ companies, 400+ new in 12 months | 550+ companies, "12 unicorns" per the 2026 release (earlier 9 per TechCrunch) |
| Sourcing | Mass top-of-funnel: ~50,000 applicants screened, ~1,200 selected; invest in ~2.5 founders per 1,000 applicants ([source](https://www.growthmentor.com/startup-accelerators/antler/sourceops), secondary) | Network-led: portfolio founders, employees at portfolio companies who become EiRs, angels from Uber/Stripe ("Seedcamp Nation", [2021 review](https://seedcamp.com/?p=2700)) |
| Data/tooling | Proprietary "Antler Hub" platform runs the investment process; data standards to learn which founder attributes predict success ([Antler](https://www.antler.co/blog/how-we-built-antler-2), [Harmonic case study](https://harmonic.ai/case-study/antler)); scouting ops roles | Community and platform rather than a published data stack; "community-led" per co-CEO Carlos Espinal |

Contrast: Speedinvest and Atomico run angel/scout-style sourcing too, but I did not research their terms [UNSURE, not covered].

## 2. Outcomes

- Seedcamp: Wise, Revolut, UiPath, Pleo, Hopin, Grover, Viz.ai, wefox, Sorare ([TechCrunch](https://techcrunch.com/2023/05/17/how-seedcamps-networked-approach-to-europe-helped-it-secure-new-180m-fund)). 2021 alone: 3 new unicorns and GBP 4B+ follow-on raised by portfolio ([Seedcamp](https://seedcamp.com/?p=2700)). Fund return from the 2014 vintage: 13x DPI (secondary, [search summary](https://www.01net.it/europes-original-first-check-investor-seedcamp-raises-320-million/)).
- Antler: two unicorns. Airalo (eSIM, $220M round July 2025 led by CVC with Peak XV and Antler Elevate) and Lovable ($1.8B within 8 months of launch, $6.6B two years in) ([Antler PR](https://www.antler.co/press-releases/antler-raises-additional-510-million-within-the-last-12-months-to-support-founders-from-inception-to-scale)).
- Hit rate: Antler ~2 unicorns on 1,800+ companies (~0.1%); Seedcamp ~9-12 on 550+ (~2%). Different vintages and stage, so not like for like [my arithmetic].
- Time to unicorn: Wise founded 2011, listed 2021, unicorn around its 2015 round [UNSURE on exact valuation date]. Lovable under 1 year (outlier, AI-era). Antler's own cohort model is too young for a long-run read.

## 3. One unicorn end to end: Wise (TransferWise), Seedcamp-backed

| Date | Round | Lead / investors | Amount | Source |
|---|---|---|---|---|
| Aug 2011 | Seed | Seedcamp (Fund II) | $72K | [Seedtable](https://seedtable.com/exits/wise) (secondary) |
| Apr 2012 | First round | Index, IA, Kima, Seedcamp | $1.3M | [search summary of Silicon.co.uk and others](https://www.silicon.co.uk/e-marketing/transferwise-andreessen-horowitz-investment-160214) |
| 2013 | Series B | Valar led; Index, Kima | $6M | same [UNSURE on month] |
| Jun 2014 | Round | Index, IA, Kima | $25M | same [UNSURE: lead not confirmed] |
| 25 Jan 2015 | Series C | Andreessen Horowitz led; Index, Seedcamp, Valar, IA, Richard Branson | $58M | [TechCrunch](https://techcrunch.com/2015/01/25/a16z-leads-58m-round-in-uks-transferwise-to-ramp-up-p2p-remittance-business) |
| 7 Jul 2021 | LSE direct listing | n/a | ~GBP 8B / $11B | [Seedtable](https://seedtable.com/exits/wise) |

Later rounds (2016-2020) not verified; fill from Cala. Key people: Kristo Kaarmann and Taavet Hinrikus (co-founders; Hinrikus ex-Skype first employee [UNSURE, source not fetched]). Seedcamp Week London 2011 is where they pitched by burning money on stage ([Seedcamp via search](https://seedcamp.com/?p=2694)). Seedcamp's seed return: ~30,524x ([Seedtable](https://seedtable.com/exits/wise), secondary).

Early signals a data product could have caught:
- Co-investor pattern: Index plus Valar (Thiel) plus IA Ventures appear in every round; one investor cluster predicts the next lead.
- Founder background: Skype alumni network, fintech pain-point founders (each had lived the problem).
- Event signal: a distinctive Seedcamp Week pitch; event appearance preceded the first institutional round by ~8 months.
- Lead progression: seed fund, then Europe-based Series A, then a US lead (a16z) four rounds in. A graph that links "European round with Index follow-on" to "US growth lead within 3 years" is a pattern.
- Headcount/hiring data for 2012-14 was not researched [gap].

## 4. European founder pain points

- Fundraising is the top concern for 58.1% of European founders in 2025 (63% in 2024); only 18% think it would be easy; building new investor relationships got 6.6 pts harder ([Slush Startup Struggle Survey 2025](https://slush.org/newsroom/slush-startup-struggle-survey-2025)).
- 68% can find prospects easily but 30% convert; GTM is "all trial and error" (same).
- Atomico: ~80-82% of founders said fundraising was harder in 2023 than 12 months earlier; 57% pick investors on shared understanding of vision, 28% on networks/chemistry ([Sifted](https://sifted.eu/articles/atomico-state-of-european-tech-report-2023), via search summary).
- Warm intros, lead search and follow-on after accelerators: no hard survey number found [gap]. Suggest treating these as hypotheses to test with Cala data (e.g. what share of accelerator alumni get a priced round within 18 months).

## 5. Investors at Slush

- Slush runs a request-and-accept marketplace: founders apply to the investor stream, browse and filter investors, send requests; investors accept or decline ([Slush](https://slush.org/newsroom/how-to-land-more-meetings-at-slush), [Notion guide](https://slush.notion.site/Browsing-and-sending-meeting-requests-490e7cd1a3fc4be1bf749809941b979e)).
- Scale: 21,000+ pre-booked meetings in 2024; 25,000+ expected for 2026 (search summary of Slush/Converve; [Converve](https://converve.com/event-networking-blog/match-founders-with-the-right-vcs)).
- Pain points (organiser view): stage, sector and ticket mismatches waste meetings; realistic ceiling is 8-12 quality conversations per investor per day; Slush gives investors a private pre-event day to cut overload (Converve, same link). First-hand investor complaints not found [gap].

## 6. Product ideas on graph data

1. **Lead-fit finder (founder).** Job: shortlist 10 investors who actually lead rounds like mine. Data: round.lead_investor, stage, sector, amount, date, investor partner. Retention: alerts when a target investor leads a comparable round.
2. **Warm-path mapper (founder).** Job: find the shortest co-investor/person path to a target partner. Data: person-career history (shared employers), co-investment edges, founders in shared portfolio. Retention: path refreshes as new rounds add edges; track outreach status.
3. **Slush meeting-prep brief (investor).** Job: before each 15-min meeting, a one-page brief on a founder: founder history, prior rounds, co-investors, headcount trend. Data: Slush 2026 attendee list joined to company/person nodes, headcount time series. Retention: daily during Slush, then a post-event follow-up list.
4. **Early-signal radar (investor/scout).** Job: surface pre-seed/seed companies resembling Wise-style early patterns: founders with category-adjacent careers, repeat-co-investor seeds, headcount growth. Data: headcount series, founder previous employers, seed co-investors. Retention: weekly ranked watchlist with changes.
5. **Accelerator follow-on tracker (founder/programme).** Job: benchmark alumni of Antler/Seedcamp-style programmes on time to next round and who led it. Data: round dates, lead, program affiliation. Retention: cohort dashboard updated per round.

Build-for-demo note: ideas 1 and 3 need only round-lead and company data plus the attendee list and are the safest to show live.
