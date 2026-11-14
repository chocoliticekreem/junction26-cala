"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import TopBar from "@/components/TopBar";
import { buildContext, fetchNetwork, lookupCompany, resolveCompany, runSimulate } from "@/components/path/api";
import CompanyFile from "@/components/path/CompanyFile";
import Interview, { type InterviewStep } from "@/components/path/Interview";
import { visionBasis as parseVisionBasis } from "@/components/path/mockSim";
import NextMoves from "@/components/path/NextMoves";
import PathMap, { KIND_COLOR, KIND_LABEL, edgeKey } from "@/components/path/PathMap";
import Precedents from "@/components/path/Precedents";
import Realities from "@/components/path/Realities";
import { YOU_ID, type CompanyCandidate, type CompanyState, type ContextDoc, type Decision, type Highway, type InvestorKind, type NetworkData, type SimResult } from "@/components/path/types";
import { loadReplay } from "@/lib/data";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { mergeProfile } from "@/lib/mergeProfile";
import { isSttSupported } from "@/lib/stt";
import { usePitch } from "@/lib/usePitch";

const REPLAY = loadReplay();
const EMPTY_NET: NetworkData = { nodes: [], edges: [] };
const KINDS: InvestorKind[] = ["fund", "angel", "accelerator", "cvc"];
const subscribeNever = () => () => {};

type Phase = InterviewStep | "simulating" | "results";

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

// A reality only names its leads; the map needs ids. Names are unique in the network.
function chainFor(names: (string | undefined)[], net: NetworkData): string[] {
  const chain = [YOU_ID];
  for (const n of names) {
    if (!n) continue;
    const hit = net.nodes.find((x) => x.name === n || x.name.startsWith(n));
    if (hit) chain.push(hit.id);
  }
  return chain;
}

export default function PathPage() {
  const q1 = usePitch(REPLAY);
  const q2 = usePitch([]);
  const sttSupported = useSyncExternalStore(subscribeNever, isSttSupported, () => false);
  const reducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("company");
  const [companyName, setCompanyName] = useState("");
  const [candidates, setCandidates] = useState<CompanyCandidate[]>([]);
  const [resolving, setResolving] = useState(false);
  const [candidate, setCandidate] = useState<CompanyCandidate | null>(null);
  const [company, setCompany] = useState<CompanyState | undefined>();
  const [pitchText, setPitchText] = useState("");
  const [visionText, setVisionText] = useState("");
  const [network, setNetwork] = useState<NetworkData>(EMPTY_NET);
  const [result, setResult] = useState<SimResult | undefined>();
  const [context, setContext] = useState<{ doc: ContextDoc; markdown: string } | undefined>();
  const [uploads, setUploads] = useState<{ name: string; text: string }[]>([]);
  const [demo, setDemo] = useState({ network: false, sim: false, company: false, context: false });
  const [error, setError] = useState<string | undefined>();
  const [realityId, setRealityId] = useState<string | undefined>();
  const [decision, setDecision] = useState<Decision | undefined>();
  const epoch = useRef(0);

  useEffect(() => {
    void fetchNetwork().then((r) => {
      setNetwork(r.data);
      setDemo((d) => ({ ...d, network: r.demo }));
    });
  }, []);

  // Candidate lookup as the name is typed.
  useEffect(() => {
    const name = companyName.trim();
    let alive = true;
    const id = window.setTimeout(() => {
      if (phase !== "company" || name.length < 2) {
        setCandidates([]);
        setResolving(false);
        return;
      }
      setResolving(true);
      void resolveCompany(name).then((r) => {
        if (!alive) return;
        setCandidates(r.data);
        setDemo((d) => ({ ...d, company: r.demo }));
        setResolving(false);
      });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [companyName, phase]);

  const profile = useMemo(() => {
    const typed = pitchText.trim();
    return typed ? mergeProfile(q1.profile, fallbackExtract(typed)) : q1.profile;
  }, [q1.profile, pitchText]);
  const visionSpoken = q2.tokens.map((t) => t.text).join(" ").trim();
  const vision = visionText.trim() || visionSpoken;
  const companyLabel = company?.name || candidate?.name || profile.company || "You";
  const companyId = candidate?.calaId ?? company?.companyId ?? "early-idea";

  const pick = useCallback(async (c: CompanyCandidate | null) => {
    setCandidate(c);
    setPhase("pitch");
    if (!c) {
      setCompany(undefined);
      return;
    }
    const r = await lookupCompany(c.name);
    setCompany(r.data.found ? r.data : { found: true, name: c.name, founded: c.foundingDate, hq: c.hq, backers: [], companyId: c.calaId });
  }, []);

  const simulate = useCallback(
    async (d?: Decision) => {
      const my = ++epoch.current;
      setError(undefined);
      if (!result) setPhase("simulating");
      const body = { profile, visionText: vision, decision: d, companyName: company?.found ? company.name : undefined };
      try {
        const [sim, ctx] = await Promise.all([
          runSimulate(body),
          context ? Promise.resolve(undefined) : buildContext({ calaId: candidate?.calaId, website: candidate?.website, pitchProfile: profile, visionText: vision, uploads }),
        ]);
        if (my !== epoch.current) return;
        setResult(sim.data);
        if (ctx) setContext(ctx.data);
        setDemo((x) => ({ ...x, sim: sim.demo, context: ctx ? ctx.demo : x.context }));
        setPhase("results");
      } catch (e) {
        if (my !== epoch.current) return;
        setError(e instanceof Error ? e.message : "Simulation failed");
        setPhase(result ? "results" : "vision");
      }
    },
    [profile, vision, company, candidate, context, uploads, result],
  );

  const reset = useCallback(() => {
    epoch.current += 1;
    q1.reset();
    q2.reset();
    setPhase("company");
    setCompanyName("");
    setCandidates([]);
    setCandidate(null);
    setCompany(undefined);
    setPitchText("");
    setVisionText("");
    setResult(undefined);
    setContext(undefined);
    setUploads([]);
    setError(undefined);
    setRealityId(undefined);
    setDecision(undefined);
  }, [q1, q2]);

  const addContext = useCallback(
    async (u: { name: string; text: string }) => {
      const next = [...uploads, u];
      setUploads(next);
      const r = await buildContext({ calaId: candidate?.calaId, website: candidate?.website, pitchProfile: profile, visionText: vision, uploads: next });
      setContext(r.data);
    },
    [uploads, candidate, profile, vision],
  );

  const selectDecision = useCallback(
    (d?: Decision) => {
      setDecision(d);
      setRealityId(undefined);
      void simulate(d);
    },
    [simulate],
  );

  // Map inputs: a selected reality re-weights the highways along its chain; a selected branch
  // (already re-simulated by the engine) brightens its top paths.
  const selectedReality = result?.realities?.find((r) => r.id === realityId);
  const { highways, brightPaths, emphasis } = useMemo(() => {
    if (!result) return { highways: [] as Highway[], brightPaths: [] as string[][], emphasis: undefined as Set<string> | undefined };
    const base = result.highways;
    if (selectedReality) {
      const chain = chainFor(
        selectedReality.steps.map((s) => s.leadName),
        network,
      );
      const keys = new Set<string>();
      for (let i = 1; i < chain.length; i++) keys.add(edgeKey(chain[i - 1], chain[i]));
      const top = Math.max(...base.map((h) => h.weight), 0.1);
      const boosted: Highway[] = base.map((h) => ({ ...h, weight: keys.has(edgeKey(h.from, h.to)) ? h.weight + top * 0.6 : h.weight * 0.25 }));
      for (let i = 1; i < chain.length; i++) {
        const k = edgeKey(chain[i - 1], chain[i]);
        if (!base.some((h) => edgeKey(h.from, h.to) === k)) boosted.push({ from: chain[i - 1], to: chain[i], weight: top * 0.9 });
      }
      return { highways: boosted, brightPaths: [chain], emphasis: keys };
    }
    const node = decision ? result.tree.children.find((c) => JSON.stringify(c.decision) === JSON.stringify(decision)) : undefined;
    const paths = (node ?? result.tree).topPaths.filter((p) => p.reachedVision).slice(0, 3);
    const chains = paths.map((p) => [YOU_ID, ...p.steps.map((s) => s.leadId).filter((x): x is string => !!x)]);
    const keys = node ? new Set(chains.flatMap((c) => c.slice(1).map((id, i) => edgeKey(c[i], id)))) : undefined;
    return { highways: base, brightPaths: chains, emphasis: keys };
  }, [result, selectedReality, decision, network]);

  const leadIds = useMemo(() => {
    if (!result) return [];
    if (selectedReality) return chainFor(selectedReality.steps.map((s) => s.leadName), network).slice(1, 4);
    const node = decision ? result.tree.children.find((c) => JSON.stringify(c.decision) === JSON.stringify(decision)) : result.tree.children[0];
    const ids = new Set<string>();
    for (const p of node?.topPaths ?? []) for (const s of p.steps) if (s.leadId) ids.add(s.leadId);
    return [...ids].slice(0, 3);
  }, [result, selectedReality, decision, network]);

  const mic = (on: boolean): "idle" | "listening" | "unsupported" => (!sttSupported ? "unsupported" : on ? "listening" : "idle");
  const mapPhase = phase === "results" ? "results" : phase === "simulating" ? "simulating" : phase === "company" ? "idle" : "interview";
  const anyDemo = demo.sim || demo.network;

  return (
    <div className="shell path-shell" data-testid="path-page" data-phase={phase}>
      <TopBar
        inbox={null}
        subtitle="Path"
        showFixtureBanner={false}
        tools={
          <button type="button" className="btn" onClick={reset} data-testid="new-simulation" title="Clear the pitch, vision and results">
            New simulation
          </button>
        }
      />
      <main className={`path-stage ${phase === "results" ? "is-results" : ""}`}>
        <section className="path-left">
          {phase === "results" && result?.realities && (
            <Realities realities={result.realities} selectedId={realityId} onSelect={(id) => setRealityId(id)} startLabel={companyLabel} />
          )}
          <div className="path-map-pane">
            <PathMap
              network={network}
              highways={highways}
              brightPaths={brightPaths}
              emphasisEdges={emphasis}
              backerIds={company?.backers.map((b) => b.id).filter((x): x is string => !!x)}
              youLabel={companyLabel}
              phase={mapPhase}
              reducedMotion={reducedMotion}
            />
            <div className="path-legend" aria-label="Legend">
              {KINDS.map((k) => (
                <span key={k}>
                  <i style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]}
                </span>
              ))}
              <span>
                <i className="path-legend-you" /> {companyLabel}
              </span>
              <span className="muted">size = rounds led</span>
            </div>
            {phase === "results" && result && (
              <p className="path-honesty font-mono" data-testid="honesty">
                Evidence from {result.tree.sampleSize} real rounds in Cala, not a forecast · {result.runs.toLocaleString()} runs · as of {result.asOf}
                {anyDemo && <span className="path-demo-tag">demo data</span>}
              </p>
            )}
            {phase === "simulating" && (
              <div className="path-simulating" role="status" data-testid="simulating">
                <p className="hero-kicker">Simulating</p>
                <p className="path-sim-title">5,000 futures of {companyLabel}</p>
              </div>
            )}
            {phase !== "results" && phase !== "simulating" && (
              <Interview
                step={phase}
                companyName={companyName}
                onCompanyName={setCompanyName}
                candidates={candidates}
                resolving={resolving}
                onPick={(c) => void pick(c)}
                company={company}
                pitchTokens={q1.tokens}
                pitchText={pitchText}
                onPitchText={setPitchText}
                profile={profile}
                triggers={q1.triggers}
                micState={mic(q1.micOn)}
                onMic={q1.toggleMic}
                onReplay={q1.replay}
                replaying={q1.replaying}
                onNext={() => setPhase("vision")}
                visionTokens={q2.tokens}
                visionText={visionText}
                onVisionText={setVisionText}
                visionMicState={mic(q2.micOn)}
                onVisionMic={q2.toggleMic}
                visionBasis={vision ? parseVisionBasis(vision) : undefined}
                onSimulate={() => void simulate(decision)}
                demo={demo.company}
              />
            )}
            {error && (
              <p className="path-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
        {phase === "results" && result && (
          <aside className="path-rail">
            {context && <CompanyFile doc={context.doc} markdown={context.markdown} onAddContext={(u) => void addContext(u)} demo={demo.context} />}
            {result.visionBasis && (
              <p className="path-vision-line" data-testid="vision-line">
                <b>{result.visionBasis.split(".")[0]}</b>
                <span className="muted" title={result.visionBasis}>
                  {" "}
                  · {vision}
                </span>
              </p>
            )}
            <NextMoves tree={result.tree} selected={decision} onSelect={selectDecision} leadIds={leadIds} companyLabel={companyLabel} companyId={companyId} />
            <Precedents precedents={result.precedents} />
          </aside>
        )}
      </main>
    </div>
  );
}
