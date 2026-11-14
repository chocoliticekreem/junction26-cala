"use client";

import { useState } from "react";
import type { FounderProfile, Interest, Investor, Verification } from "@/lib/types";
import { verifyFounder, verifyInvestor, type InterestStore } from "@/lib/engine";
import { Button, Label } from "@/components/ui";
import { hostOf } from "@/lib/verification";

export type VerificationChecklistProps = {
  interest: Interest;
  investor: Investor;
  founder: FounderProfile;
  store: InterestStore;
  side: "founder" | "investor";
  onVerify: (v: Verification) => void;
};

function findVerification(store: InterestStore, subjectId: string, side: "investor" | "founder") {
  return store.verifications.find((v) => v.subjectId === subjectId && v.side === side);
}

function passed(v?: Verification) {
  return !!v && v.checks.length > 0 && v.checks.every((c) => c.passed);
}

function Tick({ on, delayMs }: { on: boolean; delayMs: number }) {
  return (
    <span
      className={`relative flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
        on ? "border-[#FF6A3D] bg-[#FF6A3D]/15" : "border-white/15"
      }`}
    >
      {on && (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="#FF6A3D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" className="tick-path" style={{ animationDelay: `${delayMs}ms` }} />
        </svg>
      )}
    </span>
  );
}

function Lock({ open }: { open: boolean }) {
  return (
    <span
      data-testid="chat-lock"
      data-state={open ? "open" : "locked"}
      className={`flex size-10 items-center justify-center rounded-full border transition-all duration-500 ${
        open ? "border-[#FF6A3D]/60 bg-[#FF6A3D]/15 shadow-[0_0_24px_rgba(255,106,61,.35)]" : "border-white/12 bg-white/[0.03]"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke={open ? "#FF6A3D" : "rgba(255,255,255,.5)"} strokeWidth="1.8" strokeLinecap="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        {open ? <path d="M8 11V7a4 4 0 0 1 8 0" className="lock-shackle" style={{ transformOrigin: "16px 7px" }} /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
      </svg>
    </span>
  );
}

export function VerificationChecklist({ interest, investor, founder, store, side, onVerify }: VerificationChecklistProps) {
  const invV = findVerification(store, investor.id, "investor");
  const fV = findVerification(store, founder.id, "founder");
  const invOk = passed(invV);
  const fOk = passed(fV);
  const open = interest.state === "chat_open";

  const rows =
    side === "founder"
      ? [
          { who: "Yours", v: fV, ok: fOk, subject: "founder" as const },
          { who: "Theirs", v: invV, ok: invOk, subject: "investor" as const },
        ]
      : [
          { who: "Yours", v: invV, ok: invOk, subject: "investor" as const },
          { who: "Theirs", v: fV, ok: fOk, subject: "founder" as const },
        ];

  return (
    <div data-testid="verification-checklist" className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <style>{`
        @keyframes tick-draw { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
        .tick-path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: tick-draw .45s cubic-bezier(.33,1,.68,1) forwards; }
        @keyframes shackle-open { from { transform: rotate(0deg); } to { transform: rotate(-28deg) translate(-2px, -1px); } }
        .lock-shackle { animation: shackle-open .5s cubic-bezier(.33,1,.68,1) .9s both; }
        @media (prefers-reduced-motion: reduce) { .tick-path, .lock-shackle { animation-duration: 0s; animation-delay: 0s; } }
      `}</style>
      <div className="flex items-start gap-4">
        <div className="flex-1 space-y-2.5">
          <Label>Verification</Label>
          {rows.map((r, idx) => (
            <div key={r.who} className="flex items-start gap-2.5">
              <Tick on={r.ok} delayMs={idx * 450} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-white/85">
                  {r.who}
                  <span className="text-white/45"> · {r.subject === "investor" ? investor.name : founder.company ?? founder.name ?? "Founder"}</span>
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {(r.v?.checks ?? defaultChecks(r.subject)).map((c) => (
                    <li key={c.name} className={`text-[12px] ${c.passed ? "text-white/55" : "text-white/40"}`}>
                      <span className={`mr-1.5 font-mono ${c.passed ? "text-[#FF6A3D]" : "text-white/30"}`}>{c.passed ? "✓" : "·"}</span>
                      {c.name}
                      {c.detail && <span className="text-white/35"> — {c.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <Lock open={open} />
          <span className="text-[10px] uppercase tracking-wider text-white/40">{open ? "Chat open" : "Locked"}</span>
        </div>
      </div>

      {side === "founder" && !fOk && <FounderVerifyForm founder={founder} onVerified={onVerify} />}
      {side === "investor" && !invOk && <InvestorVerifyForm investor={investor} onVerified={onVerify} />}
      {!open && (side === "founder" ? fOk && !invOk : invOk && !fOk) && (
        <p className="mt-3 text-[12px] text-white/45">Waiting for the other side to verify. The lock opens automatically.</p>
      )}
    </div>
  );
}

function defaultChecks(subject: "investor" | "founder") {
  return subject === "investor"
    ? [
        { name: "Cala partner record", passed: false, detail: "not yet checked" },
        { name: "Fund-domain email", passed: false, detail: "not yet checked" },
      ]
    : [
        { name: "Company website or LinkedIn", passed: false, detail: "not yet provided" },
        { name: "Company-domain email", passed: false, detail: "not yet provided" },
      ];
}

const inputCls =
  "w-full rounded-md border border-white/10 bg-[#0B0E17] px-2.5 py-1.5 text-[13px] text-white/90 placeholder:text-white/30 outline-none focus:border-[#FF6A3D]/60";

export function InvestorVerifyForm({ investor, onVerified }: { investor: Investor; onVerified: (v: Verification) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Verification | null>(null);
  const domain = hostOf(investor.website) ?? "fund domain";

  const submit = () => {
    const v = verifyInvestor({ name, email }, investor);
    setResult(v);
    onVerified(v);
  };

  return (
    <form
      data-testid="investor-verify-form"
      className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-white/8 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="col-span-3 text-[12px] text-white/50">Verify as a partner at {investor.name}: your name is checked against the fund&apos;s Cala partner records.</div>
      <input className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} data-testid="verify-name" />
      <input className={inputCls} placeholder={`you@${domain}`} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="verify-email" />
      <Button type="submit" variant="solid" dataTestId="verify-submit">
        Verify
      </Button>
      {result && !result.checks.every((c) => c.passed) && (
        <div className="col-span-3 text-[12px] text-[#FF6A3D]/90">
          Pending verification: {result.checks.filter((c) => !c.passed).map((c) => c.detail ?? c.name).join("; ")}.
        </div>
      )}
    </form>
  );
}

export function FounderVerifyForm({ founder, onVerified }: { founder: FounderProfile; onVerified: (v: Verification) => void }) {
  const [url, setUrl] = useState(founder.website ?? "");
  const [email, setEmail] = useState(founder.email ?? "");
  const [result, setResult] = useState<Verification | null>(null);

  const submit = () => {
    const v = verifyFounder({ ...founder, website: url, email });
    setResult(v);
    onVerified(v);
  };

  return (
    <form
      data-testid="founder-verify-form"
      className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-white/8 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="col-span-3 text-[12px] text-white/50">Verify your company: a website or LinkedIn URL plus a company-domain email.</div>
      <input className={inputCls} placeholder="https://yourcompany.com or linkedin.com/in/you" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="founder-url" />
      <input className={inputCls} placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="founder-email" />
      <Button type="submit" variant="solid" dataTestId="founder-verify-submit">
        Verify
      </Button>
      {result && !result.checks.every((c) => c.passed) && (
        <div className="col-span-3 text-[12px] text-[#FF6A3D]/90">
          Pending verification: {result.checks.filter((c) => !c.passed).map((c) => c.detail ?? c.name).join("; ")}.
        </div>
      )}
    </form>
  );
}
