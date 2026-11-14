"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FounderProfile, InterestState, Investor, Room } from "@/lib/types";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import {
  INVESTOR_OPEN_CAP,
  loadDebriefs,
  loadFounders,
  loadInvestors,
  openInterestCount,
  rankFounders,
  suggestRooms,
  usingFixtures,
} from "@/lib/engine";
import { useInterestStore, useLiveProfile, useRooms } from "@/lib/interestStore";
import { FounderFeed } from "@/components/FounderFeed";
import { RoomSuggestionCard } from "@/components/RoomSuggestionCard";
import { RoomBuilder } from "@/components/RoomBuilder";
import { InvestorVerifyForm } from "@/components/VerificationChecklist";
import { ChatThread } from "@/components/ChatThread";
import { Avatar, Chip, Label, Panel } from "@/components/ui";

function InvestorPicker({ investors, value, onChange }: { investors: Investor[]; value: Investor | null; onChange: (i: Investor) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const hits = investors.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="relative w-72">
      <input
        data-testid="investor-picker"
        value={open ? q : value?.name ?? ""}
        placeholder="Act as investor…"
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-[#121726] px-3 py-1.5 text-[13px] text-white/90 placeholder:text-white/35 outline-none focus:border-[#FF6A3D]/60"
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#121726] shadow-xl">
          {hits.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                data-testid={`pick-${i.id}`}
                onMouseDown={() => {
                  onChange(i);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/[0.06]"
              >
                {i.name}
                <span className="text-[11px] text-white/35">{i.kind.replace("_", " ")}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="px-3 py-2 text-[12px] text-white/40">No investor matches.</li>}
        </ul>
      )}
    </div>
  );
}

function RevealedSummary({ inv }: { inv: Investor }) {
  const sectors = (Object.entries(inv.revealed.S) as [Sector, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const stages = (Object.entries(inv.revealed.G) as [Stage, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-6">
      <div>
        <Label>Revealed thesis · last 24 months</Label>
        <div className="mt-2 space-y-1.5">
          {sectors.map(([s, w]) => (
            <div key={s} className="flex items-center gap-2 text-[13px]">
              <span className="w-24 truncate text-white/70">{SECTOR_SHORT[s]}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
                <span className="block h-full rounded-full" style={{ width: `${Math.round(w * 100)}%`, background: SECTOR_COLOR[s] }} />
              </span>
              <span className="w-10 text-right font-mono text-[12px] text-white/60">{Math.round(w * 100)}%</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stages.map(([s, w]) => (
            <Chip key={s}>
              {Math.round(w * 100)}% {STAGE_LABELS[s].toLowerCase()}
            </Chip>
          ))}
          <Chip>
            <span className="font-mono">{inv.revealed.dealCount24m}</span> deals
          </Chip>
          <Chip>
            activity <span className="font-mono">{Math.round(inv.revealed.activity * 100)}</span>
          </Chip>
          {inv.contradictionLine && <Chip tone="accent">⚠ {inv.contradictionLine}</Chip>}
        </div>
      </div>
      <div className="w-64">
        <Label>Stated thesis</Label>
        <p className="mt-2 text-[13px] leading-relaxed text-white/60">{inv.statedThesis.text}</p>
      </div>
    </div>
  );
}

export default function InvestorPage() {
  const router = useRouter();
  const investors = useMemo(() => loadInvestors(), []);
  const seeded = useMemo(() => loadFounders(), []);
  const debriefs = useMemo(() => loadDebriefs(), []);
  const live = useLiveProfile();
  const { store, identity, express, setInvestorId, upsertVerification, send } = useInterestStore();
  const { addRoom } = useRooms();

  const inv = investors.find((i) => i.id === identity.investorId) ?? null;
  useEffect(() => {
    if (!identity.investorId) setInvestorId(investors[0]?.id ?? null);
  }, [identity.investorId, investors, setInvestorId]);

  const founders: FounderProfile[] = useMemo(() => (live && Object.keys(live.sectors).length ? [live, ...seeded] : seeded), [live, seeded]);
  const matches = useMemo(() => (inv ? rankFounders(inv, founders, debriefs) : []), [inv, founders, debriefs]);
  const suggestions = useMemo(() => (inv ? suggestRooms(inv, matches, founders) : []), [inv, matches, founders]);

  const interestByFounder = useMemo(() => {
    const m = new Map<string, InterestState>();
    if (!inv) return m;
    for (const i of store.interests) if (i.investorId === inv.id) m.set(i.founderId, i.state);
    return m;
  }, [store.interests, inv]);
  const openCount = inv ? openInterestCount(store, inv.id) : 0;
  const capHit = openCount >= INVESTOR_OPEN_CAP;

  const [builderSector, setBuilderSector] = useState<Sector | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invVerification = inv ? store.verifications.find((v) => v.subjectId === inv.id && v.side === "investor") : undefined;
  const invVerified = !!invVerification && invVerification.checks.every((c) => c.passed);
  const conversations = inv ? store.interests.filter((i) => i.investorId === inv.id && (i.state === "chat_open" || i.state === "pending_verification")) : [];
  const fById = useMemo(() => new Map(founders.map((f) => [f.id, f])), [founders]);

  const onCreateRoom = (room: Room) => {
    addRoom(room);
    setBuilderSector(null);
    router.push(`/room/${room.id}`);
  };

  return (
    <main className="min-h-screen bg-[#0B0E17] font-sans text-white/90">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0B0E17]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-[13px] text-white/50 hover:text-white/80">
              ← Founder view
            </Link>
            <span className="text-[13px] font-medium text-white/90">Investor view</span>
            {usingFixtures() && <Chip tone="muted">FIXTURE DATA</Chip>}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[12px] text-white/45">
              {openCount}/{INVESTOR_OPEN_CAP} open requests
            </span>
            <InvestorPicker investors={investors} value={inv} onChange={(i) => setInvestorId(i.id)} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {inv && (
          <Panel className="p-5">
            <div className="flex items-start gap-4">
              <Avatar name={inv.name} size={48} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-medium text-white/95">{inv.name}</h1>
                  <Chip tone="muted">{inv.kind.replace("_", " ")}</Chip>
                  {invVerified ? (
                    <Chip tone="accent" dot="#FF6A3D">
                      Verified via Cala partner record
                    </Chip>
                  ) : (
                    <Chip tone="muted">unverified</Chip>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-white/50">
                  Partners: {inv.partners.map((p) => p.name).join(", ")}
                  {inv.website && <span className="text-white/30"> · {inv.website.replace(/^https?:\/\//, "")}</span>}
                </p>
                <div className="mt-4">
                  <RevealedSummary inv={inv} />
                </div>
                {!invVerified && (
                  <div className="mt-2">
                    <InvestorVerifyForm key={inv.id} investor={inv} onVerified={upsertVerification} />
                  </div>
                )}
                {invVerified && invVerification && (
                  <p className="mt-3 text-[12px] text-white/45">{invVerification.checks.map((c) => c.detail).join(" · ")}</p>
                )}
              </div>
            </div>
          </Panel>
        )}

        {suggestions.map((s) => (
          <RoomSuggestionCard key={s.sector} suggestion={s} onOpen={() => setBuilderSector(s.sector)} />
        ))}

        {conversations.length > 0 && inv && (
          <section>
            <Label className="mb-2">Conversations</Label>
            <div className="grid gap-3 md:grid-cols-2">
              {conversations.map((c) => {
                const f = fById.get(c.founderId);
                if (!f) return null;
                return (
                  <Panel key={c.id} className="p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[13px] text-white/85">
                        {f.company ?? f.name} <span className="text-white/40">· {f.name}</span>
                      </span>
                      <Chip tone={c.state === "chat_open" ? "accent" : "muted"}>{c.state === "chat_open" ? "chat open" : "pending verification"}</Chip>
                    </div>
                    {c.state === "chat_open" ? (
                      <ChatThread
                        interest={c}
                        messages={store.messages}
                        me="investor"
                        counterpartName={f.name ?? f.company ?? "founder"}
                        onSend={(text) => {
                          const r = send(c.id, "investor", text);
                          return r.ok ? { ok: true } : { ok: false, error: r.error };
                        }}
                      />
                    ) : (
                      <p className="text-[12px] text-white/45">
                        {invVerified ? "Waiting for the founder to verify their company." : "Verify as a partner above to unlock this chat."}
                      </p>
                    )}
                  </Panel>
                );
              })}
            </div>
          </section>
        )}

        {error && (
          <div className="rounded-lg border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-4 py-2 text-[13px] text-[#FF6A3D]">
            {error}
            <button type="button" className="ml-3 text-white/60 hover:text-white/90" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}

        {inv && (
          <FounderFeed
            founders={founders}
            matches={matches}
            interestByFounder={interestByFounder}
            capHit={capHit}
            onInterested={(fid) => {
              const r = express(inv.id, fid);
              setError(r.ok ? null : r.error);
            }}
          />
        )}
      </div>

      {builderSector && inv && (
        <RoomBuilder
          sector={builderSector}
          founders={founders}
          investors={investors}
          debriefs={debriefs}
          hostInvestorId={inv.id}
          onCreate={onCreateRoom}
          onClose={() => setBuilderSector(null)}
        />
      )}
    </main>
  );
}
