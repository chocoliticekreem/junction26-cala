Mode: hackathon

# Junction 2026: Cala "Make Unicorns Real" entry

Build spec: `SPEC.md`. Startup prompt: `START.md`. Progress log: `PROGRESS.md` (the agent keeps it current).

Deadline: final submission Sun 15 Nov 2026, 10:00 Helsinki time (UTC+2). Peer review from 10:30.

## Never relaxed, even in hackathon mode
- No secrets in git. Keys live in `.env.local` only; `.env.example` lists the names with empty values.
- Record everything on GitHub through pull requests (see `START.md`, rule 6). Repo: `chocoliticekreem/junction26-cala`, private until Anson makes it public for submission. Never deploy without Anson saying so.
- Confirm before anything destructive (deleting files you did not create, dropping data).
- Parameterised queries only; never render user-supplied HTML raw.
- Do not reuse code from the old Raise project or any 8x code. Rebuild from the spec.
- Never scrape LinkedIn. Link to profiles only.

## How to work
- Mock data first, real keys second. A missing key never blocks the build: use the mock path and log what is missing in `BLOCKED.md` for Anson.
- Verify before claiming done: run the tests, run Playwright against the app, look at screenshots.
- Parallelise with subagents. Frontend and visual work: model `fable`. Backend, data, scoring and reviews: model `opus`. Bulk or mechanical work (fixtures, test scaffolds, docs): model `sonnet`.
