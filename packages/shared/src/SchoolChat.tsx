"use client";

import { ArrowLeft, Loader2, Phone, PhoneMissed, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SchoolChatConversation, SchoolChatMessage } from "./education/studio.js";

const POLL_MS = 5000;

const timeOf = (iso: string) => {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const dayOf = (iso: string) => {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
};

export type SchoolChatProps = {
  /** Who is on the screen: the learner or parent ("customer"), or the school's teacher ("school"). Their own messages sit on the right. */
  me: "customer" | "school";
  title: string;
  subtitle?: string;
  onBack: () => void;
  load: () => Promise<SchoolChatConversation>;
  send: (body: string) => Promise<unknown>;
  markRead: () => Promise<unknown>;
  /** Shown as a call button when Admin has calls on. */
  onCall?: () => void;
  errorMessage: (err: unknown) => string;
};

/**
 * One school conversation: a learner or parent writing to a school, or the teacher replying. Used by the Learn (teacher)
 * and customer (learner or parent) apps so both sides look and behave the same. It fills the screen above the bottom bar.
 */
export function SchoolChat({ me, title, subtitle, onBack, load, send, markRead, onCall, errorMessage }: SchoolChatProps) {
  const [data, setData] = useState<SchoolChatConversation | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await load();
      setData(next);
      setFailed(null);
      const unread = next.messages.filter((m) => m.sender_role !== me && !m.read).length;
      if (unread > 0) void markRead().catch(() => undefined);
    } catch (err) {
      setFailed((current) => current ?? errorMessage(err));
    }
  }, [load, markRead, me, errorMessage]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const count = data?.messages.length ?? 0;
    if (count !== seen.current) {
      seen.current = count;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [data]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await send(body);
      setText("");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const messages = data?.messages ?? [];
  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-cream pt-[env(safe-area-inset-top)] text-ink">
      <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-faint)] px-2 py-2">
          <button type="button" onClick={onBack} aria-label="Back" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-ink">
            <ArrowLeft className="h-6 w-6" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-black text-ink">{title}</h1>
            {subtitle && <p className="truncate text-base text-ink-500">{subtitle}</p>}
          </div>
          {onCall && data?.callsEnabled && (
            <button type="button" onClick={onCall} aria-label="Call" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green/15 text-green">
              <Phone className="h-6 w-6" fill="currentColor" aria-hidden />
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" role="log" aria-live="polite">
          {!data && !failed && <Loader2 className="mx-auto mt-10 h-8 w-8 animate-spin text-gold" aria-label="Loading" />}
          {failed && !data && <p className="mt-10 text-center text-lg text-ink-500">{failed}</p>}
          {data && messages.length === 0 && <p className="mt-10 text-center text-lg text-ink-500">No messages yet. Say hello.</p>}
          {messages.map((m: SchoolChatMessage, i) => {
            const newDay = i === 0 || dayOf(messages[i - 1]!.created_at) !== dayOf(m.created_at);
            return (
              <div key={m.id}>
                {newDay && <p className="py-2 text-center text-base font-semibold text-ink-500">{dayOf(m.created_at)}</p>}
                {m.type === "call" ? (
                  <p className="flex items-center justify-center gap-2 py-1 text-base text-ink-500">
                    {m.call_status === "ended" ? <Phone className="h-4 w-4" aria-hidden /> : <PhoneMissed className="h-4 w-4" aria-hidden />}
                    {m.body} · {timeOf(m.created_at)}
                  </p>
                ) : (
                  <div className={`flex ${m.sender_role === me ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.sender_role === me ? "rounded-br-md bg-gold text-ink-gold" : "rounded-bl-md bg-[rgb(var(--surface-muted))] text-ink"}`}>
                      <p className="whitespace-pre-wrap break-words text-lg">{m.body}</p>
                      <p className={`mt-0.5 text-right text-sm ${m.sender_role === me ? "opacity-70" : "text-ink-500"}`}>{timeOf(m.created_at)}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottom} />
        </div>

        {error && (
          <p role="alert" className="mx-3 mb-2 rounded-xl bg-red-50 px-3 py-2 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-t border-[var(--border-faint)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <textarea
            aria-label="Message"
            rows={1}
            value={text}
            maxLength={data?.maxMessageChars ?? 1000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit(e);
              }
            }}
            placeholder="Write a message"
            className="max-h-32 min-h-14 min-w-0 flex-1 resize-none rounded-2xl border border-[var(--border-faint)] px-4 py-3.5 text-lg text-ink outline-none focus:border-gold"
          />
          <button type="submit" disabled={busy || !text.trim() || (!data && !!failed)} aria-label="Send" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold text-ink-gold disabled:opacity-50">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Send className="h-6 w-6" aria-hidden />}
          </button>
        </form>
      </div>
    </div>
  );
}
