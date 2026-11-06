"use client";

import type { WorkMessage } from "@peebee/shared";
import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";

/** Messages with the customer about this job. Checks for new ones every few seconds while open. */
export function JobChat({ jobId, canSend }: { jobId: string; canSend: boolean }) {
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const last = useRef<string | undefined>(undefined);

  const poll = useCallback(async () => {
    try {
      const res = await api.workProviderMessages(jobId, last.current);
      if (res.messages.length > 0) {
        last.current = res.messages[res.messages.length - 1].id;
        setMessages((prev) => [...prev, ...res.messages.filter((m) => !prev.some((p) => p.id === m.id))]);
      }
    } catch { /* chat may be switched off or not set up yet; the panel just stays empty */ }
  }, [jobId]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [poll]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.workProviderSendMessage(jobId, body);
      setText("");
      await poll();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (messages.length === 0 && !canSend) return null;
  return (
    <section className="home-card space-y-3 p-4">
      <h2 className="text-base font-black uppercase tracking-wider text-ink-500">Messages</h2>
      {messages.length > 0 && (
        <div className="max-h-64 space-y-2 overflow-y-auto" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.from === "provider" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[80%] rounded-2xl px-3 py-2 text-lg font-medium ${m.from === "provider" ? "bg-gold text-ink-gold" : "bg-black/5 text-ink"}`}>{m.body}</p>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{error}</div>}
      {canSend && (
        <form onSubmit={send} className="field-box flex items-center gap-2 px-3 py-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Message the customer…" aria-label="Message" className="w-full text-lg font-medium text-ink outline-none" />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="shrink-0 text-gold disabled:opacity-40"><Send className="h-5 w-5" aria-hidden /></button>
        </form>
      )}
    </section>
  );
}
