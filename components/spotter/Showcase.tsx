"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { usingFixtures } from "@/lib/data";
import Constellation from "@/components/spotter/Constellation";
import { HostCard, HostRow } from "@/components/spotter/HostEvent";
import HowItWorks from "@/components/spotter/HowItWorks";
import InvestorPicker, { type PickerOption } from "@/components/spotter/InvestorPicker";
import PickCard from "@/components/spotter/PickCard";
import PickList from "@/components/spotter/PickList";
import TasteStrip from "@/components/spotter/TasteStrip";
import { useInvestorOptions, useSpotter } from "@/components/spotter/useSpotter";
import { sectorColor, shortDate } from "@/components/spotter/format";
import type { SpotterEventRow } from "@/components/spotter/types";
import { SECTOR_COLOR, SECTOR_SHORT, type Sector } from "@/lib/taxonomy";
import "@/components/spotter/spotter.css";

const FIXTURES = usingFixtures();
const DEFAULT_FUND = "Seedcamp";
const QUICK = ["Seedcamp", "Entrepreneur First", "Lightspeed Venture Partners"];
const SHOW = 5;
type Tab = "picks" | "events";

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
  const [hostIndex, setHostIndex] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("picks");
  // The event list rides on every answer; keep the last one so the Events tab stays put while a scoped answer loads.
  const [events, setEvents] = useState<SpotterEventRow[]>([]);
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const scopedTo = tab === "events" ? eventId : undefined;
  const { state, retry } = useSpotter(investor ? { investorId: investor.id, ...(scopedTo ? { event: scopedTo } : {}) } : null);
  const data = state.status === "ok" ? state.data : null;
  if (data && data.events !== events) setEvents(data.events);
  const selectPick = (id: string | undefined) => {
    setHostIndex(undefined);
    setSelectedId(id);
  };
  const pickInvestor = (o: PickerOption) => {
    selectPick(undefined);
    setChosen(o);
  };
  const pickTab = (next: Tab) => {
    selectPick(undefined);
    setTab(next);
    if (next === "events" && !eventId) setEventId(events[0]?.id);
  };
  const pickEvent = (id: string) => {
    selectPick(undefined);
    setEventId(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(undefined);
        setHostIndex(undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const picks = (data?.picks ?? []).slice(0, SHOW);
  const selectedIndex = picks.findIndex((p) => p.company.id === selectedId);
  const selected = selectedIndex >= 0 ? picks[selectedIndex] : null;
  const hosts = data?.host ?? [];
  const openHost = hostIndex !== undefined ? hosts[hostIndex] : undefined;
  const scopedEvent = scopedTo ? events.find((e) => e.id === scopedTo) : undefined;
  const quick = quickPicks(options);
  const noCohort = state.status === "no_cohort" || investorsState.status === "no_cohort";
  const picker = <InvestorPicker options={options} value={investor} onChange={pickInvestor} loading={investorsState.status === "loading"} placeholder="Search funds…" id="spotter-fund" />;

  return (
    <div className="shell">
      <TopBar subtitle="Early spotter · for funds" inbox={null} tools={picker} showFixtureBanner={FIXTURES} />
      <main className="sp-stage">
        <section className="sp-pane-wrap relative min-h-0" aria-label="Your picks, mapped" data-selected={selected || openHost ? "" : undefined}>
          {picks.length > 0 && (
            <Constellation investorName={data?.investor.name ?? ""} picks={picks} selectedId={selectedId} onSelect={selectPick} reducedMotion={reducedMotion} />
          )}
          {selected && data && <PickCard key={selected.company.id} pick={selected} investor={data.investor} rank={selectedIndex + 1} asOf={data.asOf} onClose={() => setSelectedId(undefined)} />}
          {openHost && <HostCard key={`${data?.investor.id}:${openHost.sector}`} host={openHost} onClose={() => setHostIndex(undefined)} />}

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
                No young company in {data?.investor.name}’s lane {scopedEvent ? `at ${scopedEvent.name}` : "yet"}.
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

          <div className="sp-tabs" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={tab === "picks"} className={`sp-tab ${tab === "picks" ? "is-on" : ""}`} onClick={() => pickTab("picks")} data-testid="spotter-tab-picks">
              Picks
            </button>
            <button type="button" role="tab" aria-selected={tab === "events"} className={`sp-tab ${tab === "events" ? "is-on" : ""}`} onClick={() => pickTab("events")} data-testid="spotter-tab-events">
              Events
            </button>
          </div>

          <div className="sp-head">
            <p className="hero-kicker">Early spotter</p>
            <div className="sp-h1-row">
              <h1 className="sp-h1">
                {scopedEvent ? (
                  <>
                    Meet at <span className="k">{scopedEvent.name}</span>: {data ? picks.length : ""} picks
                  </>
                ) : data && picks.length > 0 ? (
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
          </div>

          {tab === "events" && events.length > 0 && (
            <div className="sp-events" role="radiogroup" aria-label="Event" data-testid="spotter-events">
              {events.map((e) => (
                <button key={e.id} type="button" role="radio" aria-checked={eventId === e.id} className={`sp-event ${eventId === e.id ? "is-on" : ""}`} onClick={() => pickEvent(e.id)} data-testid={`spotter-event-${e.id}`}>
                  <span className="sp-event-name">{e.name}</span>
                  <span className="sp-event-meta font-mono">
                    {shortDate(e.date)} · {e.place.split(",").pop()?.trim()} · {e.attending} fit attend
                  </span>
                </button>
              ))}
            </div>
          )}

          {tab === "picks" && data && <TasteStrip investor={data.investor} sectorColor={tasteColor} />}
          {picks.length > 0 && <PickList picks={picks} selectedId={selectedId} onSelect={(id) => selectPick(selectedId === id ? undefined : id)} tagEvents={!scopedEvent} />}
          {tab === "events" && hosts.length > 0 && (
            <div className="sp-hosts" data-testid="spotter-hosts">
              <p className="sp-hosts-k">Host your own</p>
              {hosts.map((h, i) => (
                <HostRow
                  key={h.sector}
                  host={h}
                  open={hostIndex === i}
                  onToggle={() => {
                    setSelectedId(undefined);
                    setHostIndex((cur) => (cur === i ? undefined : i));
                  }}
                />
              ))}
            </div>
          )}
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
