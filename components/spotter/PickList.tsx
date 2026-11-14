import { pct, precedentLine, roundLabel, sectorColor, sectorLabel } from "./format";
import type { SpotterPick } from "./types";

type Props = { picks: SpotterPick[]; selectedId?: string; onSelect: (id: string) => void };

// Each pick is one sentence: who, what, and the two numbers that matter.
export default function PickList({ picks, selectedId, onSelect }: Props) {
  return (
    <ol className="sp-picks" data-testid="spotter-list">
      {picks.map((p, i) => {
        const selected = selectedId === p.company.id;
        const color = sectorColor(p.company.sector);
        return (
          <li key={p.company.id}>
            <button type="button" className={`sp-pick ${selected ? "is-selected" : ""}`} data-testid={`spotter-pick-${p.company.id}`} onClick={() => onSelect(p.company.id)}>
              <span className="sp-pick-rank font-mono">{i + 1}</span>
              <span className="sp-pick-main">
                <span className="sp-pick-name">
                  <i className="dot" style={{ color, background: color }} aria-hidden />
                  <span>{p.company.name}</span>
                  <span className="sp-pick-meta">
                    {sectorLabel(p.company.sector)} · {roundLabel(p.company.latestRound)}
                  </span>
                </span>
                <span className="sp-pick-line">
                  {precedentLine(p)}.{" "}
                  <span className="k">
                    You&rsquo;re on its path <b className="font-mono">{pct(p.scores.youOnPath)}</b>
                  </span>
                  .
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
