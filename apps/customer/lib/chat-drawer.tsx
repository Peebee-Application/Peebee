"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChatInbox } from "../components/chat/ChatInbox";
import { RestaurantChatView } from "../components/chat/RestaurantChatView";
import { RiderChatView } from "../components/chat/RiderChatView";
import { SchoolChatView } from "../components/chat/SchoolChatView";
import { useTranslate } from "./i18n";

/** Matches the CSS transition on .app-stage / .chat-drawer. */
const SLIDE_MS = 420;
const SWIPE_BACK_PX = 70;

/** What can open in the drawer: the list of conversations, or one conversation (shown full width). */
export type ChatLayer =
  | { type: "list" }
  | { type: "rider"; id: string }
  | { type: "restaurant"; id: string; item?: { id: string; name: string } }
  | { type: "school"; id: string };
type ThreadLayer = Exclude<ChatLayer, { type: "list" }>;
type Slot = "list" | "thread";

type ChatDrawer = {
  /** Anything of the chat is showing. */
  open: boolean;
  openChat: () => void;
  openThread: (layer: ThreadLayer) => void;
  /** One step back: from a conversation to the list it was opened from, or out of the chat to the screen underneath. */
  back: () => void;
  /** Out of the chat, to the screen it was opened over. */
  close: () => void;
  toggleChat: () => void;
};
const noop = () => {};
const Ctx = createContext<ChatDrawer>({ open: false, openChat: noop, openThread: noop, back: noop, close: noop, toggleChat: noop });
export const useChatDrawer = () => useContext(Ctx);

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A direct link (a notification, a shared address) lands on a chat route. That page asks for the chat to open
// over a sensible screen instead; the shell picks the request up once the address has changed.
let pending: { layer: ChatLayer; from: string } | null = null;
export function openChatAfterNavigation(layer: ChatLayer, from: string) {
  pending = { layer, from };
}

/** The chat layer a link points at, or null for any other link. */
export function chatLayerFromHref(href: string | null): ChatLayer | null {
  if (!href || !href.startsWith("/")) return null;
  const url = new URL(href, "http://x");
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/chat") return { type: "list" };
  const rider = /^\/chat\/([^/]+)$/.exec(path);
  if (rider) return { type: "rider", id: decodeURIComponent(rider[1]!) };
  const school = /^\/learn\/messages\/([^/]+)$/.exec(path);
  if (school) return { type: "school", id: decodeURIComponent(school[1]!) };
  const restaurant = /^\/restaurants\/([^/]+)\/chat$/.exec(path);
  if (restaurant) {
    const item = url.searchParams.get("item");
    const name = url.searchParams.get("itemName");
    return { type: "restaurant", id: decodeURIComponent(restaurant[1]!), item: item && name ? { id: item, name } : undefined };
  }
  return null;
}

/**
 * Wraps the whole app screen (banners, header, page, bottom menu) as one "stage".
 * Opening chat slides the stage left, leaving a part of it showing, and the chat list underneath eases up from
 * slightly zoomed out. A conversation opens the same way at full width. While the stage is moved it is pinned to
 * the viewport at the same scroll offset, so fixed and sticky parts of the app stay where they were.
 * Each layer takes one history step, so the phone's back button steps back through them too.
 */
export function ChatDrawerShell({ children }: { children: ReactNode }) {
  const tr = useTranslate();
  const pathname = usePathname();
  const [lock, setLock] = useState(false);
  const [stack, setStack] = useState<Slot[]>([]);
  const [listMounted, setListMounted] = useState(false);
  const [session, setSession] = useState(0);
  const [thread, setThread] = useState<ThreadLayer | null>(null);
  const [lockY, setLockY] = useState(0);
  const lockRef = useRef(false);
  const lockYRef = useRef(0);
  const stackRef = useRef<Slot[]>([]);
  const restoreY = useRef<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    lockRef.current = lock;
    stackRef.current = stack;
  }, [lock, stack]);

  const listOn = stack.includes("list");
  const threadOn = stack.includes("thread");

  /** Show exactly these layers; whatever is leaving finishes its slide before it is unmounted or the stage is released. */
  const applyStack = useCallback((next: Slot[]) => {
    stackRef.current = next;
    setStack(next);
    window.clearTimeout(timer.current);
    const wait = prefersReducedMotion() ? 0 : SLIDE_MS;
    if (next.length === 0) {
      timer.current = window.setTimeout(() => {
        restoreY.current = lockYRef.current;
        setLock(false);
        setThread(null);
        returnFocus.current?.focus?.();
      }, wait);
    } else if (!next.includes("thread")) {
      timer.current = window.setTimeout(() => setThread(null), wait);
    }
  }, []);

  const pushHistory = useCallback((depth: number) => {
    try {
      window.history.pushState({ ...(window.history.state ?? {}), peebeeChat: depth }, "", window.location.href);
    } catch { /* history unavailable: the on-screen controls still work */ }
  }, []);

  /** Open layers on top of whatever is showing. From closed, the stage is pinned first and the slide starts on the next frames. */
  const show = useCallback((layers: Slot[], threadLayer: ThreadLayer | null) => {
    window.clearTimeout(timer.current);
    const base = stackRef.current;
    const wasClosed = base.length === 0;
    if (wasClosed) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      lockYRef.current = window.scrollY;
      setLockY(window.scrollY);
      setLock(true);
    }
    if (layers.includes("list")) {
      setListMounted(true);
      setSession((n) => n + 1);
    }
    if (threadLayer) setThread(threadLayer);
    const next = [...base.filter((s) => !layers.includes(s)), ...layers];
    const added = next.length - base.length;
    for (let i = 1; i <= added; i++) pushHistory(base.length + i);
    requestAnimationFrame(() => requestAnimationFrame(() => applyStack(next)));
  }, [applyStack, pushHistory]);

  const openChat = useCallback(() => {
    if (stackRef.current.length > 0) return;
    show(["list"], null);
  }, [show]);

  const openThread = useCallback((layer: ThreadLayer) => {
    show(["thread"], layer);
  }, [show]);

  const popTo = useCallback((depth: number) => {
    const cur = stackRef.current;
    if (depth >= cur.length) return;
    const dropped = cur.length - depth;
    applyStack(cur.slice(0, depth));
    // Keep the browser history in step; the popstate that follows finds nothing left to do.
    try { window.history.go(-dropped); } catch { /* ignore */ }
  }, [applyStack]);

  const back = useCallback(() => popTo(Math.max(0, stackRef.current.length - 1)), [popTo]);
  const close = useCallback(() => popTo(0), [popTo]);
  const toggleChat = useCallback(() => (stackRef.current.length ? close() : openChat()), [openChat, close]);

  // The phone's own back button (or a swipe) steps back one layer.
  useEffect(() => {
    const onPop = () => {
      const depth = Number((window.history.state as { peebeeChat?: number } | null)?.peebeeChat ?? 0);
      if (depth < stackRef.current.length) applyStack(stackRef.current.slice(0, depth));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyStack]);

  // Put the page back at the offset it had before the stage was pinned.
  useLayoutEffect(() => {
    if (!lock && restoreY.current != null) {
      window.scrollTo(0, restoreY.current);
      restoreY.current = null;
    }
  }, [lock]);

  // Following a link out of the chat leaves it at once so the next screen shows normally; a direct link to a
  // chat then opens it over that screen.
  useEffect(() => {
    if (stackRef.current.length > 0 || lockRef.current) {
      window.clearTimeout(timer.current);
      stackRef.current = [];
      setStack([]);
      setLock(false);
      setThread(null);
    }
    // The request waits until the address has moved off the chat link it came from.
    if (pending && pending.from !== pathname) {
      const { layer } = pending;
      pending = null;
      // This reacts to the address changing, which lives outside React state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (layer.type === "list") show(["list"], null);
      else show(["thread"], layer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Every link to a chat opens the drawer over the current screen, wherever the link is.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!link || (link.getAttribute("target") && link.getAttribute("target") !== "_self")) return;
      const layer = chatLayerFromHref(link.getAttribute("href"));
      if (!layer) return;
      e.preventDefault();
      e.stopPropagation();
      if (layer.type === "list") openChat();
      else openThread(layer);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [openChat, openThread]);

  useEffect(() => {
    if (!listOn || threadOn) return;
    closeRef.current?.focus();
  }, [listOn, threadOn]);

  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, back]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const value = useMemo(() => ({ open: stack.length > 0, openChat, openThread, back, close, toggleChat }), [stack.length, openChat, openThread, back, close, toggleChat]);

  const swipe = {
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; },
    onTouchEnd: (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      const start = touch.current;
      touch.current = null;
      if (t && start && t.clientX - start.x > SWIPE_BACK_PX && Math.abs(t.clientY - start.y) < 50) back();
    },
  };

  return (
    <Ctx.Provider value={value}>
      <div className="app-stage" data-lock={lock} data-shown={stack.length > 0} data-wide={stack.length > 0 && !listOn} inert={stack.length > 0} style={{ "--stage-scroll": `${lockY}px` } as CSSProperties}>
        <div className="app-stage__inner">{children}</div>
      </div>
      <section
        id="chat-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={tr("chat_title")}
        aria-hidden={!listOn || threadOn}
        inert={!listOn || threadOn}
        data-shown={listOn}
        className="chat-drawer"
        {...swipe}
      >
        <header className="chat-drawer__head">
          <h2 className="text-lg font-bold">{tr("chat_title")}</h2>
          <button ref={closeRef} type="button" aria-label="Close chat" onClick={close} className="chat-drawer__close flex h-11 w-11 items-center justify-center rounded-full">
            <X size={22} aria-hidden />
          </button>
        </header>
        <div className="chat-drawer__body">{listMounted && <ChatInbox key={session} embedded />}</div>
      </section>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Conversation"
        aria-hidden={!threadOn}
        inert={!threadOn}
        data-shown={threadOn}
        className="chat-drawer chat-drawer--full"
        {...swipe}
      >
        {thread?.type === "rider" && <RiderChatView key={`rider-${thread.id}`} counterpartId={thread.id} onBack={back} />}
        {thread?.type === "school" && <SchoolChatView key={`school-${thread.id}`} schoolId={thread.id} onBack={back} />}
        {thread?.type === "restaurant" && <RestaurantChatView key={`restaurant-${thread.id}`} id={thread.id} item={thread.item} onBack={back} />}
      </section>
      <button type="button" aria-label="Close chat" tabIndex={-1} onClick={close} className="chat-drawer__slice" data-shown={listOn && !threadOn} />
    </Ctx.Provider>
  );
}
