"use client";
import { FollowUpMessages } from "./FollowUpMessages.js";
import { BellRing, Check, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AttentionSettings, AttentionSignal, FollowUpMessage, FollowUpMessagePreview } from "./attention.js";
import { startAttentionTone } from "./notification-sound.js";

type AttentionApi = {
  getUnreadFollowUpMessage(): Promise<{ message: FollowUpMessagePreview | null }>;
  getFollowUpMessages(orderId: string, recipientId: string): Promise<{ messages: FollowUpMessage[] }>;
  sendFollowUpMessage(orderId: string, recipientId: string, body: string): Promise<unknown>;
  readFollowUpMessages(orderId: string, recipientId: string): Promise<unknown>;
  getIncomingAttention(): Promise<{ signal: AttentionSignal | null; settings: AttentionSettings }>;
  attentionAction(id: string, action: "acknowledge"): Promise<unknown>;
};
/** Mounted once per signed-in app. No baseline/order-stage sound, only an explicit signal. */
export function AttentionReceiver({ api, accountId }: { api: AttentionApi; accountId: string | null }) {
  const [signal, setSignal] = useState<AttentionSignal | null>(null);
  const [unread, setUnread] = useState<FollowUpMessagePreview | null>(null), [conversation, setConversation] = useState<FollowUpMessagePreview | null>(null);
  const [error, setError] = useState("");
  const attentionDialog = useRef<HTMLDialogElement>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    setSignal(null); setUnread(null); setConversation(null); seen.current.clear();
    if (!accountId) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    let active: AttentionSignal | null = null;
    const poll = async () => {
      let delay = 1000;
      try {
        if (document.visibilityState === "visible") {
          const result = await api.getIncomingAttention();
          if (!live) return;
          delay = result.settings.pollMilliseconds;
          const inbox = await api.getUnreadFollowUpMessage();
          if (!live) return;
          setUnread(inbox.message);
          active = result.signal;
          setSignal(active);
        } else { active = null; setSignal(null); }
      } catch {
        // Never leave the receiver ringing on a failed request or lost connection.
        active = null; if (live) setSignal(null);
        delay = 3000;
      }
      if (live) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [api, accountId]);
  const id = signal?.id, mode = signal?.mode;
  useEffect(() => {
    if (!id || !mode) return;
    if (mode === "tap" && seen.current.has(id)) return;
    seen.current.add(id);
    // Retain only recent ids during an unusually long session.
    if (seen.current.size > 100) seen.current.delete(seen.current.values().next().value!);
    return startAttentionTone(mode === "hold");
  }, [id, mode]);
  useEffect(() => {
    if (!signal) return;
    const timer = setTimeout(() => setSignal((current) => current?.id === signal.id ? null : current), Math.max(0, signal.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [signal]);
  useEffect(() => { if (id && attentionDialog.current && !attentionDialog.current.open) attentionDialog.current.showModal(); }, [id]);
  const messages = conversation && <FollowUpMessages api={api} orderId={conversation.orderId} recipientId={conversation.senderId} name={conversation.senderName} onClose={() => { setConversation(null); setUnread(null); }} />;
  if (!signal) return <>{messages}{unread && !conversation && <button type="button" onClick={() => setConversation(unread)} className="fixed right-4 top-20 z-[70] flex max-w-xs items-center gap-2 rounded-2xl border border-gold bg-cream px-4 py-3 font-bold text-ink shadow"><MessageCircle className="h-5 w-5" aria-hidden />Message from {unread.senderName}</button>}</>;
  return <>{messages}<dialog ref={attentionDialog} onCancel={(e) => e.preventDefault()} aria-labelledby="attention-title" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border-0 bg-cream p-0 text-ink backdrop:bg-black/40">
    <section className="w-full max-w-sm rounded-3xl bg-cream p-6 text-center text-ink">
      <BellRing className="mx-auto mb-4 h-16 w-16 text-gold" aria-hidden />
      <h2 id="attention-title" className="text-2xl font-extrabold">{signal.senderName} is following up</h2>
      <p className="my-3 text-sm">{signal.reason}</p>
      {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
      <button type="button" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gold font-bold text-ink-gold" onClick={() => {
        setError(""); void api.attentionAction(signal.id, "acknowledge").then(() => setSignal(null)).catch(() => setError("Could not acknowledge. Try again."));
      }}><Check aria-hidden />Got it</button>
    </section>
  </dialog></>;
}
