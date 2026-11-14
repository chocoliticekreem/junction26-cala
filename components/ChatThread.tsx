"use client";

import { useEffect, useRef, useState } from "react";
import type { Interest, Message } from "@/lib/types";
import { Button, Label } from "@/components/dev-e/ui";

export type ChatThreadProps = {
  interest: Interest;
  messages: Message[];
  me: "investor" | "founder";
  counterpartName: string;
  suggestedFirst?: string;
  onSend: (text: string) => { ok: boolean; error?: string };
};

export function ChatThread({ interest, messages, me, counterpartName, suggestedFirst, onSend }: ChatThreadProps) {
  const mine = messages.filter((m) => m.interestId === interest.id);
  const [draft, setDraft] = useState(mine.length === 0 && suggestedFirst ? suggestedFirst : "");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [mine.length]);

  const send = () => {
    const r = onSend(draft);
    if (r.ok) {
      setDraft("");
      setError(null);
    } else setError(r.error ?? "Could not send");
  };

  return (
    <div data-testid="chat-thread" className="rounded-lg border border-[#FF6A3D]/25 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <Label>Chat with {counterpartName}</Label>
        <span className="text-[11px] text-white/35">local to this browser</span>
      </div>
      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {mine.length === 0 && (
          <p className="text-[12px] text-white/40">Both sides verified. Say hello: the draft below is written from the match reason, edit it before sending.</p>
        )}
        {mine.map((m, i) => (
          <div key={i} className={`flex ${m.from === me ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-1.5 text-[13px] leading-relaxed ${
                m.from === me ? "bg-[#FF6A3D]/15 text-white/90" : "bg-white/[0.06] text-white/85"
              }`}
            >
              {m.text}
              <div className="mt-0.5 text-right font-mono text-[10px] text-white/30">
                {new Date(m.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <textarea
          data-testid="chat-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
          placeholder="Write a message"
          className="flex-1 resize-none rounded-md border border-white/10 bg-[#0B0E17] px-2.5 py-1.5 text-[13px] text-white/90 placeholder:text-white/30 outline-none focus:border-[#FF6A3D]/60"
        />
        <Button variant="accent" onClick={send} disabled={!draft.trim()} dataTestId="chat-send">
          Send
        </Button>
      </div>
      {error && <p className="mt-1 text-[12px] text-[#FF6A3D]">{error}</p>}
    </div>
  );
}
