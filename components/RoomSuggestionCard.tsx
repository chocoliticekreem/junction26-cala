"use client";

import { SECTOR_COLOR, SECTOR_SHORT } from "@/lib/taxonomy";
import type { RoomSuggestion } from "@/components/dev-e/engine";
import { Button } from "@/components/dev-e/ui";

export type RoomSuggestionCardProps = { suggestion: RoomSuggestion; onOpen: () => void };

export function RoomSuggestionCard({ suggestion, onOpen }: RoomSuggestionCardProps) {
  const short = SECTOR_SHORT[suggestion.sector];
  return (
    <div
      data-testid="room-suggestion"
      className="room-pulse relative overflow-hidden rounded-xl border border-[#FF6A3D]/40 bg-[#121726] p-4"
      style={{ ["--pulse" as string]: "#FF6A3D" }}
    >
      <style>{`
        @keyframes room-pulse-kf { 0% { box-shadow: 0 0 0 0 rgba(255,106,61,.55); } 100% { box-shadow: 0 0 0 18px rgba(255,106,61,0); } }
        .room-pulse { animation: room-pulse-kf 1.4s cubic-bezier(.33,1,.68,1) 1; }
        @media (prefers-reduced-motion: reduce) { .room-pulse { animation: none; } }
      `}</style>
      <div className="flex items-center gap-4">
        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-white/10" style={{ background: `${SECTOR_COLOR[suggestion.sector]}22` }}>
          <span className="size-3 rounded-full" style={{ background: SECTOR_COLOR[suggestion.sector] }} />
          <span className="absolute -top-1 -right-1 rounded-full bg-[#FF6A3D] px-1.5 font-mono text-[10px] font-semibold leading-4 text-[#0B0E17]">
            {suggestion.count}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[#FF6A3D]">Room suggestion</div>
          <p className="mt-0.5 text-[14px] text-white/90">
            <span className="font-mono">{suggestion.count}</span> matched founders in {short.toLowerCase()}: host a {short.toLowerCase()} room
          </p>
        </div>
        <Button variant="accent" onClick={onOpen} dataTestId="open-room-builder">
          Build the room
        </Button>
      </div>
    </div>
  );
}
