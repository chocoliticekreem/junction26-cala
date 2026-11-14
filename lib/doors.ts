import type { Door, Investor, Programme } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A programme is a door into an investor only when it is that investor's own programme
// (explicit link, or the investor's name contains the programme name, e.g. Seedcamp).
export function doorsFor(inv: Investor, programmes: Programme[]): Door[] {
  const name = norm(inv.name);
  const linked = programmes.filter(
    (p) => p.investorIds?.includes(inv.id) || (norm(p.name).length > 3 && name.includes(norm(p.name))),
  );
  const programmeDoors: Door[] = linked.map((p) => ({
    kind: p.kind === "office_hours" ? "office_hours" : p.kind === "scout" ? "scout" : "programme",
    label: `${p.name}: ${p.description}`,
    url: p.url,
  }));
  const existing = inv.doors.filter((d) => !programmeDoors.some((p) => p.url && p.url === d.url));
  const doors = [...programmeDoors, ...existing];
  if (!doors.some((d) => d.kind === "room")) {
    doors.push({ kind: "room", label: "Ask to be considered for a curated room" });
  }
  return doors;
}
