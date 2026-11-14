"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { LIVE_FOUNDER_ID, useInterestStore, useLiveProfile, useRooms } from "@/lib/interestStore";
import type { OrbitGroupBy } from "@/lib/orbit";
import FounderOrbit from "@/components/FounderOrbit";
import { FounderFeed, Seg } from "@/components/FounderFeed";
import { RoomSuggestionCard } from "@/components/RoomSuggestionCard";
import { RoomBuilder } from "@/components/RoomBuilder";
import { InvestorVerifyForm } from "@/components/VerificationChecklist";
import { ChatThread } from "@/components/ChatThread";
import TopBar from "@/components/TopBar";
import { Avatar, Chip, Label, Panel } from "@/components/ui";

const FIXTURES = usingFixtures();

function InvestorPicker({ investors, value, onChange }: { investors: Investor[]; value: Investor | null; onChange: (i: Investor) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const hits = investors.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="relative w-56 md:w-72">
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
        className="h-8 w-full rounded-lg border border-white/12 bg-[#141a2a] px-3 text-[12.5px] text-white/90 placeholder:text-white/35 outline-none focus:border-[#FF6A3D]/60"
      />
      {open && (
        <ul className="absolute right-0 z-40 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#121726] shadow-xl">
          {hits.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                data-testid={`pick-${i.id}`}
                onMouseDown={() => {
                  onChange(i);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/[0.06]"
              >
                <span className="truncate">{i.name}</span>
                <span className="shrink-0 text-[11px] text-white/35">{i.kind.replace("_", " ")}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="px-3 py-2 text-[12px] text-white/40">No investor matches.</li>}
        </ul>
      )}
    </div>
  );
}

function RevealedBars({ inv }: { inv: Investor }) {
  const sectors = (Object.entries(inv.revealed.S) as [Sector, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const stages = (Object.entries(inv.revealed.G) as [Stage, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label>Revealed thesis · 24 months</Label>
        <span className="font-mono text-[11px] text-white/40">
          {inv.revealed.dealCount24m} deals · activity {Math.round(inv.revealed.activity * 100)}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {sectors.map(([s, w]) => (
          <div key={s} className="flex items-center gap-2 text-[12.5px]">
            <span className="w-20 truncate text-white/70">{SECTOR_SHORT[s]}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/6">
              <span className="block h-full rounded-full" style={{ width: `${Math.round(w * 100)}%`, background: SECTOR_COLOR[s] }} />
            </span>
            <span className="w-9 text-right font-mono text-[11.5px] text-white/60">{Math.round(w * 100)}%</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {stages.map(([s, w]) => (
          <Chip key={s}>
            {Math.round(w * 100)}% {STAGE_LABELS[s].toLowerCase()}
          </Chip>
        ))}
        {inv.contradictionLine && <Chip tone="accent">⚠ {inv.contradictionLine}</Chip>}
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

  // Hydration serves the server default (investorId null) before localStorage is read,
  // so the fallback is derived at render rather than written back to the store.
  const effectiveId = identity.investorId ?? investors[0]?.id ?? null;
  const inv = investors.find((i) => i.id === effectiveId) ?? null;

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

  const [groupBy, setGroupBy] = useState<OrbitGroupBy>("none");
  const [selectedFounderId, setSelectedFounderId] = useState<string | undefined>(undefined);
  const [builderSector, setBuilderSector] = useState<Sector | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thesisOpen, setThesisOpen] = useState(false);
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedFounderId) return;
    const card = rail.current?.querySelector<HTMLElement>(`[data-testid="founder-card-${selectedFounderId}"]`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedFounderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedFounderId(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const invVerification = inv ? store.verifications.find((v) => v.subjectId === inv.id && v.side === "investor") : undefined;
  const invVerified = !!invVerification && invVerification.checks.every((c) => c.passed);
  const conversations = inv ? store.interests.filter((i) => i.investorId === inv.id && (i.state === "chat_open" || i.state === "pending_verification")) : [];
  const fById = useMemo(() => new Map(founders.map((f) => [f.id, f])), [founders]);
  const liveMatch = matches.find((m) => m.founderId === LIVE_FOUNDER_ID);

  const onCreateRoom = (room: Room) => {
    addRoom(room);
    setBuilderSector(null);
    router.push(`/room/${room.id}`);
  };

  return (
    <div className="shell">
      <TopBar
        subtitle="London founders, ranked against your deals"
        inbox={
          <span className="open-requests font-mono" data-testid="open-requests" data-cap-hit={capHit || undefined}>
            <b>{openCount}</b>/{INVESTOR_OPEN_CAP} open requests
          </span>
        }
        tools={<InvestorPicker investors={investors} value={inv} onChange={(i) => setInvestorId(i.id)} />}
        showFixtureBanner={FIXTURES}
      />
      <main className="inv-stage">
        <section className="orbit-pane" aria-label="Founder orbit">
          {inv && (
            <FounderOrbit
              investor={inv}
              founders={founders}
              matches={matches}
              groupBy={groupBy}
              liveId={LIVE_FOUNDER_ID}
              selectedId={selectedFounderId}
              onSelect={setSelectedFounderId}
            />
          )}
          <div className="orbit-controls">
            <Seg
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "none", label: "By fit" },
                { value: "sector", label: "By sector" },
                { value: "stage", label: "By stage" },
              ]}
            />
          </div>
          <div className="graph-overlay">
            <span>
              <b>{founders.length}</b> founders
            </span>
            <span>
              distance = fit · colour = sector · <span className="k">accent</span> = live pitch
            </span>
          </div>
        </section>

        <aside className="inv-rail" ref={rail}>
          {inv && (
            <Panel className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={inv.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-[16px] font-semibold tracking-tight text-white/95">{inv.name}</h1>
                    <Chip tone="muted">{inv.kind.replace("_", " ")}</Chip>
                    {invVerified ? (
                      <Chip tone="accent" dot="#FF6A3D">
                        Verified via Cala partner record
                      </Chip>
                    ) : (
                      <Chip tone="muted">unverified</Chip>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-white/50">
                    {inv.partners.map((p) => p.name).join(", ")}
                    {inv.website && <span className="text-white/30"> · {inv.website.replace(/^https?:\/\//, "")}</span>}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <RevealedBars inv={inv} />
              </div>
              <button
                type="button"
                onClick={() => setThesisOpen((o) => !o)}
                className="mt-3 flex w-full items-center justify-between text-[11px] uppercase tracking-[0.14em] text-white/40 hover:text-white/70"
                aria-expanded={thesisOpen}
              >
                Stated thesis
                <span className="font-mono text-[11px] normal-case tracking-normal">{thesisOpen ? "hide" : "show"}</span>
              </button>
              {thesisOpen && <p className="mt-2 text-[12.5px] leading-relaxed text-white/60">{inv.statedThesis.text}</p>}
              {!invVerified && <InvestorVerifyForm key={inv.id} investor={inv} onVerified={upsertVerification} />}
              {invVerified && invVerification && <p className="mt-3 text-[12px] text-white/45">{invVerification.checks.map((c) => c.detail).join(" · ")}</p>}
            </Panel>
          )}

          {suggestions.map((s) => (
            <RoomSuggestionCard key={s.sector} suggestion={s} onOpen={() => setBuilderSector(s.sector)} />
          ))}

          {liveMatch && inv && (
            <button
              type="button"
              onClick={() => setSelectedFounderId(LIVE_FOUNDER_ID)}
              className="flex items-center justify-between rounded-xl border border-[#FF6A3D]/30 bg-[#FF6A3D]/[0.06] px-4 py-2.5 text-left text-[12.5px] text-white/80 transition-colors hover:border-[#FF6A3D]/60"
            >
              <span>
                <span className="text-[#FF6A3D]">Live pitch</span> · {fById.get(LIVE_FOUNDER_ID)?.company ?? "On stage now"} ranks{" "}
                <span className="font-mono">#{matches.indexOf(liveMatch) + 1}</span> for you
              </span>
              <span className="font-mono text-[#FF6A3D]">{Math.round(liveMatch.score)}</span>
            </button>
          )}

          {conversations.length > 0 && inv && (
            <section>
              <Label className="mb-2">Conversations</Label>
              <div className="grid gap-3">
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
              groupBy={groupBy}
              selectedId={selectedFounderId}
              onSelect={setSelectedFounderId}
              onInterested={(fid) => {
                const r = express(inv.id, fid);
                setError(r.ok ? null : r.error);
              }}
            />
          )}
        </aside>
      </main>

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
    </div>
  );
}
