"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { FounderMatch } from "@/lib/engine";
import type { OrbitGroupBy } from "@/lib/orbit";
import type { FounderProfile, Investor } from "@/lib/types";

export type FounderOrbitProps = {
  investor: Investor;
  founders: FounderProfile[];
  matches: FounderMatch[];
  groupBy: OrbitGroupBy;
  liveId: string;
  selectedId?: string;
  onSelect: (id?: string) => void;
};

const FounderOrbitCanvas = dynamic(() => import("./FounderOrbitCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0" aria-hidden />,
});

export default function FounderOrbit(props: FounderOrbitProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);

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
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden" data-testid="founder-orbit">
      {size.width > 0 && size.height > 0 && <FounderOrbitCanvas {...props} width={size.width} height={size.height} reducedMotion={reducedMotion} />}
    </div>
  );
}
