"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Sector } from "@/lib/taxonomy";
import type { Investor, Match } from "@/lib/types";

export type GraphProps = {
  investors: Investor[];
  matches: Match[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  center?: { label: string };
  emphasis?: Partial<Record<Sector, number>>;
  reducedMotion?: boolean;
  padLeft?: number;
  idle?: boolean;
  onReplay?: () => void;
  onMic?: () => void;
  micState?: "idle" | "listening" | "unsupported";
};

const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0" aria-hidden />,
});

const HERO_FADE_MS = 700;

export default function Graph(props: GraphProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [systemReduced, setSystemReduced] = useState(false);
  const [heroFaded, setHeroFaded] = useState(!props.idle);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setSystemReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // The hero stays mounted through its fade-out so the pitch starting feels like a reveal.
  useEffect(() => {
    if (props.idle) return;
    const id = window.setTimeout(() => setHeroFaded(true), HERO_FADE_MS);
    return () => window.clearTimeout(id);
  }, [props.idle]);
  if (props.idle && heroFaded) setHeroFaded(false);
  const heroMounted = props.idle || !heroFaded;

  const mic = props.micState ?? "idle";

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden" data-testid="graph">
      {size.width > 0 && size.height > 0 && (
        <GraphCanvas
          {...props}
          width={size.width}
          height={size.height}
          reducedMotion={props.reducedMotion ?? systemReduced}
          padLeft={props.padLeft ?? 0}
          idle={props.idle ?? false}
        />
      )}
      {heroMounted && (
        <div className={`hero ${props.idle ? "" : "is-leaving"}`} data-testid="graph-idle">
          <p className="hero-kicker">Raising pre-seed or seed in London?</p>
          <h1 className="hero-title">
            Who actually backs
            <br />
            startups like yours?
          </h1>
          <p className="hero-sub">Pitch out loud. Investors rank themselves by the deals they did, not the thesis they wrote.</p>
          <div className="hero-actions">
            {props.onReplay && (
              <button type="button" className="hero-btn hero-btn-primary" onClick={props.onReplay}>
                Replay a pitch <kbd>R</kbd>
              </button>
            )}
            {props.onMic && (
              <button type="button" className="hero-btn" onClick={props.onMic} disabled={mic === "unsupported"} title={mic === "unsupported" ? "Speech recognition needs Chrome" : undefined}>
                <i aria-hidden /> Pitch live
              </button>
            )}
          </div>
          <p className="hero-hint graph-hint" data-testid="graph-hint">
            {mic === "unsupported" ? "Live mic needs Chrome. Replay works everywhere." : "Press R any time to replay"}
          </p>
        </div>
      )}
    </div>
  );
}
