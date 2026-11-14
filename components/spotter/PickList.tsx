import { pct, roundLabel, sectorColor, sectorLabel } from "./format";
import type { SpotterPick } from "./types";

type Props = { picks: SpotterPick[]; selectedId?: string; onSelect: (id: string) => void };

export default function PickList({ picks, selectedId, onSelect }: Props) {
  return (
    <section className="sp-card" data-testid="spotter-list">
      <div className="sp-card-head">
        <span>On a unicorn-shaped path</span>
        <span className="muted font-mono">{picks.length} ranked</span>
      </div>
      <ol className="sp-picks">
        {picks.map((p, i) => {
          const selected = selectedId === p.company.id;
          return (
            <li key={p.company.id}>
              <button type="button" className={`sp-pick ${selected ? "is-selected" : ""}`} data-testid={`spotter-pick-${p.company.id}`} onClick={() => onSelect(p.company.id)}>
                <span className="sp-pick-rank font-mono">{i + 1}</span>
                <span className="sp-pick-main">
                  <span className="sp-pick-name">
                    <i className="dot" style={{ color: sectorColor(p.company.sector), background: sectorColor(p.company.sector) }} aria-hidden />
                    <span>{p.company.name}</span>
                  </span>
                  <span className="sp-pick-chips">
                    <span className="sp-chip">{sectorLabel(p.company.sector)}</span>
                    <span className="sp-chip">{roundLabel(p.company.latestRound)}</span>
                  </span>
                </span>
                <span className="sp-num font-mono">
                  <b>{pct(p.scores.unicornOdds)}</b>
                  <small>odds</small>
                </span>
                <span className="sp-num font-mono k">
                  <b>{pct(p.scores.youOnPath)}</b>
                  <small>you</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
