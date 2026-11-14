import { readFileSync } from "node:fs";
import path from "node:path";
import { ROUTE_PREFIX, routeCacheGet, routeCacheSet } from "@/lib/routeCache";
import { loadCohort, usingCohortFixture } from "@/lib/cohort";
import { eventFor, type EventTag } from "@/lib/events";
import { runSpotter, SpotterError, type SpotterResult } from "@/lib/sim/spotter";
import type { Cohort } from "@/lib/sim/types";
import type { Investor, Revealed } from "@/lib/types";

const MAX_FIELD = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// `at` is the event file in data/events; today only Slush 2026 is loaded (lib/events.ts).
const EVENTS = ["slush-2026"];
const MOCK_EVENT = { name: "Slush 2026", date: "2026-11-18", place: "Messukeskus, Helsinki" };

let revealedById: Map<string, Revealed> | undefined;

// data/investors.json is 2 MB: read it once, server side, only when a request needs it.
function revealedFor(cohort: Cohort, investorId: string): Revealed | undefined {
  const jsonId = cohort.investors[investorId]?.investorsJsonId;
  if (!jsonId) return undefined;
  if (!revealedById) {
    try {
      const all = JSON.parse(readFileSync(path.join(process.cwd(), "data", "investors.json"), "utf8")) as Investor[];
      revealedById = new Map(all.map((i) => [i.id, i.revealed]));
    } catch {
      revealedById = new Map();
    }
  }
  return revealedById.get(jsonId);
}

function mock(name: string, asOf: string, at: string | undefined): SpotterResult & { mock: true } {
  return {
    investor: {
      id: "mock:investor",
      name,
      kind: "fund",
      chips: ["Mock data (E2E_MOCK=1)"],
      rounds: 0,
      companies: 0,
      leadShare: 0,
      sectorDist: { fintech: 0.6, "applied AI/vertical SaaS": 0.4 },
      stageDist: { seed: 0.7, "series-a": 0.3 },
      lowConfidence: true,
    },
    picks: (at ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]).map((rank) => ({
      rank,
      ...(at || rank % 2 === 0 ? { event: MOCK_EVENT } : {}),
      company: {
        id: `mock:co${rank}`,
        name: `Mock Company ${rank}`,
        sector: "fintech",
        hq: "London, UK",
        path: "Pre-seed → Seed",
        latestRound: { id: `mock:r${rank}`, stage: "seed", label: "Seed", date: "2025-06-01", amountUsd: 2_000_000 },
        investors: [],
      },
      scores: { combined: 0.5 / rank, fit: 0.8, shape: 0.4 / rank, shapeBase: 0.1, shapeLift: 4 / rank, pUnicorn: 0.2 / rank, pRaiseNext: 0.6, medianMonthsToNextRound: 14, pOnPath: 0.3 / rank, pLeadNext: 0.1 },
      line: "Mock precedent line",
      precedents: {
        unicorns: [{ companyId: "mock:u1", name: "Mock Unicorn", outcome: "unicorn", distance: 0.5, similarity: 0.5, steps: "Pre-seed → Seed +6 mo", sharedLeads: [] }],
        stalled: [{ companyId: "mock:s1", name: "Mock Stalled", outcome: "stalled", distance: 0.7, similarity: 0.3, steps: "Pre-seed → Seed +12 mo", sharedLeads: [] }],
      },
      sample: { referenceSize: 0, unicornsInReference: 0, depth: 2, runs: 0, transitionsBehind: 0 },
      lowConfidence: true,
      actions: { sharedCoInvestors: [] },
    })),
    asOf,
    basis: "Mock data, not Cala evidence",
    considered: { candidates: 3, simulated: 3, roundsInCohort: 0 },
    weights: { fit: 0.2, shape: 0.35, sim: 0.3, path: 0.15 },
    mock: true,
  };
}

function tag(e: EventTag | undefined): SpotterResult["picks"][number]["event"] {
  return e ? { name: e.name, date: e.date, place: e.place } : undefined;
}

export async function POST(req: Request) {
  let investorId = "";
  let investorName = "";
  let asOf: string | undefined;
  let at: string | undefined;
  try {
    const body = (await req.json()) as { investorId?: unknown; investorName?: unknown; asOf?: unknown; at?: unknown };
    investorId = typeof body.investorId === "string" ? body.investorId.trim() : "";
    investorName = typeof body.investorName === "string" ? body.investorName.trim() : "";
    asOf = typeof body.asOf === "string" && body.asOf.trim() ? body.asOf.trim() : undefined;
    at = typeof body.at === "string" && body.at.trim() ? body.at.trim() : undefined;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!investorId && !investorName) return Response.json({ error: "missing_investor" }, { status: 400 });
  if (investorId.length > MAX_FIELD || investorName.length > MAX_FIELD) return Response.json({ error: "field_too_long" }, { status: 400 });
  if (asOf && !ISO_DATE.test(asOf)) return Response.json({ error: "invalid_asOf" }, { status: 400 });
  if (at && !EVENTS.includes(at)) return Response.json({ error: "invalid_at" }, { status: 400 });

  if (process.env.E2E_MOCK === "1") return Response.json(mock(investorName || investorId, asOf ?? "2026-11-14", at));

  const cohort = loadCohort();
  const fixture = usingCohortFixture();

  const t0 = performance.now();
  const key = `${ROUTE_PREFIX}spotter:v3:${cohort.asOf}:${asOf ?? "-"}:${at ?? "-"}:${(investorId || `name:${investorName}`).toLowerCase()}`;
  const shared = await routeCacheGet(key);
  if (shared) return Response.json({ ...shared, cached: true, source: "valkey", latencyMs: Math.round(performance.now() - t0) });

  try {
    const result = runSpotter(cohort, {
      investorId: investorId || undefined,
      investorName: investorName || undefined,
      asOf,
      revealedFor: (id) => revealedFor(cohort, id),
      only: at ? (c) => !!eventFor(c) : undefined,
    });
    const picks = result.picks.map((p) => ({ ...p, event: tag(eventFor(p.company)) }));
    const body = { ...result, picks, ...(fixture ? { basis: "Synthetic fixture data, not Cala evidence" } : {}), fixture, cached: false };
    routeCacheSet(key, body);
    return Response.json({ ...body, source: "computed", latencyMs: Math.round(performance.now() - t0) });
  } catch (err) {
    if (err instanceof SpotterError) return Response.json({ error: err.code, message: err.message }, { status: 404 });
    throw err;
  }
}
