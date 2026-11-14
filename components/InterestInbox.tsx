"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Deal, FounderProfile, Interest, Investor } from "@/lib/types";
import { SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import { errorMessage, loadInvestors, rankFounders } from "@/lib/engine";
import { countedDeals } from "@/lib/revealed";
import { DATA_AS_OF } from "@/lib/data";
import { useInterestStore, useLiveProfile } from "@/lib/interestStore";
import { VerificationChecklist } from "@/components/VerificationChecklist";
import { ChatThread } from "@/components/ChatThread";
import { Avatar, Button, Chip, Label, dealsSince } from "@/components/ui";

// Mount points for Track D's top bar:
//   <InboxBadge onClick={() => setOpen(true)} />          count + pulse on a new request
//   <InterestInbox open={open} onClose={() => setOpen(false)} />   drawer (omit `open` to render inline)
// Both default to the founder identity ("live") and the live profile in localStorage.

export type InboxBadgeProps = { founderId?: string; onClick?: () => void; className?: string };

export function InboxBadge({ founderId, onClick, className = "" }: InboxBadgeProps) {
  const { store, identity } = useInterestStore();
  const fid = founderId ?? identity.founderId;
  const count = store.interests.filter((i) => i.founderId === fid && i.state === "interested").length;
  const total = store.interests.filter((i) => i.founderId === fid && i.state !== "declined" && i.state !== "expired" && i.state !== "withdrawn").length;
  const prev = useRef(count);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (count > prev.current) setPulseKey((k) => k + 1);
    prev.current = count;
  }, [count]);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="inbox-badge"
      data-count={count}
      className={`relative inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-white/80 transition-colors hover:border-white/25 ${className}`}
    >
      <style>{`
        @keyframes badge-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,106,61,.7); } 100% { box-shadow: 0 0 0 12px rgba(255,106,61,0); } }
        .badge-pulse { animation: badge-pulse .9s cubic-bezier(.33,1,.68,1) 1; }
      `}</style>
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
        <path d="M4 7l8 6 8-6" />
      </svg>
      Requests
      {total > 0 && (
        <span
          key={pulseKey}
          className={`${pulseKey > 0 ? "badge-pulse" : ""} min-w-5 rounded-full px-1.5 text-center font-mono text-[11px] font-semibold leading-5 ${
            count > 0 ? "bg-[#FF6A3D] text-[#0B0E17]" : "bg-white/10 text-white/70"
          }`}
        >
          {count > 0 ? count : total}
        </span>
      )}
    </button>
  );
}

export type InterestInboxProps = {
  founderId?: string;
  founder?: FounderProfile;
  open?: boolean;
  onClose?: () => void;
};

function topSector(f: FounderProfile): Sector | undefined {
  return (Object.entries(f.sectors) as [Sector, number][]).sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Counts only deals inside the 24-month revealed-thesis window, like the scorer does.
export function evidenceLine(
  inv: Investor,
  f: FounderProfile,
  now: Date = DATA_AS_OF,
): { line: string; deals: Deal[] } {
  const sector = topSector(f);
  const recent = countedDeals(inv.deals, now).map((c) => c.deal);
  const deals = recent.filter((d) => !sector || d.sector === sector);
  const stageDeals = f.stage ? deals.filter((d) => d.round === f.stage) : deals;
  const use = stageDeals.length >= 2 ? stageDeals : deals;
  const since = dealsSince(use);
  const stageWord = stageDeals.length >= 2 && f.stage ? `${STAGE_LABELS[f.stage].toLowerCase()} ` : "";
  const sectorWord = sector ? `${SECTOR_SHORT[sector].toLowerCase()} ` : "";
  const line = use.length
    ? `backed ${use.length} ${stageWord}${sectorWord}compan${use.length === 1 ? "y" : "ies"}${since ? ` since ${since}` : ""}`
    : `no ${sectorWord}deals in the last 24 months`;
  return { line, deals: use.slice(0, 3) };
}

function fallbackFounder(id: string): FounderProfile {
  return { id, name: "You", company: "Your company", sectors: {}, teamSignals: [], confidence: {} };
}

export function InterestInbox({ founderId, founder, open, onClose }: InterestInboxProps) {
  const { store, identity, accept, decline, send, upsertVerification } = useInterestStore();
  const live = useLiveProfile();
  const fid = founderId ?? identity.founderId;
  const me = founder ?? (live && live.id === fid ? live : null) ?? fallbackFounder(fid);
  const investors = useMemo(() => loadInvestors(), []);
  const byId = useMemo(() => new Map(investors.map((i) => [i.id, i])), [investors]);

  const requests = store.interests
    .filter((i) => i.founderId === fid && i.state !== "expired" && i.state !== "withdrawn")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const active = requests.filter((i) => i.state !== "declined");
  const declined = requests.filter((i) => i.state === "declined");

  const body = (
    <div data-testid="interest-inbox" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-medium text-white/90">Interest requests</h2>
          <p className="text-[12px] text-white/50">Investors who tapped Interested on your pitch. Accept to verify both sides and open a chat.</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white/80" aria-label="Close inbox">
            ✕
          </button>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {active.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-[13px] text-white/40">
            No requests yet. When an investor taps Interested, it lands here.
          </div>
        )}
        {active.map((req) => {
          const inv = byId.get(req.investorId);
          if (!inv) return null;
          return (
            <RequestCard
              key={req.id}
              req={req}
              inv={inv}
              me={me}
              store={store}
              onAccept={() => accept(req.id)}
              onDecline={() => decline(req.id)}
              onVerify={upsertVerification}
              onSend={(text) => {
                const r = send(req.id, "founder", text);
                return r.ok ? { ok: true } : { ok: false, error: errorMessage(r.error) };
              }}
            />
          );
        })}
        {declined.length > 0 && (
          <div className="pt-2">
            <Label className="mb-1.5">Declined</Label>
            <ul className="space-y-1">
              {declined.map((d) => (
                <li key={d.id} className="text-[12px] text-white/35">
                  {byId.get(d.investorId)?.name ?? d.investorId} · not now
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );

  if (open === undefined) return <div className="rounded-xl border border-white/8 bg-[#121726]">{body}</div>;
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0B0E17]/60 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="h-full w-full max-w-xl border-l border-white/8 bg-[#121726] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {body}
      </aside>
    </div>
  );
}

function RequestCard({
  req,
  inv,
  me,
  store,
  onAccept,
  onDecline,
  onVerify,
  onSend,
}: {
  req: Interest;
  inv: Investor;
  me: FounderProfile;
  store: ReturnType<typeof useInterestStore>["store"];
  onAccept: () => void;
  onDecline: () => void;
  onVerify: ReturnType<typeof useInterestStore>["upsertVerification"];
  onSend: (text: string) => { ok: boolean; error?: string };
}) {
  const evidence = useMemo(() => evidenceLine(inv, me), [inv, me]);
  const match = useMemo(() => rankFounders(inv, [me])[0], [inv, me]);
  const suggested = `Hi ${inv.partners[0]?.name.split(" ")[0] ?? inv.name}, thanks for reaching out. I saw ${inv.name} ${evidence.line}, which is exactly where ${me.company ?? "we"} sit${me.company ? "s" : ""}: ${me.oneLiner ?? "happy to share more"}. Would a 20-minute call this week work?`;
  const stages = (Object.entries(inv.revealed.G) as [Stage, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2);

  return (
    <article data-testid={`request-${req.id}`} data-state={req.state} className="rounded-xl border border-white/8 bg-[#0B0E17]/60 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={inv.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-medium text-white/90">{inv.name}</h3>
            <Chip tone="muted">{inv.kind.replace("_", " ")}</Chip>
            {inv.fixture && <Chip tone="muted">fixture</Chip>}
          </div>
          <p className="mt-0.5 text-[13px] text-white/55">{inv.statedThesis.text}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone="accent">{evidence.line}</Chip>
            {stages.map(([s, w]) => (
              <Chip key={s}>
                {Math.round(w * 100)}% {STAGE_LABELS[s].toLowerCase()}
              </Chip>
            ))}
            {inv.contradictionLine && <Chip tone="muted">⚠ {inv.contradictionLine}</Chip>}
          </div>
          {evidence.deals.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-white/45">
              {evidence.deals.map((d, i) => (
                <li key={i}>
                  {d.company} · {d.round === "unknown" ? "round n/a" : STAGE_LABELS[d.round]} · {d.date?.slice(0, 4)}
                  {d.sources[0] && <span className="text-white/30"> · {d.sources[0].name}</span>}
                </li>
              ))}
            </ul>
          )}
          {match && <p className="mt-2 text-[12px] text-white/45">Fit {Math.round(match.score)}/100 · {match.reason}</p>}
        </div>
        {req.state === "interested" && (
          <div className="flex shrink-0 gap-2">
            <Button variant="danger" onClick={onDecline} dataTestId={`decline-${req.id}`}>
              Decline
            </Button>
            <Button variant="accent" onClick={onAccept} dataTestId={`accept-${req.id}`}>
              Accept
            </Button>
          </div>
        )}
      </div>

      {(req.state === "pending_verification" || req.state === "chat_open" || req.state === "accepted") && (
        <div className="mt-4 space-y-3">
          <VerificationChecklist interest={req} investor={inv} founder={me} store={store} side="founder" onVerify={onVerify} />
          {req.state === "chat_open" && (
            <ChatThread interest={req} messages={store.messages} me="founder" counterpartName={inv.name} suggestedFirst={suggested} onSend={onSend} />
          )}
        </div>
      )}
    </article>
  );
}
