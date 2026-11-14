"use client";

import { useState } from "react";

export type PickerOption = { id: string; name: string; kind?: string };

type Props = { options: PickerOption[]; value: PickerOption | null; onChange: (o: PickerOption) => void; autoFocus?: boolean; loading?: boolean };

export default function InvestorPicker({ options, value, onChange, autoFocus, loading }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);

  const choose = (o: PickerOption) => {
    onChange(o);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="sp-picker">
      <input
        data-testid="spotter-picker"
        value={open ? q : (value?.name ?? "")}
        placeholder="Which investor are you?"
        autoFocus={autoFocus}
        onFocus={() => {
          setOpen(true);
          setQ("");
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && hits[active]) {
            e.preventDefault();
            choose(hits[active]);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {open && (
        <ul role="listbox">
          {hits.map((o, i) => (
            <li key={o.id}>
              <button type="button" role="option" aria-selected={i === active} className={i === active ? "is-active" : ""} data-testid={`spotter-pick-investor-${o.id}`} onMouseDown={() => choose(o)}>
                <span className="truncate">{o.name}</span>
                <span>{o.kind?.replace("_", " ")}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="empty">{loading ? "Loading investors…" : "No investor matches."}</li>}
        </ul>
      )}
    </div>
  );
}
