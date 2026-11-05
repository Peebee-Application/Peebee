"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { supportAppLabel, type SupportAppId } from "./support-chat.js";

/**
 * Help & support: the Peebee AI assistant first, with a hand-over to the support team (answered in Admin → Support chat).
 * One component for every app's Settings → Help & support page. Self-contained styles that use each app's own colour
 * tokens (with fallbacks), because the apps' Tailwind builds do not scan this package.
 *
 * The chat survives leaving the page and coming back (the session lives in sessionStorage), and it signs the visitor in
 * to the chat with the app's own token so the team can see who they are talking to.
 */

type Sender = "user" | "ai" | "agent" | "system";
type Message = { id: number; from: Sender; text: string; at: string; agentName?: string };
type Status = "ai" | "waiting" | "human" | "closed";
type Session = { id: string; secret: string };
type Availability = { state: "online" | "offline"; reason: "hours" | "nobody" | null; offer: "talk" | "message" | "none"; hours: string | null; agentsOnline: number | null };
type Config = { live: boolean; aiEnabled: boolean; humanEnabled: boolean; availability?: Availability | null };
type Poll = { status: Status; agentName: string | null; position: number | null; leftOffline?: boolean; availability?: Availability | null; messages: Message[] };

const GREETING = "Hi, I am the Peebee assistant. Ask me about orders, trips, the wallet or how this app works. If you need a person, use the button above.";
const POLL_MS = 3000;
const POLL_HIDDEN_MS = 15000;
const CHIPS = ["How does the wallet work?", "I have a problem with a payment", "How do I get paid?", "Something else"];

const CSS = `
.pbhs{display:flex;flex-direction:column;height:min(34rem,calc(100dvh - 18rem));min-height:20rem;border:1px solid var(--border-faint,rgba(10,10,10,.08));border-radius:20px;background:rgb(var(--surface-card,255 255 255));color:rgb(var(--color-ink,10 10 10));overflow:hidden;font:inherit}
.pbhs *{box-sizing:border-box}
.pbhs-head{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid var(--border-faint,rgba(10,10,10,.08))}
.pbhs-head b{display:block;font-size:.9rem}
.pbhs-head small{display:flex;align-items:center;gap:.35rem;font-size:.72rem;color:rgb(var(--color-ink-500,92 102 112))}
.pbhs-dot{width:.5rem;height:.5rem;border-radius:99px;background:rgb(var(--color-green,27 122 78))}
.pbhs-dot[data-s="waiting"]{background:rgb(var(--color-gold,201 162 39))}
.pbhs-swap{margin-left:auto;min-height:2.25rem;padding:0 .9rem;border-radius:99px;border:1px solid var(--border-faint,rgba(10,10,10,.12));background:transparent;color:inherit;font:inherit;font-size:.75rem;font-weight:700;cursor:pointer}
.pbhs-swap[data-primary]{border-color:rgb(var(--color-gold,201 162 39));color:rgb(var(--color-gold,201 162 39))}
.pbhs-list{flex:1;margin:0;padding:.9rem 1rem;list-style:none;overflow-y:auto;display:flex;flex-direction:column;gap:.55rem;overscroll-behavior:contain}
.pbhs-msg{max-width:86%;display:flex;flex-direction:column;gap:.15rem}
.pbhs-msg[data-from="user"]{align-self:flex-end;align-items:flex-end}
.pbhs-tag{font-size:.65rem;font-weight:700;letter-spacing:.03em;color:rgb(var(--color-ink-500,92 102 112))}
.pbhs-bubble{margin:0;padding:.55rem .8rem;border-radius:16px;font-size:.875rem;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;background:rgb(var(--surface-muted,242 242 242))}
.pbhs-msg[data-from="user"] .pbhs-bubble{background:rgb(var(--color-gold,201 162 39));color:rgb(var(--color-ink-gold,10 10 10));border-bottom-right-radius:6px}
.pbhs-msg[data-from="agent"] .pbhs-bubble{border:1px solid rgb(var(--color-gold,201 162 39) / .5)}
.pbhs-sys{align-self:center;text-align:center;font-size:.72rem;color:rgb(var(--color-ink-500,92 102 112))}
.pbhs-queue{align-self:stretch;display:flex;align-items:center;gap:.7rem;padding:.7rem .9rem;border-radius:14px;border:1px dashed rgb(var(--color-gold,201 162 39) / .7);font-size:.8rem}
.pbhs-queue small{display:block;color:rgb(var(--color-ink-500,92 102 112))}
.pbhs-typing{display:inline-flex;gap:.25rem;padding:.65rem .8rem}
.pbhs-typing i{width:.4rem;height:.4rem;border-radius:99px;background:rgb(var(--color-ink-500,92 102 112));animation:pbhs-b 1s infinite ease-in-out}
.pbhs-typing i:nth-child(2){animation-delay:.15s}.pbhs-typing i:nth-child(3){animation-delay:.3s}
@keyframes pbhs-b{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
.pbhs-chips{align-self:stretch;display:flex;flex-wrap:wrap;gap:.4rem}
.pbhs-chip{min-height:2.25rem;padding:0 .8rem;border-radius:99px;border:1px solid var(--border-faint,rgba(10,10,10,.12));background:transparent;color:inherit;font:inherit;font-size:.75rem;font-weight:600;cursor:pointer}
.pbhs-form{display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;border-top:1px solid var(--border-faint,rgba(10,10,10,.08))}
.pbhs-field{flex:1;min-width:0;border-radius:99px;background:rgb(var(--surface-input,255 255 255));border:1px solid var(--border-faint,rgba(10,10,10,.12))}
.pbhs-field input{width:100%;min-height:2.6rem;padding:0 1rem;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:.9rem}
.pbhs-send{flex:none;width:2.6rem;height:2.6rem;border-radius:99px;border:0;background:rgb(var(--color-gold,201 162 39));color:rgb(var(--color-ink-gold,10 10 10));cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.pbhs-send:disabled{opacity:.45;cursor:default}
.pbhs-note{padding:1rem;font-size:.85rem;color:rgb(var(--color-ink-500,92 102 112))}
.pbhs :focus-visible{outline:2px solid rgb(var(--color-gold,201 162 39));outline-offset:2px}
.pbhs-away{margin:0 1rem .6rem;padding:.7rem .9rem;border-radius:14px;border:1px solid rgb(var(--color-gold,201 162 39) / .6);font-size:.8rem;display:flex;flex-direction:column;gap:.5rem}
.pbhs-away p{margin:0}
.pbhs-away small{color:rgb(var(--color-ink-500,92 102 112))}
.pbhs-away .pbhs-field{border-radius:12px}
.pbhs-row{display:flex;gap:.5rem;flex-wrap:wrap}
.pbhs-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

const sessionKey = (app: string) => `pb_support_chat_${app}`;
const loadSession = (app: string): Session | null => {
  try { const v = JSON.parse(window.sessionStorage.getItem(sessionKey(app)) ?? "null"); return v?.id && v?.secret ? v : null; } catch { return null; }
};
const saveSession = (app: string, s: Session | null) => {
  try { if (s) window.sessionStorage.setItem(sessionKey(app), JSON.stringify(s)); else window.sessionStorage.removeItem(sessionKey(app)); } catch { /* private mode: the chat just will not survive a reload */ }
};

export function HelpSupport({ app, apiBase, getToken }: { app: SupportAppId; apiBase: string; getToken?: () => string | null }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>("ai");
  const [agentName, setAgentName] = useState<string | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [leftOffline, setLeftOffline] = useState(false);
  const [composing, setComposing] = useState(false);
  const [contact, setContact] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);
  const list = useRef<HTMLOListElement>(null);
  const label = supportAppLabel(app);

  const call = useCallback(async <T,>(path: string, init: { method?: string; secret?: string; body?: unknown } = {}): Promise<T> => {
    const token = getToken?.();
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/v1/support-chat${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(init.secret ? { "X-Chat-Secret": init.secret } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw Object.assign(new Error(data.message ?? "Something went wrong"), { status: res.status });
    return data;
  }, [apiBase, getToken]);

  const merge = useCallback((incoming: Message[]) => {
    if (!incoming.length) return;
    lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
    setMessages((l) => [...l, ...incoming.filter((m) => !l.some((x) => x.id === m.id))]);
  }, []);

  // Open: is chat on for this app, and is there an earlier chat in this tab to pick up?
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const c = await call<Config>(`/config?app=${encodeURIComponent(app)}`);
        if (!live) return;
        setConfig(c); setAvailability(c.availability ?? null);
        if (!c.live) return;
        // This tab's chat, or (when signed in) the person's latest chat, so a reply left while they were away is waiting for them.
        let saved = loadSession(app);
        if (!saved && getToken?.()) {
          const back = await call<Session>("/resume", { method: "POST", body: { app } }).catch(() => null);
          if (back) { saved = { id: back.id, secret: back.secret }; saveSession(app, saved); }
        }
        if (!saved) return;
        try {
          const first = await call<Poll>(`/${saved.id}?after=0`, { secret: saved.secret });
          if (!live) return;
          setSession(saved); setStatus(first.status); setAgentName(first.agentName); setPosition(first.position); setLeftOffline(Boolean(first.leftOffline)); if (first.availability) setAvailability(first.availability); merge(first.messages);
        } catch { saveSession(app, null); }
      } catch { if (live) setConfig({ live: false, aiEnabled: false, humanEnabled: false }); }
    })();
    return () => { live = false; };
  }, [app, call, merge]);

  // While a person is expected or talking, poll for what they say.
  useEffect(() => {
    if (!session || (status !== "waiting" && status !== "human")) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const p = await call<Poll>(`/${session.id}?after=${lastId.current}`, { secret: session.secret });
        if (stopped) return;
        merge(p.messages.filter((m) => m.from !== "user"));
        lastId.current = Math.max(lastId.current, ...p.messages.map((m) => m.id), 0);
        setAgentName(p.agentName); setPosition(p.position); if (p.availability) setAvailability(p.availability);
        if (p.status !== status) setStatus(p.status);
        if (p.status === "ai") return;
      } catch { /* a dropped connection waits for the next poll */ }
      if (!stopped) timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session, status, call, merge]);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, status]);

  async function ensureSession(): Promise<Session> {
    if (session) return session;
    const made = await call<Session & { status: Status }>("", { method: "POST", body: { app, page: typeof location === "undefined" ? undefined : location.pathname } });
    const s = { id: made.id, secret: made.secret };
    saveSession(app, s); setSession(s); setStatus(made.status);
    return s;
  }

  async function send(raw: string) {
    const body = raw.trim();
    if (!body || busy) return;
    setText(""); setError(null); setBusy(true);
    try {
      const s = await ensureSession();
      const res = await call<{ status: Status; messages: Message[] }>(`/${s.id}/messages`, { method: "POST", secret: s.secret, body: { text: body } });
      merge(res.messages); setStatus(res.status);
    } catch (e) {
      setText(body);
      setError((e as { status?: number }).status === 429 ? "You are sending messages very fast. Please wait a moment." : (e as Error).message || "Could not send. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  /** Asks for a person. While the team is away this is "leave a message", and the visitor may add a way to reach them. */
  async function toPerson(contactLine?: string) {
    setError(null); setBusy(true);
    try {
      const s = await ensureSession();
      const res = await call<{ status: Status; position: number | null; leftOffline?: boolean; availability?: Availability | null }>(`/${s.id}/handoff`, { method: "POST", secret: s.secret, body: contactLine?.trim() ? { contact: contactLine.trim() } : {} });
      setStatus(res.status); setPosition(res.position); setLeftOffline(Boolean(res.leftOffline)); if (res.availability) setAvailability(res.availability);
      setComposing(false);
      const fresh = await call<{ messages: Message[] }>(`/${s.id}?after=${lastId.current}`, { secret: s.secret });
      merge(fresh.messages);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function backToAI() {
    if (!session) return;
    setBusy(true);
    try { await call(`/${session.id}/end`, { method: "POST", secret: session.secret }); } catch { /* the next message resets it */ }
    setStatus("ai"); setAgentName(null); setPosition(null);
    setMessages((l) => [...l, { id: -Date.now(), from: "system", text: "You are back with the AI assistant", at: new Date().toISOString() }]);
    setBusy(false);
  }

  if (config === null) return <><style>{CSS}</style><div className="pbhs" aria-busy="true"><p className="pbhs-note">Loading…</p></div></>;
  if (!config.live) {
    return <><style>{CSS}</style><div className="pbhs"><p className="pbhs-note">Chat support is not available in {label} right now. Please try again later.</p></div></>;
  }

  const withPerson = status === "waiting" || status === "human";
  const ended = status === "closed";
  const offer = availability?.offer ?? (config.humanEnabled ? "talk" : "none");
  const sub = status === "human" ? `${agentName ?? "Support agent"}, a person on the team` : status === "waiting" ? (leftOffline ? "Your message is with the team" : "Finding a support agent") : offer === "message" ? "AI assistant · the team is away" : "AI assistant, replies instantly";
  const signedIn = Boolean(getToken?.());
  const away = (availability?.hours ? ` We are on ${availability.hours}.` : "");
  // The waiting card below says what the server's "Connecting you…" / "team is away" line says.
  const visible = messages.filter((m) => !(m.from === "system" && (m.text.startsWith("Connecting you to a support agent") || m.text.startsWith("The team is away right now"))));
  const shown = messages.length === 0 ? [{ id: 0, from: "ai" as Sender, text: GREETING, at: "" }] : visible;

  return (
    <>
      <style>{CSS}</style>
      <div className="pbhs" role="region" aria-label="Help and support chat">
        <div className="pbhs-head">
          <span>
            <b>Peebee Support</b>
            <small><span className="pbhs-dot" data-s={status} aria-hidden />{sub}</small>
          </span>
          {withPerson ? (
            <button type="button" className="pbhs-swap" onClick={backToAI} disabled={busy}>Back to the AI assistant</button>
          ) : offer === "talk" ? (
            <button type="button" className="pbhs-swap" data-primary onClick={() => void toPerson()} disabled={busy}>Talk to a person</button>
          ) : offer === "message" ? (
            <button type="button" className="pbhs-swap" data-primary onClick={() => setComposing((v) => !v)} disabled={busy} aria-expanded={composing}>Leave a message</button>
          ) : null}
        </div>
        <ol ref={list} className="pbhs-list" aria-live="polite" aria-label="Messages">
          {shown.map((m) => m.from === "system" ? (
            <li key={m.id} className="pbhs-sys">{m.text}</li>
          ) : (
            <li key={m.id} className="pbhs-msg" data-from={m.from}>
              {m.from !== "user" && <span className="pbhs-tag">{m.from === "ai" ? "AI assistant" : m.agentName ?? "Support agent"}</span>}
              <p className="pbhs-bubble">{m.text}</p>
            </li>
          ))}
          {status === "waiting" && (
            <li className="pbhs-queue">
              {leftOffline ? (
                <span><b>Your message is with the team</b><small>The team is away right now.{away} We will reply right here{signedIn ? ", and send you a notification when we do" : ""}. You can leave this page{signedIn ? "" : " and come back to it in this tab"}.</small></span>
              ) : availability?.agentsOnline === 0 ? (
                <span><b>We have alerted the team</b><small>Nobody is watching the chat this second, so it may take a few minutes. You can leave this page: we will reply here{signedIn ? " and send you a notification" : ""}.</small></span>
              ) : (
                <span><b>Connecting you to a support agent</b><small>{position && position > 1 ? `You are number ${position} in the queue. ` : ""}Stay on this page and a person from the team will join.</small></span>
              )}
            </li>
          )}
          {ended && <li className="pbhs-sys">The support agent ended the chat. You can keep asking the AI assistant.</li>}
          {busy && status === "ai" && <li className="pbhs-msg" data-from="ai"><p className="pbhs-bubble pbhs-typing" aria-label="The assistant is typing"><i /><i /><i /></p></li>}
          {messages.length === 0 && status === "ai" && config.aiEnabled && (
            <li className="pbhs-chips">{CHIPS.map((c) => <button key={c} type="button" className="pbhs-chip" onClick={() => send(c)}>{c}</button>)}</li>
          )}
        </ol>
        {composing && status === "ai" && (
          <div className="pbhs-away" role="group" aria-label="Leave a message for the team">
            <p><b>The team is away right now.</b>{away}</p>
            <small>Your conversation so far goes to the team, and they reply here{signedIn ? " (we will send you a notification)" : ""}. Add a phone number or email if you would like to be reached outside this chat. It is optional.</small>
            <div className="pbhs-field"><input aria-label="Phone or email (optional)" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} placeholder="Phone or email (optional)" autoComplete="off" /></div>
            <div className="pbhs-row">
              <button type="button" className="pbhs-swap" style={{ marginLeft: 0 }} data-primary disabled={busy} onClick={() => void toPerson(contact)}>Leave my message</button>
              <button type="button" className="pbhs-swap" style={{ marginLeft: 0 }} disabled={busy} onClick={() => setComposing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="pbhs-note" style={{ paddingTop: 0, paddingBottom: ".4rem", color: "rgb(185 28 28)" }}>{error}</p>}
        <form className="pbhs-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(text); }}>
          <label className="pbhs-sr" htmlFor="pbhs-input">Message</label>
          <div className="pbhs-field">
            <input id="pbhs-input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={status === "human" ? "Message the support agent" : "Ask Peebee Support"} autoComplete="off" />
          </div>
          <button type="submit" className="pbhs-send" aria-label="Send message" disabled={!text.trim() || busy}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>
          </button>
        </form>
      </div>
    </>
  );
}
