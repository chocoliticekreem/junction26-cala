"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FounderProfile } from "@/lib/types";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS } from "@/lib/taxonomy";
import { loadDebriefs, loadFounders, loadInvestors, rankFounders } from "@/lib/engine";
import { usingFixtures } from "@/lib/data";
import { useInterestStore, useLiveProfile, useRooms } from "@/lib/interestStore";
import { SeatRequest } from "@/components/SeatRequest";
import { DebriefPanel } from "@/components/DebriefPanel";
import FixtureBanner from "@/components/FixtureBanner";
import { Avatar, Button, Chip, Label, Panel, formatDate } from "@/components/ui";

type Role = "founder" | "host";

const FIXTURES = usingFixtures();

export function RoomView({ id }: { id: string }) {
  const { rooms } = useRooms();
  const room = rooms.find((r) => r.id === id);
  const investors = useMemo(() => loadInvestors(), []);
  const seeded = useMemo(() => loadFounders(), []);
  const debriefs = useMemo(() => loadDebriefs(), []);
  const live = useLiveProfile();
  const founders: FounderProfile[] = useMemo(() => (live ? [live, ...seeded] : seeded), [live, seeded]);
  const { store, identity, decideSeat } = useInterestStore();
  const [role, setRole] = useState<Role>("founder");

  const fById = useMemo(() => new Map(founders.map((f) => [f.id, f])), [founders]);
  const iById = useMemo(() => new Map(investors.map((i) => [i.id, i])), [investors]);

  const lineupInvestors = useMemo(() => (room ? room.investorIds.map((x) => iById.get(x)).filter((x): x is NonNullable<typeof x> => !!x) : []), [room, iById]);
  const lineupFounders = useMemo(() => (room ? room.founderIds.map((x) => fById.get(x)).filter((x): x is FounderProfile => !!x) : []), [room, fById]);

  const fit = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of lineupInvestors) for (const r of rankFounders(inv, lineupFounders, debriefs)) m.set(`${inv.id}:${r.founderId}`, r.score);
    return m;
  }, [lineupInvestors, lineupFounders, debriefs]);

  if (!room) {
    return (
      <main className="min-h-screen bg-[#0B0E17] p-10 font-sans text-white/90">
        <p className="text-[14px] text-white/60">Room &ldquo;{id}&rdquo; not found in this browser.</p>
        <Link href="/investor" className="mt-3 inline-block text-[13px] text-[#FF6A3D]">
          Back to the investor view
        </Link>
      </main>
    );
  }

  const seats = store.seats.filter((s) => s.roomId === room.id);
  const short = SECTOR_SHORT[room.sector];
  const host = room.hostInvestorId ? iById.get(room.hostInvestorId) : undefined;

  return (
    <main className="min-h-screen bg-[#0B0E17] font-sans text-white/90">
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/investor" className="text-[13px] text-white/50 hover:text-white/80">
              ← Investor view
            </Link>
            <span className="text-[13px] font-medium">Room</span>
            {room.seeded && <Chip tone="muted">seeded</Chip>}
          </div>
          <div className="inline-flex rounded-lg border border-white/10 p-0.5">
            {(["founder", "host"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                data-testid={`role-${r}`}
                onClick={() => setRole(r)}
                className={`rounded-md px-2.5 py-1 text-[12px] ${role === r ? "bg-white/10 text-white/90" : "text-white/50 hover:text-white/80"}`}
              >
                {r === "founder" ? "As founder" : "As host"}
              </button>
            ))}
          </div>
        </div>
        <FixtureBanner show={FIXTURES} />
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <Panel className="p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: SECTOR_COLOR[room.sector] }} />
                <h1 className="text-2xl font-medium text-white/95">{room.title}</h1>
              </div>
              <p className="mt-1 text-[13px] text-white/55">
                {lineupFounders.length} founders, {lineupInvestors.length} investors. Every pairing scored on revealed deals
                {host && (
                  <>
                    {" "}
                    · hosted by <span className="text-white/80">{host.name}</span>
                  </>
                )}
                .
              </p>
            </div>
            <div className="text-right">
              <div className="font-mono text-[13px] text-white/85">{formatDate(room.date)}</div>
              <div className="text-[12px] text-white/45">19:00 · {room.venue}</div>
            </div>
          </div>

          <div className="mt-6 border-t border-white/8 pt-5">
            {role === "founder" ? (
              <SeatRequest roomId={room.id} founderId={identity.founderId} />
            ) : (
              <div>
                <Label className="mb-2">Seat requests · host controls</Label>
                {seats.length === 0 ? (
                  <p className="text-[13px] text-white/40">No seat requests yet.</p>
                ) : (
                  <ul className="divide-y divide-white/6 rounded-lg border border-white/8">
                    {seats.map((s) => {
                      const f = fById.get(s.founderId);
                      return (
                        <li key={s.founderId} className="flex items-center gap-3 px-3 py-2" data-testid={`seat-row-${s.founderId}`}>
                          <Avatar name={f?.name ?? s.founderId} size={28} />
                          <div className="min-w-0 flex-1 text-[13px]">
                            <span className="text-white/90">{f?.company ?? s.founderId}</span>
                            {f?.name && <span className="text-white/45"> · {f.name}</span>}
                            {f?.stage && <span className="text-white/35"> · {STAGE_LABELS[f.stage]}</span>}
                          </div>
                          <Chip tone={s.state === "seated" ? "accent" : s.state === "requested" ? "neutral" : "muted"}>{s.state}</Chip>
                          {s.state === "requested" && (
                            <div className="flex gap-1.5">
                              <Button onClick={() => decideSeat(room.id, s.founderId, "waitlisted")} dataTestId={`waitlist-${s.founderId}`}>
                                Waitlist
                              </Button>
                              <Button variant="accent" onClick={() => decideSeat(room.id, s.founderId, "seated")} dataTestId={`seat-${s.founderId}`}>
                                Seat
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Panel>

        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <Panel className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <Label>Founders</Label>
              <div className="flex gap-1 text-[10px] uppercase tracking-wider text-white/35">
                {lineupInvestors.map((inv, i) => (
                  <span key={inv.id} className="w-8 text-center" title={inv.name}>
                    {String.fromCharCode(65 + i)}
                  </span>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-white/6">
              {lineupFounders.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={f.name ?? f.company ?? f.id} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] text-white/90">
                      {f.company} <span className="text-white/45">· {f.name}</span>
                      {!f.seeded && <Chip tone="accent">live</Chip>}
                    </div>
                    <div className="truncate text-[12px] text-white/50">
                      {f.stage ? STAGE_LABELS[f.stage] : "Stage unknown"} · {f.oneLiner}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {lineupInvestors.map((inv) => {
                      const v = fit.get(`${inv.id}:${f.id}`) ?? 0;
                      return (
                        <span
                          key={inv.id}
                          title={`${inv.name}: ${v}/100`}
                          className="w-8 rounded px-1 text-center font-mono text-[11px] leading-6 text-white/75"
                          style={{ background: `rgba(255,255,255,${(v / 100) * 0.18 + 0.03})` }}
                        >
                          {v}
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel className="p-5">
            <Label className="mb-3">Investors</Label>
            <ul className="space-y-3">
              {lineupInvestors.map((inv, i) => (
                <li key={inv.id} className="flex items-start gap-3">
                  <span className="mt-1 w-4 font-mono text-[11px] text-white/35">{String.fromCharCode(65 + i)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] text-white/90">{inv.name}</div>
                    <div className="text-[12px] text-white/50">
                      {Math.round((inv.revealed.S[room.sector] ?? 0) * 100)}% of deals in {short.toLowerCase()} · {inv.partners[0]?.name}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <DebriefPanel room={room} debriefs={debriefs} founders={founders} investors={investors} />
      </div>
    </main>
  );
}
