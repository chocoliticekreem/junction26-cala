"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { usingFixtures } from "@/lib/data";
import Constellation from "@/components/spotter/Constellation";
import HowItWorks from "@/components/spotter/HowItWorks";
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

// Three named funds plus the busiest other one in the cohort, so the first click is one of four.
function quickPicks(options: PickerOption[]): PickerOption[] {
  const named = QUICK.map((name) => options.find((o) => o.name === name)).filter((o): o is PickerOption => !!o);
  const extra = options.find((o) => !QUICK.includes(o.name));
  return extra ? [...named, extra].slice(0, 4) : named;
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
  const quick = quickPicks(options);
  const noCohort = state.status === "no_cohort" || investorsState.status === "no_cohort";
  const picker = <InvestorPicker options={options} value={investor} onChange={pickInvestor} loading={investorsState.status === "loading"} placeholder={investor ? "Switch fund…" : "Search funds…"} id="spotter-fund" />;

  return (
    <div className="shell">
      <TopBar subtitle="Early spotter · for funds" inbox={null} tools={investor ? picker : undefined} showFixtureBanner={FIXTURES} />
      <main className="sp-stage">
        <section className="sp-pane-wrap relative min-h-0" aria-label="Your picks, mapped" data-selected={selected ? "" : undefined}>
          {picks.length > 0 && (
            <Constellation investorName={data?.investor.name ?? ""} picks={picks} selectedId={selectedId} onSelect={setSelectedId} reducedMotion={reducedMotion} />
          )}
          {data && picks.length > 0 && (
            <div className="sp-title">
              <b>
                {picks.length} picks for <span className="k">{data.investor.name}</span>
              </b>
              <span>young companies in your lane, not yet in your portfolio</span>
              <HowItWorks data={data} />
            </div>
          )}
          {data && picks.length > 0 && (
            <div className="sp-legend">
              <span>
                closer to you = <b>higher rank</b> · glow = <b>unicorn-like odds</b> · <span className="k">orange ring</span> = you&rsquo;re on its path
              </span>
              <span className="sp-honesty font-mono" data-testid="spotter-basis">
                {data.considered.roundsInCohort} real rounds in Cala · as of {data.asOf}
              </span>
            </div>
          )}
          {selected && data && <PickCard key={selected.company.id} pick={selected} investor={data.investor} rank={selectedIndex + 1} asOf={data.asOf} onClose={() => setSelectedId(undefined)} />}

          {state.status === "idle" && !noCohort && (
            <div className="sp-idle" data-testid="spotter-idle">
              <p className="hero-kicker">Early spotter · for funds</p>
              <h1 className="hero-title">Your next breakout, before the round.</h1>
              <p className="hero-sub">Pick your fund. We learn your taste from your real rounds in Cala, then rank young companies outside your portfolio whose first rounds look like past unicorns&rsquo;.</p>
              <div className="sp-ask">
                <label htmlFor="spotter-fund">Which fund are you?</label>
                {picker}
              </div>
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
                  Could not load the fund list. {investorsState.message}
                </p>
              )}
            </div>
          )}
          {state.status === "loading" && (
            <div className="sp-loading" data-testid="spotter-loading" aria-live="polite">
              <div className="sp-loading-orb" />
              <span>Learning {investor?.name}&rsquo;s taste and ranking its lane…</span>
            </div>
          )}
          {noCohort && (
            <div className="sp-error" data-testid="spotter-no-cohort" role="status">
              <span>No Cala cohort is loaded on this deploy, so there is nothing real to rank.</span>
            </div>
          )}
          {state.status === "ok" && picks.length === 0 && (
            <div className="sp-error" data-testid="spotter-empty">
              <span>No young company in {data?.investor.name}&rsquo;s lane yet.</span>
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
          {picks.length === 0 && (
            <section className="sp-card" aria-hidden>
              <div className="sp-card-head">
                <span>Ranked picks</span>
                <span className="muted">{state.status === "loading" ? "ranking…" : "pick a fund first"}</span>
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
