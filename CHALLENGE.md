# CHALLENGE.md: what we are judged on

This file is the source of truth for **what the judges want**. `SPEC.md` says how we build it. When the two disagree, this file wins on scope and judging, and the conflict goes into `PROGRESS.md`. Before calling any milestone done, check it against the self-check at the bottom.

## Main challenge: Make Unicorns Real (id 350), partner Cala
Track: Agentic AI. Link: https://hackjunction.app/participate/45/challenges/350 · https://www.cala.ai/

### Prizes
- 1st: each team member becomes a "Cala Comet" (about €5,000 for a team of four): for three months, one hackathon of their choice per month, with travel and accommodation paid by Cala. The team also gets €1,000 in Cala credits and merch.
- Runner-up: €500 in Cala credits and Cala merch (the list page says "500€ + merch").

### Problem (Cala's words, condensed)
Founders and investors make decisions from scattered, stale information. Agents that search the web hit messy, disconnected data.

### What to build
A product on Cala's structured, sourced data (companies, people, funding rounds, investors and the links between them) that solves **one real need** for founders, investors or both. **Focus beats breadth.** Aim for something founders and investors could use at **Slush**, which starts right after the hackathon.

Cala's starting points (examples, not requirements):
- finding lead investors still active in your space;
- reading a market: competitors, who raised from whom, funding flows;
- spotting promising young companies, or running quick sourced background checks;
- finding first customers among newly funded companies;
- market sizing;
- mapping likely acquirers.

### Judging (25% each)
| Criterion | What full marks look like |
|---|---|
| **Real need** | A clear user with a problem worth solving |
| **Execution** | Works smoothly end to end |
| **Originality** | A fresh angle |
| **Use of Cala** | Core to the product, not an add-on |

### Hard requirement
The Cala API or MCP must be **core**. If you removed Cala, the product should stop working, not just lose a feature.

### Resources
- Credits: each team gets all it needs. Promo code is on the platform; redeem at console.cala.ai → Billing → Extra credits → Add promo code. (Already done: the key is in `.env.local`.)
- Docs: https://docs.cala.ai. API base `https://api.cala.ai`, auth header `X-API-KEY`. MCP: `https://api.cala.ai/mcp/`.
- Workshop "Tips & tricks to Make Unicorns Real", Sat 11:00 to 11:30, Loft, 4th floor, hosted by Elies Delgado: how to query companies, people, investors and funding rounds, and **what the judges look for**. Anson attends; answers go into `SPEC.md` section 11.
- Mentors on site all weekend: Issey Masuda (co-founder and CTO) and Cala engineers (knowledge graphs, data pipelines, LLM agents, MCP).

### What we already know about the data
Question 1 in `SPEC.md` section 11 is answered: investors link to rounds through `INVESTED_IN`, with company, round type, date and amount. Dates and amounts are free text (normalise them), funds have duplicate entities (dedupe), and one query may not return every round (page or ask per year).

## Tech challenges this project can also enter
Tick them on the form only if they are genuinely used.
| Tech challenge | What qualifies | Extra step |
|---|---|---|
| Best Use of ElevenLabs (50, MLH) | Voice/audio built with ElevenLabs, e.g. pitch transcription | Claim the code at mlh.link/junction-26 |
| Best Use of Context.dev (44) | At least one Context.dev endpoint in the core flow, visibly driving the demo | Note in the submission: which endpoints and why |
| Best agentic use of Oxylabs Web API (32) | At least one live /search or /scrape call at runtime, with source URLs shown | Note in the submission: which endpoints and why |
| Best Use of Gemini API (48, Google DeepMind) | Meaningful use, not "an LLM added"; 18+ only | Explain problem, integration, why Gemini |

---

## Self-check: compare back to this before calling anything done
Answer each line in `PROGRESS.md` with evidence (a test, a screenshot path or a command output), not "yes".
- [ ] **Real need:** can you name the user (founder raising pre-seed or seed in London, or an investor at Slush) and the one problem in a sentence? Does the first screen show it?
- [ ] **Focus:** is there one core flow that works end to end, rather than five half-features? Anything that isn't on that flow is polish backlog.
- [ ] **Execution:** does the demo flow run start to finish without a crash, a spinner that never ends, or a mock label showing on real data?
- [ ] **Originality:** what does this do that Dealroom, Crunchbase or a LinkedIn search does not? (Matching on investors' actual deals, not their stated thesis, is the angle.)
- [ ] **Use of Cala is core:** does every investor match trace back to Cala entity IDs and real rounds? Would the product stop working without Cala?
- [ ] **Slush-ready:** could a founder use it next week at Slush?
- [ ] **Sourced:** does each claim about an investor show where it came from (the round, the date, the Cala entity)?
- [ ] **Junction rules:** MIT `LICENSE`, README that runs, no keys in git, no code from Raise or 8x, nothing scraped from LinkedIn.
- [ ] **Submission pack:** `docs/submission.md` with a project name (max 30 characters), punchline (max 200), description (max 5000), a 2-minute demo script, and the tech challenges genuinely used.
- [ ] **Peer review:** can it be shown in 3 minutes, and does it score on Innovation, Impact and Implementation?

---

## Junction 2026 context (applies to every entry)

Source: hackjunction.app/participate/45 and the Info Team's answers in Discord #ask-organizers, scraped Fri 13 Nov 2026. Promo codes, access codes and keys are "on platform": never write them into this repo.

### Deadlines (Helsinki, UTC+2)
| What | When |
|---|---|
| Submissions open | Sat 14 Nov, 12:00 |
| **Final submission deadline** | **Sun 15 Nov, 10:00.** The form closes automatically; no late submissions. Draft projects are not reviewed: it must be set to FINAL. |
| Live peer review | Sun 15 Nov, 10:30 to 13:00 (the rules text says until 14:00). Every team member must be at the table. |
| Final ceremony | Sun 14:00 to 16:05: Top 5 pitches 14:15 to 15:10, challenge winners 15:10 to 15:50, Junction winner 15:50 to 16:05 |

Working rule for this build: feature freeze Sun 07:00, demo video recorded by Sun 08:30, submission final by Sun 09:30.

### How entering works
- 19 main challenges in 6 tracks. Each partner picks its own winners using its own criteria (the rubric in the section above is what decides this challenge).
- **One project per main challenge.** The Info Team said: "you can pick many main challenges, but you have to make separate submissions and separate projects for them" (Sat 01:51), and "You need to be able to present each of the challenges for the peer review" (23:32). This team is building three separate projects for three challenges. This repo is one of them and must stand alone: do not share code with or reference the other two.
- Tech (side) challenges stack on top of a submission: tick them in the form's "Tech Challenge Participation" field. Some need an extra step (listed below for this project).

### Overall Junction prize (separate from the partner prize)
- Live peer review on Sunday picks the Top 5. Peers score **Innovation** (new or different from projects already presented), **Impact** (significant societal impact, share of affected people helped) and **Implementation** (realistic, viable, feasible).
- The Top 5 pitch on stage: exactly 3 minutes (mics cut at time) plus 3 minutes of judges' questions, demo from your own laptop. A panel of 7 judges picks the winner. Main prize €10,000, total pool €100,000.
- Skipping peer review makes the team ineligible for the main prize.

### Submission form (opens Sat 12:00)
| Field | Rule |
|---|---|
| Project Name | Required, max 30 characters |
| Punchline | Required, max 200 characters |
| Description | Required, max 5000 characters, Markdown: what you built and the problem it solves |
| Challenge Picker | Required: this project's main challenge |
| Project Demo | Optional link where it can be experienced live |
| Source Code | Required by the rules: a repo link organisers can access |
| Video | Required by the rules: **max 2 minutes**, publicly viewable (YouTube, Vimeo or Loom). "Not a second longer than 2 minutes, and we will be very strict." |
| Presentation | Optional PDF/PPTX/KEY, max 20 MB |
| Tech Challenge Participation | Optional multi-select |

The Guide also asks for technologies used, whether you want to be credited, a pitch deck PDF, team phone numbers and Discord usernames. Check the live form on Saturday.

So the build must produce, inside this repo: a README that a judge can follow, a punchline (max 200 characters), a description draft (max 5000 characters) in `docs/submission.md`, and a 2-minute demo script.

### Junction rules (prize eligibility)
- No code written before the event. All code outside open-source libraries must be written at the event. Pre-written code for the idea, or a project tied to an existing company, means disqualification. (So: no code from Raise, 8x or any earlier project.)
- Team size 1 to 4. Enter at least one challenge.
- All submissions are licensed under **MIT**, and organisers must be able to access the source. Add an MIT `LICENSE` file.
- Partner APIs and materials stay subject to partner terms.
- The repo stays private until Anson makes it public for submission.
