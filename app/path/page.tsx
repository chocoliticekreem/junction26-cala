"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import TopBar from "@/components/TopBar";
import { buildContext, errorMessage, fetchNetwork, resolveCompany, runSimulate } from "@/components/path/api";
import CompanyFile from "@/components/path/CompanyFile";
import HowThisWorks from "@/components/path/HowThisWorks";
import Interview, { type CompanyMode, type InterviewStep } from "@/components/path/Interview";
import NextMoves from "@/components/path/NextMoves";
import PathMap, { type MapInset, edgeKey } from "@/components/path/PathMap";
import Precedents from "@/components/path/Precedents";
import Realities from "@/components/path/Realities";
import { YOU_ID, type CompanyCandidate, type ContextResult, type Decision, type Highway, type NetworkData, type SimulateResponse, type Upload } from "@/components/path/types";
import { loadReplay } from "@/lib/data";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { mergeProfile } from "@/lib/mergeProfile";
import { correctCompanyName } from "@/lib/nameFix";
import { saveMyCompany, type SavedCompany } from "@/lib/myCompanies";
import { fmtUsd } from "@/lib/sim/util";
import { UNICORN_USD, parseVision } from "@/lib/sim/vision";
import { isSttSupported } from "@/lib/stt";
import { SECTOR_SHORT, STAGE_LABELS, type Sector } from "@/lib/taxonomy";
import type { FounderProfile } from "@/lib/types";
import { usePitch } from "@/lib/usePitch";

const REPLAY = loadReplay();
const EMPTY_NET: NetworkData = { nodes: [], edges: [] };
const subscribeNever = () => () => {};

// Stage geometry (px): the brief bar and the two drawers the map lays out around.
const BAR_H = 76;
const LEFT_W = 316;
const LEFT_TAB_W = 44;
const RIGHT_W = 456;
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const SPRING = { duration: 0.55, ease: EASE };

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

// The engine's keyword read of the vision in a few words ("Unicorn · 5 yrs"), shown while the
// founder types. The run's visionBasis (LLM-parsed when a key is set) is what the (i) shows.
function visionShort(text: string): string {
  const v = parseVision(text);
  const parts: string[] = [];
  if (v.targetValuationUsd && v.targetValuationUsd >= 10 * UNICORN_USD) parts.push("Decacorn");
  else if (v.targetValuationUsd && v.targetValuationUsd >= UNICORN_USD) parts.push("Unicorn");
  else {
    parts.push(STAGE_LABELS[v.targetStage]);
    if (v.targetValuationUsd) parts.push(`${fmtUsd(v.targetValuationUsd)} valuation`);
  }
  if (v.targetHeadcount) parts.push(`${v.targetHeadcount} people`);
  if (v.targetFundingUsd) parts.push(`${fmtUsd(v.targetFundingUsd)} raised`);
  parts.push(`${v.horizonYears} yrs`);
  return parts.join(" · ");
}

// One line of what the pitch gave the engine so far.
function pitchRead(p: FounderProfile): string | undefined {
  const sectors = (Object.entries(p.sectors) as [Sector, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([s]) => SECTOR_SHORT[s]);
  const parts = [p.stage ? STAGE_LABELS[p.stage] : undefined, ...sectors, p.raise ? `raising ${fmtUsd(p.raise)}` : undefined, p.geography].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

export default function PathPage() {
  const q1 = usePitch(REPLAY);
  const q2 = usePitch([]);
  const sttSupported = useSyncExternalStore(subscribeNever, isSttSupported, () => false);
  const reducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("idle");
  // The brief bar was clicked: the CTA is back over the map while the last result stays loaded.
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<CompanyMode>("existing");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [candidates, setCandidates] = useState<CompanyCandidate[]>([]);
  const [autoPick, setAutoPick] = useState<string | undefined>();
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>();
  const [candidate, setCandidate] = useState<CompanyCandidate | null>(null);
  // The founder answered "Is this you?"; the candidate list collapses to one line until the name changes.
  const [picked, setPicked] = useState(false);
  const [pitchText, setPitchText] = useState("");
  const [visionText, setVisionText] = useState("");
  const [network, setNetwork] = useState<NetworkData>(EMPTY_NET);
  const [networkError, setNetworkError] = useState<string | undefined>();
  const [result, setResult] = useState<SimulateResponse | undefined>();
  const [context, setContext] = useState<ContextResult | undefined>();
  const [contextError, setContextError] = useState<string | undefined>();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [realityId, setRealityId] = useState<string | undefined>();
  const [decision, setDecision] = useState<Decision | undefined>();
  const [fileOpen, setFileOpen] = useState(true);
  const epoch = useRef(0);
  // A saved company arrives with its Cala match; the lookup for that exact name must not undo it.
  const presetFor = useRef<string | null>(null);

  useEffect(() => {
    fetchNetwork().then(setNetwork, (e) => setNetworkError(errorMessage(e)));
  }, []);

  // The investor page links "Company file" to /?company=<name>: the field is pre-filled as an
  // existing company and resolved; the founder still presses Simulate.
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get("company")?.trim();
    if (!name) return;
    queueMicrotask(() => {
      setMode("existing");
      setCompanyName(name);
    });
  }, []);

  // Candidate lookup as the name is typed (existing companies only); the best candidate is
  // preselected, the founder can change it inline.
  useEffect(() => {
    const name = companyName.trim();
    const site = website.trim();
    let alive = true;
    const id = window.setTimeout(() => {
      if (mode === "new" || name.length < 2) {
        setCandidates([]);
        setAutoPick(undefined);
        setResolving(false);
        setResolveError(undefined);
        if (presetFor.current !== name) setCandidate(null);
        return;
      }
      setResolving(true);
      setResolveError(undefined);
      resolveCompany(name, site || undefined).then(
        (r) => {
          if (!alive) return;
          setCandidates(r.candidates);
          setAutoPick(r.autoPick);
          setResolving(false);
          if (presetFor.current === name) return;
          const auto = r.candidates.find((c) => c.calaId === r.autoPick);
          setCandidate(auto ?? r.candidates[0] ?? null);
          // A website or sole exact-name match needs no "Is this you?".
          if (auto) setPicked(true);
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
  }, [companyName, website, mode]);

  const profile = useMemo(() => {
    const typed = pitchText.trim();
    return typed ? mergeProfile(q1.profile, fallbackExtract(typed)) : q1.profile;
  }, [q1.profile, pitchText]);
  // Speech hears the company name by sound ("Kala"); once the name is typed, the transcript and
  // the text the engine reads both carry the founder's spelling.
  const fixName = useCallback((t: string) => correctCompanyName(t, companyName.trim()), [companyName]);
  const pitchTokens = useMemo(() => q1.tokens.map((t) => ({ ...t, text: fixName(t.text) })), [q1.tokens, fixName]);
  const visionTokens = useMemo(() => q2.tokens.map((t) => ({ ...t, text: fixName(t.text) })), [q2.tokens, fixName]);
  const visionSpoken = visionTokens.map((t) => t.text).join(" ").trim();
  const vision = fixName(visionText.trim()) || visionSpoken;
  const pitchSpoken = pitchTokens.map((t) => t.text).join(" ").trim();
  const pitch = [fixName(pitchText.trim()), pitchSpoken].filter(Boolean).join(" ");
  const companyLabel = result?.start.companyName || candidate?.name || companyName.trim() || result?.founder?.company || profile.company || "You";
  const step: InterviewStep = !pitch ? (mode === "new" || companyName.trim() ? "pitch" : "company") : !vision ? "vision" : "ready";
  const read = pitch ? pitchRead(profile) : undefined;
  const visionTarget = vision ? visionShort(vision) : undefined;

  const onMode = useCallback((m: CompanyMode) => {
    presetFor.current = null;
    setPicked(false);
    setCandidate(null);
    setWebsite("");
    setMode(m);
  }, []);

  const onCompanyName = useCallback((v: string) => {
    presetFor.current = null;
    setPicked(false);
    setCompanyName(v);
  }, []);

  const onWebsite = useCallback((v: string) => {
    presetFor.current = null;
    setPicked(false);
    setWebsite(v);
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
      setMode(s.candidate || s.website ? "existing" : mode);
      setCompanyName(s.name);
      setWebsite(s.website ?? "");
      setCandidate(s.candidate ?? null);
      setPicked(true);
      setPitchText(s.pitch);
      setVisionText(s.vision);
    },
    [q1, q2, mode],
  );

  const contextBody = useCallback(
    (u: Upload[]) => ({ calaId: candidate?.calaId, name: candidate?.name ?? companyName.trim(), website: website.trim() || candidate?.website, pitchProfile: profile, visionText: vision, uploads: u }),
    [candidate, companyName, website, profile, vision],
  );

  const simulate = useCallback(
    async (d: Decision | undefined, fresh: boolean) => {
      const my = ++epoch.current;
      setError(undefined);
      const prior = fresh ? undefined : result;
      const ctxPrior = fresh ? undefined : context;
      if (fresh) {
        setResult(undefined);
        setContext(undefined);
        setContextError(undefined);
        setRealityId(undefined);
        setDecision(undefined);
        setEditing(false);
        setPhase("simulating");
        setPicked(true);
        saveMyCompany({ name: candidate?.name ?? (companyName.trim() || companyLabel), website: website.trim() || undefined, candidate: candidate ?? undefined, pitch, vision });
      }
      const body = { profile, pitchText: pitch || undefined, visionText: vision, decision: d, companyName: candidate?.name };
      const [sim, ctx] = await Promise.allSettled([runSimulate(body), ctxPrior ? Promise.resolve(undefined) : buildContext(contextBody(uploads))]);
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
        setPhase(prior ? "results" : "idle");
      }
    },
    [profile, pitch, vision, candidate, companyName, website, companyLabel, context, contextBody, uploads, result],
  );

  const reset = useCallback(() => {
    epoch.current += 1;
    presetFor.current = null;
    q1.reset();
    q2.reset();
    setPhase("idle");
    setEditing(false);
    setMode("existing");
    setCompanyName("");
    setWebsite("");
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
    setFileOpen(true);
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
      void simulate(d, false);
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
  const showInput = phase === "idle" || editing;
  const showResults = phase === "results" && !editing && !!result;
  const mapPhase = editing ? "idle" : phase;
  const inset = useMemo<MapInset>(
    () => (showResults ? { left: (fileOpen ? LEFT_W : LEFT_TAB_W) + 16, right: RIGHT_W + 16, top: BAR_H, bottom: 16 } : { left: 0, right: 0, top: 0, bottom: 0 }),
    [showResults, fileOpen],
  );
  const briefLabel = mode === "new" && !companyName.trim() ? "New idea" : companyLabel;

  return (
    <MotionConfig reducedMotion="user" transition={SPRING}>
      <div className="shell path-shell" data-testid="path-page" data-phase={phase} data-view={showInput ? "input" : phase}>
        <TopBar
          inbox={null}
          subtitle="Founder path"
          showFixtureBanner={false}
          tools={
            <>
              <HowThisWorks result={result} vision={vision} networkError={networkError} />
              <button type="button" className="btn" onClick={reset} data-testid="new-simulation" title="Clear the company, pitch, vision and results">
                New simulation
              </button>
            </>
          }
        />
        <main className="fx-stage" data-view={showInput ? "input" : phase}>
          <div className="fx-map" data-view={showInput ? "input" : phase}>
            <PathMap network={network} inset={inset} highways={highways} brightPaths={brightPaths} emphasisEdges={emphasis} backerIds={backerIds} youLabel={companyLabel} phase={mapPhase} reducedMotion={reducedMotion} />
          </div>

          <AnimatePresence initial={false}>
            {showInput ? (
              <motion.section key="hero" className="fx-hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
                <motion.h1 className="path-title" layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}>
                  Where does {briefLabel === "You" ? "your company" : briefLabel} go from here?
                </motion.h1>
                <motion.div className="fx-card glass" layoutId="brief" style={{ borderRadius: 22 }}>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.25, duration: 0.3 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                    <Interview
                    step={step}
                    busy={phase === "simulating"}
                    mode={mode}
                    onMode={onMode}
                    companyName={companyName}
                    onCompanyName={onCompanyName}
                    website={website}
                    onWebsite={onWebsite}
                    candidates={candidates}
                    autoPick={autoPick}
                    resolving={resolving}
                    resolveError={resolveError}
                    company={candidate}
                    picked={picked}
                    onPick={pick}
                    onChangeCompany={() => setPicked(false)}
                    saved={[]}
                    onLoadSaved={loadSaved}
                    pitchTokens={pitchTokens}
                    pitchText={pitchText}
                    onPitchText={setPitchText}
                    pitchRead={read}
                    micState={mic(q1.micOn)}
                    onMic={q1.toggleMic}
                    onReplay={q1.replay}
                    replaying={q1.replaying}
                    visionTokens={visionTokens}
                    visionText={visionText}
                    onVisionText={setVisionText}
                    visionMicState={mic(q2.micOn)}
                    onVisionMic={q2.toggleMic}
                    visionTarget={visionTarget}
                    onSimulate={() => void simulate(undefined, true)}
                  />
                  </motion.div>
                </motion.div>
              </motion.section>
            ) : (
              <motion.button
                key="brief"
                type="button"
                className="fx-brief glass"
                layoutId="brief"
                style={{ borderRadius: 999 }}
                onClick={() => setEditing(true)}
                title="Edit the company, pitch or vision"
                data-testid="brief"
              >
                <motion.span className="fx-brief-row" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.3, duration: 0.3 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                  <span className="fx-brief-company">{briefLabel}</span>
                  <span className="fx-brief-sep" aria-hidden />
                  <span className="fx-brief-pitch" title={pitch}>
                    {read ?? clip(pitch, 72)}
                  </span>
                  <span className="fx-brief-sep" aria-hidden />
                  <span className="fx-brief-vision chip" title={result?.visionBasis.text ?? vision}>
                    <span className="chip-value">{visionTarget}</span>
                  </span>
                  <span className="fx-brief-edit" aria-hidden>
                    edit
                  </span>
                </motion.span>
              </motion.button>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === "simulating" && !editing && (
              <motion.div key="sim" className="fx-simulating" role="status" data-testid="simulating" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
                <p className="hero-kicker">Simulating</p>
                <p className="path-sim-title">5,000 futures of {briefLabel}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p key="err" className="path-error" role="alert" data-testid="sim-error" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showResults && result && (
              <motion.aside
                key="left"
                className={`fx-drawer fx-left ${fileOpen ? "" : "is-closed"}`}
                style={{ width: fileOpen ? LEFT_W : LEFT_TAB_W }}
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0, width: fileOpen ? LEFT_W : LEFT_TAB_W }}
                exit={{ opacity: 0, x: -24, transition: { duration: 0.3 } }}
                data-testid="left-drawer"
              >
                <button type="button" className="fx-drawer-tab" onClick={() => setFileOpen((v) => !v)} aria-expanded={fileOpen} data-testid="toggle-file">
                  <span>Company file</span>
                  <i aria-hidden />
                </button>
                {fileOpen && (
                  <div className="fx-drawer-body glass">
                    <p className="path-start-line" data-testid="start-line">
                      {result.start.companyName ? (
                        <>
                          <b>{result.start.companyName}</b> in Cala&apos;s cohort · starts after its {STAGE_LABELS[result.start.stage]}
                          {result.start.stageNote && (
                            <span className="path-info" tabIndex={0} role="img" aria-label={result.start.stageNote} title={result.start.stageNote} data-testid="stage-note">
                              i
                            </span>
                          )}
                          {result.start.existingInvestors.length > 0 && <> · backed by {result.start.existingInvestors.map((b) => b.name).join(", ")}</>}
                        </>
                      ) : (
                        <>
                          <b>{companyLabel === "You" ? "Not" : companyLabel}</b> {companyLabel === "You" ? "in Cala's cohort yet" : "is not in Cala's cohort yet"} · starts from your pitch at{" "}
                          {STAGE_LABELS[result.start.stage]}
                          {result.start.stageNote && (
                            <span className="path-info" tabIndex={0} role="img" aria-label={result.start.stageNote} title={result.start.stageNote} data-testid="stage-note">
                              i
                            </span>
                          )}
                        </>
                      )}
                    </p>
                    {result.founder && result.founder.tags.length > 0 && (
                      <div className="chips path-founder-tags" data-testid="founder-tags" aria-label="What the pitch is about">
                        {result.founder.tags.map((t) => (
                          <span key={t} className="chip" data-chip={`tag:${t}`}>
                            <span className="chip-value">{t}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {context ? (
                      <CompanyFile doc={context.doc} markdown={context.markdown} verification={context.verification} onAddContext={(u) => void addContext(u)} />
                    ) : (
                      <section className="path-file" aria-label="Your company file" data-testid="company-file-error">
                        <header className="path-section-head">
                          <span>Company file</span>
                        </header>
                        <p className="muted path-empty">{contextError ?? "Building…"}</p>
                      </section>
                    )}
                    <Precedents precedents={result.precedents} />
                  </div>
                )}
              </motion.aside>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showResults && result && (
              <motion.aside
                key="right"
                className="fx-drawer fx-right glass"
                style={{ width: RIGHT_W }}
                initial={{ opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 32, transition: { duration: 0.3 } }}
                data-testid="results"
              >
                <Realities realities={result.realities} selectedId={realityId} onSelect={(id) => setRealityId(id)} horizonYears={result.vision.horizonYears || 5} />
                <NextMoves tree={result.tree} selected={decision} onSelect={selectDecision} leadIds={leadIds} docId={context?.doc.id} />
              </motion.aside>
            )}
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  );
}
