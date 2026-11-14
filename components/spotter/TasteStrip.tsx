import { pct } from "./format";
import type { SpotterInvestor } from "./types";

// The learned taste as one sentence: top sector, entry stage, lead share, cheque band.
export default function TasteStrip({ investor, sectorColor }: { investor: SpotterInvestor; sectorColor: (label: string) => string }) {
  const { taste } = investor;
  const sector = taste.sectors[0];
  const stage = taste.entryStage ?? taste.stages[0]?.label;
  return (
    <p className="sp-taste" data-testid="spotter-taste">
      <b>Your taste</b>
      <span className="muted">, from {investor.rounds} real rounds</span>
      {investor.lowConfidence && (
        <span className="sp-lowconf" title={`Thin history: only ${investor.rounds} rounds in the cohort`}>
          {" "}
          <i aria-hidden>!</i> thin
        </span>
      )}
      :{" "}
      {sector && (
        <>
          <i className="dot" style={{ color: sectorColor(sector.label), background: sectorColor(sector.label) }} aria-hidden />
          {sector.label} <small className="font-mono">{pct(sector.share * 100)}</small>
        </>
      )}
      {stage && <> · enters at {stage}</>}
      <> · </>
      <span className="k">leads {pct(taste.leadShare * 100)}</span>
      {taste.chequeBand && <> · {taste.chequeBand} rounds</>}
    </p>
  );
}
