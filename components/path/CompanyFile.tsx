"use client";

import { useState, type DragEvent } from "react";
import type { ContextClaim, ContextDoc } from "./types";

export type CompanyFileProps = {
  doc: ContextDoc;
  markdown: string;
  onAddContext: (upload: { name: string; text: string }) => void;
  demo: boolean;
};

function Claims({ title, items }: { title: string; items: ContextClaim[] }) {
  if (!items.length) return null;
  return (
    <div className="path-file-row">
      <span className="path-file-key">{title}</span>
      <span className="path-file-vals">
        {items.map((c, i) => (
          <span key={i} className="path-claim" title={`Basis: ${c.basis}`}>
            {c.text}
            <i className={`path-basis path-basis-${c.basis.toLowerCase()}`}>{c.basis}</i>
          </span>
        ))}
      </span>
    </div>
  );
}

export default function CompanyFile({ doc, markdown, onAddContext, demo }: CompanyFileProps) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [over, setOver] = useState(false);

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.company.text.split("·")[0].trim().replace(/\s+/g, "-").toLowerCase() || "company"}-file.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const text = /pdf$/i.test(file.name) ? `(pdf, ${Math.round(file.size / 1024)} KB)` : await file.text();
    onAddContext({ name: file.name, text });
  };

  return (
    <section className="path-file" aria-label="Your company file" data-testid="company-file">
      <header className="path-section-head">
        <span>
          Your company file {demo && <span className="path-demo-tag">demo data</span>}
        </span>
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
        <Claims title="Company" items={[doc.company]} />
        <Claims title="Investors" items={doc.investors} />
        <Claims title="Rounds" items={doc.rounds} />
        {open && (
          <>
            <Claims title="Founders" items={doc.founders} />
            <Claims title="Product" items={doc.product} />
            {doc.vision && <Claims title="Vision" items={[doc.vision]} />}
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
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Add context: paste text or drop a .md / .txt / .pdf" rows={2} />
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
