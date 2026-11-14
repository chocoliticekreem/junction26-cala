"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Graph from "@/components/Graph";
import MatchList from "@/components/MatchList";
import ProfileChips from "@/components/ProfileChips";
import ProfilePanel from "@/components/ProfilePanel";
import TopBar from "@/components/TopBar";
import TranscriptRail from "@/components/TranscriptRail";
import { MOCK_INVESTORS } from "@/components/dev/mockState";
import { useMockTimeline } from "@/components/dev/useMockTimeline";
import { isSttSupported, pickProvider, type SttSession } from "@/lib/stt";
import type { Investor } from "@/lib/types";

const subscribeNever = () => () => {};

// Wiring surface. Today every field below comes from the mock timeline; the real engine
// swaps in here: investors from lib/data, transcript from lib/stt + lib/replay, profile
// from mergeProfile(fallbackExtract / /api/extract), matches from rankInvestors.
export default function FounderPage() {
  const investors: Investor[] = MOCK_INVESTORS;
  const mock = useMockTimeline(true);
  const { transcript, profile, matches, triggers, playing, replay } = mock;

  const [selectedInvestorId, setSelectedInvestorId] = useState<string | undefined>(undefined);
  const [interim, setInterim] = useState<string>("");
  const [micOn, setMicOn] = useState(false);
  const sttSupported = useSyncExternalStore(subscribeNever, isSttSupported, () => false);
  const micState: "idle" | "listening" | "unsupported" = !sttSupported ? "unsupported" : micOn ? "listening" : "idle";
  const [liveFinals, setLiveFinals] = useState<{ text: string; t: number; final: boolean }[]>([]);
  const session = useRef<SttSession | null>(null);

  const onReplay = useCallback(() => {
    session.current?.stop();
    session.current = null;
    setMicOn(false);
    setLiveFinals([]);
    setInterim("");
    setSelectedInvestorId(undefined);
    replay();
  }, [replay]);

  const onMic = useCallback(() => {
    if (session.current) {
      session.current.stop();
      session.current = null;
      setMicOn(false);
      setInterim("");
      return;
    }
    const provider = pickProvider();
    session.current = provider.start({
      onInterim: setInterim,
      onFinal: (text) => {
        setInterim("");
        setLiveFinals((prev) => [...prev, { text, t: performance.now(), final: true }]);
      },
      onError: () => {
        setMicOn(false);
        session.current = null;
      },
      onEnd: () => {
        setMicOn(false);
        session.current = null;
      },
    });
    setMicOn(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "r" || e.key === "R") onReplay();
      if (e.key === "Escape") setSelectedInvestorId(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onReplay]);

  const tokens = useMemo(() => {
    const all = [...transcript, ...liveFinals];
    return interim ? [...all, { text: interim, t: 0, final: false }] : all;
  }, [transcript, liveFinals, interim]);

  const selected = selectedInvestorId ? investors.find((i) => i.id === selectedInvestorId) : undefined;
  const selectedMatch = selectedInvestorId ? matches.find((m) => m.investorId === selectedInvestorId) : undefined;
  const usingFixtures = investors.some((i) => i.fixture);

  return (
    <div className="shell">
      <TopBar
        inboxCount={0}
        onInbox={() => {}}
        onReplay={onReplay}
        replaying={playing}
        micState={micState}
        onMic={onMic}
        showFixtureBanner={usingFixtures}
      />
      <main className="stage">
        <section className="graph-pane" aria-label="Investor map">
          <Graph investors={investors} matches={matches} selectedId={selectedInvestorId} onSelect={setSelectedInvestorId} center={{ label: profile.company ?? "You" }} padLeft={selected ? 392 : 0} />
          {selected && <ProfilePanel investor={selected} match={selectedMatch} onClose={() => setSelectedInvestorId(undefined)} />}
          <div className="graph-overlay">
            <span>
              <b>{investors.length}</b> London investors
            </span>
            <span>
              distance = fit · colour = sector · <span className="k">accent</span> = about you
            </span>
          </div>
        </section>
        <aside className="rail">
          <TranscriptRail tokens={tokens} live={playing || micState === "listening"} />
          <ProfileChips profile={profile} triggers={triggers} />
          <MatchList matches={matches} investors={investors} selectedId={selectedInvestorId} onSelect={setSelectedInvestorId} />
        </aside>
      </main>
    </div>
  );
}
