"use client";

import { useState, type DragEvent } from "react";
import type { ClaimBasis, ContextRound } from "@/lib/context/types";
import type { ContextDoc, ContextVerification, Upload } from "./types";

export type CompanyFileProps = {
  doc: ContextDoc;
  markdown: string;
  verification?: ContextVerification;
  onAddContext: (upload: Upload) => void;
};

type Item = { text: string; basis: ClaimBasis };
type Unconfirmed = ContextVerification["unconfirmed"][number];

const LEVEL_LABEL: Record<Unconfirmed["level"], string> = {
  verified: "verified",
  corroborated: "corroborated",
  single_source: "single source",
  unverified: "unverified",
  conflict: "conflict",
};

// The audit keys unconfirmed facts by claim id (ctx:<company>:<kind>:…) and the text load.ts
// builds for them; both are matched so a founder and an investor with one name cannot collide.
function unconfirmedFor(list: Unconfirmed[] | undefined, kind: "round" | "investor" | "founder", text: string): Unconfirmed | undefined {
  return list?.find((u) => u.id.includes(`:${kind}:`) && u.text === text);
}

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

export default function CompanyFile({ doc, markdown, verification, onAddContext }: CompanyFileProps) {
  const [open, setOpen] = useState(false);
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const [paste, setPaste] = useState("");
  const [over, setOver] = useState(false);

  const unconfirmed = verification?.unconfirmed ?? [];
  const company: Item[] = [
    { text: [doc.company.name, doc.company.hq, doc.company.founded ? `founded ${doc.company.founded}` : undefined].filter(Boolean).join(" · "), basis: basisFor(doc, "founder") },
  ];
  const investors: Item[] = doc.investors
    .filter((i) => !unconfirmedFor(unconfirmed, "investor", `Investor: ${i.name}`))
    .map((i) => ({ text: [i.name, i.round, i.lead ? "lead" : undefined].filter(Boolean).join(" · "), basis: "cala" }));
  const rounds: Item[] = doc.rounds.filter((r) => !unconfirmedFor(unconfirmed, "round", `${r.label}${r.date ? `, ${r.date}` : ""}`)).map((r) => ({ text: roundLine(r), basis: "cala" }));
  const founders: Item[] = doc.founders.filter((f) => !unconfirmedFor(unconfirmed, "founder", `Founder: ${f.name}`)).map((f) => ({ text: f.role ? `${f.name} · ${f.role}` : f.name, basis: "cala" }));
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
        <span className="muted">Sources: Cala · website · you</span>
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
        {unconfirmed.length > 0 && (
          <div className="path-unconfirmed" data-testid="unconfirmed">
            <button type="button" className="path-link path-file-key" onClick={() => setShowUnconfirmed((v) => !v)} aria-expanded={showUnconfirmed}>
              {showUnconfirmed ? "▾" : "▸"} Unconfirmed ({unconfirmed.length})
            </button>
            <span className="path-file-vals">
              {showUnconfirmed ? (
                unconfirmed.map((u) => (
                  <span key={u.id} className={`path-claim is-unconfirmed is-${u.level}`} title={u.reasons.join("; ") || "Cala's graph is the only source"} data-testid="unconfirmed-claim">
                    {u.text}
                    <i className="path-basis path-basis-unconfirmed">{LEVEL_LABEL[u.level]}</i>
                  </span>
                ))
              ) : (
                <span className="muted path-unconfirmed-hint">Cala facts the audit could not confirm against a second source. Not shown as fact.</span>
              )}
            </span>
          </div>
        )}
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
