"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { usingFixtures } from "@/lib/data";
import Constellation from "@/components/spotter/Constellation";
import InvestorPicker, { type PickerOption } from "@/components/spotter/InvestorPicker";
import PickCard from "@/components/spotter/PickCard";
import PickList from "@/components/spotter/PickList";
import TasteStrip from "@/components/spotter/TasteStrip";
import { useInvestorOptions, useSpotter } from "@/components/spotter/useSpotter";
import { sectorColor } from "@/components/spotter/format";
import { SECTOR_COLOR, SECTOR_SHORT, type Sector } from "@/lib/taxonomy";
import "@/components/spotter/spotter.css";

const FIXTURES = usingFixtures();
const QUICK = ["Seedcamp", "Entrepreneur First", "Lightspeed Venture Partners"];

// Taste rows come back with short labels; map them back to the sector hue used on the map.
const SHORT_TO_SECTOR = Object.fromEntries((Object.entries(SECTOR_SHORT) as [Sector, string][]).map(([s, short]) => [short, s])) as Record<string, Sector>;
function tasteColor(label: string): string {
  const s = SHORT_TO_SECTOR[label];
  return s ? SECTOR_COLOR[s] : sectorColor(label);
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export default function SpotterPage() {
  const investorsState = useInvestorOptions();
  const options: PickerOption[] = investorsState.status === "ok" ? investorsState.options : [];
  const [investor, setInvestor] = useState<PickerOption | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const { state, retry } = useSpotter(investor ? { investorId: investor.id } : null);
  const pickInvestor = (o: PickerOption) => {
    setSelectedId(undefined);
    setInvestor(o);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const data = state.status === "ok" ? state.data : null;
  const picks = data?.picks ?? [];
  const selectedIndex = picks.findIndex((p) => p.company.id === selectedId);
  const selected = selectedIndex >= 0 ? picks[selectedIndex] : null;
  const quick = QUICK.map((name) => options.find((o) => o.name === name)).filter((o): o is PickerOption => !!o);
  const noCohort = state.status === "no_cohort" || investorsState.status === "no_cohort";

  return (
    <div className="shell">
      <TopBar
        subtitle="Early spotter · companies on a unicorn-shaped path"
        inbox={null}
        tools={<InvestorPicker options={options} value={investor} onChange={pickInvestor} loading={investorsState.status === "loading"} />}
        showFixtureBanner={FIXTURES}
      />
      <main className="sp-stage">
        <section className="sp-pane-wrap relative min-h-0" aria-label="Unicorn-path constellation" data-selected={selected ? "" : undefined}>
          {picks.length > 0 && (
            <Constellation investorName={data?.investor.name ?? ""} picks={picks} selectedId={selectedId} onSelect={setSelectedId} reducedMotion={reducedMotion} />
          )}
          {picks.length > 0 && (
            <div className="sp-title">
              <b>{picks.length} companies on a unicorn-shaped path</b>
              <span>
                ranked for <span className="k">{data?.investor.name}</span>
              </span>
            </div>
          )}
          {picks.length > 0 && (
            <div className="sp-legend">
              <span>
                closer = <b>stronger path</b> · glow = <b>unicorn odds</b> · <span className="k">ring</span> = you on its path
              </span>
              <span className="sp-honesty font-mono" data-testid="spotter-basis">
                {data?.basis} · as of {data?.asOf}
              </span>
            </div>
          )}
          {selected && <PickCard key={selected.company.id} pick={selected} rank={selectedIndex + 1} onClose={() => setSelectedId(undefined)} />}

          {state.status === "idle" && !noCohort && (
            <div className="sp-idle" data-testid="spotter-idle">
              <p className="hero-kicker">Early spotter</p>
              <h1 className="hero-title">Who is on a unicorn-shaped path?</h1>
              <p className="hero-sub">Pick an investor. The map ranks early companies by how much their path looks like one that went all the way, and how often you were on it.</p>
              <div className="sp-quick">
                {quick.map((o) => (
                  <button key={o.id} type="button" className="hero-btn" onClick={() => pickInvestor(o)} data-testid={`spotter-quick-${o.id}`}>
                    <i aria-hidden />
                    {o.name}
                  </button>
                ))}
              </div>
              {investorsState.status === "error" && (
                <p className="sp-idle-note" role="alert" data-testid="spotter-investors-error">
                  Could not load the investor list. {investorsState.message}
                </p>
              )}
            </div>
          )}
          {state.status === "loading" && (
            <div className="sp-loading" data-testid="spotter-loading" aria-live="polite">
              <div className="sp-loading-orb" />
            </div>
          )}
          {noCohort && (
            <div className="sp-error" data-testid="spotter-no-cohort" role="status">
              <span>No Cala cohort is loaded on this deploy, so there is nothing real to rank.</span>
            </div>
          )}
          {state.status === "ok" && picks.length === 0 && (
            <div className="sp-error" data-testid="spotter-empty">
              <span>No company on a unicorn-shaped path matches {data?.investor.name} yet.</span>
            </div>
          )}
          {state.status === "error" && (
            <div className="sp-error" data-testid="spotter-error" role="alert">
              <span>Could not load picks. {state.message}</span>
              <button type="button" className="btn" onClick={retry}>
                Retry
              </button>
            </div>
          )}
        </section>

        <aside className="sp-rail">
          {data && <TasteStrip investor={data.investor} sectorColor={tasteColor} />}
          {picks.length > 0 && <PickList picks={picks} selectedId={selectedId} onSelect={(id) => setSelectedId((cur) => (cur === id ? undefined : id))} />}
          {!data && state.status !== "loading" && (
            <section className="sp-card">
              <div className="sp-card-head">
                <span>Your taste</span>
                <span className="muted">from your real deals</span>
              </div>
              <p className="muted text-[12.5px]">Pick an investor to see sector and stage mix, round band and lead share.</p>
            </section>
          )}
          {picks.length === 0 && (
            <section className="sp-card" aria-hidden>
              <div className="sp-card-head">
                <span>On a unicorn-shaped path</span>
                <span className="muted">{state.status === "loading" ? "ranking…" : "waiting for you"}</span>
              </div>
              <div className="matches-idle" style={{ position: "static", inset: "auto" }}>
                <ul>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <li key={i}>
                      <span className="sk sk-rank" />
                      <span>
                        <span className="sk sk-name" />
                        <span className="sk sk-line" />
                      </span>
                      <span className="sk sk-score" />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
