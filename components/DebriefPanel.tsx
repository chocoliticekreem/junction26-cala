"use client";

import type { Debrief, FounderProfile, Investor, Room } from "@/lib/types";
import { Chip, Label, Panel } from "@/components/ui";

export type DebriefPanelProps = { room: Room; debriefs: Debrief[]; founders: FounderProfile[]; investors: Investor[] };

const FIT_TONE: Record<Debrief["fit"], string> = { yes: "text-[#FF6A3D]", maybe: "text-white/70", no: "text-white/40" };

export function DebriefPanel({ room, debriefs, founders, investors }: DebriefPanelProps) {
  const fById = new Map(founders.map((f) => [f.id, f]));
  const iById = new Map(investors.map((i) => [i.id, i]));
  const forRoom = debriefs.filter((d) => d.roomId === room.id);
  const all = debriefs.length;

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label>Post-room debrief</Label>
          <Chip tone="muted">seeded</Chip>
        </div>
        <span className="text-[12px] text-white/45">
          learning from <span className="font-mono text-white/70">{all}</span> debriefs (seeded)
        </span>
      </div>
      <p className="mt-1 text-[12px] text-white/45">Three questions per pairing after each room. Answers nudge that investor&apos;s weighting by a few points.</p>

      {forRoom.length === 0 ? (
        <p className="mt-4 text-[13px] text-white/40">No debriefs for this room yet. They are collected after the room runs.</p>
      ) : (
        <table className="mt-4 w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-white/35">
              <th className="pb-2 font-medium">Pairing</th>
              <th className="pb-2 font-medium">Fit?</th>
              <th className="pb-2 font-medium">Meet again?</th>
              <th className="pb-2 font-medium">One tag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6">
            {forRoom.map((d, i) => (
              <tr key={i}>
                <td className="py-2 text-white/80">
                  {iById.get(d.investorId)?.name ?? d.investorId}
                  <span className="text-white/35"> × </span>
                  {fById.get(d.founderId)?.company ?? d.founderId}
                </td>
                <td className={`py-2 font-mono ${FIT_TONE[d.fit]}`}>{d.fit}</td>
                <td className="py-2 font-mono text-white/60">{d.again ? "yes" : "no"}</td>
                <td className="py-2">
                  <Chip>{d.tag}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
