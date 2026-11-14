"use client";

import { useState, type DragEvent } from "react";
import type { ClaimBasis, ContextRound } from "@/lib/context/types";
import type { ContextDoc, Upload } from "./types";

export type CompanyFileProps = {
  doc: ContextDoc;
  markdown: string;
  onAddContext: (upload: Upload) => void;
};

type Item = { text: string; basis: ClaimBasis };

const BASIS_LABEL: Record<ClaimBasis, string> = { cala: "Cala", website: "Website", founder: "You" };

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  return `$${Math.round(n / 1e3)}k`;
}

// Same shape as the Markdown export's round line (lib/context/doc.ts is server-only).
function roundLine(r: ContextRound): string {
  const amount = r.amountText ?? (r.amountUsd ? usd(r.amountUsd) : undefined);
  const parts = [r.label, amount ? `(${amount})` : undefined, r.date, r.leads.length ? `led by ${r.leads.join(", ")}` : undefined];
  return parts.filter(Boolean).join(" · ");
}

function Row({ title, items }: { title: string; items: Item[] }) {
  if (!items.length) return null;
  return (
    <div className="path-file-row">
      <span className="path-file-key">{title}</span>
      <span className="path-file-vals">
        {items.map((c, i) => (
          <span key={i} className="path-claim" title={`Basis: ${BASIS_LABEL[c.basis]}`}>
            {c.text}
            <i className={`path-basis path-basis-${c.basis}`}>{BASIS_LABEL[c.basis]}</i>
          </span>
        ))}
      </span>
    </div>
  );
}

// Which source backs a fact: the founder's own words when nothing came from the graph or the site.
function basisFor(doc: ContextDoc, fallback: ClaimBasis): ClaimBasis {
  return doc.coverage.cala ? "cala" : doc.coverage.website ? "website" : fallback;
}

export default function CompanyFile({ doc, markdown, onAddContext }: CompanyFileProps) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [over, setOver] = useState(false);

  const company: Item[] = [
    { text: [doc.company.name, doc.company.hq, doc.company.founded ? `founded ${doc.company.founded}` : undefined].filter(Boolean).join(" · "), basis: basisFor(doc, "founder") },
  ];
  const investors: Item[] = doc.investors.map((i) => ({ text: [i.name, i.round, i.lead ? "lead" : undefined].filter(Boolean).join(" · "), basis: "cala" }));
  const rounds: Item[] = doc.rounds.map((r) => ({ text: roundLine(r), basis: "cala" }));
  const founders: Item[] = doc.founders.map((f) => ({ text: f.role ? `${f.name} · ${f.role}` : f.name, basis: "cala" }));
  const product: Item[] = doc.product ? [{ text: doc.product, basis: doc.coverage.website ? "website" : "founder" }] : [];
  const vision: Item[] = doc.vision ? [{ text: doc.vision, basis: "founder" }] : [];
  const founderClaims: Item[] = doc.claims.filter((c) => c.basis === "founder").map((c) => ({ text: c.text, basis: "founder" }));
  const empty = !doc.coverage.cala && !doc.coverage.website && !doc.coverage.founder;

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.company.name.replace(/\s+/g, "-").toLowerCase() || "company"}-file.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (/pdf$/i.test(file.name)) return;
    onAddContext({ name: file.name, text: await file.text() });
  };

  return (
    <section className="path-file" aria-label="Your company file" data-testid="company-file">
      <header className="path-section-head">
        <span>Your company file</span>
        <span className="path-file-tools">
          <button type="button" className="path-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Less" : "More"}
          </button>
          <button type="button" className="path-link" onClick={download}>
            Download .md
          </button>
        </span>
      </header>
      <div className="path-file-body">
        {empty && <p className="muted path-file-empty">Nothing on file yet. Add context below.</p>}
        <Row title="Company" items={company} />
        <Row title="Investors" items={investors} />
        <Row title="Rounds" items={rounds} />
        {open && (
          <>
            <Row title="Founders" items={founders} />
            <Row title="Product" items={product} />
            <Row title="Vision" items={vision} />
            <Row title="You said" items={founderClaims} />
            <div
              className={`path-drop ${over ? "is-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
              data-testid="context-drop"
            >
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Add context: paste text or drop a .md / .txt" rows={2} />
              <button
                type="button"
                className="btn"
                disabled={!paste.trim()}
                onClick={() => {
                  onAddContext({ name: "pasted", text: paste.trim() });
                  setPaste("");
                }}
              >
                Add
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
