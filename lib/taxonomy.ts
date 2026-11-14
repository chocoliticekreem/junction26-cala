export const SECTORS = [
  "biotech/therapeutics",
  "medtech/devices",
  "healthtech",
  "insurtech",
  "fintech",
  "crypto/web3",
  "proptech",
  "marketplaces",
  "consumer",
  "edtech",
  "mobility",
  "climate/energy",
  "deep tech/hardware",
  "AI infrastructure",
  "developer tools",
  "cybersecurity",
  "applied AI/vertical SaaS",
  "B2B SaaS (other)",
] as const;

// Order above is deliberate: related sectors sit next to each other so their arcs on
// the graph are adjacent (health cluster, money cluster, ... software cluster).

export type TaxonomySector = (typeof SECTORS)[number];
export type Sector = TaxonomySector | "other";

export const ALL_SECTORS: readonly Sector[] = [...SECTORS, "other"];

export const STAGES = ["pre-idea", "pre-seed", "seed", "series-a", "series-b-plus"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  "pre-idea": "Pre-idea",
  "pre-seed": "Pre-seed",
  seed: "Seed",
  "series-a": "Series A",
  "series-b-plus": "Series B+",
};

export const SECTOR_SHORT: Record<Sector, string> = {
  "biotech/therapeutics": "Biotech",
  "medtech/devices": "Medtech",
  healthtech: "Healthtech",
  insurtech: "Insurtech",
  fintech: "Fintech",
  "crypto/web3": "Crypto",
  proptech: "Proptech",
  marketplaces: "Marketplaces",
  consumer: "Consumer",
  edtech: "Edtech",
  mobility: "Mobility",
  "climate/energy": "Climate",
  "deep tech/hardware": "Deep tech",
  "AI infrastructure": "AI infra",
  "developer tools": "Dev tools",
  cybersecurity: "Cyber",
  "applied AI/vertical SaaS": "Applied AI",
  "B2B SaaS (other)": "B2B SaaS",
  other: "Other",
};

// Hue per sector, walked around the wheel in taxonomy order so neighbours look related.
export const SECTOR_COLOR: Record<Sector, string> = Object.fromEntries(
  ALL_SECTORS.map((s, i) => {
    if (s === "other") return [s, "hsl(220 10% 60%)"];
    const hue = Math.round((i / SECTORS.length) * 330 + 160) % 360;
    return [s, `hsl(${hue} 80% 62%)`];
  }),
) as Record<Sector, string>;

export function isSector(x: string): x is Sector {
  return (ALL_SECTORS as readonly string[]).includes(x);
}

export function isStage(x: string): x is Stage {
  return (STAGES as readonly string[]).includes(x);
}

export function stageIndex(s: Stage): number {
  return STAGES.indexOf(s);
}
