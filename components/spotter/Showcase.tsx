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
const DEFAULT_FUND = "Seedcamp";
const QUICK = ["Seedcamp", "Entrepreneur First", "Lightspeed Venture Partners"];
const SHOW = 5;
const SLUSH = "slush-2026";
type Scope = "slush" | "all";

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

// Three named funds plus the busiest other one in the cohort: switching fund is one click.
function quickPicks(options: PickerOption[]): PickerOption[] {
  const named = QUICK.map((name) => options.find((o) => o.name === name)).filter((o): o is PickerOption => !!o);
  const extra = options.find((o) => !QUICK.includes(o.name));
  return extra ? [...named, extra].slice(0, 4) : named;
}

function shortName(name: string): string {
  return name.replace(/ Venture Partners$| Ventures$| Capital$/, "");
}

export default function Showcase() {
  const investorsState = useInvestorOptions();
  const options: PickerOption[] = investorsState.status === "ok" ? investorsState.options : [];
  const [chosen, setChosen] = useState<PickerOption | null>(null);
  // The page never waits for a choice: the default fund is ranked the moment the list arrives.
  const investor = chosen ?? options.find((o) => o.name === DEFAULT_FUND) ?? options[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  // The demo story is "who should this fund meet at Slush next week", so the event scope is the default.
  const [scope, setScope] = useState<Scope>("slush");
  const reducedMotion = useReducedMotion();
  const { state, retry } = useSpotter(investor ? { investorId: investor.id, ...(scope === "slush" ? { at: SLUSH } : {}) } : null);
  const pickInvestor = (o: PickerOption) => {
    setSelectedId(undefined);
    setChosen(o);
  };
  const pickScope = (next: Scope) => {
    setSelectedId(undefined);
    setScope(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const data = state.status === "ok" ? state.data : null;
  const picks = (data?.picks ?? []).slice(0, SHOW);
  const selectedIndex = picks.findIndex((p) => p.company.id === selectedId);
  const selected = selectedIndex >= 0 ? picks[selectedIndex] : null;
  const quick = quickPicks(options);
  const noCohort = state.status === "no_cohort" || investorsState.status === "no_cohort";
  const picker = <InvestorPicker options={options} value={investor} onChange={pickInvestor} loading={investorsState.status === "loading"} placeholder="Search funds…" id="spotter-fund" />;

  return (
    <div className="shell">
      <TopBar subtitle="Early spotter · for funds" inbox={null} tools={picker} showFixtureBanner={FIXTURES} />
      <main className="sp-stage">
        <section className="sp-pane-wrap relative min-h-0" aria-label="Your picks, mapped" data-selected={selected ? "" : undefined}>
          {picks.length > 0 && (
            <Constellation investorName={data?.investor.name ?? ""} picks={picks} selectedId={selectedId} onSelect={setSelectedId} reducedMotion={reducedMotion} />
          )}
          {selected && data && <PickCard key={selected.company.id} pick={selected} investor={data.investor} rank={selectedIndex + 1} asOf={data.asOf} onClose={() => setSelectedId(undefined)} />}

          {(state.status === "loading" || (state.status === "idle" && !noCohort && investorsState.status !== "error")) && (
            <div className="sp-loading" data-testid="spotter-loading" aria-live="polite">
              <div className="sp-loading-orb" />
              <span>{investor ? `Learning ${investor.name}’s taste and ranking its lane…` : "Loading funds…"}</span>
            </div>
          )}
          {noCohort && (
            <div className="sp-error" data-testid="spotter-no-cohort" role="status">
              <span>No Cala cohort is loaded on this deploy, so there is nothing real to rank.</span>
            </div>
          )}
          {investorsState.status === "error" && (
            <div className="sp-error" role="alert" data-testid="spotter-investors-error">
              <span>Could not load the fund list. {investorsState.message}</span>
            </div>
          )}
          {state.status === "ok" && picks.length === 0 && (
            <div className="sp-error" data-testid="spotter-empty">
              <span>
                No young company in {data?.investor.name}’s lane {scope === "slush" ? "at Slush" : "yet"}.
              </span>
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

          <p className="sp-vision">
            Next: Scalaxy becomes a network inside Cala, founders and investors on the same graph.
          </p>
        </section>

        <aside className="sp-rail">
          <div className="sp-funds" role="group" aria-label="Fund">
            {quick.map((o) => (
              <button key={o.id} type="button" className={`sp-fund ${investor?.id === o.id ? "is-on" : ""}`} onClick={() => pickInvestor(o)} data-testid={`spotter-quick-${o.id}`}>
                {shortName(o.name)}
              </button>
            ))}
          </div>

          <div className="sp-head">
            <p className="hero-kicker">Early spotter</p>
            <div className="sp-h1-row">
              <h1 className="sp-h1">
                {scope === "slush" && "Meet at Slush: "}
                {data && picks.length > 0 ? (
                  <>
                    {picks.length} picks for <span className="k">{data.investor.name}</span>
                  </>
                ) : (
                  <>
                    Picks for <span className="k">{investor?.name ?? "your fund"}</span>
                  </>
                )}
              </h1>
              {data && <HowItWorks data={data} />}
            </div>
            <div className="sp-scope" role="radiogroup" aria-label="Which companies">
              <button type="button" role="radio" aria-checked={scope === "slush"} className={`sp-scope-opt ${scope === "slush" ? "is-on" : ""}`} onClick={() => pickScope("slush")} data-testid="spotter-scope-slush">
                At Slush · Nov 18
              </button>
              <button type="button" role="radio" aria-checked={scope === "all"} className={`sp-scope-opt ${scope === "all" ? "is-on" : ""}`} onClick={() => pickScope("all")} data-testid="spotter-scope-all">
                All early companies
              </button>
            </div>
          </div>

          {data && <TasteStrip investor={data.investor} sectorColor={tasteColor} />}
          {data && (
            <p className="sp-honesty font-mono" data-testid="spotter-basis">
              {data.considered.roundsInCohort} real rounds in Cala · as of {data.asOf}
            </p>
          )}
          {picks.length > 0 && <PickList picks={picks} selectedId={selectedId} onSelect={(id) => setSelectedId((cur) => (cur === id ? undefined : id))} tagEvents={scope === "all"} />}
          {picks.length === 0 && (
            <div className="matches-idle" style={{ position: "static", inset: "auto" }} aria-hidden>
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
          )}
        </aside>
      </main>
    </div>
  );
}
