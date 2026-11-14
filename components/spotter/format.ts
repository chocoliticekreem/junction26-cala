import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, isSector, isStage } from "@/lib/taxonomy";
import type { SpotterEvent, SpotterInvestor, SpotterPick } from "./types";

export function sectorColor(sector: string): string {
  if (isSector(sector)) return SECTOR_COLOR[sector];
  let h = 0;
  for (const c of sector) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 62%)`;
}

export function sectorLabel(sector: string): string {
  return isSector(sector) ? SECTOR_SHORT[sector] : sector;
}

export function stageLabel(stage: string): string {
  return isStage(stage) ? STAGE_LABELS[stage] : stage;
}

export function roundLabel(round: { stage: string; date?: string }): string {
  const year = round.date?.slice(0, 4);
  return year ? `${stageLabel(round.stage)} · ${year}` : stageLabel(round.stage);
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

// "Looks like early Lovable, Ramp": the closest unicorn precedents, by name.
export function precedentLine(pick: SpotterPick): string {
  const names = pick.precedents.filter((p) => p.outcome === "unicorn").map((p) => p.name);
  return names.length ? `Looks like early ${names.slice(0, 2).join(", ")}` : "No unicorn precedent at this depth yet";
}

// One line on why this company is in the investor's lane, from the taste the engine learned.
export function whyItFits(pick: SpotterPick, investor: SpotterInvestor): string {
  const { taste } = investor;
  const sector = sectorLabel(pick.company.sector);
  const rank = taste.sectors.findIndex((s) => s.label === sector);
  const parts: string[] = [];
  if (rank === 0) parts.push(`${sector} is your top sector`);
  else if (rank > 0) parts.push(`${sector} is ${pct(taste.sectors[rank].share * 100)} of your rounds`);
  else parts.push(`${sector}, close to what you back`);
  if (taste.entryStage) parts.push(`you usually enter at ${taste.entryStage}`);
  const co = pick.actions.sharedCoInvestors;
  if (co.length) parts.push(`${co.slice(0, 2).join(" and ")} co-invested with you before`);
  return parts.join(" · ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nov 18" from an ISO date.
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return m >= 1 && m <= 12 && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

// "At Slush · Nov 18": the event tag on a pick.
export function eventTag(event: SpotterEvent): string {
  return `At ${event.name.replace(/\s+\d{4}$/, "")} · ${shortDate(event.date)}`;
}
