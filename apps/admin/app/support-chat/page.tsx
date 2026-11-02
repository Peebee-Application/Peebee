"use client";

import { hasPermission } from "@peebee/shared";
import { BellRing, Headset, Send, UserRound, Bot } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OptionSettingsPanel } from "../../components/OptionSettingsPanel";
import { PageHeader } from "../../components/SettingsPageShell";
import { useAuth } from "../../lib/auth-context";
import { adminRequest, requestErrorMessage } from "../../lib/admin-request";
import { enablePush, pushState, type PushState } from "../../lib/push";
import { useSupportAlerts } from "../../components/SupportAlerts";

type ChatRow = { appLabel: string; person: string | null; id: string; status: "waiting" | "human" | "closed"; agentName: string | null; mine: boolean; page: string | null; waitingSince: string | null; startedAt: string; updatedAt: string; lastText: string | null; lastFrom: string | null; visitorMessages: number };
type Message = { id: number; from: "user" | "ai" | "agent" | "system"; text: string; at: string; agentName?: string };
type Detail = { appLabel: string; person: string | null; id: string; status: string; agentName: string | null; mine: boolean; page: string | null; messages: Message[] };

const ago = (value: string | null) => {
  if (!value) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(`${value.replace(" ", "T")}Z`)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
const STATUS: Record<string, string> = { waiting: "Waiting for a person", human: "With a person", closed: "Ended" };

export default function SupportChatPage() {
  const { user } = useAuth();
  const role = user?.adminRole ?? null;
  const canManage = hasPermission(role, "settings.manage");
  const [tab, setTab] = useState<"inbox" | "settings">("inbox");

  return (
    <div className="admin-page space-y-5 px-4 pb-6 pt-4 lg:px-8 lg:pt-2">
      <PageHeader title="Support chat" backHref="/" description="Visitors on the website talk to the AI assistant first and can ask for a person. Chats waiting for a person appear here." />
      <div role="tablist" aria-label="Support chat" className="flex gap-2">
        {(["inbox", ...(canManage || hasPermission(role, "settings.view") ? ["settings"] : [])] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t as "inbox" | "settings")}
            className={`min-h-10 rounded-full border px-4 text-xs font-bold transition ${tab === t ? "border-gold bg-gold/15 text-ink" : "border-ink/10 text-ink-600"}`}>
            {t === "inbox" ? "Inbox" : "Settings & AI notes"}
          </button>
        ))}
      </div>
      {tab === "inbox" ? <><AlertsCard /><Inbox /></> : <ChatSettings canManage={canManage} />}
    </div>
  );
}

/** This device's alerts: with them on, a chat asking for a person reaches this phone or computer even when the admin app is closed. */
function AlertsCard() {
  const support = useSupportAlerts();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const first = setTimeout(() => void pushState().then(setState).catch(() => setState("unsupported")), 0);
    return () => clearTimeout(first);
  }, []);
  const text: Record<PushState, string> = {
    on: "This device will be alerted when someone asks for a person, even when the admin app is closed.",
    off: "Turn alerts on for this device, so you hear about a waiting chat even when the admin app is closed.",
    blocked: "Alerts are blocked for this site in your browser. Allow notifications for the admin site in the browser's site settings, then come back.",
    unsupported: "This browser cannot receive alerts while the app is closed. On a phone, add the admin app to your home screen first. A badge and a sound still work while the app is open.",
  };
  return (
    <section className="home-card flex flex-wrap items-center gap-3" aria-label="Alerts on this device">
      <BellRing className="h-5 w-5 shrink-0 text-gold" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">
          Alerts on this device: {state === "on" ? "on" : state === "blocked" ? "blocked" : state === "unsupported" ? "not available" : "off"}
          {support.enabled && support.agentsOnline != null && <span className="ml-2 text-xs font-semibold text-ink-500">{support.agentsOnline} {support.agentsOnline === 1 ? "person" : "people"} online</span>}
        </p>
        <p className="text-xs text-ink-500">{state ? text[state] : "Checking…"}</p>
      </div>
      {state === "off" && (
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setState(await enablePush()); setBusy(false); }} className="min-h-10 rounded-full bg-gold px-5 text-xs font-bold text-ink disabled:opacity-50">Turn on alerts</button>
      )}
    </section>
  );
}

function Inbox() {
  const [view, setView] = useState<"open" | "all">("open");
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminRequest<{ chats: ChatRow[] }>(`/admin/support-chats?view=${view}`);
      setChats(res.chats);
      setError(null);
    } catch (e) { setError(requestErrorMessage(e)); }
  }, [view]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  const waiting = chats?.filter((c) => c.status === "waiting").length ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <section aria-label="Chats" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-ink">{waiting > 0 ? `${waiting} waiting for a person` : "Nobody is waiting"}</p>
          <button type="button" className="min-h-9 rounded-full border border-ink/10 px-3 text-xs font-bold text-ink-600" onClick={() => setView(view === "open" ? "all" : "open")}>
            {view === "open" ? "Show ended too" : "Open only"}
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {chats === null && !error && <div className="admin-skeleton h-24 rounded-[var(--radius-card)]" />}
        {chats?.length === 0 && <p className="rounded-[var(--radius-card)] border border-ink/10 p-4 text-sm text-ink-500">No chats here yet.</p>}
        <ul className="space-y-2">
          {chats?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setSelected(c.id)} aria-current={selected === c.id}
                className={`w-full rounded-[var(--radius-card)] border p-3 text-left transition ${selected === c.id ? "border-gold bg-gold/10" : "border-ink/10"}`}>
                <span className="flex items-center justify-between gap-2 text-xs">
                  <b className={c.status === "waiting" ? "text-gold" : "text-ink-600"}>{STATUS[c.status]}</b>
                  <span className="text-ink-400">{ago(c.waitingSince ?? c.updatedAt)}</span>
                </span>
                <span className="mt-1 block truncate text-sm text-ink">{c.lastText ?? "No messages yet"}</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold text-ink-500">{c.person ?? "Not signed in"} · {c.appLabel}</span>
                <span className="mt-0.5 block truncate text-[11px] text-ink-400">{c.visitorMessages} message{c.visitorMessages === 1 ? "" : "s"}{c.page ? ` · from ${c.page}` : ""}{c.agentName ? ` · ${c.mine ? "you" : c.agentName}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Conversation" className="min-h-[24rem]">
        {selected ? <Conversation key={selected} id={selected} onChanged={load} /> : (
          <div className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-ink/10 p-6 text-center text-sm text-ink-500">
            <Headset className="h-6 w-6" aria-hidden /> Pick a chat to read it and, if it is waiting, take it.
          </div>
        )}
      </section>
    </div>
  );
}

function Conversation({ id, onChanged }: { id: string; onChanged: () => void | Promise<void> }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const list = useRef<HTMLOListElement>(null);

  const poll = useCallback(async () => {
    try {
      const d = await adminRequest<Detail>(`/admin/support-chats/${id}?after=${last.current}`);
      setDetail(d);
      if (d.messages.length) {
        last.current = Math.max(last.current, ...d.messages.map((m) => m.id));
        setMessages((l) => [...l, ...d.messages.filter((m) => !l.some((x) => x.id === m.id))]);
      }
    } catch (e) { setError(requestErrorMessage(e)); }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const t = setInterval(() => { if (!document.hidden) void poll(); }, 3000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [poll]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages]);

  async function act(path: string, body?: unknown) {
    setBusy(true); setError(null);
    try { await adminRequest(`/admin/support-chats/${id}/${path}`, { method: "POST", body }); await poll(); await onChanged(); }
    catch (e) { setError(requestErrorMessage(e)); await poll(); await onChanged(); }
    finally { setBusy(false); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    await act("messages", { text: body });
  }

  const mine = detail?.status === "human" && detail.mine;
  return (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-ink/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 p-3">
        <p className="text-sm font-bold text-ink">{detail ? `${detail.person ?? "Not signed in"} · ${detail.appLabel} · ` : ""}{detail ? STATUS[detail.status] : "Loading…"}{detail?.agentName && detail.status === "human" ? ` · ${mine ? "you" : detail.agentName}` : ""}</p>
        <div className="flex gap-2">
          {detail?.status === "waiting" && <button type="button" disabled={busy} onClick={() => act("claim")} className="min-h-9 rounded-full bg-gold px-4 text-xs font-bold text-ink disabled:opacity-50">Take this chat</button>}
          {(detail?.status === "waiting" || (detail?.status === "human" && mine)) && <button type="button" disabled={busy} onClick={() => act("close")} className="min-h-9 rounded-full border border-ink/10 px-4 text-xs font-bold text-ink-600 disabled:opacity-50">End chat</button>}
        </div>
      </div>
      <ol ref={list} className="max-h-[28rem] flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite" aria-label="Messages">
        {messages.map((m) => m.from === "system" ? (
          <li key={m.id} className="text-center text-[11px] text-ink-400">{m.text}</li>
        ) : (
          <li key={m.id} className={`flex gap-2 ${m.from === "user" ? "" : "flex-row-reverse"}`}>
            <span className="mt-1 text-ink-400" aria-hidden>{m.from === "user" ? <UserRound className="h-4 w-4" /> : m.from === "ai" ? <Bot className="h-4 w-4" /> : <Headset className="h-4 w-4" />}</span>
            <div className={`max-w-[80%] rounded-2xl border border-ink/10 px-3 py-2 text-sm text-ink ${m.from === "agent" ? "bg-gold/10" : ""}`}>
              <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-400">{m.from === "user" ? "Visitor" : m.from === "ai" ? "AI assistant" : m.agentName ?? "Agent"}</span>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="px-3 pb-1 text-xs text-red-600">{error}</p>}
      {mine ? (
        <form onSubmit={send} className="flex items-center gap-2 border-t border-ink/10 p-3">
          <div className="field-box min-w-0 flex-1 rounded-xl">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Reply to the visitor" aria-label="Reply" className="w-full p-2.5 text-sm text-ink outline-none" />
          </div>
          <button type="submit" disabled={busy || !text.trim()} aria-label="Send reply" className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-ink disabled:opacity-50"><Send className="h-4 w-4" aria-hidden /></button>
        </form>
      ) : (
        <p className="border-t border-ink/10 p-3 text-xs text-ink-500">{detail?.status === "waiting" ? "Take this chat to reply. The visitor sees your name when you join." : detail?.status === "human" ? `${detail.agentName ?? "Another agent"} is handling this chat.` : "Read-only."}</p>
      )}
    </div>
  );
}

function ChatSettings({ canManage }: { canManage: boolean }) {
  const [notes, setNotes] = useState<string | null>(null);
  const [builtIn, setBuiltIn] = useState("");
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminRequest<{ notes: string; builtIn: string }>("/admin/support-chat/ai-notes").then((r) => { setNotes(r.notes); setBuiltIn(r.builtIn); }).catch((e) => setError(requestErrorMessage(e)));
  }, []);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try { await adminRequest("/admin/support-chat/ai-notes", { method: "PUT", body: { notes } }); setSaved(true); }
    catch (e) { setError(requestErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function tryIt() {
    setTrying(true); setError(null); setReply(null);
    try {
      const res = await adminRequest<{ reply: string }>("/admin/support-chat/ai-test", { method: "POST", body: { question, notes: notes ?? "" } });
      setReply(res.reply);
    } catch (e) { setError(requestErrorMessage(e)); } finally { setTrying(false); }
  }

  return (
    <div className="space-y-6">
      <OptionSettingsPanel module="support" canManage={canManage} />
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">What the AI assistant should know</h2>
        <p className="max-w-2xl text-xs text-ink-500">Facts, policies, opening hours and links the assistant may use in its answers. It is told to trust these and not to invent anything else. Do not put secrets here.</p>
        <div className="field-box rounded-xl">
          <textarea rows={8} value={notes ?? ""} disabled={notes === null || !canManage} maxLength={6000} onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
            aria-label="What the AI assistant should know" className="w-full p-3 text-sm text-ink outline-none" placeholder="e.g. Support is open 8am to 8pm every day. Refunds go back to the wallet within 24 hours." />
        </div>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {canManage && (
          <div className="flex items-center gap-3">
            <button type="button" disabled={busy || notes === null} onClick={save} className="min-h-10 rounded-full bg-gold px-5 text-xs font-bold text-ink disabled:opacity-50">Save notes</button>
            {saved && <span className="text-xs text-ink-500" role="status">Saved</span>}
          </div>
        )}
      </section>

      {canManage && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-ink">Try the assistant</h2>
          <p className="max-w-2xl text-xs text-ink-500">Ask it something a customer might ask. It answers with the notes exactly as typed above, even before you save them, so you can see what a note changes. Nothing is sent to a customer.</p>
          <div className="flex items-center gap-2">
            <div className="field-box min-w-0 flex-1 rounded-xl">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} aria-label="A question to try" placeholder="e.g. Can I join as a carpenter to get work?" className="w-full p-2.5 text-sm text-ink outline-none" onKeyDown={(e) => { if (e.key === "Enter" && question.trim() && !trying) void tryIt(); }} />
            </div>
            <button type="button" disabled={trying || !question.trim()} onClick={() => void tryIt()} className="min-h-10 rounded-full bg-gold px-5 text-xs font-bold text-ink disabled:opacity-50">{trying ? "Thinking…" : "Try it"}</button>
          </div>
          {reply && <p className="whitespace-pre-wrap rounded-2xl border border-[var(--border-faint)] p-3 text-sm text-ink" role="status">{reply}</p>}
        </section>
      )}

      {builtIn && (
        <details className="rounded-xl border border-[var(--border-faint)] p-3">
          <summary className="cursor-pointer text-sm font-bold text-ink">What the assistant already knows (built in)</summary>
          <p className="mt-2 text-xs text-ink-500">This is its starting knowledge about Peebee. Anything you write in the notes above is newer and wins when they differ.</p>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-ink">{builtIn}</pre>
        </details>
      )}
    </div>
  );
}
