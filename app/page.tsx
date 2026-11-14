"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Graph from "@/components/Graph";
import { InboxBadge, InterestInbox } from "@/components/InterestInbox";
import MatchList from "@/components/MatchList";
import ProfileChips from "@/components/ProfileChips";
import ProfilePanel from "@/components/ProfilePanel";
import TopBar from "@/components/TopBar";
import TranscriptRail from "@/components/TranscriptRail";
import { loadDebriefs, loadInvestors, loadProgrammes, loadReplay, usingFixtures } from "@/lib/data";
import { doorsFor } from "@/lib/doors";
import { writeLiveProfile } from "@/lib/interestStore";
import { rankInvestors } from "@/lib/scoring";
import { isSttSupported } from "@/lib/stt";
import { usePitch } from "@/lib/usePitch";

const INVESTORS = loadInvestors();
const DEBRIEFS = loadDebriefs();
const PROGRAMMES = loadProgrammes();
const REPLAY = loadReplay();
const FIXTURES = usingFixtures();

const subscribeNever = () => () => {};

export default function FounderPage() {
  const pitch = usePitch(REPLAY);
  const { tokens, profile, triggers, replaying, micOn, replay, toggleMic } = pitch;
  const [selectedInvestorId, setSelectedInvestorId] = useState<string | undefined>(undefined);
  const [inboxOpen, setInboxOpen] = useState(false);
  const sttSupported = useSyncExternalStore(subscribeNever, isSttSupported, () => false);
  const micState: "idle" | "listening" | "unsupported" = !sttSupported ? "unsupported" : micOn ? "listening" : "idle";

  const matches = useMemo(() => rankInvestors(profile, INVESTORS, DEBRIEFS), [profile]);

  useEffect(() => {
    if (Object.keys(profile.sectors).length || profile.stage) writeLiveProfile(profile);
  }, [profile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "r" || e.key === "R") {
        setSelectedInvestorId(undefined);
        replay();
      }
      if (e.key === "Escape") setSelectedInvestorId(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay]);

  const selectedRaw = selectedInvestorId ? INVESTORS.find((i) => i.id === selectedInvestorId) : undefined;
  const selected = useMemo(
    () => (selectedRaw ? { ...selectedRaw, doors: doorsFor(selectedRaw, PROGRAMMES) } : undefined),
    [selectedRaw],
  );
  const selectedMatch = selectedInvestorId ? matches.find((m) => m.investorId === selectedInvestorId) : undefined;

  return (
    <div className="shell">
      <TopBar
        inbox={<InboxBadge onClick={() => setInboxOpen(true)} />}
        onReplay={() => {
          setSelectedInvestorId(undefined);
          replay();
        }}
        replaying={replaying}
        micState={micState}
        onMic={toggleMic}
        showFixtureBanner={FIXTURES}
      />
      <main className="stage">
        <section className="graph-pane" aria-label="Investor map">
          <Graph
            investors={INVESTORS}
            matches={matches}
            selectedId={selectedInvestorId}
            onSelect={setSelectedInvestorId}
            center={{ label: profile.company ?? "You" }}
            padLeft={selected ? 392 : 0}
          />
          {selected && (
            <ProfilePanel investor={selected} match={selectedMatch} onClose={() => setSelectedInvestorId(undefined)} />
          )}
          <div className="graph-overlay">
            <span>
              <b>{INVESTORS.length}</b> London investors
            </span>
            <span>
              distance = fit · colour = sector · <span className="k">accent</span> = about you
            </span>
          </div>
        </section>
        <aside className="rail">
          <TranscriptRail tokens={tokens} live={replaying || micState === "listening"} />
          <ProfileChips profile={profile} triggers={triggers} />
          <MatchList
            matches={matches}
            investors={INVESTORS}
            selectedId={selectedInvestorId}
            onSelect={setSelectedInvestorId}
          />
        </aside>
      </main>
      {inboxOpen && <InterestInbox founder={profile} open onClose={() => setInboxOpen(false)} />}
    </div>
  );
}
