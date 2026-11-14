import type { ReactNode } from "react";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";

// Small shared primitives for Track E screens. Palette per SPEC 6: bg #0B0E17, panels #121726,
// hairlines white/8, text white/90 + white/60, one accent #FF6A3D for "about you".

export const ACCENT = "#FF6A3D";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/8 bg-[#121726] ${className}`}>{children}</div>;
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[11px] uppercase tracking-[0.14em] text-white/40 ${className}`}>{children}</div>;
}

export function Chip({ children, tone = "neutral", dot }: { children: ReactNode; tone?: "neutral" | "accent" | "muted"; dot?: string }) {
  const cls =
    tone === "accent"
      ? "border-[#FF6A3D]/40 bg-[#FF6A3D]/10 text-[#FF6A3D]"
      : tone === "muted"
        ? "border-white/8 bg-white/[0.03] text-white/40"
        : "border-white/10 bg-white/[0.04] text-white/70";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] leading-5 ${cls}`}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}
      {children}
    </span>
  );
}

export function SectorChip({ sector }: { sector: Sector }) {
  return <Chip dot={SECTOR_COLOR[sector]}>{SECTOR_SHORT[sector]}</Chip>;
}

export function StageChip({ stage }: { stage: Stage }) {
  return <Chip>{STAGE_LABELS[stage]}</Chip>;
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  title,
  className = "",
  type = "button",
  dataTestId,
  stopPropagation,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "accent" | "solid" | "danger";
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
  dataTestId?: string;
  stopPropagation?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const v =
    variant === "accent"
      ? "bg-[#FF6A3D] text-[#0B0E17] hover:bg-[#ff7d55]"
      : variant === "solid"
        ? "bg-white/90 text-[#0B0E17] hover:bg-white"
        : variant === "danger"
          ? "border border-white/10 text-white/60 hover:border-white/20 hover:text-white/80"
          : "border border-white/10 text-white/80 hover:border-white/25 hover:bg-white/[0.04]";
  return (
    <button
      type={type}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onClick?.();
      }}
      disabled={disabled} title={title} className={`${base} ${v} ${className}`} data-testid={dataTestId}>
      {children}
    </button>
  );
}

export function Score({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {value}
      <span className="text-white/30">/100</span>
    </span>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border border-white/10 font-medium text-white/80"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${h} 30% 22%)` }}
    >
      {initials}
    </div>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function formatMoney(usd: number): string {
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(usd % 1e6 === 0 ? 0 : 1)}M`;
  return `$${Math.round(usd / 1e3)}k`;
}

export function dealsSince(deals: { date?: string }[]): string | undefined {
  const years = deals.map((d) => d.date?.slice(0, 4)).filter(Boolean) as string[];
  if (!years.length) return undefined;
  return years.sort()[0];
}
