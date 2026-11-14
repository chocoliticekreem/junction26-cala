# Room: presenter runbook

Rankings, scores and room suggestions below were computed on 14 Nov 2026 with the repo's own functions (`loadReplay`, `mergeProfile`, `rankInvestors`, `rankFounders`, `suggestRooms`) over `data/investors.json`, with `new Date()` as "now". Scores drift slightly as the date moves (recency weights), so check the order on screen before you rehearse.

## Setup

1. Use Chrome (Web Speech API for the mic).
2. `npm install` once, then `npm run dev`. The app is at `http://localhost:3000`.
3. Open two windows side by side in the same Chrome profile, since interest and chat sync through localStorage:
   - Left: `http://localhost:3000/` (founder view).
   - Right: `http://localhost:3000/investor` (investor view).
4. Keys are optional. With `CALA_API_KEY` set, the investor profile panel shows live Cala answers (20-60 s on a cold query). Without it the panel shows a labelled mock. Rankings never depend on the key.
5. Clear stale state before a take: DevTools, Application, Local Storage, clear for `localhost:3000`. Do this before each run-through so the inbox starts empty.
6. Do not click in the transcript area while pressing `R`. The key is ignored inside inputs.

## What the replay pitch produces

Press `R` on the founder view. The recorded pitch is a fictional founder, Amara of Helixa Bio, 64 events over 60.8 s (`data/replay/demo-pitch.json`). Its final profile: 92% biotech/therapeutics, 8% AI infrastructure, pre-seed, raise $1.52m (the "£1.2 million" she says), London.

### Top 10 investors for the replay pitch

| # | Investor | Kind | Score | Reason line on the card | Contradiction badge |
|---|---|---|---|---|---|
| 1 | Zinc | accelerator | 62.3 | Backed 5 biotech deals in 24 months; 19% of deals at pre-seed | none |
| 2 | 4BIO Capital | fund | 56.0 | Backed 10 biotech deals in 24 months; 7 deals in the last 12 months | none |
| 3 | Syncona | fund | 55.9 | Backed 6 biotech deals in 24 months; mostly Series B+ | none |
| 4 | Conception X | accelerator | 51.3 | Mostly pre-seed; rounds of £945k-£1.2m | none |
| 5 | Fuel Ventures | fund | 50.9 | Mostly pre-seed; rounds of £908k-£2.7m | none |
| 6 | Abingworth | fund | 50.8 | Backed 13 biotech deals in 24 months; 9 deals in the last 12 months | none |
| 7 | Deep Science Ventures | accelerator | 50.6 | Mostly pre-seed; rounds around £1.5m | none |
| 8 | Sofinnova Partners | fund | 50.3 | Backed 12 biotech deals in 24 months; 14 deals in the last 12 months | none |
| 9 | London Business Angels | angel network | 49.9 | Mostly pre-seed; 9 deals in the last 12 months | Says seed and Series A; 9 of last 10 deals were pre-seed |
| 10 | Medicxi | fund | 49.4 | Backed 8 biotech deals in 24 months; 6 deals in the last 12 months | none |

Evidence chips for the top match, Zinc: Serenatis Bio (pre-seed, 2025-06-03), Microsol (pre-seed, 2024-12-15), Nascent Therapeutics (seed, 2026-09-03). That is two pre-seed and one seed, so say "pre-seed and seed biotech deals", not "three pre-seed deals".

The only contradiction badge in the replay's top 10 is London Business Angels (#9), and it is the one to show. Its evidence chips are Onya Therapeutics (pre-seed, 2026-02-15), ManholeMetrics (pre-seed, 2026-08-15) and ClicknClear (pre-seed, 2026-08-15), and they carry no source links (its deals are sourced to a "Cala knowledge query" only), so do not promise a link there. Show sources on Zinc instead.

Caveat: the scores are close together below #3 (51.3 down to 49.4). Do not narrate the exact order of #4 to #10.

## 2-minute video shot list

Adapted from SPEC 7.1 to what the app shows. Record at 1440 px wide, founder window first, investor window joins at 1:35.

| Time | Screen | Voiceover / action |
|---|---|---|
| 0:00-0:10 | Founder view loads: the investor points sit dim before any pitch | "193 investors active in London. Ranked by what they did, not what they say." |
| 0:10-0:20 | Press `R` (or the Replay button). Transcript starts streaming on the right | Pitch begins: "Hi, I'm Amara, founder of Helixa Bio, a London startup." |
| 0:20-0:50 | Words stream. On "therapeutics" the biotech chip appears and the biotech investors move inward. On "pre-seed" the stage chip appears | Silent. The motion carries it |
| 0:50-1:05 | Graph settles. Top 10 cards on the right: Zinc, 4BIO Capital, Syncona at the top | "Ten matches. Every one backed by real deals." |
| 1:05-1:15 | Click Zinc. Evidence edges light up to Serenatis Bio, Microsol and Nascent Therapeutics with round and year. Source links visible in the panel | "Five biotech deals in the last 24 months, with the rounds and sources from Cala." |
| 1:15-1:25 | Click London Business Angels (#9), then show the contradiction badge | "This one says seed and Series A. Nine of its last ten deals were pre-seed." |
| 1:25-1:35 | Easiest-door section in the investor panel | "And the easiest way in, for each one." |
| 1:35-1:50 | Split screen. Investor window: pick Zinc, show the biotech room suggestion, then switch to Medicxi and tap Interested on the live founder. Founder window: inbox badge lights, accept, both sides verify (see "Verification moment"), lock opens, chat appears | "Investors only reach out when the fit is real. Both sides verified, then you talk, or you meet in the room." |
| 1:50-2:00 | Title card: "Built on Cala" | End |

Do not say "seven investors in the halo" or any other cluster count. Read the number off the screen on the day, or leave it out.

## Which investor to pick in the investor view

I ran `rankFounders` and `suggestRooms` for every one of the 193 investors against the seeded pool plus the live pitch (41 founders). Only three investors reach the room threshold (12 matched founders at score 50 or above in one sector), and all three are biotech:

| Investor | Kind | Biotech room suggestion | Live pitch rank in their feed |
|---|---|---|---|
| Zinc | accelerator | 15 founders (14 without the live pitch) | 1 of 41 (62.3) |
| 4BIO Capital | fund | 14 (13) | 7 of 41 (56.0) |
| Syncona | fund | 13 (12) | 7 of 41 (55.9) |

**Pick Zinc for the room suggestion.** It is the only one where the live pitch is the top founder, and its suggestion reads "15 matched founders in biotech/therapeutics". Without the replay having run first, the count is 14 and the live founder is absent. Run the replay in the founder window first.

**Zinc has no partners linked on Cala.** It cannot pass the investor verification check. Use Medicxi for the interest and verification beat (below). Medicxi does not produce a room suggestion: only 4 matched biotech founders score 50 or above in its feed.

## Verification moment

Pick **Medicxi** in the investor picker. In `data/investors.json` it has `website: https://medicxi.com` and three partners linked to Cala Person entities:

- Francesco De Rubertis, Co-founder & Partner (Cala ID `190fc0b2-7d16-4225-9b57-0c00af9e200b`)
- Giovanni Mariggi, Co-founder & Partner
- Shyam Masrani, Partner

In Medicxi's feed the live founder ranks 5 of 41 at 49.4. Tap Interested on that card. In the founder window, accept from the inbox, then:

1. In the investor verify form, type the name **Francesco De Rubertis** and an address on the fund's domain, for example `you@medicxi.com` (placeholder shows `you@medicxi.com`). Press Verify. Both checks pass: "Partner on Cala" (matched Francesco De Rubertis at Medicxi, with the Cala ID) and "Fund-domain email" (format check only).
2. In the founder verify form, enter a company website and a work email on a company domain, for example `https://helixabio.example` and `amara@helixabio.example`. A gmail address fails by design.
3. The lock opens and a chat thread appears with a suggested first message.

Optional failure beat before step 1: type a name that is not a Medicxi partner. The form shows "No partner named ... linked to Medicxi on Cala" and the lock stays closed. This is the honest answer to "is this check real": the name is compared with the Cala partner records in the committed data.

Say aloud that the email check is format-only and chat is local to the browser. Do not imply an email was sent.

## 3-minute live pitch flow

From SPEC 7.2.

| Time | Do | Say |
|---|---|---|
| 0:00-0:30 | Slide or title only. Read two lines: founders cold-email lists of investors who were never a fit; partners lose first meetings to wrong-fit founders | Add one real quote only if it is in `data/quotes.json`. Do not quote a statistic. The problem numbers are still `[N]` placeholders until quotes are collected |
| 0:30-1:40 | Live: a teammate pitches into the mic, or a judge gives a one-line idea. The graph reacts. If the mic or Wi-Fi fails, press `R` | "Watch the biotech investors move when she says therapeutics." |
| 1:40-2:10 | Click the top match, show evidence edges and sources. Show London Business Angels' contradiction (#9 in the replay). Show the door | "Ranked by what they did. Nine of London Business Angels' last ten deals were pre-seed, not seed or Series A." |
| 2:10-2:40 | Investor window: Zinc room suggestion, then Medicxi, Interested, accept, verify | "A VC told us the value is the room." |
| 2:40-3:00 | Back to the founder window | "Revealed thesis needs typed, sourced deal data. 2,632 deals, 193 investors, all from Cala." |

Facts to have ready for questions, from `data/investors.json`: 2,632 deals, 68% with at least one URL source, 133 investors with a Cala-linked partner, 12 with a contradiction badge, 32 flagged thin history. See `docs/submission.md` for the full table and for the honesty notes (approximate dates, mocked chat and email checks).

If a judge pitches a non-biotech idea, the room suggestion will not appear for the investors above. That is expected: only the biotech cluster passes the threshold with the seeded pool.

## Fallbacks

- **Mic does not work or transcript is slow:** press `R`. Replay drives the same extraction and ranking path as live. Click anywhere that is not an input first, since the key is ignored while an input has focus.
- **Replay does not start:** reload the page, wait for the graph, press `R` again.
- **Live panels sit on "loading":** cold Cala queries take 20-60 s. Move on. The deals, sources, evidence and contradiction badge are read from `data/investors.json` and do not wait on Cala.
- **No Cala key or no network:** the panels show a labelled mock. Say so; do not present mock text as a live answer.
- **Inbox badge does not light in the founder window:** the two windows must be in the same Chrome profile and the same origin (`localhost:3000`). Reload both and repeat Interested.
- **Interest state is stale from an earlier take:** clear localStorage for `localhost:3000` and reload both windows.
- **Anthropic extraction is unavailable:** the keyword fallback extractor drives the graph, so the demo continues with coarser chips.
- **Fixture banner visible:** `data/investors.json` failed to load. Stop and check it before presenting.
