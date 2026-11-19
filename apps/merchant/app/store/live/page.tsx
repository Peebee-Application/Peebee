"use client";

import type { LiveComment, LiveHostView } from "@peebee/shared";
import { Check, Crown, Eye, Flame, Link2, Loader2, Mic, MicOff, MessageCircle, Package, Plus, Radio, RotateCcw, ShoppingBag, SwitchCamera, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "../../../components/store/BottomSheet";
import { goldBtn } from "../../../components/store/StoreUI";
import { useCamera } from "../../../components/store/live/useCamera";
import { publishWhip, whenConnected } from "../../../components/store/live/whip";
import { api, errorMessage } from "../../../lib/api";

type Item = { id: string; title: string; price: number; image_url: string | null; inventory_quantity: number };
type Phase = "loading" | "blocked" | "setup" | "connecting" | "live" | "ended";

const ugx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const POLL_MS = 3000;

/** Big round control over the camera picture. */
function RoundBtn({ label, onClick, children, on = false, testId }: { label: string; onClick: () => void; children: React.ReactNode; on?: boolean; testId?: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={onClick} data-testid={testId}
      className={`grid h-[60px] w-[60px] place-items-center rounded-full backdrop-blur-md transition active:scale-95 ${on ? "bg-white text-black" : "bg-black/55 text-white"}`}>
      {children}
    </button>
  );
}

function Thumb({ item, size = 64 }: { item: Item; size?: number }) {
  return item.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.image_url} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-[16px] object-cover" />
  ) : <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-[16px] bg-white/15"><Package className="h-7 w-7" /></span>;
}

/**
 * Going live from the phone camera, for a store. Same pipeline as creators in the customer app: the API asks the
 * video provider for a live input, the phone sends its camera over WHIP, and the stream shows in the Spotlight as a
 * store live with the pinned items for sale. Big controls, few words.
 */
function StoreCameraLive() {
  const router = useRouter();
  const params = useSearchParams();
  const cam = useCamera();
  const [phase, setPhase] = useState<Phase>("loading");
  const [blocked, setBlocked] = useState<{ reason: string | null; message: string | null } | null>(null);
  const [products, setProducts] = useState<Item[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [live, setLive] = useState<LiveHostView | null>(null);
  const [leftover, setLeftover] = useState<LiveHostView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [viewers, setViewers] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [summary, setSummary] = useState<{ seconds: number; peakViewers: number; comments: number } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const cursor = useRef(0);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const pickedItems = picked.map((id) => byId.get(id)).filter((p): p is Item => !!p);

  // What this store may do, its items, and a stream left open earlier.
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [state, list] = await Promise.all([api.storeCameraLive(), api.getMerchantProProducts().catch(() => ({ products: [] }))]);
        if (off) return;
        const items = ((list as { products?: Item[] }).products ?? []).filter((p) => p && p.id);
        setProducts(items);
        const pin = params.get("pin");
        if (state.live) { setLeftover(state.live); setPicked(state.productIds); }
        else if (pin && items.some((p) => p.id === pin)) setPicked([pin]);
        if (!state.available) { setBlocked({ reason: state.reason, message: state.message }); setPhase("blocked"); return; }
        setPhase("setup");
        void cam.start();
      } catch (err) {
        if (!off) { setError(errorMessage(err)); setBlocked({ reason: "error", message: errorMessage(err) }); setPhase("blocked"); }
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    if (el && cam.stream && el.srcObject !== cam.stream) { el.srcObject = cam.stream; void el.play().catch(() => undefined); }
  }, [cam.stream]);

  // While live: the clock, keep the screen on, warn before leaving.
  useEffect(() => {
    if (phase !== "live") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    let lock: { release: () => Promise<void> } | null = null;
    void nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => undefined);
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { clearInterval(timer); window.removeEventListener("beforeunload", warn); void lock?.release().catch(() => undefined); };
  }, [phase]);

  // The host's check-in (keeps the stream open), the viewer count and new comments.
  useEffect(() => {
    if (phase !== "live" || !live) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const s = await api.liveState(live.id, cursor.current);
        if (stop) return;
        setViewers(s.viewers ?? 0);
        if (s.cursor > cursor.current) cursor.current = s.cursor;
        if (s.comments.length) setComments((prev) => { const seen = new Set(prev.map((c) => c.id)); return [...prev, ...s.comments.filter((c) => !seen.has(c.id))].slice(-30); });
        if (s.status === "ended") { void finish(false); return; }
      } catch { /* the next poll catches up */ }
      if (!stop) t = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => { stop = true; if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, live?.id]);

  const closeConnection = useCallback(() => { pcRef.current?.close(); pcRef.current = null; }, []);
  useEffect(() => () => { pcRef.current?.close(); }, []);

  async function connect(l: LiveHostView, media: MediaStream) {
    if (l.mock || !l.publishUrl) return; // the demo provider has no camera connection
    const pc = await publishWhip(l.publishUrl, media);
    pcRef.current = pc;
    await whenConnected(pc);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") { setNotice("Connection dropped. Trying again…"); void retry(l, media); }
      else if (pc.connectionState === "connected") setNotice(null);
    });
  }

  async function retry(l: LiveHostView, media: MediaStream, attempt = 1) {
    closeConnection();
    try {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      await connect(l, media);
      setNotice(null);
    } catch {
      if (attempt < 4) await retry(l, media, attempt + 1);
      else setNotice("Could not reconnect. End the live and start again.");
    }
  }

  async function goLive() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const media = cam.stream ?? (await cam.start());
    if (!media) { setBusy(false); return; }
    setPhase("connecting");
    let started: LiveHostView | null = null;
    try {
      started = (await api.storeCameraStart({ title: title.trim() || undefined, productIds: picked })).live;
      await connect(started, media);
      const went = await api.storeCameraGo(started.id, picked);
      setPicked(went.productIds);
      setLive(went.live);
      setPhase("live");
    } catch (err) {
      closeConnection();
      if (started) await api.storeCameraEnd(started.id).catch(() => undefined);
      setPhase("setup");
      setError(err instanceof Error && /^(timeout|failed|The stream address)/.test(err.message) ? "Could not connect your camera. Check your network and try again." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function continueLeftover() {
    if (!leftover || busy) return;
    setBusy(true);
    setError(null);
    const media = cam.stream ?? (await cam.start());
    if (!media) { setBusy(false); return; }
    try {
      setPhase("connecting");
      await connect(leftover, media);
      const went = await api.storeCameraGo(leftover.id, picked);
      setLive(went.live);
      setLeftover(null);
      setPhase("live");
    } catch (err) {
      setPhase("setup");
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function endLeftover() {
    if (!leftover) return;
    await api.storeCameraEnd(leftover.id).catch(() => undefined);
    setLeftover(null);
    setPicked([]);
  }

  async function finish(callApi = true) {
    if (!live) return;
    setBusy(true);
    try {
      const r = callApi ? await api.storeCameraEnd(live.id) : { seconds: elapsed, peakViewers: viewers, comments: comments.length };
      setSummary({ seconds: r.seconds, peakViewers: r.peakViewers, comments: r.comments });
    } catch (err) {
      setError(errorMessage(err));
      setSummary({ seconds: elapsed, peakViewers: viewers, comments: comments.length });
    } finally {
      closeConnection();
      cam.stop();
      setConfirmEnd(false);
      setPhase("ended");
      setBusy(false);
    }
  }

  async function savePicked(next: string[]) {
    setPicked(next);
    if (phase === "live" && live) {
      try { setPicked((await api.storeCameraItems(live.id, next)).productIds); }
      catch (err) { setNotice(errorMessage(err)); }
    }
  }

  /** Puts an item first: the one shoppers see on top while live. */
  function feature(id: string) {
    if (picked[0] === id) return;
    void savePicked([id, ...picked.filter((x) => x !== id)]);
  }

  async function flip() {
    await cam.flip(async (track) => {
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(track);
    });
  }

  function leave() {
    cam.stop();
    router.push("/store");
  }

  function useLink() {
    try { sessionStorage.setItem("peebee_store_open", "live-link"); } catch { /* storage blocked */ }
    leave();
  }

  // ------------------------------------------------------------------ screens without the camera
  const shell = (children: React.ReactNode) => (
    <div className="fixed inset-0 z-[55] flex flex-col overflow-hidden bg-black text-white" data-testid="camera-live">{children}</div>
  );

  if (phase === "loading") return shell(<Loader2 className="m-auto h-10 w-10 animate-spin text-gold" />);

  if (phase === "blocked") {
    const plan = blocked?.reason === "plan_required";
    return shell(
      <div className="m-auto w-full max-w-sm space-y-5 px-5 text-center" data-testid="camera-blocked">
        <span className="mx-auto grid h-[88px] w-[88px] place-items-center rounded-[28px] bg-gold text-ink-gold">{plan ? <Crown className="h-11 w-11" /> : <Radio className="h-11 w-11" />}</span>
        <h1 className="text-[26px] font-black leading-tight">{plan ? "Live needs Pro Live" : "Live is not open yet"}</h1>
        <p className="text-[18px] font-semibold text-white/75">{plan ? "Or Elite. Sell on camera, shoppers buy in one tap." : blocked?.message ?? "Check back soon."}</p>
        {plan && <button type="button" onClick={() => router.push("/store/plans?tier=pro_live")} className={goldBtn} data-testid="camera-upgrade"><Crown className="h-6 w-6" /> See plans</button>}
        <button type="button" onClick={leave} className="flex min-h-[60px] w-full items-center justify-center rounded-full border-2 border-white/25 text-[19px] font-black">Back to store</button>
      </div>,
    );
  }

  if (phase === "ended") {
    const s = summary ?? { seconds: elapsed, peakViewers: viewers, comments: comments.length };
    return shell(
      <div className="m-auto w-full max-w-sm space-y-6 px-5 text-center" data-testid="camera-ended">
        <span className="mx-auto grid h-[88px] w-[88px] place-items-center rounded-[28px] bg-white/10"><Check className="h-11 w-11 text-gold" strokeWidth={3} /></span>
        <h1 className="text-[28px] font-black">Live ended</h1>
        <div className="grid grid-cols-3 gap-2.5">
          {[["Time", clock(s.seconds)], ["Viewers", String(s.peakViewers)], ["Chats", String(s.comments)]].map(([l, v]) => (
            <div key={l} className="rounded-[20px] bg-white/10 p-3"><p className="text-[24px] font-black tabular-nums">{v}</p><p className="text-[16px] font-semibold text-white/70">{l}</p></div>
          ))}
        </div>
        {error && <p className="text-[17px] font-semibold text-red-300">{error}</p>}
        <button type="button" onClick={leave} className={goldBtn} data-testid="camera-done">Back to store</button>
      </div>,
    );
  }

  // ------------------------------------------------------------------ the camera
  const isLive = phase === "live";
  const front = cam.facing === "user";
  return shell(
    <>
      {cam.stream ? (
        <video ref={attachPreview} autoPlay muted playsInline data-testid="camera-preview"
          className={`absolute inset-0 h-full w-full object-cover ${front ? "-scale-x-100" : ""}`} />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-neutral-950 p-6" data-testid="camera-off">
          {cam.error ? (
            <div className="max-w-xs space-y-4 text-center">
              <p className="text-[19px] font-bold text-white/85">{cam.error}</p>
              <button type="button" onClick={() => void cam.start()} className={goldBtn} data-testid="camera-retry"><RotateCcw className="h-6 w-6" /> Try again</button>
            </div>
          ) : <Loader2 className="h-10 w-10 animate-spin text-gold" />}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      {/* Top: close, LIVE + time + viewers */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2.5 px-4" style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}>
        {!isLive && <RoundBtn label="Close" onClick={leave} testId="camera-close"><X className="h-7 w-7" strokeWidth={2.6} /></RoundBtn>}
        {isLive && (
          <>
            <span className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-4 text-[18px] font-black" data-testid="camera-live-pill"><Radio className="h-5 w-5" /> LIVE <span className="tabular-nums">{clock(elapsed)}</span></span>
            <span className="flex h-12 items-center gap-2 rounded-full bg-black/55 px-4 text-[18px] font-black backdrop-blur-md" data-testid="camera-viewers"><Eye className="h-5 w-5 text-gold" /> {viewers}</span>
          </>
        )}
      </div>

      {/* Right: flip, mic */}
      <div className="absolute right-4 z-10 flex flex-col gap-3" style={{ top: "calc(max(14px, env(safe-area-inset-top)) + 76px)" }}>
        <RoundBtn label="Flip camera" onClick={() => void flip()} testId="camera-flip"><SwitchCamera className="h-7 w-7" /></RoundBtn>
        <RoundBtn label={cam.micOn ? "Mute microphone" : "Turn microphone on"} on={!cam.micOn} onClick={cam.toggleMic} testId="camera-mic">
          {cam.micOn ? <Mic className="h-7 w-7" /> : <MicOff className="h-7 w-7" />}
        </RoundBtn>
      </div>

      {notice && <p role="status" className="absolute inset-x-4 top-[calc(max(14px,env(safe-area-inset-top))+76px)] z-10 mr-20 rounded-[18px] bg-black/75 p-3 text-[17px] font-bold" data-testid="camera-notice">{notice}</p>}

      {/* Bottom panel */}
      <div className="absolute inset-x-0 bottom-0 z-10 space-y-3.5 px-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        {isLive && comments.length > 0 && (
          <ul className="max-h-[22vh] space-y-1.5 overflow-hidden pr-20" data-testid="camera-comments" aria-live="polite">
            {comments.slice(-4).map((c) => (
              <li key={c.id} className="w-fit max-w-full rounded-[16px] bg-black/55 px-3 py-1.5 text-[17px] leading-snug backdrop-blur-sm">
                <b className={c.byHost ? "text-gold" : ""}>{c.author}</b> <span className="break-words text-white/90">{c.body}</span>
              </li>
            ))}
          </ul>
        )}

        {leftover && !isLive && (
          <div className="space-y-3 rounded-[24px] border-[1.5px] border-red-500/50 bg-black/75 p-4 backdrop-blur-md" data-testid="camera-leftover">
            <p className="flex items-center gap-2 text-[19px] font-black"><Radio className="h-5 w-5 text-red-500" /> You are still live</p>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => void endLeftover()} className="min-h-[56px] rounded-full border-2 border-white/25 text-[18px] font-black" data-testid="leftover-end">End it</button>
              <button type="button" onClick={() => void continueLeftover()} disabled={busy} className="min-h-[56px] rounded-full bg-red-600 text-[18px] font-black disabled:opacity-50" data-testid="leftover-continue">Continue</button>
            </div>
          </div>
        )}

        {!isLive && !leftover && (
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="What are you selling?" aria-label="Live title" data-testid="camera-title"
            className="min-h-[60px] w-full rounded-[20px] border-2 border-white/20 bg-black/55 px-4 text-[21px] font-semibold text-white outline-none backdrop-blur-md placeholder:text-white/55 focus:border-gold" />
        )}

        {/* Items for sale: the first one is shown on top to shoppers */}
        <div className="flex items-center gap-3 overflow-x-auto pt-3 [scrollbar-width:none]" data-testid="camera-items">
          {pickedItems.map((p, i) => (
            <button key={p.id} type="button" onClick={() => feature(p.id)} aria-label={i === 0 ? `${p.title}, shown first` : `Show ${p.title} first`} data-testid={`camera-item-${p.id}`}
              className={`relative flex min-h-[72px] shrink-0 items-center gap-2.5 rounded-[20px] p-1.5 text-left backdrop-blur-md ${i === 0 ? "bg-gold pr-7 text-ink-gold" : "bg-black/60 pr-3.5 text-white"}`}>
              <Thumb item={p} size={60} />
              <span className="max-w-[9.5rem]">
                <span className="line-clamp-2 block text-[16px] font-black leading-tight">{p.title}</span>
                <span className="block text-[16px] font-bold tabular-nums opacity-85">{ugx(p.price)}</span>
              </span>
              {i === 0 && <span className="absolute -right-1.5 -top-2.5 grid h-8 w-8 place-items-center rounded-full border-[3px] border-black bg-red-600 text-white"><Flame className="h-4 w-4" /></span>}
            </button>
          ))}
          <button type="button" onClick={() => setPickerOpen(true)} data-testid="camera-add-items" aria-label="Choose items to sell"
            className="relative flex min-h-[72px] shrink-0 items-center gap-2 rounded-[20px] border-2 border-dashed border-white/40 bg-black/45 px-4 text-[18px] font-black backdrop-blur-md">
            {pickedItems.length ? <Plus className="h-6 w-6" /> : <><ShoppingBag className="h-6 w-6 text-gold" /> Items to sell</>}
          </button>
        </div>

        {error && <p role="alert" className="rounded-[18px] bg-red-600/90 p-3 text-[17px] font-bold" data-testid="camera-error">{error}</p>}

        {isLive ? (
          <button type="button" onClick={() => setConfirmEnd(true)} data-testid="camera-end"
            className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full border-2 border-white/40 bg-black/55 text-[20px] font-black backdrop-blur-md active:scale-[.98]">
            <X className="h-6 w-6" strokeWidth={3} /> End live
          </button>
        ) : !leftover && (
          <>
            <button type="button" onClick={() => void goLive()} disabled={busy || phase === "connecting" || !cam.stream} data-testid="camera-go-live"
              className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-red-600 text-[21px] font-black shadow-[0_10px_28px_rgba(220,38,38,.45)] active:scale-[.98] disabled:opacity-60">
              {phase === "connecting" ? <><Loader2 className="h-6 w-6 animate-spin" /> Connecting…</> : <><Radio className="h-6 w-6" /> Go live</>}
            </button>
            <button type="button" onClick={useLink} data-testid="camera-use-link" className="mx-auto flex min-h-[56px] items-center gap-2 rounded-full px-4 text-[17px] font-bold text-white/80">
              <Link2 className="h-5 w-5" /> Use a stream link instead
            </button>
          </>
        )}
      </div>

      {pickerOpen && (
        <BottomSheet title="Items to sell" subtitle="Shoppers can buy these while you're live" onClose={() => setPickerOpen(false)} testId="camera-picker"
          footer={<button type="button" onClick={() => setPickerOpen(false)} className={goldBtn} data-testid="picker-done">{picked.length ? `Done · ${picked.length} item${picked.length === 1 ? "" : "s"}` : "Done"}</button>}>
          {products.length === 0 ? (
            <p className="py-8 text-center text-[19px] font-bold text-ink-500" data-testid="picker-empty">Add items to your Catalog first.</p>
          ) : (
            <ul className="space-y-2.5 pb-2">
              {products.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <li key={p.id}>
                    <button type="button" role="checkbox" aria-checked={on} data-testid={`pick-${p.id}`}
                      onClick={() => void savePicked(on ? picked.filter((x) => x !== p.id) : [...picked, p.id].slice(0, 10))}
                      className={`relative flex min-h-[80px] w-full items-center gap-3 rounded-[22px] border-2 p-2 pr-3 text-left ${on ? "border-gold bg-gold/10" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}>
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" className="h-[60px] w-[60px] shrink-0 rounded-[14px] object-cover" />
                      ) : <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-[14px] bg-[rgb(var(--surface-muted))]"><Package className="h-7 w-7 text-ink-500" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[19px] font-black leading-tight text-ink">{p.title}</span>
                        <span className="flex flex-wrap items-center gap-x-2 text-[17px] font-bold text-ink-500">{ugx(p.price)}{p.inventory_quantity <= 0 ? " · Sold out" : ""}
                          {on && picked[0] === p.id && <span className="inline-flex h-7 items-center gap-1 rounded-full bg-red-600 px-2.5 text-[15px] font-black text-white"><Flame className="h-4 w-4" /> 1st</span>}</span>
                      </span>
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 ${on ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)]"}`}>{on && <Check className="h-6 w-6" strokeWidth={3} />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </BottomSheet>
      )}

      {confirmEnd && (
        <BottomSheet title="End your live?" subtitle="Shoppers will see it ended" onClose={() => setConfirmEnd(false)} testId="camera-confirm-end">
          <div className="grid gap-3 pb-2 pt-1">
            <button type="button" disabled={busy} onClick={() => void finish()} className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-red-600 text-[20px] font-black text-white disabled:opacity-50" data-testid="camera-end-confirm">
              {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <X className="h-6 w-6" strokeWidth={3} />} End live
            </button>
            <button type="button" onClick={() => setConfirmEnd(false)} className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full border-2 border-[var(--border-faint)] text-[20px] font-black text-ink" data-testid="camera-keep">
              <MessageCircle className="h-6 w-6" /> Keep going
            </button>
          </div>
        </BottomSheet>
      )}
    </>,
  );
}

export default function StoreLivePage() {
  return <Suspense fallback={null}><StoreCameraLive /></Suspense>;
}
