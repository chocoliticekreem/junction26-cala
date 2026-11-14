"use client";

import { useMemo, useState } from "react";
import type { FounderProfile, InterestState } from "@/lib/types";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, STAGES, type Sector, type Stage } from "@/lib/taxonomy";
import type { FounderMatch } from "@/lib/engine";
import { FounderCard } from "@/components/FounderCard";
import { Label } from "@/components/ui";

export type FounderFeedProps = {
  founders: FounderProfile[];
  matches: FounderMatch[];
  interestByFounder: Map<string, InterestState>;
  capHit: boolean;
  onInterested: (founderId: string) => void;
};

type GroupBy = "none" | "sector" | "stage";
type Traction = "all" | "revenue" | "users";

function topSector(f: FounderProfile): Sector {
  return (Object.entries(f.sectors) as [Sector, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
            o.value === value ? "bg-white/10 text-white/90" : "text-white/50 hover:text-white/80"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FounderFeed({ founders, matches, interestByFounder, capHit, onInterested }: FounderFeedProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [traction, setTraction] = useState<Traction>("all");

  const byId = useMemo(() => new Map(founders.map((f) => [f.id, f])), [founders]);

  const rows = useMemo(() => {
    return matches
      .map((m) => ({ m, f: byId.get(m.founderId)! }))
      .filter(({ f }) => !!f)
      .filter(({ f }) => (traction === "revenue" ? !!f.traction?.revenue : traction === "users" ? !!f.traction?.users : true));
  }, [matches, byId, traction]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: null as string | null, color: undefined as string | undefined, rows }];
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = groupBy === "sector" ? topSector(r.f) : (r.f.stage ?? "unknown");
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    const order = groupBy === "stage" ? [...STAGES, "unknown"] : [...map.keys()].sort((a, b) => map.get(b)!.length - map.get(a)!.length);
    return order
      .filter((k) => map.has(k))
      .map((k) => ({
        key: k,
        label: groupBy === "sector" ? SECTOR_SHORT[k as Sector] : k === "unknown" ? "Stage unknown" : STAGE_LABELS[k as Stage],
        color: groupBy === "sector" ? SECTOR_COLOR[k as Sector] : undefined,
        rows: map.get(k)!,
      }));
  }, [rows, groupBy]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Label>Founder feed</Label>
          <span className="font-mono text-[12px] text-white/40">
            {rows.length}/{matches.length} · sorted by fit
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "none", label: "No grouping" },
              { value: "sector", label: "By sector" },
              { value: "stage", label: "By stage" },
            ]}
          />
          <Seg
            value={traction}
            onChange={setTraction}
            options={[
              { value: "all", label: "All" },
              { value: "revenue", label: "Has revenue" },
              { value: "users", label: "Has users" },
            ]}
          />
        </div>
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.key}>
            {g.label && (
              <div className="mb-2 flex items-center gap-2">
                {g.color && <span className="size-2 rounded-full" style={{ background: g.color }} />}
                <span className="text-[13px] font-medium text-white/80">{g.label}</span>
                <span className="font-mono text-[11px] text-white/35">{g.rows.length}</span>
                <span className="h-px flex-1 bg-white/8" />
              </div>
            )}
            <div className="space-y-2">
              {g.rows.map(({ m, f }) => (
                <FounderCard
                  key={f.id}
                  founder={f}
                  match={m}
                  interestState={interestByFounder.get(f.id) ?? null}
                  capHit={capHit}
                  onInterested={() => onInterested(f.id)}
                />
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="py-12 text-center text-[13px] text-white/40">No founders match this filter.</p>}
      </div>
    </section>
  );
}
