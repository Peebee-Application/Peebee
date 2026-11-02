/**
 * Support chat adapter. The UI in components/SupportChat.tsx only talks to `supportChat`.
 * `liveAdapter` talks to the Peebee API (AI assistant, then the support team's inbox in Admin → Support chat).
 * While chat is switched off, or its migration (0150_support_chat.sql) is not applied, `supportChat` keeps using
 * `mockAdapter`, the built-in demo replies, so the website never shows a broken chat.
 */
export type Sender = "user" | "ai" | "agent" | "system";
export type ChatMessage = { id: string; from: Sender; text: string; at: number; agentName?: string };
export type HandoffEvent =
  | { type: "queued"; /** The team is away and the message is saved for them. */ away?: boolean; hours?: string | null; /** In hours, but nobody is watching right now. */ nobodyWatching?: boolean }
  | { type: "declined"; message: string }
  | { type: "joined"; agentName: string }
  | { type: "message"; message: ChatMessage }
  | { type: "ended" };

/** What the chat can offer right now: a person ("talk"), a message left for the team while they are away ("message"), or only the assistant ("none"). */
export type Capabilities = { humanEnabled: boolean; offer: "talk" | "message" | "none"; hours: string | null };
type ServerAvailability = { state: string; offer: "talk" | "message" | "none"; hours: string | null; agentsOnline: number | null };

export interface SupportChatAdapter {
  /** Ask the AI assistant. Resolves with its reply. */
  askAI(text: string, history: ChatMessage[]): Promise<ChatMessage>;
  /** Ask for a person. Calls `on` as the handoff progresses; returns a function that cancels it. */
  requestAgent(history: ChatMessage[], on: (e: HandoffEvent) => void, contact?: string): () => void;
  /** Send a message to the person once they have joined. */
  sendToAgent(text: string): Promise<void>;
  /** Leave the person and go back to the AI. */
  endAgent(): void;
  /** What this chat can do right now (admin can switch "Talk to a person" off). */
  capabilities(): Promise<Capabilities>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
export const msg = (from: Sender, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: uid(), from, text, at: Date.now(), ...extra });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CANNED: [RegExp, string][] = [
  [/track|order|where|deliver|rider/i, "You can follow any order or trip live in the Peebee app under Orders. Tap the order to see where it is and to chat with the person handling it. If something looks wrong, tell me the order number and I can pass it to the team."],
  [/pay|wallet|momo|airtel|mtn|money|top ?up|refund/i, "Peebee runs on one wallet. You top it up from MTN MoMo or Airtel Money, and what a job costs is held in escrow until it is done. You release it with your four-digit PIN. For a missing payment or refund, a person on the team can look at your account."],
  [/partner|earn|join|driver|rider|sell|restaurant|teach/i, "Great! Every kind of partner has its own page on Peebee Partners that explains sign-up, how work reaches you and how you get paid. Open the Partners site from the menu, or tell me what you do and I will point you to the right page."],
  [/person|human|agent|someone/i, "Of course. Tap \"Talk to a person\" at the top and I will hand you over to the support team."],
];

export const mockAdapter: SupportChatAdapter = {
  async askAI(text) {
    await wait(900 + Math.random() * 600);
    const hit = CANNED.find(([re]) => re.test(text));
    return msg("ai", hit ? hit[1] : "Thanks, I have noted that. I can help with orders and trips, the wallet and payments, or becoming a partner. If you would rather talk it through with someone, tap \"Talk to a person\".");
  },
  requestAgent(_h, on) {
    const timers: ReturnType<typeof setTimeout>[] = [];
    on({ type: "queued" });
    timers.push(setTimeout(() => on({ type: "joined", agentName: "Support agent" }), 2600));
    timers.push(setTimeout(() => on({ type: "message", message: msg("agent", "Hello, I am from the Peebee support team and I have read your chat so far. How can I help?", { agentName: "Support agent" }) }), 3800));
    return () => timers.forEach(clearTimeout);
  },
  async sendToAgent() {
    /* demo: the mock agent does not reply further */
  },
  endAgent() {},
  async capabilities() { return { humanEnabled: true, offer: "talk" as const, hours: null }; },
};

// ------------------------------------------------------------------------------------------------ live

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.peebee.online";
const POLL_MS = 3000;
const POLL_HIDDEN_MS = 15000;

type ServerMessage = { id: number; from: Sender; text: string; at: string; agentName?: string };
type Session = { id: string; secret: string };

const toChat = (m: ServerMessage): ChatMessage => ({ id: `s${m.id}`, from: m.from, text: m.text, at: Date.parse(`${m.at.replace(" ", "T")}Z`) || Date.now(), agentName: m.agentName });

async function call<T>(path: string, init: { method?: string; secret?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/v1/support-chat${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(init.secret ? { "X-Chat-Secret": init.secret } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw Object.assign(new Error(data.message ?? "Request failed"), { status: res.status });
  return data;
}

function createLiveAdapter(): SupportChatAdapter {
  let session: Promise<Session> | null = null;
  let lastId = 0;
  const open = () => (session ??= call<Session>("", { method: "POST", body: { app: "website", page: typeof location === "undefined" ? undefined : location.pathname } }).catch((e) => { session = null; throw e; }));

  return {
    async askAI(text) {
      try {
        const s = await open();
        const res = await call<{ messages: ServerMessage[] }>(`/${s.id}/messages`, { method: "POST", secret: s.secret, body: { text } });
        lastId = Math.max(lastId, ...res.messages.map((m) => m.id));
        const reply = res.messages.find((m) => m.from === "ai");
        return reply ? toChat(reply) : msg("ai", "Thanks. Tap \"Talk to a person\" if you would like someone from the team.");
      } catch (e) {
        const limited = (e as { status?: number }).status === 429;
        return msg("ai", limited ? "You are sending messages very fast. Please wait a moment and try again." : "Sorry, I could not reach Peebee just now. Check your connection and try again, or tap \"Talk to a person\".");
      }
    },
    requestAgent(_history, on, contact) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let joined = false;
      let shown = "";
      const queued = (left: boolean, a: ServerAvailability | null | undefined) => {
        const flags = `${left}|${a?.hours ?? ""}|${a?.agentsOnline === 0}`;
        if (flags === shown) return;
        shown = flags;
        on({ type: "queued", away: left, hours: a?.hours ?? null, nobodyWatching: !left && a?.agentsOnline === 0 });
      };
      (async () => {
        try {
          const s = await open();
          const first = await call<{ status: string; leftOffline?: boolean; availability?: ServerAvailability | null }>(`/${s.id}/handoff`, { method: "POST", secret: s.secret, body: contact?.trim() ? { contact: contact.trim() } : {} });
          if (stopped) return;
          if (first.status === "waiting") queued(Boolean(first.leftOffline), first.availability);
          const tick = async () => {
            if (stopped) return;
            try {
              const poll = await call<{ status: string; agentName: string | null; leftOffline?: boolean; availability?: ServerAvailability | null; messages: ServerMessage[] }>(`/${s.id}?after=${lastId}`, { secret: s.secret });
              if (stopped) return;
              if (poll.status === "waiting") queued(Boolean(poll.leftOffline), poll.availability);
              for (const m of poll.messages) lastId = Math.max(lastId, m.id);
              if (poll.status === "human" && !joined) { joined = true; on({ type: "joined", agentName: poll.agentName ?? "Support agent" }); }
              for (const m of poll.messages) if (m.from === "agent") on({ type: "message", message: toChat(m) });
              if (poll.status === "closed") { on({ type: "ended" }); return; }
              if (poll.status === "ai") return;
            } catch { /* a dropped connection just waits for the next poll */ }
            timer = setTimeout(tick, typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_MS);
          };
          void tick();
        } catch (e) {
          if (stopped) return;
          const err = e as { status?: number; message?: string };
          if (err.status === 403) on({ type: "declined", message: err.message ?? "A person is not available right now." });
          else on({ type: "ended" });
        }
      })();
      return () => { stopped = true; if (timer) clearTimeout(timer); };
    },
    async sendToAgent(text) {
      const s = await open();
      await call(`/${s.id}/messages`, { method: "POST", secret: s.secret, body: { text } }).then((r) => {
        for (const m of (r as { messages: ServerMessage[] }).messages) lastId = Math.max(lastId, m.id);
      }).catch(() => undefined);
    },
    endAgent() {
      session?.then((s) => call(`/${s.id}/end`, { method: "POST", secret: s.secret })).catch(() => undefined);
    },
    async capabilities() {
      const c = await call<{ humanEnabled: boolean; availability?: ServerAvailability | null }>("/config?app=website").catch(() => null);
      if (!c) return { humanEnabled: true, offer: "talk" as const, hours: null };
      return { humanEnabled: c.humanEnabled, offer: c.availability?.offer ?? (c.humanEnabled ? "talk" as const : "none" as const), hours: c.availability?.hours ?? null };
    },
  };
}

/** Picks the live chat when the API says it is on, otherwise the demo, once per page load. */
function createSupportChat(): SupportChatAdapter {
  const live = createLiveAdapter();
  let choice: Promise<SupportChatAdapter> | null = null;
  const pick = () => (choice ??= call<{ live: boolean }>("/config?app=website").then((c) => (c.live ? live : mockAdapter)).catch(() => mockAdapter));
  let current: SupportChatAdapter | null = null;
  return {
    async askAI(text, history) { current = await pick(); return current.askAI(text, history); },
    requestAgent(history, on, contact) {
      let cancel: (() => void) | null = null;
      let stopped = false;
      pick().then((a) => { current = a; if (!stopped) cancel = a.requestAgent(history, on, contact); });
      return () => { stopped = true; cancel?.(); };
    },
    async sendToAgent(text) { return (current ?? (await pick())).sendToAgent(text); },
    endAgent() { current?.endAgent(); },
    async capabilities() { return (await pick()).capabilities(); },
  };
}

export const supportChat: SupportChatAdapter = createSupportChat();
