"use client";

import { useState } from "react";
import Link from "next/link";
import { InboxBadge, InterestInbox } from "@/components/InterestInbox";
import { useLiveProfile, writeLiveProfile, LIVE_FOUNDER_ID } from "@/lib/interestStore";
import { Button, Chip } from "@/components/ui";

// Founder-side harness for the two-window demo and the e2e smoke test. Track D's page.tsx
// mounts InboxBadge + InterestInbox in the real top bar; this page only hosts them.

const DEMO_LIVE = {
  id: LIVE_FOUNDER_ID,
  name: "Anson Lee",
  company: "Cellwright Bio",
  oneLiner: "Engineered T-cells for solid tumours, pre-seed, raising $800k",
  sectors: { "biotech/therapeutics": 0.8, healthtech: 0.2 } as const,
  stage: "pre-seed" as const,
  raise: 800_000,
  traction: { users: "2 pilot labs" },
  teamSignals: ["PhD founder"],
  confidence: { sectors: 0.9, stage: 0.9, raise: 0.8 },
};

export default function InboxTestPage() {
  const live = useLiveProfile();
  const [open, setOpen] = useState(false);

  return (
    <main className="min-h-screen bg-[#0B0E17] font-sans text-white/90">
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/investor" className="text-[13px] text-white/50 hover:text-white/80">
              ← Investor view
            </Link>
            <span className="text-[13px] font-medium">Founder inbox (test harness)</span>
            {live ? <Chip tone="accent">live profile: {live.company ?? live.id}</Chip> : <Chip tone="muted">no live profile</Chip>}
          </div>
          <div className="flex items-center gap-2">
            {!live && (
              <Button onClick={() => writeLiveProfile(DEMO_LIVE)} dataTestId="seed-live-profile">
                Seed demo pitch
              </Button>
            )}
            <InboxBadge onClick={() => setOpen(true)} />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-6 py-6">
        <InterestInbox />
      </div>
      <InterestInbox open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
