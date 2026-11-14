import { describe, expect, it } from "vitest";
import type { FounderProfile } from "@/lib/types";
import type { Sector } from "@/lib/taxonomy";
import { rankFounders } from "@/lib/scoring";
import { buildRoom, suggestRooms } from "@/lib/roomBuilder";
import { NOW, deal, founder, investor, repeat } from "./helpers";

const bioInv = (id: string, n: number) =>
  investor(id, repeat(n, (i) => deal("biotech/therapeutics", "pre-seed", 10 + i * 40, 1e6)), {
    sectors: { "biotech/therapeutics": 1 },
    stages: { "pre-seed": 1 },
  });
const finInv = investor("fin", repeat(8, (i) => deal("fintech", "series-a", 10 + i * 40, 10e6)));

const pool = (sector: Sector, n: number, prefix: string): FounderProfile[] =>
  repeat(n, (i) =>
    founder({ id: `${prefix}${i}`, sectors: { [sector]: 1 }, stage: i % 3 === 0 ? "seed" : "pre-seed", raise: 1e6 }),
  );

describe("suggestRooms", () => {
  const bio = bioInv("bio", 10);
  const founders = [...pool("biotech/therapeutics", 14, "b"), ...pool("fintech", 8, "x")];
  const ranked = rankFounders(bio, founders, [], NOW);

  it("suggests a themed room when a sector cluster reaches the threshold", () => {
    const rooms = suggestRooms(bio, ranked, founders);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].sector).toBe("biotech/therapeutics");
    expect(rooms[0].count).toBe(14);
    expect(rooms[0].founderIds).toHaveLength(14);
  });

  it("does not suggest below the threshold", () => {
    expect(suggestRooms(bio, ranked, founders, 15)).toEqual([]);
  });

  it("drops founders under the minimum score", () => {
    expect(suggestRooms(bio, ranked, founders, 12, 99)).toEqual([]);
  });
});

describe("buildRoom", () => {
  it("proposes 6 founders and 3 investors with the best pairwise fit", () => {
    const investors = [bioInv("bio1", 10), bioInv("bio2", 8), bioInv("bio3", 6), finInv, bioInv("bio4", 2)];
    const founders = [...pool("biotech/therapeutics", 9, "b"), ...pool("fintech", 5, "x")];
    const room = buildRoom("biotech/therapeutics", founders, investors);
    expect(room.founderIds).toHaveLength(6);
    expect(room.investorIds).toHaveLength(3);
    expect(room.investorIds).not.toContain("fin");
    expect(room.founderIds.every((id) => id.startsWith("b"))).toBe(true);
    // pre-seed founders fit pre-seed investors better than the seed ones (b0, b3, b6)
    expect(room.founderIds).toEqual(expect.arrayContaining(["b1", "b2", "b4", "b5", "b7", "b8"]));
  });

  it("fills from other sectors when the sector is short, and handles empty input", () => {
    const founders = [...pool("biotech/therapeutics", 2, "b"), ...pool("fintech", 6, "x")];
    const room = buildRoom("biotech/therapeutics", founders, [bioInv("bio1", 5), finInv]);
    expect(room.founderIds).toHaveLength(6);
    expect(room.investorIds).toHaveLength(2);
    expect(buildRoom("biotech/therapeutics", [], [finInv])).toEqual({ founderIds: [], investorIds: [] });
  });
});
