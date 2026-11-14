import { describe, expect, it } from "vitest";
import { doorsFor } from "@/lib/doors";
import type { Programme } from "@/lib/types";
import { founder, investor } from "./helpers";

const prog = (id: string, name: string, p: Partial<Programme> = {}): Programme => ({
  id,
  name,
  kind: "accelerator",
  stages: ["pre-idea", "pre-seed"],
  sectors: "any",
  description: `${name} description`,
  url: `https://${id}.example`,
  checkedOn: "2026-11-14",
  ...p,
});

const PROGRAMMES: Programme[] = [
  prog("ef", "Entrepreneur First"),
  prog("bio", "Bio Lab", { sectors: ["biotech/therapeutics"] }),
  prog("grow", "Growth Lab", { stages: ["pre-seed", "seed", "series-a"] }),
  prog("climate", "Carbon Lab", { sectors: ["climate/energy"] }),
  prog("seedcamp", "Seedcamp", { kind: "programme", stages: ["pre-seed", "seed"] }),
];

const inv = investor("acme", [], {}, {
  name: "Acme Ventures",
  doors: [
    { kind: "warm_intro", label: "Warm intro to Zoë", via: ["Zoë"] },
    { kind: "scout", label: "Acme scout network" },
    { kind: "office_hours", label: "Acme office hours" },
  ],
});

describe("doorsFor", () => {
  it("orders programme, office hours, scout, warm intro, room", () => {
    const doors = doorsFor(inv, PROGRAMMES, founder({ stage: "pre-seed" }));
    expect(doors.map((d) => d.kind)).toEqual([
      "programme",
      "programme",
      "office_hours",
      "scout",
      "warm_intro",
      "room",
    ]);
    expect(doors.some((d) => /email/i.test(d.label))).toBe(false);
  });

  it("matches open programmes to the founder's stage and top sector, at most two", () => {
    const pre = doorsFor(inv, PROGRAMMES, founder({ stage: "pre-idea", sectors: { "biotech/therapeutics": 1 } }));
    expect(pre.filter((d) => d.kind === "programme").map((d) => d.label)).toEqual([
      "Open application: Bio Lab",
      "Open application: Entrepreneur First",
    ]);
    const seed = doorsFor(inv, PROGRAMMES, founder({ stage: "seed", sectors: { fintech: 1 } }));
    expect(seed.filter((d) => d.kind === "programme").map((d) => d.label)).toEqual([
      "Open application: Growth Lab",
      "Open application: Seedcamp",
    ]);
  });

  it("prefers seed-and-later programmes for a founder with revenue", () => {
    const doors = doorsFor(inv, PROGRAMMES, founder({ stage: "pre-seed", traction: { revenue: "£20k MRR" } }));
    expect(doors[0].label).toBe("Open application: Growth Lab");
    const pre = doorsFor(inv, PROGRAMMES, founder({ stage: "pre-seed", traction: { revenue: "pre-revenue" } }));
    expect(pre[0].label).toBe("Open application: Entrepreneur First");
  });

  it("puts the investor's own programme first and labels it as theirs", () => {
    const seedcamp = investor("sc", [], {}, { name: "Seedcamp", doors: [] });
    const doors = doorsFor(seedcamp, PROGRAMMES, founder({ stage: "pre-seed" }));
    expect(doors[0].label).toMatch(/^Seedcamp \(their own programme\)/);
    expect(doors[1].label).toMatch(/^Open application: /);
    expect(doors.filter((d) => d.kind === "programme")).toHaveLength(2);
  });

  it("offers no general programme without a founder signal, but always a room", () => {
    const doors = doorsFor(inv, PROGRAMMES);
    expect(doors.some((d) => d.kind === "programme")).toBe(false);
    expect(doors.at(-1)?.kind).toBe("room");
  });
});
