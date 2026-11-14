"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import CacheStats from "@/components/CacheStats";
import TopBar from "@/components/TopBar";
import { buildContext, errorMessage, fetchNetwork, resolveCompany, runSimulate } from "@/components/path/api";
import CompanyFile from "@/components/path/CompanyFile";
import Interview, { type InterviewStep } from "@/components/path/Interview";
import NextMoves from "@/components/path/NextMoves";
import PathMap, { KIND_COLOR, KIND_LABEL, edgeKey } from "@/components/path/PathMap";
import Precedents from "@/components/path/Precedents";
import Realities from "@/components/path/Realities";
import { YOU_ID, type CompanyCandidate, type ContextDoc, type Decision, type Highway, type InvestorKind, type NetworkData, type SimulateResponse, type Upload } from "@/components/path/types";
import { loadReplay } from "@/lib/data";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { mergeProfile } from "@/lib/mergeProfile";
import { getMyCompanies, getMyCompaniesServer, saveMyCompany, subscribeMyCompanies, type SavedCompany } from "@/lib/myCompanies";
import { fmtUsd } from "@/lib/sim/util";
import { parseVision } from "@/lib/sim/vision";
import { isSttSupported } from "@/lib/stt";
import { SECTOR_SHORT, STAGE_LABELS, type Sector } from "@/lib/taxonomy";
import type { FounderProfile } from "@/lib/types";
import { usePitch } from "@/lib/usePitch";

const REPLAY = loadReplay();
const EMPTY_NET: NetworkData = { nodes: [], edges: [] };
const KINDS: InvestorKind[] = ["fund", "angel", "accelerator", "cvc"];
const subscribeNever = () => () => {};

type Phase = "idle" | "simulating" | "results";

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

// The engine's keyword read of the vision, shown while the founder types. The run's visionBasis
// (LLM-parsed when a key is set) is what the results show.
function visionTarget(text: string): string {
  const v = parseVision(text);
  const parts = [STAGE_LABELS[v.targetStage]];
  if (v.targetValuationUsd) parts.push(`${fmtUsd(v.targetValuationUsd)} valuation`);
  if (v.targetHeadcount) parts.push(`${v.targetHeadcount} people`);
  if (v.targetFundingUsd) parts.push(`${fmtUsd(v.targetFundingUsd)} raised`);
  parts.push(`${v.horizonYears}y`);
  return parts.join(" · ");
}

// One line of what the pitch gave the engine so far; replaces the old chip panel.
function pitchRead(p: FounderProfile): string | undefined {
  const sectors = (Object.entries(p.sectors) as [Sector, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([s]) => SECTOR_SHORT[s]);
  const parts = [p.stage ? STAGE_LABELS[p.stage] : undefined, ...sectors, p.raise ? `raising ${fmtUsd(p.raise)}` : undefined, p.geography].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export default function PathPage() {
  const q1 = usePitch(REPLAY);
  const q2 = usePitch([]);
  const sttSupported = useSyncExternalStore(subscribeNever, isSttSupported, () => false);
  const reducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("idle");
  const [companyName, setCompanyName] = useState("");
  const [candidates, setCandidates] = useState<CompanyCandidate[]>([]);
  const [autoPick, setAutoPick] = useState<string | undefined>();
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>();
  const [candidate, setCandidate] = useState<CompanyCandidate | null>(null);
  // The founder answered "Is this you?"; the candidate list collapses to one line until the name changes.
  const [picked, setPicked] = useState(false);
  const saved = useSyncExternalStore(subscribeMyCompanies, getMyCompanies, getMyCompaniesServer);
  const [pitchText, setPitchText] = useState("");
  const [visionText, setVisionText] = useState("");
  const [network, setNetwork] = useState<NetworkData>(EMPTY_NET);
  const [networkError, setNetworkError] = useState<string | undefined>();
  const [result, setResult] = useState<SimulateResponse | undefined>();
  const [context, setContext] = useState<{ doc: ContextDoc; markdown: string } | undefined>();
  const [contextError, setContextError] = useState<string | undefined>();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [realityId, setRealityId] = useState<string | undefined>();
  const [decision, setDecision] = useState<Decision | undefined>();
  const epoch = useRef(0);
  // A saved company arrives with its Cala match; the lookup for that exact name must not undo it.
  const presetFor = useRef<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchNetwork().then(setNetwork, (e) => setNetworkError(errorMessage(e)));
  }, []);

  // Candidate lookup as the name is typed; the best candidate is preselected, the founder can
  // change it inline.
  useEffect(() => {
    const name = companyName.trim();
    let alive = true;
    const id = window.setTimeout(() => {
      if (name.length < 2) {
        setCandidates([]);
        setAutoPick(undefined);
        setResolving(false);
        setResolveError(undefined);
        if (presetFor.current !== name) setCandidate(null);
        return;
      }
      setResolving(true);
      setResolveError(undefined);
      resolveCompany(name).then(
        (r) => {
          if (!alive) return;
          setCandidates(r.candidates);
          setAutoPick(r.autoPick);
          setResolving(false);
          if (presetFor.current === name) return;
          setCandidate(r.candidates.find((c) => c.calaId === r.autoPick) ?? r.candidates[0] ?? null);
        },
        (e) => {
          if (!alive) return;
          setCandidates([]);
          setAutoPick(undefined);
          setResolveError(errorMessage(e));
          setResolving(false);
          if (presetFor.current !== name) setCandidate(null);
        },
      );
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [companyName]);

  const profile = useMemo(() => {
    const typed = pitchText.trim();
    return typed ? mergeProfile(q1.profile, fallbackExtract(typed)) : q1.profile;
  }, [q1.profile, pitchText]);
  const visionSpoken = q2.tokens.map((t) => t.text).join(" ").trim();
  const vision = visionText.trim() || visionSpoken;
  const pitchSpoken = q1.tokens.map((t) => t.text).join(" ").trim();
  const pitch = [pitchText.trim(), pitchSpoken].filter(Boolean).join(" ");
  const companyLabel = result?.start.companyName || candidate?.name || companyName.trim() || result?.founder?.company || profile.company || "You";
  const step: InterviewStep = !pitch ? (companyName.trim() ? "pitch" : "company") : !vision ? "vision" : "ready";

  const onCompanyName = useCallback((v: string) => {
    presetFor.current = null;
    setPicked(false);
    setCompanyName(v);
  }, []);

  const pick = useCallback(
    (c: CompanyCandidate | null) => {
      presetFor.current = companyName.trim();
      setCandidate(c);
      setPicked(true);
    },
    [companyName],
  );

  const loadSaved = useCallback(
    (s: SavedCompany) => {
      presetFor.current = s.name.trim();
      q1.reset();
      q2.reset();
      setCompanyName(s.name);
      setCandidate(s.candidate ?? null);
      setPicked(true);
      setPitchText(s.pitch);
      setVisionText(s.vision);
    },
    [q1, q2],
  );

  const contextBody = useCallback(
    (u: Upload[]) => ({ calaId: candidate?.calaId, name: candidate?.name ?? companyName.trim(), website: candidate?.website, pitchProfile: profile, visionText: vision, uploads: u }),
    [candidate, companyName, profile, vision],
  );

  const simulate = useCallback(
    async (d?: Decision) => {
      const my = ++epoch.current;
      setError(undefined);
      if (!result) {
        setPhase("simulating");
        saveMyCompany({ name: candidate?.name ?? (companyName.trim() || companyLabel), candidate: candidate ?? undefined, pitch, vision });
        window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }), 50);
      }
      const body = { profile, pitchText: pitch || undefined, visionText: vision, decision: d, companyName: candidate?.name };
      const [sim, ctx] = await Promise.allSettled([runSimulate(body), context ? Promise.resolve(undefined) : buildContext(contextBody(uploads))]);
      if (my !== epoch.current) return;
      if (ctx.status === "fulfilled") {
        if (ctx.value) {
          setContext(ctx.value);
          setContextError(undefined);
        }
      } else setContextError(errorMessage(ctx.reason));
      if (sim.status === "fulfilled") {
        setResult(sim.value);
        setPhase("results");
      } else {
        setError(errorMessage(sim.reason));
        setPhase(result ? "results" : "idle");
      }
    },
    [profile, pitch, vision, candidate, companyName, companyLabel, context, contextBody, uploads, result, reducedMotion],
  );

  const reset = useCallback(() => {
    epoch.current += 1;
    presetFor.current = null;
    q1.reset();
    q2.reset();
    setPhase("idle");
    setCompanyName("");
    setCandidates([]);
    setAutoPick(undefined);
    setResolveError(undefined);
    setCandidate(null);
    setPicked(false);
    setPitchText("");
    setVisionText("");
    setResult(undefined);
    setContext(undefined);
    setContextError(undefined);
    setUploads([]);
    setError(undefined);
    setRealityId(undefined);
    setDecision(undefined);
    window.scrollTo({ top: 0 });
  }, [q1, q2]);

  const addContext = useCallback(
    async (u: Upload) => {
      const next = [...uploads, u];
      setUploads(next);
      try {
        setContext(await buildContext(contextBody(next)));
        setContextError(undefined);
      } catch (e) {
        setContextError(errorMessage(e));
      }
    },
    [uploads, contextBody],
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
  const selectedReality = result?.realities.find((r) => r.title === realityId);
  const { highways, brightPaths, emphasis } = useMemo(() => {
    if (!result) return { highways: [] as Highway[], brightPaths: [] as string[][], emphasis: undefined as Set<string> | undefined };
    const base = result.highways;
    if (selectedReality) {
      const chain = [YOU_ID, ...selectedReality.steps.map((s) => s.leadId).filter((x): x is string => !!x)];
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
  }, [result, selectedReality, decision]);

  const leadIds = useMemo(() => {
    if (!result) return [];
    if (selectedReality) return selectedReality.steps.map((s) => s.leadId).filter((x): x is string => !!x).slice(0, 3);
    const node = decision ? result.tree.children.find((c) => JSON.stringify(c.decision) === JSON.stringify(decision)) : result.tree.children[0];
    const ids = new Set<string>();
    for (const p of node?.topPaths ?? []) for (const s of p.steps) if (s.leadId) ids.add(s.leadId);
    return [...ids].slice(0, 3);
  }, [result, selectedReality, decision]);

  const mic = (on: boolean): "idle" | "listening" | "unsupported" => (!sttSupported ? "unsupported" : on ? "listening" : "idle");
  const backerIds = result?.start.existingInvestors.map((b) => b.id);
  const showResults = phase !== "idle";

  return (
    <div className="shell path-shell" data-testid="path-page" data-phase={phase}>
      <TopBar
        inbox={null}
        subtitle="Founder path"
        showFixtureBanner={false}
        tools={
          <button type="button" className="btn" onClick={reset} data-testid="new-simulation" title="Clear the company, pitch, vision and results">
            New simulation
          </button>
        }
      />
      <main className={`path-stage ${showResults ? "is-results" : ""}`}>
        <Interview
          step={step}
          busy={phase === "simulating"}
          companyName={companyName}
          onCompanyName={onCompanyName}
          candidates={candidates}
          autoPick={autoPick}
          resolving={resolving}
          resolveError={resolveError}
          company={candidate}
          picked={picked}
          onPick={pick}
          onChangeCompany={() => setPicked(false)}
          saved={saved}
          onLoadSaved={loadSaved}
          onNewCompany={reset}
          pitchTokens={q1.tokens}
          pitchText={pitchText}
          onPitchText={setPitchText}
          pitchRead={pitch ? pitchRead(profile) : undefined}
          micState={mic(q1.micOn)}
          onMic={q1.toggleMic}
          onReplay={q1.replay}
          replaying={q1.replaying}
          visionTokens={q2.tokens}
          visionText={visionText}
          onVisionText={setVisionText}
          visionMicState={mic(q2.micOn)}
          onVisionMic={q2.toggleMic}
          visionTarget={vision ? visionTarget(vision) : undefined}
          onSimulate={() => void simulate(decision)}
        />
        {error && (
          <p className="path-error" role="alert" data-testid="sim-error">
            {error}
          </p>
        )}

        {showResults && (
          <div className="path-results" ref={resultsRef} data-testid="results">
            <section className="path-left">
              {phase === "results" && result && (
                <Realities realities={result.realities} selectedId={realityId} onSelect={(id) => setRealityId(id)} startLabel={companyLabel} horizonYears={result.vision.horizonYears || 5} />
              )}
              <div className="path-map-pane glass">
                <PathMap network={network} highways={highways} brightPaths={brightPaths} emphasisEdges={emphasis} backerIds={backerIds} youLabel={companyLabel} phase={phase} reducedMotion={reducedMotion} />
                <div className="path-legend" aria-label="Legend">
                  {KINDS.map((k) => (
                    <span key={k}>
                      <i style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]}
                    </span>
                  ))}
                  <span>
                    <i className="path-legend-you" /> {companyLabel}
                  </span>
                  {networkError ? (
                    <span className="muted" data-testid="network-error">
                      investor map: {networkError}
                    </span>
                  ) : (
                    <span className="muted">size = rounds led</span>
                  )}
                </div>
                {phase === "results" && result && (
                  <p className="path-honesty font-mono" data-testid="honesty">
                    Evidence from {result.tree.sampleSize} real rounds in Cala, not a forecast · {result.runs.toLocaleString()} runs · as of {result.asOf}
                    <CacheStats />
                  </p>
                )}
                {phase === "simulating" && (
                  <div className="path-simulating" role="status" data-testid="simulating">
                    <p className="hero-kicker">Simulating</p>
                    <p className="path-sim-title">5,000 futures of {companyLabel}</p>
                  </div>
                )}
              </div>
            </section>
            {phase === "results" && result && (
              <aside className="path-rail">
                {context ? (
                  <CompanyFile doc={context.doc} markdown={context.markdown} onAddContext={(u) => void addContext(u)} />
                ) : (
                  <section className="path-file" aria-label="Your company file" data-testid="company-file-error">
                    <header className="path-section-head">
                      <span>Your company file</span>
                    </header>
                    <p className="muted path-empty">{contextError ?? "Building…"}</p>
                  </section>
                )}
                <p className="path-start-line" data-testid="start-line">
                  {result.start.companyName ? (
                    <>
                      <b>{result.start.companyName}</b> in Cala&apos;s cohort · starts after its {STAGE_LABELS[result.start.stage]}
                      {result.start.existingInvestors.length > 0 && <> · backed by {result.start.existingInvestors.map((b) => b.name).join(", ")}</>}
                    </>
                  ) : (
                    <>
                      <b>{companyLabel === "You" ? "Not" : companyLabel}</b> {companyLabel === "You" ? "in Cala's cohort yet" : "is not in Cala's cohort yet"} · starts from your pitch at{" "}
                      {STAGE_LABELS[result.start.stage]}
                    </>
                  )}
                </p>
                <p className="path-vision-line" data-testid="vision-line" title={result.visionBasis.text}>
                  <b>{result.vision.interpretation ?? result.visionBasis.text}</b>
                  <span className="muted"> · {vision}</span>
                  {result.analysis === "keyword_fallback" && (
                    <span className="muted path-fallback" data-testid="keyword-fallback" title={result.analysisDetail?.fallbackReasons?.join("; ") || "The AI reader was unavailable; keyword rules read the text."}>
                      {" "}
                      · keyword fallback
                    </span>
                  )}
                </p>
                {result.vision.interpretation && <p className="muted path-empty">{result.visionBasis.text}</p>}
                {result.founder && result.founder.tags.length > 0 && (
                  <div className="chips path-founder-tags" data-testid="founder-tags" aria-label="What the pitch is about">
                    {result.founder.tags.map((t) => (
                      <span key={t} className="chip" data-chip={`tag:${t}`}>
                        <span className="chip-value">{t}</span>
                      </span>
                    ))}
                  </div>
                )}
                <NextMoves tree={result.tree} selected={decision} onSelect={selectDecision} leadIds={leadIds} docId={context?.doc.id} />
                <Precedents precedents={result.precedents} />
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
