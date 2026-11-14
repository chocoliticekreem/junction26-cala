import { pct } from "./format";
import type { SpotterInvestor } from "./types";

function Bars({ title, rows, color }: { title: string; rows: { label: string; share: number }[]; color: (label: string) => string }) {
  return (
    <div className="sp-taste-col">
      <span className="sp-taste-label">{title}</span>
      {rows.map((r) => (
        <div key={r.label} className="sp-bar">
          <span>{r.label}</span>
          <i>
            <b style={{ width: `${Math.round(Math.min(1, r.share) * 100)}%`, background: color(r.label) }} />
          </i>
          <span className="font-mono">{pct(r.share * 100)}</span>
        </div>
      ))}
      {rows.length === 0 && <span className="muted text-[11.5px]">none on record</span>}
    </div>
  );
}

export default function TasteStrip({ investor, sectorColor }: { investor: SpotterInvestor; sectorColor: (label: string) => string }) {
  const { taste } = investor;
  return (
    <section className="sp-card" data-testid="spotter-taste">
      <div className="sp-card-head">
        <span>Your taste</span>
        <span className="muted font-mono">
          {investor.rounds} rounds · {investor.companies} companies
          {investor.lowConfidence && (
            <span className="sp-lowconf" title={`Thin history: only ${investor.rounds} rounds in the cohort`}>
              {" "}
              <i aria-hidden>!</i> thin
            </span>
          )}
        </span>
      </div>
      <div className="sp-taste">
        <Bars title="Sectors" rows={taste.sectors} color={sectorColor} />
        <Bars title="Stages" rows={taste.stages} color={() => "rgb(233 236 244 / 0.5)"} />
        <div className="sp-taste-facts">
          <div className="sp-fact">
            <small>Rounds</small>
            <b className="font-mono">{taste.chequeBand}</b>
          </div>
          <div className="sp-fact">
            <small>Leads</small>
            <b className="font-mono k">{pct(taste.leadShare * 100)}</b>
          </div>
        </div>
      </div>
    </section>
  );
}
