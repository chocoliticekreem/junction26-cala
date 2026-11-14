import { pct } from "./format";
import type { SpotterInvestor } from "./types";

export default function TasteStrip({ investor, sectorColor }: { investor: SpotterInvestor; sectorColor: (label: string) => string }) {
  const { taste } = investor;
  const sector = taste.sectors[0];
  const stage = taste.entryStage ?? taste.stages[0]?.label;
  return (
    <section className="sp-card" data-testid="spotter-taste">
      <div className="sp-card-head">
        <span>Your taste</span>
        <span className="muted font-mono">
          from {investor.rounds} real rounds
          {investor.lowConfidence && (
            <span className="sp-lowconf" title={`Thin history: only ${investor.rounds} rounds in the cohort`}>
              {" "}
              <i aria-hidden>!</i> thin
            </span>
          )}
        </span>
      </div>
      <div className="sp-taste-chips">
        {sector && (
          <span className="sp-chip sp-chip-lg">
            <i className="dot" style={{ color: sectorColor(sector.label), background: sectorColor(sector.label) }} aria-hidden />
            {sector.label} <small>{pct(sector.share * 100)}</small>
          </span>
        )}
        {stage && <span className="sp-chip sp-chip-lg">{stage}</span>}
        <span className="sp-chip sp-chip-lg k">leads {pct(taste.leadShare * 100)}</span>
        {taste.chequeBand && <span className="sp-chip sp-chip-lg">{taste.chequeBand} rounds</span>}
      </div>
    </section>
  );
}
