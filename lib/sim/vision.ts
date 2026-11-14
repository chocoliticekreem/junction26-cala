// Vision parsing (keyword fallback) and the rule that decides whether a path "reached the vision".
import { fallbackExtract } from "@/lib/fallbackExtract";
import { STAGE_LABELS, stageIndex, type Stage } from "@/lib/taxonomy";
import type { SimModel, Vision, VisionBasis } from "./types";
import { PROXY_FUNDING_USD, fmtUsd, median, roundStageIndex, toMs } from "./util";

export const UNICORN_USD = 1_000_000_000;
const FX: Record<string, number> = { "£": 1.27, "€": 1.08, $: 1 };
const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1 };

function money(num: string, mult: string | undefined, sym: string | undefined): number {
  const n = WORDS[num.toLowerCase()] ?? parseFloat(num.replace(/,/g, ""));
  return n * (mult ? MULT[mult.toLowerCase()] : 1) * (sym ? (FX[sym] ?? 1) : 1);
}

const MONEY = "([£€$])?\\s?(\\d+(?:[.,]\\d+)?|one|two|three|four|five|ten|a)\\s?(k|mm|m|bn|b|thousand|million|billion)\\b";

export function parseVision(text: string): Vision {
  const t = text ?? "";
  const v: Vision = { text: t, targetStage: "series-b-plus", horizonYears: 5 };

  const valuation =
    t.match(new RegExp(`${MONEY}\\s+(?:valuation|valued|company|business)`, "i")) ??
    t.match(new RegExp(`(?:valuation|valued at|worth)\\s+(?:of\\s+)?${MONEY}`, "i"));
  if (/\b(?:unicorn|billion[- ]dollar|\$1\s?b(?:n|illion)?\b|decacorn)/i.test(t)) {
    v.targetValuationUsd = /decacorn/i.test(t) ? 10 * UNICORN_USD : UNICORN_USD;
  } else if (valuation) {
    v.targetValuationUsd = money(valuation[2], valuation[3], valuation[1]);
  }

  if (/\b(?:ipo|public company|go(?:ing)? public|listed|unicorn|series[- ][b-k]|growth stage|scale-?up|billion)\b/i.test(t)) v.targetStage = "series-b-plus";
  else if (/\bseries[- ]a\b/i.test(t)) v.targetStage = "series-a";
  else if (/(?<!pre[- ]?)\bseed\b/i.test(t)) v.targetStage = "seed";

  const head = t.match(/\b(\d[\d,]*)\s*\+?\s*(?:people|employees|staff|engineers|headcount|person team|strong team)\b/i) ?? t.match(/\bteam of\s+(\d[\d,]*)/i);
  if (head) v.targetHeadcount = parseInt(head[1].replace(/,/g, ""), 10);

  const raised = t.match(new RegExp(`(?:raised?|raising|funding of|in funding)\\s+(?:over\\s+|more than\\s+)?${MONEY}`, "i")) ?? t.match(new RegExp(`${MONEY}\\s+(?:raised|in funding|of funding)`, "i"));
  if (raised) v.targetFundingUsd = money(raised[2], raised[3], raised[1]);

  const years = t.match(/\bin\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/i);
  if (years) v.horizonYears = Math.min(10, Math.max(1, WORDS[years[1].toLowerCase()] ?? parseInt(years[1], 10)));

  const sector = fallbackExtract(t).sectors[0]?.label;
  if (sector) v.sector = sector;
  return v;
}

export type CompanyFacts = { stageIdx: number; totalUsd: number; valuationUsd?: number };

// Facts known about a company as of model.asOf; present-day company fields only when asOf is the
// cohort's own date or later.
export function companyFacts(model: SimModel, companyId: string): CompanyFacts {
  const eps = model.episodes[companyId] ?? [];
  const co = model.cohort.companies[companyId];
  const trust = model.asOfMs >= (toMs(model.cohort.asOf) ?? 0);
  let totalUsd = eps.reduce((a, e) => a + (e.amountUsd ?? 0), 0);
  let valuationUsd = eps.reduce<number | undefined>((a, e) => (e.valuationUsd ? Math.max(a ?? 0, e.valuationUsd) : a), undefined);
  if (trust && co) {
    totalUsd = Math.max(totalUsd, co.totalFundingUsd ?? 0);
    if (co.maxValuationUsd) valuationUsd = Math.max(valuationUsd ?? 0, co.maxValuationUsd);
    if (co.isUnicorn?.value) valuationUsd = Math.max(valuationUsd ?? 0, UNICORN_USD);
  }
  return { stageIdx: eps.length ? Math.max(...eps.map((e) => roundStageIndex(e.stage))) : -1, totalUsd, valuationUsd };
}

function cohortHasValuations(model: SimModel): boolean {
  return Object.keys(model.episodes).some((id) => companyFacts(model, id).valuationUsd !== undefined);
}

export function visionBasis(vision: Vision, model: SimModel): VisionBasis {
  if (vision.targetValuationUsd) {
    const target = vision.targetValuationUsd;
    const targetStage: Stage = "series-b-plus";
    if (cohortHasValuations(model)) {
      const hits = Object.keys(model.episodes)
        .map((id) => companyFacts(model, id))
        .filter((f) => (f.valuationUsd ?? 0) >= target && f.totalUsd > 0);
      const threshold = median(hits.map((h) => h.totalUsd)) ?? PROXY_FUNDING_USD;
      return {
        kind: "valuation",
        targetStage,
        targetValuationUsd: target,
        fundingThresholdUsd: threshold,
        text:
          `Real companies count when a sourced valuation is at least ${fmtUsd(target)} (${hits.length} in the cohort). ` +
          `Simulated paths count when they reach Series B+ with ${fmtUsd(threshold)}+ raised, ` +
          (hits.length ? `the median raised by those ${hits.length}.` : `a proxy, since none hit the target.`),
      };
    }
    return {
      kind: "proxy",
      targetStage,
      targetValuationUsd: target,
      fundingThresholdUsd: PROXY_FUNDING_USD,
      text: `No valuations in the cohort, so a ${fmtUsd(target)} valuation is proxied as Series B+ with ${fmtUsd(PROXY_FUNDING_USD)}+ raised.`,
    };
  }
  const label = STAGE_LABELS[vision.targetStage === "pre-idea" ? "pre-seed" : vision.targetStage];
  if (vision.targetFundingUsd) {
    return {
      kind: "stage",
      targetStage: vision.targetStage,
      fundingThresholdUsd: vision.targetFundingUsd,
      text: `Reached when a path gets to ${label} with ${fmtUsd(vision.targetFundingUsd)}+ raised in total.`,
    };
  }
  return { kind: "stage", targetStage: vision.targetStage, text: `Reached when a path closes a ${label} round.` };
}

export function realReachedVision(model: SimModel, companyId: string, basis: VisionBasis): boolean {
  const f = companyFacts(model, companyId);
  if (basis.kind === "valuation") return (f.valuationUsd ?? 0) >= (basis.targetValuationUsd ?? Infinity);
  const target = Math.max(0, roundStageIndex(basis.targetStage === "pre-idea" ? "pre-seed" : basis.targetStage));
  return f.stageIdx >= target && f.totalUsd >= (basis.fundingThresholdUsd ?? 0);
}

export function targetStageIdx(basis: VisionBasis): number {
  return Math.max(0, stageIndex(basis.targetStage) - 1);
}
