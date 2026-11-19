"use client";

import type { FormEvent, ReactNode, RefObject } from "react";

/**
 * The merchant look for Help & support (black & gold, big tap targets, 2-column topic tiles, a composer fixed above the
 * bottom nav). Only the view: every state and request stays in HelpSupport, so the merchant app gets exactly the same
 * features as the other apps (AI chat, hand-over and queue, leave a message, talking to a person, ended, notes, errors,
 * chat off, restore, polling, notifications). Self-contained styles, because the apps' Tailwind builds do not scan this
 * package; colours come from the merchant app's tokens and its [data-theme="dark"] switch.
 */

type Sender = "user" | "ai" | "agent" | "system";
type Message = { id: number; from: Sender; text: string; at: string; agentName?: string };
type Status = "ai" | "waiting" | "human" | "closed";
type Availability = { state: "online" | "offline"; reason: "hours" | "nobody" | null; offer: "talk" | "message" | "none"; hours: string | null; agentsOnline: number | null };

const ICONS: Record<string, string> = {
  "bot": `<path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" />`,
  "user-round": `<circle cx="12" cy="8" r="5" /> <path d="M20 21a8 8 0 0 0-16 0" />`,
  "mail": `<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /> <rect x="2" y="4" width="20" height="16" rx="2" />`,
  "send-horizontal": `<path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" /> <path d="M6 12h16" />`,
  "wallet": `<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /> <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />`,
  "triangle-alert": `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" />`,
  "banknote": `<rect width="20" height="12" x="2" y="6" rx="2" /> <circle cx="12" cy="12" r="2" /> <path d="M6 12h.01M18 12h.01" />`,
  "message-circle-question": `<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /> <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /> <path d="M12 17h.01" />`,
  "check": `<path d="M20 6 9 17l-5-5" />`,
  "users": `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" />`,
  "user-round-search": `<circle cx="10" cy="8" r="5" /> <path d="M2 21a8 8 0 0 1 10.434-7.62" /> <circle cx="18" cy="18" r="3" /> <path d="m22 22-1.9-1.9" />`,
  "message-circle-off": `<path d="m2 2 20 20" /> <path d="M4.93 4.929a10 10 0 0 0-1.938 11.412 2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 0 0 11.302-1.989" /> <path d="M8.35 2.69A10 10 0 0 1 21.3 15.65" />`,
  "phone": `<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />`,
  "clock": `<circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" />`,
  "x": `<path d="M18 6 6 18" /> <path d="m6 6 12 12" />`,
  "circle-alert": `<circle cx="12" cy="12" r="10" /> <line x1="12" x2="12" y1="8" y2="12" /> <line x1="12" x2="12.01" y1="16" y2="16" />`,
  "loader-circle": `<path d="M21 12a9 9 0 1 1-6.219-8.56" />`,
};

function Icon({ name, size = 24, stroke = 2.2 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ flex: "none" }} dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }} />
  );
}

export const MERCHANT_GREETING = "Hi! I'm the Peebee assistant. Ask me about payments, your store or how the app works.";
export const MERCHANT_TOPICS: { icon: string; label: string; send: string }[] = [
  { icon: "wallet", label: "Wallet", send: "How does the wallet work?" },
  { icon: "triangle-alert", label: "Payment problem", send: "I have a problem with a payment" },
  { icon: "banknote", label: "Getting paid", send: "How do I get paid?" },
  { icon: "message-circle-question", label: "Something else", send: "Something else" },
];

const G = "var(--color-gold,201 162 39)";
const CSS = `
.pbm{display:flex;flex-direction:column;gap:16px;color:rgb(var(--color-ink,10 10 10));font:inherit;padding-bottom:96px}
.pbm *{box-sizing:border-box}
.pbm button{font:inherit;cursor:pointer}
.pbm button:disabled{cursor:default;opacity:.6}
.pbm :focus-visible{outline:3px solid rgb(${G});outline-offset:2px}
.pbm-hero{position:relative;overflow:hidden;border-radius:30px;padding:18px;background:#0a0a0a;color:#fff;border:1.5px solid rgb(${G}/.45);box-shadow:0 14px 40px rgb(0 0 0/.25);display:flex;flex-direction:column;gap:16px}
.pbm-hero:before{content:"";position:absolute;right:-70px;top:-70px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgb(${G}/.45),transparent 70%);pointer-events:none}
.pbm-hero>*{position:relative}
.pbm-hh{display:flex;align-items:center;gap:14px;min-width:0}
.pbm-av{position:relative;width:76px;height:76px;border-radius:24px;background:rgb(${G});color:#0a0a0a;display:grid;place-items:center;flex:none;font-size:30px;font-weight:900}
.pbm-av[data-agent]{background:#fff}
.pbm-dot{position:absolute;right:-5px;bottom:-5px;width:24px;height:24px;border-radius:50%;background:#22c55e;border:4px solid #0a0a0a}
.pbm-dot[data-away]{background:#9ca3af}
.pbm-nm{font-size:24px;font-weight:900;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbm-hero[data-compact] .pbm-sub,.pbm-nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbm-sub{font-size:17px;font-weight:700;color:rgb(255 255 255/.75);margin-top:4px}
.pbm-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.pbm-pill{min-height:34px;padding:4px 12px;border-radius:99px;display:inline-flex;align-items:center;gap:7px;font-size:15px;font-weight:900;background:rgb(52 178 112/.2);color:#5fe0a0}
.pbm-pill i{width:10px;height:10px;border-radius:50%;background:#34b270;display:block;flex:none}
.pbm-pill[data-away]{background:rgb(255 255 255/.14);color:#fff}
.pbm-pill[data-away] i{background:#9ca3af}
.pbm-pill[data-wait]{background:rgb(${G}/.22);color:rgb(${G})}
.pbm-big{min-height:60px;width:100%;border-radius:18px;border:0;display:flex;align-items:center;justify-content:center;gap:10px;font-size:19px;font-weight:900;background:rgb(${G});color:#0a0a0a}
.pbm-hero[data-compact]{padding:12px 14px;border-radius:24px}
.pbm-hero[data-compact] .pbm-hh{gap:10px}
.pbm-hero[data-compact] .pbm-av{width:48px;height:48px;border-radius:16px;font-size:22px}
.pbm-hero[data-compact] .pbm-dot{width:20px;height:20px;border-width:3px}
.pbm-hero[data-compact] .pbm-nm{font-size:19px}
.pbm-hero[data-compact] .pbm-sub{font-size:15px;margin-top:2px}
.pbm-swap{margin-left:auto;min-height:56px;min-width:56px;padding:0 10px;border-radius:18px;display:flex;align-items:center;gap:6px;font-size:17px;font-weight:900;background:rgb(255 255 255/.12);border:1.5px solid rgb(255 255 255/.22);color:#fff;flex:none}
.pbm-swap[data-primary]{background:rgb(${G});color:#0a0a0a;border-color:rgb(${G})}
.pbm-sec{font-size:15px;font-weight:900;color:rgb(var(--color-ink-500,92 102 112));text-transform:uppercase;letter-spacing:.06em;margin:4px 4px -6px}
.pbm-topics{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pbm-tp{min-height:96px;border-radius:24px;padding:14px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;text-align:left;color:inherit;background:rgb(var(--surface-card,255 255 255));border:1.5px solid var(--border-faint,rgba(10,10,10,.08));font-size:18px;font-weight:900;line-height:1.2;box-shadow:0 6px 18px rgb(0 0 0/.06)}
.pbm-tp:active{transform:scale(.98)}
.pbm-ti{width:48px;height:48px;border-radius:16px;display:grid;place-items:center;background:rgb(${G}/.16);color:#8a6d0b;flex:none}
[data-theme="dark"] .pbm-ti{color:rgb(${G})}
.pbm-chat{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px}
.pbm-msg{max-width:88%;display:flex;flex-direction:column;gap:5px}
.pbm-msg[data-from="user"]{align-self:flex-end;align-items:flex-end}
.pbm-tag{font-size:15px;font-weight:900;color:rgb(var(--color-ink-500,92 102 112));display:flex;align-items:center;gap:6px;padding:0 6px}
.pbm-bub{margin:0;padding:14px 16px;border-radius:24px;border-bottom-left-radius:8px;font-size:19px;font-weight:600;line-height:1.38;white-space:pre-wrap;overflow-wrap:anywhere;background:rgb(var(--surface-card,255 255 255));border:1.5px solid var(--border-faint,rgba(10,10,10,.08));box-shadow:0 6px 18px rgb(0 0 0/.06)}
.pbm-msg[data-from="user"] .pbm-bub{background:rgb(${G});color:#0a0a0a;border-color:rgb(${G});border-radius:24px;border-bottom-right-radius:8px;box-shadow:none}
.pbm-msg[data-from="agent"] .pbm-bub{border:2px solid rgb(${G})}
.pbm-sys{align-self:center;text-align:center;font-size:16px;font-weight:800;color:rgb(var(--color-ink-500,92 102 112));background:rgb(var(--surface-muted,242 242 242));border-radius:18px;padding:8px 14px}
.pbm-typing{display:inline-flex;gap:6px;padding:20px 18px}
.pbm-typing i{width:10px;height:10px;border-radius:50%;background:rgb(var(--color-ink-500,92 102 112));display:block;animation:pbm-b 1s infinite ease-in-out}
.pbm-typing i:nth-child(2){animation-delay:.15s}.pbm-typing i:nth-child(3){animation-delay:.3s}
@keyframes pbm-b{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
.pbm-card{border-radius:26px;padding:18px;display:flex;gap:14px;align-items:flex-start;background:rgb(var(--surface-card,255 255 255));border:2px solid rgb(${G}/.6);box-shadow:0 6px 18px rgb(0 0 0/.06)}
.pbm-card[data-dash]{border-style:dashed}
.pbm-card .pbm-ci{width:60px;height:60px;border-radius:20px;display:grid;place-items:center;background:rgb(${G});color:#0a0a0a;flex:none}
.pbm-card .pbm-ci[data-ok]{background:#22c55e;color:#fff}
.pbm-card b{display:block;font-size:21px;font-weight:900;line-height:1.2}
.pbm-card span{display:block;margin-top:4px;font-size:17px;font-weight:600;line-height:1.35;color:rgb(var(--color-ink-500,92 102 112))}
.pbm-card .pbm-q{display:inline-flex;align-items:center;gap:8px;margin-top:10px;min-height:40px;padding:0 14px;border-radius:99px;background:#0a0a0a;color:rgb(${G});font-size:17px;font-weight:900}
.pbm-err{display:flex;gap:10px;align-items:center;border-radius:18px;padding:12px 14px;background:rgb(220 38 38/.1);color:#b91c1c;font-size:17px;font-weight:800;margin:0}
[data-theme="dark"] .pbm-err{color:#ff8a8a}
.pbm-off{border-radius:30px;padding:26px 20px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;background:rgb(var(--surface-card,255 255 255));border:1.5px solid var(--border-faint,rgba(10,10,10,.08))}
.pbm-off .pbm-oi{width:88px;height:88px;border-radius:28px;display:grid;place-items:center;background:rgb(var(--surface-muted,242 242 242));color:rgb(var(--color-ink-500,92 102 112))}
.pbm-off b{font-size:24px;font-weight:900}
.pbm-off span{font-size:18px;font-weight:600;color:rgb(var(--color-ink-500,92 102 112))}
.pbm-spin{animation:pbm-s 1s linear infinite}@keyframes pbm-s{to{transform:rotate(360deg)}}
.pbm-comp{position:fixed;left:12px;right:12px;bottom:calc(98px + env(safe-area-inset-bottom));z-index:39;max-width:30rem;margin:0 auto;display:flex;gap:10px;align-items:center;padding:10px;border-radius:28px;background:rgb(var(--surface-card,255 255 255));border:1.5px solid var(--border-faint,rgba(10,10,10,.08));box-shadow:0 10px 30px rgb(0 0 0/.16)}
.pbm-field{flex:1;min-width:0;min-height:60px;border-radius:20px;background:rgb(var(--surface-input,255 255 255));border:2px solid var(--border-faint,rgba(10,10,10,.12));display:flex;align-items:center}
.pbm-field:focus-within{border-color:rgb(${G})}
.pbm-field input{width:100%;min-width:0;min-height:56px;padding:0 16px;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:21px;font-weight:600}
.pbm-send{width:60px;height:60px;border-radius:20px;border:0;background:rgb(${G});color:#0a0a0a;display:grid;place-items:center;flex:none;box-shadow:0 8px 20px rgb(${G}/.4)}
.pbm-send:disabled{box-shadow:none;opacity:.5}
.pbm-scrim{position:fixed;inset:0;z-index:60;background:rgb(0 0 0/.5)}
.pbm-sheet{position:fixed;left:0;right:0;bottom:0;z-index:61;max-width:32rem;margin:0 auto;max-height:90dvh;overflow-y:auto;border-radius:30px 30px 0 0;background:rgb(var(--surface-card,255 255 255));color:rgb(var(--color-ink,10 10 10));padding:10px 16px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:16px;box-shadow:0 -10px 40px rgb(0 0 0/.3)}
.pbm-handle{align-self:center;width:44px;height:5px;border-radius:99px;background:rgb(var(--color-ink-500,92 102 112)/.4)}
.pbm-sh{display:flex;align-items:center;gap:12px}
.pbm-sh .pbm-ci{width:60px;height:60px;border-radius:18px;display:grid;place-items:center;background:rgb(${G});color:#0a0a0a;flex:none}
.pbm-sh h2{margin:0;font-size:24px;font-weight:900;line-height:1.15}
.pbm-sh small{display:block;font-size:16px;font-weight:700;color:rgb(var(--color-ink-500,92 102 112))}
.pbm-x{margin-left:auto;width:56px;height:56px;border-radius:50%;border:1.5px solid var(--border-faint,rgba(10,10,10,.12));background:rgb(var(--surface-muted,242 242 242));color:inherit;display:grid;place-items:center;flex:none}
.pbm-hrs{display:flex;align-items:center;gap:10px;border-radius:18px;padding:14px;background:rgb(${G}/.14);font-size:17px;font-weight:800}
.pbm-p{margin:0;font-size:17px;font-weight:600;line-height:1.35;color:rgb(var(--color-ink-500,92 102 112))}
.pbm-lbl{font-size:18px;font-weight:900;display:flex;align-items:center;gap:8px;margin-bottom:8px}
.pbm-lbl small{font-size:16px;font-weight:700;color:rgb(var(--color-ink-500,92 102 112))}
.pbm-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pbm-ghost,.pbm-go{min-height:60px;border-radius:20px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:19px;font-weight:900}
.pbm-ghost{border:2px solid var(--border-faint,rgba(10,10,10,.12));background:rgb(var(--surface-card,255 255 255));color:inherit}
.pbm-go{border:0;background:rgb(${G});color:#0a0a0a}
.pbm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

export type MerchantHelpProps = {
  loading: boolean;
  live: boolean;
  aiEnabled: boolean;
  appLabel: string;
  status: Status;
  agentName: string | null;
  position: number | null;
  availability: Availability | null;
  leftOffline: boolean;
  offer: "talk" | "message" | "none";
  ended: boolean;
  signedIn: boolean;
  away: string;
  composing: boolean;
  setComposing: (v: boolean | ((p: boolean) => boolean)) => void;
  contact: string;
  setContact: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  busy: boolean;
  error: string | null;
  hasMessages: boolean;
  shown: Message[];
  listRef: RefObject<HTMLOListElement | null>;
  send: (text: string) => void;
  toPerson: (contact?: string) => void;
  backToAI: () => void;
};

function Shell({ children }: { children: ReactNode }) {
  return <><style>{CSS}</style><div className="pbm" role="region" aria-label="Help and support chat" data-testid="help-merchant">{children}</div></>;
}

export function MerchantHelp(p: MerchantHelpProps) {
  if (p.loading) {
    return <Shell><div className="pbm-off" aria-busy="true"><span className="pbm-oi"><span className="pbm-spin" style={{ display: "grid" }}><Icon name="loader-circle" size={40} /></span></span><span>Loading…</span></div></Shell>;
  }
  if (!p.live) {
    return (
      <Shell>
        <div className="pbm-off" data-testid="help-off"><span className="pbm-oi"><Icon name="message-circle-off" size={44} /></span><b>Chat is off right now</b><span>Help chat isn&apos;t available in {p.appLabel} at the moment. Please try again later.</span></div>
      </Shell>
    );
  }

  const { status, offer } = p;
  const withPerson = status === "waiting" || status === "human";
  const person = status === "human";
  const fresh = !p.hasMessages && status === "ai";
  const awayNow = offer === "message";
  const name = person ? (p.agentName ?? "Support agent") : "Peebee Support";
  const sub = person ? "Support team · a person" : status === "waiting" ? (p.leftOffline ? "Message sent" : "Finding a person") : awayNow ? "AI · team away" : "AI · replies now";
  const pill = person ? <span className="pbm-pill"><i />Talking to {p.agentName ?? "a person"}</span>
    : status === "waiting" ? <span className="pbm-pill" data-wait=""><Icon name="clock" size={17} stroke={2.6} /> {p.leftOffline ? "Message sent" : "Connecting"}</span>
    : awayNow ? <span className="pbm-pill" data-away=""><i />Team away</span>
    : offer === "talk" ? <span className="pbm-pill"><i />Team online</span> : null;
  const avatar = person
    ? <div className="pbm-av" data-agent=""><span aria-hidden>{(p.agentName ?? "S").trim().charAt(0).toUpperCase()}</span><span className="pbm-dot" /></div>
    : <div className="pbm-av"><Icon name="bot" size={fresh ? 40 : 30} /><span className="pbm-dot" {...(withPerson || awayNow ? { "data-away": "" } : {})} /></div>;

  const swap = withPerson ? (
    <button type="button" className="pbm-swap" onClick={p.backToAI} disabled={p.busy} aria-label="Back to the AI assistant" data-testid="help-back-ai"><Icon name="bot" size={22} /> AI</button>
  ) : offer === "talk" ? (
    <button type="button" className="pbm-swap" data-primary="" onClick={() => p.toPerson()} disabled={p.busy} aria-label="Talk to a person" data-testid="help-person"><Icon name="user-round" size={22} stroke={2.6} /> Person</button>
  ) : offer === "message" ? (
    <button type="button" className="pbm-swap" data-primary="" onClick={() => p.setComposing(true)} disabled={p.busy} aria-label="Leave a message" aria-expanded={p.composing} data-testid="help-message"><Icon name="mail" size={22} stroke={2.6} /> Message</button>
  ) : null;

  return (
    <Shell>
      {fresh ? (
        <div className="pbm-hero" data-testid="help-hero">
          <div className="pbm-hh">{avatar}<div style={{ flex: 1, minWidth: 0 }}><div className="pbm-nm">{name}</div><div className="pbm-sub">AI assistant · replies now</div>{pill && <div className="pbm-pills">{pill}</div>}</div></div>
          {offer === "talk" && <button type="button" className="pbm-big" onClick={() => p.toPerson()} disabled={p.busy} data-testid="help-person"><Icon name="user-round" size={24} stroke={2.6} /> Talk to a person</button>}
          {offer === "message" && <button type="button" className="pbm-big" onClick={() => p.setComposing(true)} disabled={p.busy} aria-expanded={p.composing} data-testid="help-message"><Icon name="mail" size={24} stroke={2.6} /> Leave a message</button>}
        </div>
      ) : (
        <div className="pbm-hero" data-compact="" data-testid="help-hero">
          <div className="pbm-hh">{avatar}<div style={{ flex: 1, minWidth: 0 }}><div className="pbm-nm">{name}</div><div className="pbm-sub" data-testid="help-sub">{sub}</div></div>{swap}</div>
        </div>
      )}

      <ol ref={p.listRef} className="pbm-chat" aria-live="polite" aria-label="Messages" data-testid="help-messages">
        {p.shown.map((m) => m.from === "system" ? (
          <li key={m.id} className="pbm-sys">{m.text}</li>
        ) : (
          <li key={m.id} className="pbm-msg" data-from={m.from}>
            {m.from !== "user" && <span className="pbm-tag"><Icon name={m.from === "ai" ? "bot" : "user-round"} size={18} /> {m.from === "ai" ? "AI assistant" : `${m.agentName ?? "Support agent"} · Support team`}</span>}
            <p className="pbm-bub">{m.text}</p>
          </li>
        ))}
        {status === "waiting" && (
          <li className="pbm-card" {...(p.leftOffline ? {} : { "data-dash": "" })} data-testid="help-waiting">
            {p.leftOffline ? (
              <><span className="pbm-ci" data-ok=""><Icon name="check" size={32} stroke={3} /></span>
                <div><b>Message sent</b><span>The team is away right now.{p.away} We will reply right here{p.signedIn ? " and send you a notification" : ""}. You can leave this page{p.signedIn ? "" : " and come back to it in this tab"}.</span></div></>
            ) : p.availability?.agentsOnline === 0 ? (
              <><span className="pbm-ci"><Icon name="users" size={30} /></span>
                <div><b>We have alerted the team</b><span>Nobody is watching the chat this second, so it may take a few minutes. You can leave this page: we will reply here{p.signedIn ? " and send you a notification" : ""}.</span></div></>
            ) : (
              <><span className="pbm-ci"><Icon name="user-round-search" size={30} /></span>
                <div><b>Connecting you to a person</b><span>Stay on this page and someone from the team will join.</span>
                  {p.position && p.position > 1 ? <span className="pbm-q"><Icon name="users" size={20} /> You are number {p.position}</span> : null}</div></>
            )}
          </li>
        )}
        {p.ended && <li className="pbm-sys">The support agent ended the chat. You can keep asking the AI assistant.</li>}
        {p.busy && status === "ai" && <li className="pbm-msg" data-from="ai"><span className="pbm-tag"><Icon name="bot" size={18} /> AI assistant</span><p className="pbm-bub pbm-typing" aria-label="The assistant is typing"><i /><i /><i /></p></li>}
      </ol>

      {fresh && p.aiEnabled && (
        <>
          <div className="pbm-sec">Ask about</div>
          <div className="pbm-topics" data-testid="help-topics">
            {MERCHANT_TOPICS.map((t) => (
              <button key={t.label} type="button" className="pbm-tp" onClick={() => p.send(t.send)} disabled={p.busy}><span className="pbm-ti"><Icon name={t.icon} size={28} /></span>{t.label}</button>
            ))}
          </div>
        </>
      )}

      {p.error && <p role="alert" className="pbm-err" data-testid="help-error"><Icon name="circle-alert" size={22} /> {p.error}</p>}

      <form className="pbm-comp" onSubmit={(e: FormEvent) => { e.preventDefault(); p.send(p.text); }} data-testid="help-composer">
        <label className="pbm-sr" htmlFor="pbm-input">Message</label>
        <div className="pbm-field">
          <input id="pbm-input" value={p.text} maxLength={1000} onChange={(e) => p.setText(e.target.value)} placeholder={person ? `Message ${p.agentName ?? "the support agent"}` : "Ask Peebee Support"} autoComplete="off" enterKeyHint="send" />
        </div>
        <button type="submit" className="pbm-send" aria-label="Send message" disabled={!p.text.trim() || p.busy} data-testid="help-send"><Icon name="send-horizontal" size={28} stroke={2.4} /></button>
      </form>

      {p.composing && status === "ai" && (
        <>
          <div className="pbm-scrim" onClick={() => p.setComposing(false)} aria-hidden />
          <div className="pbm-sheet" role="dialog" aria-modal="true" aria-labelledby="pbm-leave-title" data-testid="help-leave-sheet">
            <span className="pbm-handle" aria-hidden />
            <div className="pbm-sh"><span className="pbm-ci"><Icon name="mail" size={30} /></span><div><h2 id="pbm-leave-title">Leave a message</h2><small>For the support team</small></div>
              <button type="button" className="pbm-x" aria-label="Close" onClick={() => p.setComposing(false)}><Icon name="x" size={28} stroke={2.6} /></button></div>
            <div className="pbm-hrs"><Icon name="clock" size={24} /> <span>The team is away right now.{p.away}</span></div>
            <p className="pbm-p">Your chat so far goes to the team, and they reply here{p.signedIn ? " (we will send you a notification)" : ""}. Add a phone number or email if you would like to be reached outside this chat.</p>
            <div>
              <label className="pbm-lbl" htmlFor="pbm-contact"><Icon name="phone" size={20} /> Phone or email <small>· optional</small></label>
              <div className="pbm-field"><input id="pbm-contact" value={p.contact} maxLength={120} onChange={(e) => p.setContact(e.target.value)} autoComplete="off" data-testid="help-contact" /></div>
            </div>
            {p.error && <p role="alert" className="pbm-err"><Icon name="circle-alert" size={22} /> {p.error}</p>}
            <div className="pbm-row">
              <button type="button" className="pbm-ghost" onClick={() => p.setComposing(false)} disabled={p.busy}>Cancel</button>
              <button type="button" className="pbm-go" onClick={() => p.toPerson(p.contact)} disabled={p.busy} data-testid="help-leave-send"><Icon name="send-horizontal" size={24} stroke={2.4} /> Send</button>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
