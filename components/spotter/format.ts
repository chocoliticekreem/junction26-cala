import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, isSector, isStage } from "@/lib/taxonomy";

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
