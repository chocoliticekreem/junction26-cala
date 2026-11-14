"use client";

import { useEffect, useRef, useState } from "react";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector } from "@/lib/taxonomy";
import type { FounderProfile } from "@/lib/types";

export type ProfileChipsProps = {
  profile: FounderProfile;
  triggers?: Record<string, string>;
};

type Chip = { key: string; label: string; value: string; color?: string; trigger?: string };

// Raise is stored in USD; a London founder hears it back in pounds.
export function formatRaise(raiseUsd: number): string {
  const usd = raiseUsd / 1.27;
  if (usd >= 1_000_000) return `£${(usd / 1_000_000).toFixed(usd % 1_000_000 === 0 ? 0 : 1)}m`;
  if (usd >= 1_000) return `£${Math.round(usd / 1_000)}k`;
  return `£${usd}`;
}

function chipsFor(p: FounderProfile, triggers: Record<string, string>): Chip[] {
  const chips: Chip[] = [];
  const sectors = (Object.entries(p.sectors) as [Sector, number][]).sort((a, b) => b[1] - a[1]);
  for (const [s, w] of sectors) {
    chips.push({ key: `sector:${s}`, label: "Sector", value: `${SECTOR_SHORT[s]} ${Math.round(w * 100)}%`, color: SECTOR_COLOR[s], trigger: triggers[`sector:${s}`] });
  }
  if (p.stage) chips.push({ key: "stage", label: "Stage", value: STAGE_LABELS[p.stage], trigger: triggers.stage });
  if (p.raise) chips.push({ key: "raise", label: "Raise", value: formatRaise(p.raise), trigger: triggers.raise });
  if (p.traction) {
    const t = [p.traction.revenue, p.traction.users, p.traction.growth].filter(Boolean).join(" · ");
    if (t) chips.push({ key: "traction", label: "Traction", value: t, trigger: triggers.traction });
  }
  for (const sig of p.teamSignals) chips.push({ key: `team:${sig}`, label: "Team", value: sig, trigger: triggers.teamSignals });
  if (p.geography) chips.push({ key: "geo", label: "Where", value: p.geography, trigger: triggers.geography });
  if (p.businessModel) chips.push({ key: "model", label: "Model", value: p.businessModel, trigger: triggers.businessModel });
  return chips;
}

export default function ProfileChips({ profile, triggers = {} }: ProfileChipsProps) {
  const chips = chipsFor(profile, triggers);
  const chipKeys = chips.map((c) => c.key).join("|");
  const seen = useRef(new Set<string>());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const newly = chipKeys.split("|").filter((k) => k && !seen.current.has(k));
    if (newly.length === 0) return;
    for (const k of newly) seen.current.add(k);
    setFresh((prev) => new Set([...prev, ...newly]));
    const id = window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const k of newly) next.delete(k);
        return next;
      });
    }, 1400);
    return () => window.clearTimeout(id);
  }, [chipKeys]);

  return (
    <section className="rail-card" aria-label="What we heard" data-testid="profile-chips">
      <header className="rail-head">
        <span>What we heard</span>
        <span className="muted font-mono">{chips.length} signals</span>
      </header>
      <div className="chips">
        {chips.length === 0 && <span className="muted">Nothing yet.</span>}
        {chips.map((c) => (
          <span
            key={c.key}
            className={`chip ${fresh.has(c.key) ? "chip-flash" : ""}`}
            style={c.color ? ({ "--chip": c.color } as React.CSSProperties) : undefined}
            data-testid="chip"
            data-chip={c.key}
            data-value={c.value}
            title={c.trigger ? `heard "${c.trigger}"` : undefined}
          >
            <span className="chip-label">{c.label}</span>
            <span className="chip-value">{c.value}</span>
            {c.trigger && <span className="chip-trigger font-mono">“{c.trigger}”</span>}
          </span>
        ))}
      </div>
    </section>
  );
}
