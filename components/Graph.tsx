"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Investor, Match } from "@/lib/types";

export type GraphProps = {
  investors: Investor[];
  matches: Match[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  center?: { label: string };
  reducedMotion?: boolean;
  padLeft?: number;
};

const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0" aria-hidden />,
});

export default function Graph(props: GraphProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [systemReduced, setSystemReduced] = useState(false);

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

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden" data-testid="graph">
      {size.width > 0 && size.height > 0 && (
        <GraphCanvas {...props} width={size.width} height={size.height} reducedMotion={props.reducedMotion ?? systemReduced} padLeft={props.padLeft ?? 0} />
      )}
    </div>
  );
}
