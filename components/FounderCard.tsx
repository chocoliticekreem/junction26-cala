"use client";

import type { FounderProfile, InterestState } from "@/lib/types";
import type { Sector } from "@/lib/taxonomy";
import type { FounderMatch } from "@/lib/engine";
import { INVESTOR_OPEN_CAP } from "@/lib/interest";
import { formatGbp } from "@/lib/scoring";
import { Avatar, Button, Chip, Score, SectorChip, StageChip } from "@/components/ui";

export type FounderCardProps = {
  founder: FounderProfile;
  match: FounderMatch;
  interestState: InterestState | null;
  capHit: boolean;
  onInterested: () => void;
  onWithdraw: () => void;
  selected?: boolean;
  onSelect?: () => void;
};

const STATE_LABEL: Record<InterestState, string> = {
  interested: "Requested",
  accepted: "Accepted",
  pending_verification: "Pending verification",
  chat_open: "Chat open",
  declined: "Not now",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export function FounderCard({ founder, match, interestState, capHit, onInterested, onWithdraw, selected = false, onSelect }: FounderCardProps) {
  const sectors = (Object.entries(founder.sectors) as [Sector, number][]).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const isLive = !founder.seeded;
  const open = interestState && interestState !== "declined" && interestState !== "expired" && interestState !== "withdrawn";
  const disabled = !!open || capHit;
  const title = capHit && !open ? `You have ${INVESTOR_OPEN_CAP} open requests` : undefined;

  return (
    <article
      data-testid={`founder-card-${founder.id}`}
      data-selected={selected || undefined}
      onClick={onSelect}
      className={`group relative flex gap-4 rounded-xl border bg-[#121726] p-4 transition-[border-color,box-shadow] duration-300 hover:border-white/15 ${
        selected ? "border-[#FF6A3D]/70 shadow-[0_0_0_1px_rgba(255,106,61,.35),0_0_28px_rgba(255,106,61,.18)]" : isLive ? "border-[#FF6A3D]/30" : "border-white/8"
      } ${onSelect ? "cursor-pointer" : ""}`}
    >
      <Avatar name={founder.name ?? founder.company ?? founder.id} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-medium text-white/90">{founder.company ?? founder.name ?? founder.id}</h3>
              {isLive ? <Chip tone="accent">live pitch</Chip> : <Chip tone="muted">seeded</Chip>}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-white/60">
              {founder.name && <span className="text-white/45">{founder.name} · </span>}
              {founder.oneLiner ?? "No one-liner yet"}
            </p>
          </div>
          <Score value={Math.round(match.score)} className="shrink-0 text-xl text-white/90" />
        </div>

        <p className="mt-2 text-[13px] text-white/60">
          <span className="text-white/40">Why: </span>
          {match.reason}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {sectors.slice(0, 2).map((s) => (
            <SectorChip key={s} sector={s} />
          ))}
          {founder.stage && <StageChip stage={founder.stage} />}
          {founder.raise && <Chip>raising {formatGbp(founder.raise)}</Chip>}
          {founder.traction?.revenue && <Chip>rev {founder.traction.revenue}</Chip>}
          {founder.traction?.users && <Chip>{founder.traction.users}</Chip>}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between">
        <Button
          variant={open ? "accent" : "ghost"}
          disabled={disabled}
          title={title}
          onClick={onInterested}
          stopPropagation
          dataTestId={`interested-${founder.id}`}
          className={open ? "disabled:opacity-100" : "border-white/15 text-white/90"}
        >
          {open ? STATE_LABEL[interestState!] : interestState === "declined" ? "Not now" : "Interested"}
        </Button>
        {interestState === "interested" && (
          <button
            type="button"
            data-testid={`withdraw-${founder.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onWithdraw();
            }}
            className="mt-1 text-[11px] text-white/40 underline-offset-2 hover:text-white/75 hover:underline"
          >
            Withdraw
          </button>
        )}
        <div className="font-mono text-[10px] text-white/30">
          s{Math.round(match.breakdown.sectorFit * 100)} · g{Math.round(match.breakdown.stageFit * 100)} · c{Math.round(match.breakdown.chequeFit * 100)}
        </div>
      </div>
    </article>
  );
}
