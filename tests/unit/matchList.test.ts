import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MatchList, { contradictionPair } from "@/components/MatchList";
import type { Match } from "@/lib/types";
import { deal, investor, repeat } from "./helpers";

const saysPreSeedDoesSeriesA = investor(
  "contra",
  [...repeat(9, (i) => deal("biotech/therapeutics", "series-a", 30 + i * 40, 8e6)), ...repeat(2, (i) => deal("biotech/therapeutics", "pre-seed", 500 + i * 40, 1e6))],
  { sectors: { "biotech/therapeutics": 1 }, stages: { "pre-seed": 1 } },
);

const match = (investorId: string, score: number): Match => ({
  investorId,
  score,
  breakdown: { sectorFit: 0, stageFit: 0, chequeFit: 0, activity: 0, debriefAdj: 0 },
  reason: "test",
  evidence: [{ company: "Acme", round: "seed", date: "2026-03-01", sector: "biotech/therapeutics", sources: [{ name: "Cala", date: "2026-03-02", url: "https://example.com" }] }],
});

describe("MatchList", () => {
  it("shows the widest stated-vs-revealed gap as a micro-chart on contradicted rows", () => {
    expect(saysPreSeedDoesSeriesA.contradiction).toBeGreaterThan(0.4);
    const pair = contradictionPair(saysPreSeedDoesSeriesA);
    expect(pair?.label).toBe("Pre-seed");
    expect(pair?.stated).toBe(1);
    expect(pair?.revealed).toBeLessThan(0.3);

    const html = renderToStaticMarkup(createElement(MatchList, { matches: [match("contra", 71.4)], investors: [saysPreSeedDoesSeriesA], onSelect: () => {} }));
    expect(html).toContain('class="mini-bars"');
    expect(html).toContain('class="mini-stated" style="width:100%"');
    expect(html).toMatch(/class="mini-revealed" style="width:(\d|1\d|2\d)%"/);
  });

  it("renders scores as integers and source previews on evidence chips", () => {
    const html = renderToStaticMarkup(createElement(MatchList, { matches: [match("contra", 71.4)], investors: [saysPreSeedDoesSeriesA], onSelect: () => {} }));
    expect(html).toContain('<span class="match-score font-mono">71<small>/100</small></span>');
    expect(html).not.toContain("71.4");
    expect(html).toContain('title="Cala · 2026-03-02"');
  });
});
