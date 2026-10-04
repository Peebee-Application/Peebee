"use client";

import type { StageMessage } from "@peebee/shared";
import { Send } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { useLivePolling } from "../../../../lib/use-live-polling";

const SYSTEM_LABEL: Record<string, string> = {
  member_joined: "joined the circle",
  election_opened: "voting opened",
  election_resolved: "a new officer was elected",
  cycle_started: "a new savings cycle started",
  contribution_intent: "declared a savings intent",
  contribution_confirmed: "a contribution was confirmed",
  contribution_proof: "attached proof of payment",
  loan_requested: "requested a loan",
  loan_approved: "a loan was approved",
  loan_rejected: "a loan was rejected",
  loan_disbursed: "a loan payout was confirmed",
  repayment_intent: "declared a repayment intent",
  repayment_confirmed: "a repayment was confirmed",
  repayment_proof: "attached proof of payment",
};

export default function StageChatPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-ink-500">Loading…</div>}>
      <StageChatContent />
    </Suspense>
  );
}

function StageChatContent() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const searchParams = useSearchParams();
  const withRiderId = searchParams.get("with") ?? undefined;
  const { user } = useAuth();
  const [messages, setMessages] = useState<StageMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = () => {
    api
      .getStageMessages(stageId, withRiderId)
      .then((res) => setMessages(res.messages))
      .catch((err) => setError(errorMessage(err)));
  };

  useLivePolling(load, 5000, [stageId, withRiderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send() {
    if (!draft.trim()) return;
    const body = draft.trim();
    setDraft("");
    try {
      await api.sendStageMessage(stageId, { body, recipientId: withRiderId });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="border-b border-[var(--border-faint)] px-4 py-2.5">
        <h1 className="text-sm font-bold text-ink">{withRiderId ? "Direct message" : "Circle chat"}</h1>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {messages.map((m) =>
          m.type === "system" ? (
            <div key={m.id} className="flex justify-center">
              <span className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1 text-[11px] text-ink-500">
                {SYSTEM_LABEL[m.system_event_type ?? ""] ?? "update"}
              </span>
            </div>
          ) : (
            <div key={m.id} className={`flex ${m.sender_id === user?.id ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  m.sender_id === user?.id ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"
                }`}
              >
                {m.type === "image" ? <span className="italic">📷 Photo attached</span> : m.body}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border-faint)] px-4 py-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message…"
          className="min-w-0 flex-1 rounded-full border border-[var(--border-faint)] px-4 py-2.5 text-sm outline-none focus:border-gold"
        />
        <button
          type="button"
          onClick={send}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-ink-gold"
          aria-label="Send"
        >
          <Send className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
