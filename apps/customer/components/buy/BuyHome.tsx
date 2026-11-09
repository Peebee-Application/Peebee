"use client";

import { DEFAULT_SHOPPING_UNIT_SETTINGS, type OrderRow, type ShoppingUnitSettings } from "@peebee/shared";
import {
  ArrowLeftRight, Camera, ChevronDown, ChevronRight, FileText, Flame, List, Loader2, MapPin, Mic, Pill, Play, Plus, Search, ShieldCheck, ShoppingBag, Square, Store, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import {
  BUY_SPOTLIGHT_PULL_MAX, buyCategoryNames, buyFeaturedSpots, matchPrice, parseListText, shoppingStageLabel, spotlightPullDecision, unitLabel,
} from "../../lib/buy-home";
import { addToCart, useCart, useEarlierCarts, type CartItem } from "../../lib/cart";
import { formatDistanceKm, haversineKm, useCustomerLocation } from "../../lib/location";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
import { productPricing, type MarketVariant } from "../../lib/product-pricing";
import { addSpotlightItemToCart } from "../../lib/spotlight-cart";
import { useLocationLabel } from "../../lib/use-location-label";
import { ShoppingListModal } from "../home/ShoppingListModal";
import type { Item } from "../home/ListItemLine";

type MStore = {
  id: string; name: string; slug?: string; category?: string; logo_url?: string | null; banner_url?: string | null;
  lat?: number | null; lng?: number | null; distance_km?: number | null; is_open?: number | boolean; is_live?: number | boolean;
  live_viewer_count?: number; min_order_amount?: number | null; delivery_enabled?: number | boolean; pickup_enabled?: number | boolean;
};
type MProduct = {
  id: string; store_id: string; store_name?: string; store_slug?: string; store_category?: string; title: string; price: number;
  compare_at_price?: number | null; image_url?: string | null; inventory_quantity?: number | null; variants?: MarketVariant[] | null;
  category_name?: string | null; badge?: string | null;
};
type Spot = {
  id: string; store_id: string; store_name: string; store_slug?: string; store_logo?: string; store_category?: string;
  type: "live" | "video" | "image" | "carousel"; poster_url?: string; title: string; viewer_count?: number; likes_count?: number;
  product: { id: string; title: string; price: number; compare_at_price?: number | null; image_url?: string | null };
};

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-UG")}`;
const truthy = (v: unknown) => v === true || v === 1 || v === "1";
/** Only same-origin images: the demo feed's remote images may not load (offline, practice, data saver). */
const localImg = (...urls: Array<string | null | undefined>) => urls.find((u) => !!u && u.startsWith("/")) ?? urls.find((u) => !!u) ?? null;

type SpeechCtor = new () => {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void;
};

/** Pull down from the top of Buy home to open Spotlight. Released early, it springs back.
 * The Spotlight button and the Live / Reels "See all" links are the non-gesture paths. */
function useSpotlightPull(blocked: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const router = useRouter();

  useEffect(() => {
    document.documentElement.classList.add("buy-pull-page");
    return () => document.documentElement.classList.remove("buy-pull-page");
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let startY = 0;
    let startX = 0;
    let armed = false;
    let dragging = false;
    let pulled = 0;

    const atTop = () => window.scrollY <= 0 && !blocked && !document.documentElement.classList.contains("customer-menu-open");
    const say = (text: string) => {
      const node = statusRef.current;
      if (node && node.textContent !== text) node.textContent = text;
    };
    const paint = (px: number) => {
      pulled = px;
      el.style.setProperty("--buy-pull", `${px}px`);
      const ready = spotlightPullDecision(px) === "commit";
      el.toggleAttribute("data-pull-ready", ready);
      say(ready ? "Release to open Spotlight" : "");
    };
    const springBack = () => {
      el.classList.remove("is-pulling");
      const go = () => paint(0);
      if (reduce.matches) go();
      else requestAnimationFrame(go);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [data-buy-no-pull]")) { armed = false; return; }
      if (!atTop()) { armed = false; return; }
      startY = e.touches[0]!.clientY;
      startX = e.touches[0]!.clientX;
      armed = true;
      dragging = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!armed || e.touches.length !== 1) return;
      const dy = e.touches[0]!.clientY - startY;
      const dx = e.touches[0]!.clientX - startX;
      if (!dragging) {
        if (dy < 12) {
          if (dy < -6 || Math.abs(dx) > Math.abs(dy) + 4) armed = false;
          return;
        }
        if (!atTop()) { armed = false; return; }
        dragging = true;
        el.classList.add("is-pulling");
      }
      if (!atTop()) { armed = false; dragging = false; springBack(); return; }
      if (e.cancelable) e.preventDefault();
      paint(Math.max(0, Math.min(BUY_SPOTLIGHT_PULL_MAX, (dy - 12) * 0.7)));
    };
    const onEnd = () => {
      if (!armed && !dragging) return;
      const commit = dragging && spotlightPullDecision(pulled) === "commit";
      armed = false;
      dragging = false;
      if (commit) {
        el.classList.remove("is-pulling");
        paint(reduce.matches ? 0 : BUY_SPOTLIGHT_PULL_MAX);
        say("");
        router.push("/spotlight");
        return;
      }
      springBack();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.classList.remove("is-pulling");
      el.style.removeProperty("--buy-pull");
      el.removeAttribute("data-pull-ready");
    };
  }, [router, blocked]);

  return { rootRef, statusRef };
}

export function BuyHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { label: placeLabel } = useLocationLabel();
  const { lat, lng } = useCustomerLocation();
  const cart = useCart();
  const { carts: earlier } = useEarlierCarts();

  // ---- data -------------------------------------------------------------
  const [stores, setStores] = useState<MStore[]>([]);
  const [products, setProducts] = useState<MProduct[]>([]);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [active, setActive] = useState<OrderRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [productLoadKey, setProductLoadKey] = useState("");
  const [unitSettings, setUnitSettings] = useState<ShoppingUnitSettings>(DEFAULT_SHOPPING_UNIT_SETTINGS);
  const [category, setCategory] = useState("All");

  useEffect(() => {
    let cancelled = false;
    const requestKey = `${lat ?? ""}:${lng ?? ""}`;
    (async () => {
      // Every call is optional: any of them can fail (e.g. the marketplace tables missing) and the page still renders.
      const [g, s, live, spot, act, settings] = await Promise.all([
        api.getMarketplaceStores("groceries", lat, lng).catch(() => ({ stores: [] as MStore[] })),
        api.getMarketplaceStores("stores", lat, lng).catch(() => ({ stores: [] as MStore[] })),
        api.getMarketplaceLiveChannels().catch(() => ({ liveChannels: [] as MStore[] })),
        api.getMarketplaceSpotlight().catch(() => ({ spotlight: [] as Spot[] })),
        api.getActiveOrder().catch(() => null),
        api.getSettings().catch(() => null),
      ]);
      if (cancelled) return;
      const liveIds = new Set((live.liveChannels ?? []).map((c: MStore) => c.id));
      const seen = new Set<string>();
      let all: MStore[] = [...(g.stores ?? []), ...(s.stores ?? [])]
        .filter((x: MStore) => x?.id && x.category !== "pharmacy" && !seen.has(x.id) && !!seen.add(x.id))
        .map((x: MStore) => {
          let d = x.distance_km ?? null;
          if (d == null && lat != null && lng != null && x.lat != null && x.lng != null) d = Math.round(haversineKm(lat, lng, Number(x.lat), Number(x.lng)) * 10) / 10;
          return { ...x, distance_km: d, is_live: truthy(x.is_live) || liveIds.has(x.id) };
        });
      all = all.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
      setStores(all);
      setSpots(Array.isArray(spot.spotlight) ? spot.spotlight : []);
      if (act?.activeOrder && act.activeOrder.type === "shopping" && !act.activeOrder.restaurant_id) setActive(act.activeOrder);
      if (settings?.settings?.shoppingUnits) setUnitSettings(settings.settings.shoppingUnits);
      setLoaded(true);
      // Products for deals and price hints: the two nearest shops.
      try {
        const lists = await Promise.all(
          all.slice(0, 3).map((st) =>
            api.getMarketplaceStoreProducts(st.id)
              .then((r) => (r.products ?? []).map((p: MProduct) => ({ ...p, store_id: st.id, store_name: st.name, store_slug: st.slug, store_category: st.category, price: Number(p.price) || 0 })))
              .catch(() => [] as MProduct[]),
          ),
        );
        if (!cancelled) setProducts(lists.flat());
      } finally {
        if (!cancelled) setProductLoadKey(requestKey);
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  // ---- list composer ------------------------------------------------------
  const [text, setText] = useState("");
  const [composerMode, setComposerMode] = useState<"type" | "speak" | "snap">("type");
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [capEditing, setCapEditing] = useState(false);
  const [showAllChips, setShowAllChips] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const recRef = useRef<{ stop(): void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { rootRef, statusRef } = useSpotlightPull(listOpen);

  useEffect(() => {
    const v = Number(window.localStorage.getItem("peebee_buy_cap"));
    if (v > 0) {
      // Read after mount: localStorage is not available during server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stored preference
      setCap(v);
    }
  }, []);
  function saveCap(v: number | null) {
    setCap(v);
    if (v) window.localStorage.setItem("peebee_buy_cap", String(v)); else window.localStorage.removeItem("peebee_buy_cap");
  }

  const parsed = useMemo(() => parseListText(text, unitSettings), [text, unitSettings]);
  const priced = parsed.map((it) => {
    // A shop price is only a fair hint for "one of" an item; "5 basmati" or "2 kg tomatoes" may not match how the shop sells it.
    const single = it.quantity === "1" && it.unit !== "other";
    const p = single ? matchPrice(it.name, products) : null;
    return { it, unitPrice: p, est: p };
  });
  const estimate = priced.reduce((s, x) => s + (x.est ?? 0), 0);
  const pricedCount = priced.filter((x) => x.est).length;
  const composerActive = composerOpen || text.trim().length > 0 || listening || !!hint || capEditing;

  function appendText(t: string) {
    const clean = t.trim();
    if (!clean) return;
    setText((prev) => (prev.trim() ? `${prev.trim().replace(/,$/, "")}, ${clean}` : clean));
  }

  async function startSpeak() {
    setComposerMode("speak");
    setComposerOpen(true);
    setHint(null);
    if (listening) { recRef.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = "en-UG"; rec.interimResults = false; rec.continuous = false;
      rec.onresult = (e) => { const r = e.results[e.results.length - 1]; if (r?.[0]) appendText(r[0].transcript); };
      rec.onend = () => { setListening(false); setComposerMode("type"); };
      rec.onerror = () => { setListening(false); setHint("Couldn't hear that. Try again or type your list."); };
      recRef.current = rec; setListening(true); rec.start();
      return;
    }
    // No speech recognition in this browser: record a short clip and let the server transcribe it.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setHint("Voice isn't available in this browser. Type your list instead.");
      setComposerMode("type");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        setHint("Writing down your list…");
        try {
          const res = await api.transcribeVoiceNote(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
          if (res.items?.length) appendText(res.items.map((i) => `${i.quantity > 1 ? `${i.quantity} ` : ""}${i.name}`).join(", "));
          else appendText(res.transcript);
          setHint(null);
        } catch { setHint("Couldn't write that down. Try again or type your list."); }
        setComposerMode("type");
      };
      recRef.current = { stop: () => mr.state !== "inactive" && mr.stop() };
      setListening(true);
      mr.start();
      window.setTimeout(() => recRef.current?.stop(), 15000);
    } catch {
      setHint("Allow the microphone to speak your list, or type it.");
      setComposerMode("type");
    }
  }

  function onSnap(file: File | undefined) {
    setComposerMode("type");
    setComposerOpen(true);
    if (!file) return;
    // Reading handwriting needs a server step that doesn't exist yet, so be honest about it.
    setHint("Reading photo lists is coming soon. Type or speak your list for now.");
  }

  function toModalItems(): Item[] {
    return priced.map(({ it, unitPrice }) => ({
      name: it.name, quantity: it.quantity, unit: it.unit, customUnit: it.customUnit,
      unitCost: unitPrice && it.unit !== "other" ? String(unitPrice) : "", stage: 3, unitSource: "manual" as const,
    }));
  }

  // ---- derived sections ----------------------------------------------------
  /** A same-origin picture for a Spotlight item: its product, another product from that shop, or the shop logo. */
  const spotImg = (sp: Spot) => {
    const own = products.find((p) => p.id === sp.product.id)?.image_url;
    const key = sp.product.title.toLowerCase().replace(/\(.*\)/, "").split(/\s+/).filter((w) => w.length > 3).slice(-1)[0]?.replace(/s$/, "");
    const byTitle = key ? products.find((p) => p.image_url?.startsWith("/") && p.title.toLowerCase().includes(key))?.image_url : null;
    const sameStore = products.find((p) => p.store_id === sp.store_id && p.image_url?.startsWith("/"))?.image_url;
    const store = stores.find((x) => x.id === sp.store_id);
    return localImg(own, byTitle, sp.product.image_url, sp.poster_url, sameStore, store?.logo_url, sp.store_logo);
  };
  const slides = useMemo(() => buyFeaturedSpots(spots), [spots]);
  const reels = useMemo(() => {
    const lead = spots.find((s) => s.type === "live");
    return spots.filter((s) => s !== lead).slice(0, 8);
  }, [spots]);
  const rings = useMemo(() => {
    const list = stores.map((s) => ({ id: s.id, name: s.name, logo: s.logo_url, live: truthy(s.is_live), viewers: s.live_viewer_count, href: `/store/${s.id}` }));
    if (!list.length) {
      const seen = new Set<string>();
      for (const s of spots) if (!seen.has(s.store_id)) { seen.add(s.store_id); list.push({ id: s.store_id, name: s.store_name, logo: s.store_logo ?? null, live: s.type === "live", viewers: s.viewer_count, href: `/store/${s.store_id}` }); }
    }
    return list.sort((a, b) => Number(b.live) - Number(a.live)).slice(0, 10);
  }, [stores, spots]);
  const categories = useMemo(() => buyCategoryNames(products), [products]);
  const activeCategory = category !== "All" && categories.includes(category) ? category : "All";
  const scopedProducts = useMemo(
    () => (activeCategory === "All" ? products : products.filter((p) => p.category_name?.trim() === activeCategory)),
    [products, activeCategory],
  );
  const deals = useMemo(() => {
    const rows = scopedProducts.map((p) => ({ p, pr: productPricing(p) }));
    const disc = rows.filter((r) => r.pr.discount > 0).sort((a, b) => b.pr.discount - a.pr.discount);
    const rest = rows.filter((r) => r.pr.discount === 0);
    return [...disc, ...rest].slice(0, 4);
  }, [scopedProducts]);
  const buyAgain = useMemo(() => {
    const seen = new Set<string>();
    const out: CartItem[] = [];
    for (const c of [...earlier].sort((a, b) => b.savedAt - a.savedAt)) for (const it of c.items) {
      if (seen.has(it.productId)) continue;
      seen.add(it.productId); out.push(it);
    }
    return out.slice(0, 8);
  }, [earlier]);
  const shopCount = new Set(cart.items.filter((i) => i.selected).map((i) => i.storeId)).size;

  // ---- nav ------------------------------------------------------------------
  const sendLabel = `${parsed.length} item${parsed.length === 1 ? "" : "s"}${pricedCount ? ` · ≈ ${ugx(estimate)}` : ""} + delivery`;
  const navAction = listOpen
    ? null
    : parsed.length > 0
      ? { tone: "step" as const, label: "Send to shopper", sublabel: sendLabel, onClick: () => setListOpen(true) }
      : cart.totalQuantity > 0
        ? {
            tone: "gold" as const, label: "Checkout", detail: ugx(cart.total),
            sublabel: `${cart.selectedCount} item${cart.selectedCount === 1 ? "" : "s"}${shopCount > 1 ? ` · ${shopCount} shops · one rider` : ""}`,
            onClick: () => router.push("/cart"),
          }
        : null;
  useRegisterNavPrimaryAction(navAction);
  // Inside the list flow the nav's Home becomes Back to the Buy home.
  useRegisterNavBack(listOpen, () => setListOpen(false));

  const firstName = user?.name?.trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const chips = showAllChips ? priced : priced.slice(0, 4);
  const productsLoaded = productLoadKey === `${lat ?? ""}:${lng ?? ""}`;
  const nothingLoaded = loaded && productsLoaded && !stores.length && !spots.length;
  const dealTitle = activeCategory !== "All" ? activeCategory : deals.some((d) => d.pr.discount > 0) ? "Deals today" : "Popular deals";
  const previewSpots = spots.slice(0, 3);

  return (
    <div ref={rootRef} className="buy-home customer-nav-content-clearance mx-auto max-w-lg">
      <p ref={statusRef} className="sr-only" role="status" />
      <div className="buy-pull" aria-hidden="true">
        <div className="buy-pull__card">
          <p className="buy-pull__top"><Flame className="h-4 w-4" aria-hidden />Spotlight</p>
          <p className="buy-pull__label"><span className="is-rest">Pull down to open the feed</span><span className="is-ready">Release to open Spotlight</span></p>
          {previewSpots.length > 0 && (
            <div className="buy-pull__clips">
              {previewSpots.map((sp) => {
                const img = spotImg(sp);
                return <span key={sp.id} className="buy-pull__clip">{img ? <img src={img} alt="" /> : <Store className="h-5 w-5" aria-hidden />}</span>;
              })}
            </div>
          )}
        </div>
      </div>
      <Link href="/spotlight" className="buy-pull-hint">
        <ChevronDown className="h-4 w-4" aria-hidden />
        <span>Pull down for Spotlight</span>
      </Link>

      <div className="buy-loc">
        <p className="buy-pill"><MapPin className="h-4 w-4 shrink-0 buy-gold" aria-hidden /><span className="truncate">{placeLabel ?? "Your location"}</span></p>
        <Link href="/cart" className="buy-iconbtn" aria-label={`Bag, ${cart.totalQuantity} item${cart.totalQuantity === 1 ? "" : "s"}`}>
          <ShoppingBag className="h-[19px] w-[19px]" aria-hidden />
          {cart.totalQuantity > 0 && <span className="buy-badge">{cart.totalQuantity}</span>}
        </Link>
      </div>

      <section
        className="buy-composer"
        aria-label="Shopping list"
        onFocus={() => setComposerOpen(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setComposerOpen(false); }}
      >
        <div className={`field-box buy-search${composerActive ? " is-open" : ""}`}>
          <Search className="buy-search__icon h-[18px] w-[18px]" aria-hidden />
          <label className="sr-only" htmlFor="buy-list">Your shopping list</label>
          <textarea
            id="buy-list" rows={composerActive ? 2 : 1} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={composerActive ? "2kg tomatoes, tray of eggs, 1L milk…" : "Search or type a list…"}
            className="buy-text"
          />
          <button type="button" className="buy-search__btn" aria-pressed={composerMode === "snap"} aria-label="Snap a photo of your list" onClick={() => { setComposerMode("snap"); setComposerOpen(true); fileRef.current?.click(); }}>
            <Camera className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button type="button" className="buy-search__btn" aria-pressed={listening || composerMode === "speak"} aria-label={listening ? "Stop listening" : "Speak your list"} onClick={() => void startSpeak()}>
            {listening ? <Square className="h-4 w-4 fill-current" aria-hidden /> : <Mic className="h-[18px] w-[18px]" aria-hidden />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onSnap(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {composerActive && (
          <div className="buy-tools">
            <div className="buy-tools__top">
              <div className="buy-modes" role="group" aria-label="How to add your list">
                <button type="button" aria-pressed={composerMode === "type"} onClick={() => setComposerMode("type")}><List className="h-3.5 w-3.5" aria-hidden />Type</button>
                <button type="button" aria-pressed={composerMode === "speak"} onClick={() => void startSpeak()}>
                  {listening ? <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}{listening ? "Stop" : "Speak"}
                </button>
                <button type="button" aria-pressed={composerMode === "snap"} onClick={() => { setComposerMode("snap"); fileRef.current?.click(); }}><Camera className="h-3.5 w-3.5" aria-hidden />Snap</button>
              </div>
              <span className="buy-trust"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Escrow</span>
            </div>
            {listening && <p className="buy-listening" role="status"><span aria-hidden />Listening… say your items</p>}
            {hint && <p className="text-[13px] font-semibold text-ink-500" role="status">{hint}</p>}
            {parsed.length > 0 && (
              <div className="buy-chips" aria-label="Items found">
                {chips.map(({ it }, i) => (
                  <span key={`${it.name}-${i}`} className="buy-item">
                    {it.name} <b className={it.unitGuessed ? "is-guess" : ""}>{unitLabel(it)}{it.unitGuessed ? "?" : ""}</b>
                    <button type="button" aria-label={`Remove ${it.name}`} onClick={() => setText(removePhrase(text, i, unitSettings))}><X className="h-3.5 w-3.5" aria-hidden /></button>
                  </span>
                ))}
                {!showAllChips && parsed.length > 4 && <button type="button" className="buy-more" onClick={() => setShowAllChips(true)}>+{parsed.length - 4} more</button>}
              </div>
            )}
            <div className="buy-est">
              {capEditing ? (
                <form className="buy-capform" onSubmit={(e) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get("cap")); saveCap(v > 0 ? v : null); setCapEditing(false); }}>
                  <span className="field-box buy-capfield"><span>UGX</span><input name="cap" inputMode="numeric" autoFocus defaultValue={cap ?? ""} aria-label="Budget cap in UGX" /></span>
                  <button type="submit">Save</button>
                </form>
              ) : (
                <button type="button" className="buy-budget" onClick={() => setCapEditing(true)}>{cap ? `Budget cap ${ugx(cap)}` : "+ Set a budget cap"}</button>
              )}
              {pricedCount > 0 ? <span className="text-[13px] font-semibold text-ink-500">≈ <b>{ugx(estimate)}</b></span> : parsed.length > 0 ? <span className="text-[13px] font-semibold text-ink-500">Shopper confirms prices</span> : null}
            </div>
            {cap && pricedCount > 0 && (
              <div className="buy-cap" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={estimate} aria-label="Estimate against budget cap">
                <i style={{ width: `${Math.min(100, (estimate / cap) * 100)}%` }} className={estimate > cap ? "is-over" : ""} />
              </div>
            )}
          </div>
        )}
      </section>

      <h1 className="buy-hello">Hi{firstName ? `, ${firstName}` : ""}!</h1>
      <p className="buy-hello__sub">{greet}. What do you need today?</p>

      {!loaded && <div className="buy-skel" aria-hidden="true"><i /><i /></div>}

      {categories.length > 0 && (
        <div className="buy-cats" role="tablist" aria-label="Categories">
          {["All", ...categories].map((name) => (
            <button key={name} type="button" role="tab" className="buy-cat" aria-selected={activeCategory === name} onClick={() => setCategory(name)}>{name}</button>
          ))}
        </div>
      )}

      {slides.length > 0 && <HeroCarousel key={slides.map((s) => s.id).join("|")} slides={slides} imageFor={spotImg} onAdd={(sp) => addSpotlightItemToCart(sp, (id) => api.getMarketplaceProduct(id))} />}

      <Link href="/spotlight" className="buy-quick"><Flame className="h-[18px] w-[18px]" aria-hidden />Spotlight</Link>

      {active && (
        <Link href={`/orders/${active.id}`} className="buy-card buy-order" aria-label="Your shopping order">
          <span className="buy-avatar">{(active.rider_name ?? "P").charAt(0)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{active.rider_name ? `${active.rider_name.split(" ")[0]} · ${shoppingStageLabel(active.stage)}` : shoppingStageLabel(active.stage)}</span>
            <span className="block truncate text-[12.5px] font-semibold text-ink-500">{active.store_name ?? active.destination_area ?? "Your list"}{active.eta_minutes ? ` · about ${active.eta_minutes} min` : ""}</span>
          </span>
          <span className="buy-swap"><ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />Track</span>
        </Link>
      )}

      {rings.length > 0 && (
        <>
          <SectionHead title="Live now" href="/spotlight" />
          <div className="buy-scroll" role="list">
            {rings.map((r) => (
              <Link key={r.id} href={r.href} role="listitem" className="buy-ring" aria-label={`${r.name}${r.live ? ", live now" : ""}`}>
                <span className={`buy-ring__o ${r.live ? "is-live" : ""}`}>
                  {r.logo ? <img src={r.logo} alt="" /> : <Store className="h-6 w-6" aria-hidden />}
                  {r.live && <span className="buy-live buy-ring__tag">LIVE{r.viewers ? ` ${r.viewers}` : ""}</span>}
                </span>
                <span className="buy-ring__name">{r.name.split(" ")[0]}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {(deals.length > 0 || (activeCategory !== "All" && productsLoaded)) && (
        <>
          <SectionHead title={dealTitle} href="/groceries" />
          {deals.length === 0 ? (
            <p className="buy-note">Nothing in {activeCategory} from nearby shops right now.</p>
          ) : (
            <div className="buy-deals">
              {deals.map(({ p, pr }) => {
                const tag = pr.discount > 0 ? "DEAL" : p.badge?.trim() || null;
                return (
                  <article key={p.id} className="buy-card buy-product">
                    <Link href={`/product/${p.id}`} className="buy-thumb" aria-label={`View ${p.title}`}>
                      {p.image_url && <img src={p.image_url} alt="" loading="lazy" />}
                      {tag && <span className="buy-deal">{tag}</span>}
                    </Link>
                    <div className="buy-product__row">
                      <Link href={`/product/${p.id}`} className="min-w-0 flex-1">
                        <p className="buy-product__title">{p.title}</p>
                        <p className="buy-product__price">
                          <span className="buy-product__amt">{pr.from && <span className="buy-product__from">from </span>}{ugx(pr.price)}</span>
                          {pr.compareAt != null && <s>{pr.compareAt.toLocaleString("en-UG")}</s>}
                        </p>
                        {p.inventory_quantity != null && p.inventory_quantity > 0 && p.inventory_quantity <= 10 && <p className="buy-product__low">Only {p.inventory_quantity} left</p>}
                      </Link>
                      <AddButton label={`Add ${p.title}`} onAdd={() => {
                        const v = p.variants?.[0];
                        addToCart({ productId: p.id, storeId: p.store_id, storeName: p.store_name, storeSlug: p.store_slug, title: p.title, variantId: v?.id, variantTitle: v?.title, price: v ? Number(v.price) : p.price, compareAtPrice: (v ? v.compare_at_price : p.compare_at_price) ?? undefined, imageUrl: p.image_url ?? undefined, category: p.store_category });
                      }} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {loaded && !productsLoaded && stores.length > 0 && <div className="buy-skel buy-skel--row" aria-hidden="true"><i /><i /></div>}

      {stores.length > 0 && (
        <>
          <SectionHead title="Open near you" href="/stores" />
          <div className="buy-near-list">
            {stores.slice(0, 3).map((s) => {
              const banner = s.banner_url?.startsWith("/") ? s.banner_url : products.find((p) => p.store_id === s.id && p.image_url?.startsWith("/"))?.image_url ?? s.banner_url;
              const open = truthy(s.is_open ?? 1);
              const service = [truthy(s.delivery_enabled ?? 1) ? "Delivery" : null, truthy(s.pickup_enabled) ? "Pickup" : null, "Escrow"].filter(Boolean).join(" · ");
              return (
                <Link key={s.id} href={`/store/${s.id}`} className="buy-card buy-near">
                  <span className="buy-near__img">{banner ? <img src={banner} alt="" loading="lazy" /> : <Store className="h-6 w-6" aria-hidden />}</span>
                  <span className="buy-near__body">
                    <b>{s.name}</b>
                    <span className="buy-near__meta">
                      <span className={open ? "is-open" : "is-closed"}>{open ? "Open" : "Closed"}</span>
                      {s.distance_km != null && <span> · {formatDistanceKm(s.distance_km)}</span>}
                      {s.min_order_amount ? <span className="buy-near__min"> · Min {ugx(s.min_order_amount)}</span> : null}
                    </span>
                    <span className="buy-near__sub">{service}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {buyAgain.length > 0 && (
        <>
          <SectionHead title="Buy again" href="/cart" />
          <div className="buy-scroll" role="list">
            {buyAgain.map((it) => (
              <div key={it.id} role="listitem" className="buy-again">
                <div className="buy-thumb buy-again__img">
                  {it.imageUrl && <img src={it.imageUrl} alt="" loading="lazy" />}
                  <AddButton small label={`Add ${it.title} again`} onAdd={() => addToCart({ ...it, quantity: 1 })} />
                </div>
                <p className="buy-again__name">{it.title}</p>
                <p className="buy-again__price">{ugx(it.price)}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {reels.length > 0 && (
        <>
          <SectionHead title="Reels, replays & picks" href="/spotlight" />
          <div className="buy-scroll" role="list">
            {reels.map((r) => (
              <Link key={r.id} href="/spotlight" role="listitem" className="buy-reel" aria-label={`${r.title} from ${r.store_name}`}>
                {spotImg(r) && <img src={spotImg(r)!} alt="" loading="lazy" />}
                {r.type === "video" ? <span className="buy-reel__play"><Play className="h-3 w-3 fill-current" aria-hidden /></span> : <span className="buy-reel__price">{ugx(r.product.price)}</span>}
                <span className="buy-reel__t"><b>{r.product.title}</b><small>{r.store_name}</small></span>
              </Link>
            ))}
          </div>
        </>
      )}

      {nothingLoaded && (
        <section className="buy-card buy-empty">
          <Store className="mx-auto h-6 w-6 buy-gold" aria-hidden />
          <p className="mt-2 text-[15px] font-bold">Shops will show here soon</p>
          <p className="mt-1 text-[13px] font-semibold text-ink-500">You can still send a shopper with your list above, or browse groceries and stores.</p>
          <div className="buy-empty-links"><Link href="/groceries">Groceries</Link><Link href="/stores">Stores</Link></div>
        </section>
      )}

      <SectionHead title="Pharmacy" href="/pharmacy" />
      <div className="rx-page">
        <Link href="/pharmacy" className="rx-hero flex w-full items-center gap-4 rounded-[26px] p-4 text-left">
          <span className="rx-hero-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"><FileText className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">Send a prescription</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">A pharmacist quotes first. You only pay if you accept.</span>
          </span>
          <span className="rx-hero-go flex h-11 w-11 shrink-0 items-center justify-center rounded-full"><Pill className="h-4 w-4" aria-hidden /></span>
        </Link>
      </div>
      <p className="buy-trustline"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />Shops are paid only after you receive your order</p>

      {listOpen && <ShoppingListModal initialItems={toModalItems()} onClose={() => setListOpen(false)} />}
      {!loaded && <p className="sr-only" role="status">Loading shops</p>}
    </div>
  );
}

function HeroCarousel({ slides, imageFor, onAdd }: { slides: Spot[]; imageFor: (sp: Spot) => string | null; onAdd: (sp: Spot) => Promise<unknown> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function onScroll() {
    const el = scroller.current;
    if (!el || el.clientWidth <= 0) return;
    const next = Math.min(slides.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
    setIndex((i) => (i === next ? i : next));
  }
  function go(i: number) {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    go(e.key === "ArrowRight" ? Math.min(slides.length - 1, index + 1) : Math.max(0, index - 1));
  }

  return (
    <section className="buy-hero" aria-roledescription="carousel" aria-label="Featured from nearby shops">
      <div ref={scroller} className="buy-hero__track" onScroll={onScroll} onKeyDown={onKey} tabIndex={0}>
        {slides.map((sp, i) => {
          const copy = heroText(sp);
          const img = imageFor(sp);
          const price = sp.product?.price > 0 ? ugx(sp.product.price) : null;
          const productLine = sp.product?.title && sp.product.title !== copy.title ? `${sp.product.title}${price ? ` · ${price}` : ""}` : price;
          return (
            <article key={sp.id} className="buy-hero__slide" aria-label={copy.title}>
              <div className="buy-hero__copy">
                <p className="buy-hero__title">{copy.title}</p>
                {copy.sub && <p className="buy-hero__sub">{copy.sub}</p>}
                {productLine && <p className="buy-hero__price">{productLine}</p>}
                <Link href="/spotlight" className="buy-shop">Shop now</Link>
              </div>
              <div className="buy-hero__media">
                <Link href="/spotlight" className="buy-hero__photo" tabIndex={-1} aria-label={`Watch ${sp.store_name} on Spotlight`}>
                  {img && <img src={img} alt="" loading={i === 0 ? "eager" : "lazy"} />}
                </Link>
                {sp.product?.id && <AddButton label={`Add ${sp.product.title}`} className="buy-hero__add" onAdd={() => onAdd(sp)} />}
              </div>
            </article>
          );
        })}
      </div>
      {slides.length > 1 && (
        <div className="buy-dots">
          {slides.map((sp, i) => (
            <button key={sp.id} type="button" className="buy-dot" aria-label={`Show ${sp.store_name}`} aria-current={i === index ? "true" : undefined} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </section>
  );
}

function heroText(sp: Spot): { title: string; sub: string } {
  const live = sp.type === "live";
  const title = sp.title?.trim() || (live ? `Live from ${sp.store_name}` : sp.product.title);
  const bits = [live ? "Featured live" : null, sp.store_name, sp.viewer_count ? `${sp.viewer_count} watching` : null].filter(Boolean);
  return { title, sub: bits.join(" · ") };
}

function removePhrase(text: string, index: number, settings: ShoppingUnitSettings): string {
  const parts = text.split(/[,\n;]+|\s+and\s+|\s+na\s+/i).filter((p) => parseListText(p, settings).length > 0);
  return parts.filter((_, i) => i !== index).map((p) => p.trim()).join(", ");
}

function SectionHead({ title, href }: { title: string; href: string }) {
  return (
    <div className="buy-section">
      <h2>{title}</h2>
      <Link href={href}>See all<ChevronRight className="h-4 w-4" aria-hidden /></Link>
    </div>
  );
}

function AddButton({ label, onAdd, small, className = "" }: { label: string; onAdd: () => unknown; small?: boolean; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button
      type="button" aria-label={label} disabled={state === "busy"}
      onClick={async (e) => { e.preventDefault(); e.stopPropagation(); setState("busy"); try { await onAdd(); setState("done"); window.setTimeout(() => setState("idle"), 1200); } catch { setState("idle"); } }}
      className={`buy-add ${small ? "is-small" : ""} ${state === "done" ? "is-done" : ""} ${className}`}
    >
      {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-5 w-5" strokeWidth={2.6} aria-hidden />}
    </button>
  );
}
