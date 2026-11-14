// Backtest: fit only on rounds before asOf, simulate the company from its state at asOf, and see
// where its real next leads rank among the simulated ones.
import { buildEpisodes, fitModel } from "./fit";
import { toPrecedent } from "./precedents";
import { Engine, prepare } from "./simulate";
import type { Cohort, Precedent, StartState, Vision } from "./types";
import { mulberry32, roundStageIndex, toMs } from "./util";

export type BacktestResult = {
  realPath: Precedent;
  rankOfRealFirstLead: number | null;
  topLeads: string[];
  realFirstLead?: string;
  rankOfRealNextLead: number | null;
  topNextLeads: string[];
  realNextLead?: string;
  runs: number;
};

function ranking(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

export function backtest(companyId: string, asOf: string, cohort: Cohort, opts: { runs?: number; seed?: number } = {}): BacktestResult {
  const co = cohort.companies[companyId];
  if (!co) throw new Error(`backtest: unknown company ${companyId}`);
  const asOfMs = toMs(asOf);
  if (asOfMs === undefined) throw new Error(`backtest: bad asOf ${asOf}`);
  const model = fitModel(cohort, asOf);
  const full = buildEpisodes(cohort, Infinity)[companyId] ?? [];
  const after = full.filter((e) => e.dateMs >= asOfMs);
  const before = model.episodes[companyId] ?? [];

  const start: StartState = before.length
    ? { companyId, sectors: { [co.sector]: 1 }, stage: before[before.length - 1].stage, asOf }
    : { sectors: { [co.sector]: 1 }, stage: after[0]?.stage ?? "pre-seed", asOf };
  const vision: Vision = { text: "backtest", targetStage: "series-b-plus", horizonYears: 10 };
  const prep = prepare(start, vision, model);
  const engine = new Engine(model, prep);
  const runs = opts.runs ?? 3000;
  const rnd = mulberry32(opts.seed ?? 7);
  const first = new Map<string, number>();
  const second = new Map<string, number>();
  for (let i = 0; i < runs; i++) {
    const o = engine.run({ l1: null, l2: "now" }, 0, 120, rnd);
    const [a, b] = o.steps;
    if (a?.leadId) first.set(a.leadId, (first.get(a.leadId) ?? 0) + 1);
    if (b?.leadId) second.set(b.leadId, (second.get(b.leadId) ?? 0) + 1);
  }
  const firstRank = ranking(first);
  const secondRank = ranking(second);
  const realFirst = after[0]?.leadId;
  const realNext = after[1]?.leadId;
  const rankOf = (list: string[], id?: string) => (id && list.includes(id) ? list.indexOf(id) + 1 : null);
  const name = (id: string) => model.agents[model.agentIndex[id]]?.name ?? cohort.investors[id]?.name ?? id;
  const reachedB = full.some((e) => roundStageIndex(e.stage) >= roundStageIndex("series-b-plus"));
  return {
    realPath: toPrecedent({ ...model, episodes: { [companyId]: full } }, companyId, reachedB),
    rankOfRealFirstLead: rankOf(firstRank, realFirst),
    topLeads: firstRank.slice(0, 5).map(name),
    realFirstLead: realFirst ? name(realFirst) : undefined,
    rankOfRealNextLead: rankOf(secondRank, realNext),
    topNextLeads: secondRank.slice(0, 5).map(name),
    realNextLead: realNext ? name(realNext) : undefined,
    runs,
  };
}
