import type { Deal, FounderProfile, Investor } from "@/lib/types";
import type { Sector, Stage } from "@/lib/taxonomy";
import { finalizeInvestor } from "@/lib/revealed";

export const NOW = new Date("2026-11-14T00:00:00Z");

export function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

export function deal(sector: Sector, round: Stage | "unknown", ago: number, amountUsd?: number): Deal {
  return { company: `${sector}-${round}-${ago}`, sector, round, date: daysAgo(ago), amountUsd, sources: [{ name: "TEST" }] };
}

export function investor(
  id: string,
  deals: Deal[],
  stated: { sectors?: Partial<Record<Sector, number>>; stages?: Partial<Record<Stage, number>> } = {},
  extra: Partial<Investor> = {},
): Investor {
  return finalizeInvestor(
    {
      id,
      calaId: `cala-${id}`,
      name: `Investor ${id}`,
      kind: "fund",
      website: `https://${id}.example`,
      statedThesis: { text: "", sectors: stated.sectors ?? {}, stages: stated.stages ?? {}, sources: [] },
      deals,
      partners: [{ calaId: "p1", name: "Zoë Brontë-Smith" }],
      doors: [],
      ...extra,
    },
    NOW,
  );
}

export function founder(p: Partial<FounderProfile> = {}): FounderProfile {
  return { id: "f1", sectors: {}, teamSignals: [], confidence: {}, ...p };
}

export const repeat = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
