"use client";
import { Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FollowUpMessage } from "./attention.js";

type MessageApi = {
  getFollowUpMessages(orderId: string, recipientId: string): Promise<{ messages: FollowUpMessage[] }>;
  sendFollowUpMessage(orderId: string, recipientId: string, body: string): Promise<unknown>;
  readFollowUpMessages(orderId: string, recipientId: string): Promise<unknown>;
};
export function FollowUpMessages({ api, orderId, recipientId, name, onClose }: { api: MessageApi; orderId: string; recipientId: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [messages, setMessages] = useState<FollowUpMessage[]>([]), [body, setBody] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    const load = async () => {
      try {
        const r = await api.getFollowUpMessages(orderId, recipientId);
        if (live) { setMessages(r.messages); await api.readFollowUpMessages(orderId, recipientId); }
      } catch { if (live) setError("Could not load messages. Please try again."); }
    };
    void load(); const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [api, orderId, recipientId]);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} aria-label={`Message ${name}`} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-[var(--border-faint)] bg-cream p-5 text-ink backdrop:bg-black/40">
    <header className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-extrabold">{name}</h2><button type="button" aria-label="Close messages" onClick={onClose}><X aria-hidden /></button></header>
    <div role="log" aria-label="Order messages" className="mb-4 max-h-[50dvh] min-h-40 space-y-3 overflow-y-auto">{messages.length ? messages.map((m) => <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.senderId === recipientId ? "bg-[rgb(var(--surface-muted))]" : "ml-auto bg-gold/20"}`}><p className="whitespace-pre-wrap break-words text-sm">{m.body}</p></div>) : <p className="text-sm text-ink-500">Start a conversation about this order.</p>}</div>
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    <form className="flex gap-2" onSubmit={async (e) => {
      e.preventDefault(); if (!body.trim() || lock.current) return;
      lock.current = true; setBusy(true); setError("");
      try { await api.sendFollowUpMessage(orderId, recipientId, body.trim()); setBody(""); const r = await api.getFollowUpMessages(orderId, recipientId); setMessages(r.messages); }
      catch { setError("Could not send. Your message is still here; try again."); }
      finally { lock.current = false; setBusy(false); }
    }}><label className="flex-1"><span className="sr-only">Message</span><input autoComplete="off" required maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-12 w-full rounded-xl px-3" placeholder="Write a message" /></label><button type="submit" disabled={busy || !body.trim()} aria-label="Send message" className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold text-ink-gold disabled:opacity-50"><Send className="h-5 w-5" aria-hidden /></button></form>
  </dialog>;
}
