"use client";

import type { ChatMessage } from "@tuma/shared";
import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";

/** A simple text chat with the passenger/customer of the ride in progress. */
export function RideChat({ orderId, myId }: { orderId: string; myId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.getChat(orderId).then((r) => setMessages(r.messages)).catch(() => undefined);
    api.markChatRead(orderId).catch(() => undefined);
  }, [orderId]);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await api.sendChat(orderId, body);
      setText("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = (m: ChatMessage) => (m.type === "text" ? m.body : m.type === "image" ? "📷 Photo" : m.type === "voice" ? "🎤 Voice note" : "📞 Call");
  return (
    <div className="space-y-2">
      <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-[rgb(var(--surface-muted))] p-2">
        {messages.length === 0 && <p className="p-2 text-xs text-ink-500">No messages yet.</p>}
        {messages.map((m) => {
          const mine = m.sender_id === myId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <span className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${mine ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface))] text-ink"}`}>{label(m)}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" maxLength={1000} className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] px-3 text-sm" />
        <button disabled={busy || !text.trim()} aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-ink-gold disabled:opacity-50"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
