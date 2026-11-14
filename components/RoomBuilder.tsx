"use client";

import { useMemo } from "react";
import type { Debrief, FounderProfile, Investor, Room } from "@/lib/types";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector } from "@/lib/taxonomy";
import { buildRoom, rankFounders } from "@/components/dev-e/engine";
import { Avatar, Button, Label, Panel, Score } from "@/components/dev-e/ui";

export type RoomBuilderProps = {
  sector: Sector;
  founders: FounderProfile[];
  investors: Investor[];
  debriefs: Debrief[];
  hostInvestorId: string;
  onCreate: (room: Room) => void;
  onClose: () => void;
};

function nextRoomDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 19);
  return d.toISOString().slice(0, 10);
}

export function RoomBuilder({ sector, founders, investors, debriefs, hostInvestorId, onCreate, onClose }: RoomBuilderProps) {
  const lineup = useMemo(() => buildRoom(sector, founders, investors, debriefs), [sector, founders, investors, debriefs]);
  const fById = useMemo(() => new Map(founders.map((f) => [f.id, f])), [founders]);
  const iById = useMemo(() => new Map(investors.map((i) => [i.id, i])), [investors]);

  const lineupInvestors = lineup.investorIds.map((id) => iById.get(id)!).filter(Boolean);
  const lineupFounders = lineup.founderIds.map((id) => fById.get(id)!).filter(Boolean);

  const fitFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of lineupInvestors) {
      for (const r of rankFounders(inv, lineupFounders, debriefs)) m.set(`${inv.id}:${r.founderId}`, r.score);
    }
    return m;
  }, [lineupInvestors, lineupFounders, debriefs]);

  const avgFit = useMemo(() => {
    const vals = [...fitFor.values()];
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }, [fitFor]);

  const short = SECTOR_SHORT[sector];

  const create = () => {
    const id = `room-${Date.now().toString(36)}`;
    onCreate({
      id,
      title: `${short} room`,
      sector,
      date: nextRoomDate(),
      venue: "Venue TBC, London",
      founderIds: lineup.founderIds,
      investorIds: lineup.investorIds,
      hostInvestorId,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0E17]/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <Panel className="w-full max-w-3xl p-6 shadow-2xl" >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: SECTOR_COLOR[sector] }} />
                <h2 className="text-lg font-medium text-white/90">Proposed {short.toLowerCase()} room</h2>
              </div>
              <p className="mt-1 text-[13px] text-white/60">
                6 founders, 3 investors, picked to maximise pairwise fit. Average pairing fit{" "}
                <Score value={avgFit} className="text-white/90" />.
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-white/40 hover:text-white/80" aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mt-5 grid grid-cols-[1fr_auto] gap-6">
            <div>
              <Label className="mb-2">Founders</Label>
              <ul className="divide-y divide-white/6 rounded-lg border border-white/8">
                {lineupFounders.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                    <Avatar name={f.name ?? f.company ?? f.id} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-white/90">
                        {f.company} <span className="text-white/45">· {f.name}</span>
                      </div>
                      <div className="truncate text-[12px] text-white/50">
                        {f.stage ? STAGE_LABELS[f.stage] : "Stage unknown"} · {f.oneLiner}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {lineupInvestors.map((inv) => (
                        <span
                          key={inv.id}
                          title={`${inv.name}: ${fitFor.get(`${inv.id}:${f.id}`) ?? 0}/100`}
                          className="w-7 rounded px-1 text-center font-mono text-[10px] leading-5 text-white/70"
                          style={{ background: `rgba(255,255,255,${((fitFor.get(`${inv.id}:${f.id}`) ?? 0) / 100) * 0.18 + 0.03})` }}
                        >
                          {fitFor.get(`${inv.id}:${f.id}`) ?? 0}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="w-56">
              <Label className="mb-2">Investors</Label>
              <ul className="space-y-2">
                {lineupInvestors.map((inv, i) => (
                  <li key={inv.id} className="rounded-lg border border-white/8 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-white/35">{String.fromCharCode(65 + i)}</span>
                      <span className="truncate text-[13px] text-white/90">{inv.name}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-white/50">
                      {Math.round((inv.revealed.S[sector] ?? 0) * 100)}% of deals in {short.toLowerCase()}
                      {inv.id === hostInvestorId && <span className="ml-1 text-[#FF6A3D]">· you</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-white/40">Columns on each founder show fit per investor A, B, C.</p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-[12px] text-white/40">Date and venue are placeholders until the host confirms.</span>
            <div className="flex gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="accent" onClick={create} dataTestId="create-room">
                Create room
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
