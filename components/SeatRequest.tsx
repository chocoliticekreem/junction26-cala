"use client";

import { useState } from "react";
import type { SeatRequest as SeatRequestRecord } from "@/lib/types";
import { errorMessage } from "@/lib/engine";
import { useInterestStore } from "@/lib/interestStore";
import { Button, Chip } from "@/components/ui";

export type SeatRequestProps = { roomId: string; founderId?: string };

const LABEL: Record<SeatRequestRecord["state"], string> = {
  requested: "Seat requested",
  seated: "You're seated",
  waitlisted: "Waitlisted",
};

export function SeatRequest({ roomId, founderId }: SeatRequestProps) {
  const { store, identity, requestSeat } = useInterestStore();
  const fid = founderId ?? identity.founderId;
  const mine = store.seats.find((s) => s.roomId === roomId && s.founderId === fid);
  const otherOpen = store.seats.find((s) => s.founderId === fid && s.state === "requested" && s.roomId !== roomId);
  const [error, setError] = useState<string | null>(null);

  if (mine) {
    return (
      <div data-testid="seat-state" data-state={mine.state} className="flex items-center gap-2">
        <Chip tone={mine.state === "seated" ? "accent" : "neutral"}>{LABEL[mine.state]}</Chip>
        <span className="text-[12px] text-white/40">
          {mine.state === "requested" ? "The host will seat or waitlist you." : mine.state === "seated" ? "See you there." : "We'll tell you if a seat opens."}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="accent"
        disabled={!!otherOpen}
        title={otherOpen ? "You already have one open seat request" : undefined}
        onClick={() => {
          const r = requestSeat(roomId, fid);
          setError(r.ok ? null : errorMessage(r.error));
        }}
        dataTestId="request-seat"
      >
        Request a seat
      </Button>
      <span className="text-[12px] text-white/40">{otherOpen ? "One open request at a time." : "One open seat request per founder."}</span>
      {error && <span className="text-[12px] text-[#FF6A3D]">{error}</span>}
    </div>
  );
}
