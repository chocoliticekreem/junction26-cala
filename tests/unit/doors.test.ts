import { describe, expect, it } from "vitest";
import { doorsFor, publicDoors } from "@/lib/doors";
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
    { kind: "warm_intro", label: "Warm intro to Zoë", via: ["Zoë", "Max"] },
    { kind: "scout", label: "Acme scout network" },
    { kind: "office_hours", label: "Acme office hours", url: "https://acme.example/office-hours" },
    { kind: "room", label: "Ask to be considered for a room" },
  ],
});

describe("doorsFor", () => {
  it("orders programme, office hours, scout; never a room, a warm intro or an email", () => {
    const doors = doorsFor(inv, PROGRAMMES, founder({ stage: "pre-seed" }));
    expect(doors.map((d) => d.kind)).toEqual(["programme", "programme", "office_hours"]);
    expect(doors.some((d) => /email/i.test(d.label))).toBe(false);
    expect(doors.every((d) => !!d.url)).toBe(true);
  });

  it("drops doors without a public URL", () => {
    expect(publicDoors(inv.doors).map((d) => d.kind)).toEqual(["office_hours"]);
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

  it("offers nothing without a founder signal or a public door of the investor's own", () => {
    const doors = doorsFor(investor("x", [], {}, { name: "X Capital", doors: inv.doors.filter((d) => d.kind !== "office_hours") }), PROGRAMMES);
    expect(doors).toEqual([]);
  });
});
