// Real cohort companies behind a simulation: precedents for the start/vision, and the distinct
// simulated futures ("realities") with the real companies that followed each route.
import { STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import type { Precedent, Reality, RealityStep, SimModel } from "./types";
import type { Prepared, RunOutcome } from "./simulate";
import { domainTier, queryVector, similarityIndex, textMatch, type TextMatch } from "./similarity";
import { realReachedVision } from "./vision";
import { LOW_CONFIDENCE_N, ROUND_STAGES, fmtMonths, fmtUsd, leadOf, median, quantile, roundStageIndex } from "./util";

const MAX_PRECEDENTS = 8;
const MIN_PRECEDENTS = 4;
const MAX_REALITIES = 5;
const MIN_REALITY_SHARE = 0.02;
const NO_URL_SOURCE = "Cala knowledge query";
// Weight of text similarity (0..1) in the precedent score, next to sector (x3), stage (2) and
// shared investors (1.5 each).
const LIKE_W = 4;

type Facts = { id: string; sector: Sector; reached: boolean; stalledAt?: Stage; lastStage: Stage; stages: Set<Stage>; investors: Set<string>; leads: Set<string> };

function companyFactsList(model: SimModel, prep: Prepared): Facts[] {
  const stalledLast = new Map<string, Stage>();
  for (const t of model.transitions) if (t.outcome === "stalled") stalledLast.set(t.companyId, t.stage);
  const out: Facts[] = [];
  for (const [id, eps] of Object.entries(model.episodes)) {
    if (id === prep.company?.id) continue;
    out.push({
      id,
      sector: model.cohort.companies[id].sector,
      reached: realReachedVision(model, id, prep.basis),
      stalledAt: stalledLast.get(id),
      lastStage: eps[eps.length - 1].stage,
      stages: new Set(eps.map((e) => e.stage)),
      investors: new Set(eps.flatMap((e) => e.memberIds)),
      leads: new Set(eps.map((e) => e.leadId).filter((x): x is string => !!x)),
    });
  }
  return out;
}

export function toPrecedent(model: SimModel, companyId: string, reachedVision: boolean, similarity?: number, fallback?: boolean): Precedent {
  const co = model.cohort.companies[companyId];
  const eps = model.episodes[companyId] ?? [];
  return {
    companyId,
    name: co.name,
    sector: co.sector,
    reachedVision,
    ...(similarity !== undefined ? { similarity: Math.round(similarity * 1000) / 1000 } : {}),
    ...(fallback ? { fallback: true } : {}),
    path: eps.flatMap((e) =>
      e.roundIds.map((rid) => {
        const r = model.cohort.rounds[rid];
        const src = r.sources.find((s) => s.url) ?? r.sources[0];
        const lead = leadOf(r);
        return {
          stage: e.stage,
          ...(lead ? { leadId: lead.investorId } : {}),
          leadName: lead?.name,
          date: r.date,
          ...(r.amountUsd ? { amountUsd: r.amountUsd } : {}),
          roundId: rid,
          source: src?.url ? { name: src.name, url: src.url } : { name: src?.name ?? NO_URL_SOURCE },
        };
      }),
    ),
  };
}

export function buildPrecedents(model: SimModel, prep: Prepared): Precedent[] {
  const sw = new Map(prep.sectors);
  const ds = prep.company ? ROUND_STAGES[Math.max(0, prep.lastStageIdx)] : prep.firstStage;
  const facts = companyFactsList(model, prep);
  const existing = new Set(prep.allExisting);
  const like = likeness(model, prep);
  const tier = tierFn(model, prep);
  const score = (f: Facts) =>
    (sw.size ? (sw.get(f.sector) ?? 0) * 3 : 1) +
    (f.stages.has(ds) ? 2 : 0) +
    1.5 * [...f.investors].filter((i) => existing.has(i)).length +
    (like ? LIKE_W * like(f.id) : 0);
  // Domain first (same-domain tier, then text similarity in 0.05 bands), stage and path second.
  const band = (f: Facts) => (like ? Math.round(like(f.id) * 20) : 0);
  const ranked = [...facts].sort(
    (a, b) => tier(a) - tier(b) || band(b) - band(a) || score(b) - score(a) || a.id.localeCompare(b.id),
  );
  const chosen: Facts[] = [];
  const take = (pred: (f: Facts) => boolean, n: number, maxTier: number) => {
    for (const f of ranked) {
      if (n <= 0 || chosen.length >= MAX_PRECEDENTS) break;
      if (!chosen.includes(f) && tier(f) <= maxTier && pred(f)) {
        chosen.push(f);
        n--;
      }
    }
  };
  // Unrelated companies (tier 2) only when the related ones cannot fill MIN_PRECEDENTS.
  for (const maxTier of [1, 2]) {
    if (maxTier === 2 && chosen.length >= MIN_PRECEDENTS) break;
    take((f) => f.reached, 4, maxTier);
    take((f) => !!f.stalledAt && roundStageIndex(f.stalledAt) >= roundStageIndex(ds), 3, maxTier);
    take(() => true, MAX_PRECEDENTS, maxTier);
  }
  return chosen.map((f) => toPrecedent(model, f.id, f.reached, like?.(f.id), tier(f) > 0));
}

// Domain tier of a candidate (see domainTier): 0 same domain, 1 same sector family, 2 unrelated.
function tierFn(model: SimModel, prep: Prepared): (f: Facts) => number {
  const sectors = new Set(prep.sectors.map(([s]) => s));
  const match = textMatcher(model, prep);
  const memo = new Map<string, number>();
  return (f) => {
    let t = memo.get(f.id);
    if (t === undefined) memo.set(f.id, (t = domainTier(f, sectors, match?.(f.id))));
    return t;
  };
}

// Text similarity to the founder's tags + description, or undefined when the founder gave none.
function likeness(model: SimModel, prep: Prepared): ((companyId: string) => number) | undefined {
  const match = textMatcher(model, prep);
  return match && ((id) => match(id).sim);
}

function textMatcher(model: SimModel, prep: Prepared): ((companyId: string) => TextMatch) | undefined {
  if (!prep.like.tags?.length && !prep.like.text?.trim()) return undefined;
  const idx = similarityIndex(model.cohort);
  const q = queryVector(idx, prep.like);
  return q.size ? (id) => textMatch(idx, q, id) : undefined;
}

type ClassKey = string;

function classOf(o: RunOutcome, reachedMedian: number): ClassKey {
  if (o.reached) return o.months <= reachedMedian ? "R:fast" : "R:slow";
  if (o.stalledAt) return `S:${o.stalledAt}`;
  return `H:${o.finalStage ?? "none"}`;
}

function classRank(k: ClassKey): number {
  const [kind, rest] = k.split(":");
  const idx = rest === "none" ? -1 : roundStageIndex(rest as Stage);
  if (kind === "R") return rest === "fast" ? 1000 : 900;
  if (kind === "H") return 500 + idx * 10;
  return 100 + idx * 10;
}

function band(xs: number[] | undefined, fmt: (n: number) => string): string | undefined {
  if (!xs || xs.length < 3) return undefined;
  const lo = quantile(xs, 0.25)!;
  const hi = quantile(xs, 0.75)!;
  return `${fmt(lo)}–${fmt(hi)}`;
}

export function buildRealities(outs: RunOutcome[], prep: Prepared, model: SimModel, startLabel: string): Reality[] {
  if (!outs.length) return [];
  const reachedMedian = median(outs.filter((o) => o.reached).map((o) => o.months)) ?? 0;
  const classes = new Map<ClassKey, RunOutcome[]>();
  for (const o of outs) {
    const k = classOf(o, reachedMedian);
    const list = classes.get(k);
    if (list) list.push(o);
    else classes.set(k, [o]);
  }
  const eligible = [...classes.entries()].filter(([, l]) => l.length / outs.length >= MIN_REALITY_SHARE || classes.size <= MAX_REALITIES);
  const byRank = [...eligible].sort((a, b) => classRank(b[0]) - classRank(a[0]));
  const picked = new Set<ClassKey>();
  if (byRank.length) {
    picked.add(byRank[0][0]);
    picked.add(byRank[byRank.length - 1][0]);
  }
  for (const [k] of [...eligible].sort((a, b) => b[1].length - a[1].length)) {
    if (picked.size >= MAX_REALITIES) break;
    picked.add(k);
  }

  const facts = companyFactsList(model, prep);
  const like = likeness(model, prep);
  const tier = tierFn(model, prep);
  const sectorSet = new Set(prep.sectors.map(([s]) => s));
  const target = STAGE_LABELS[prep.basis.targetStage];
  const visionName = prep.basis.targetValuationUsd ? `a ${fmtUsd(prep.basis.targetValuationUsd)} outcome` : target;

  return byRank
    .filter(([k]) => picked.has(k))
    .map(([k, list]) => {
      const [kind, rest] = k.split(":");
      const sigOf = (o: RunOutcome) => o.steps.map((s) => `${s.stage}:${s.leadId ?? "?"}`).join(">");
      const counts = new Map<string, RunOutcome[]>();
      for (const o of list) {
        const s = sigOf(o);
        const l = counts.get(s);
        if (l) l.push(o);
        else counts.set(s, [o]);
      }
      const rep = [...counts.values()].sort((a, b) => b.length - a.length)[0];
      const first = rep[0];
      const steps: RealityStep[] = first.steps.map((s, i) => {
        const month = median(rep.map((o) => o.steps[i].monthFromStart)) ?? s.monthFromStart;
        return {
          year: Math.floor(month / 12) + 1,
          monthFromStart: Math.round(month * 10) / 10,
          stage: s.stage,
          label: `${i > 0 && s.stage === "series-b-plus" && first.steps[i - 1].stage === "series-b-plus" ? "Later round" : STAGE_LABELS[s.stage]}${s.leadName ? ` led by ${s.leadName}` : ""}`,
          leadId: s.leadId,
          leadName: s.leadName,
          amountBand: band(model.stageAmounts[s.stage], fmtUsd),
          headcountBand: band(model.stageHeadcounts[s.stage], (n) => `${Math.round(n)}`),
        };
      });
      const months = median(list.map((o) => o.months)) ?? 0;
      const lastStage = rest as Stage;
      const outcome: Reality["outcome"] = kind === "R" ? "reached_vision" : kind === "S" ? "stalled" : "horizon";
      const title =
        kind === "R"
          ? rest === "fast"
            ? `Fast track to ${visionName}`
            : `The long road to ${visionName}`
          : kind === "S"
            ? `Stalls after ${STAGE_LABELS[lastStage]}`
            : rest === "none"
              ? `No new round`
              : `${STAGE_LABELS[lastStage]}, still climbing`;
      const outcomeLine =
        kind === "R"
          ? `Reaches ${visionName} in about ${fmtMonths(months)}`
          : kind === "S"
            ? `No round within 24 months of the ${STAGE_LABELS[lastStage]}: stalled, like the real companies below`
            : rest === "none"
              ? `Still at ${startLabel} when the horizon ends`
              : `At ${STAGE_LABELS[lastStage]} when the horizon ends, short of ${visionName}`;
      const outcomeShort =
        kind === "R"
          ? `${visionName.replace(/^an? /, "")} · ~${fmtMonths(months)}`
          : kind === "S"
            ? "Stalls · no round in 24 mo"
            : rest === "none"
              ? `Still ${startLabel} · horizon`
              : `${STAGE_LABELS[lastStage]} · climbing`;

      const match = (f: Facts) =>
        kind === "R" ? f.reached : kind === "S" ? f.stalledAt === lastStage : !f.reached && !f.stalledAt && f.lastStage === lastStage;
      const all = facts.filter(match);
      const inSector = sectorSet.size ? all.filter((f) => sectorSet.has(f.sector)) : all;
      const pool = inSector.length ? inSector : all;
      const routeLeads = new Set(first.steps.map((s) => s.leadId).filter((x): x is string => !!x));
      const shared = (f: Facts) => [...f.leads].filter((l) => routeLeads.has(l)).length;
      // Named precedents come from the closest domain first (any sector), then shared leads.
      const ranked = [...all].sort(
        (a, b) => tier(a) - tier(b) || shared(b) - shared(a) || (like ? like(b.id) - like(a.id) : 0) || a.id.localeCompare(b.id),
      );
      const related = ranked.filter((f) => tier(f) <= 1);
      const named = (related.length ? related : ranked).slice(0, 3);
      return {
        title,
        outcome,
        probability: Math.round((list.length / outs.length) * 1000) / 1000,
        runs: list.length,
        steps,
        outcomeLine,
        outcomeShort,
        precedents: named.map((f) => toPrecedent(model, f.id, f.reached, like?.(f.id), tier(f) > 0)),
        ...(named.some((f) => tier(f) > 0) ? { precedentsFallback: true } : {}),
        sampleSize: pool.length,
        lowConfidence: pool.length < LOW_CONFIDENCE_N,
      };
    });
}
