"use client";

import { DEFAULT_SHOPPING_UNIT_SETTINGS, type OrderRow, type ShoppingUnitSettings } from "@peebee/shared";
import {
  ArrowLeftRight, Camera, ChevronRight, Eye, FileText, List, Loader2, MapPin, Mic, Pill, Play, Plus, ShieldCheck, ShoppingBag, Square, Store, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { matchPrice, parseListText, shoppingStageLabel, unitLabel } from "../../lib/buy-home";
import { addToCart, useCart, useEarlierCarts, type CartItem } from "../../lib/cart";
import { formatDistanceKm, haversineKm, useCustomerLocation } from "../../lib/location";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
import { productPricing, type MarketVariant } from "../../lib/product-pricing";
import { addSpotlightItemToCart } from "../../lib/spotlight-cart";
import { useLocationLabel } from "../../lib/use-location-label";
import { ShoppingListModal } from "../home/ShoppingListModal";
import { ShoppingExtras } from "../shopping/ShoppingExtras";
import type { Item } from "../home/ListItemLine";

type MStore = {
  id: string; name: string; slug?: string; category?: string; logo_url?: string | null; banner_url?: string | null;
  lat?: number | null; lng?: number | null; distance_km?: number | null; is_open?: number | boolean; is_live?: number | boolean;
  live_viewer_count?: number; min_order_amount?: number | null; delivery_enabled?: number | boolean; pickup_enabled?: number | boolean;
};
type MProduct = {
  id: string; store_id: string; store_name?: string; store_slug?: string; store_category?: string; title: string; price: number;
  compare_at_price?: number | null; image_url?: string | null; inventory_quantity?: number | null; variants?: MarketVariant[] | null;
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
  const [unitSettings, setUnitSettings] = useState<ShoppingUnitSettings>(DEFAULT_SHOPPING_UNIT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
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
      const lists = await Promise.all(
        all.slice(0, 3).map((st) =>
          api.getMarketplaceStoreProducts(st.id)
            .then((r) => (r.products ?? []).map((p: MProduct) => ({ ...p, store_id: st.id, store_name: st.name, store_slug: st.slug, store_category: st.category, price: Number(p.price) || 0 })))
            .catch(() => [] as MProduct[]),
        ),
      );
      if (!cancelled) setProducts(lists.flat());
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
  const recRef = useRef<{ stop(): void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const v = Number(window.localStorage.getItem("peebee_buy_cap"));
    if (v > 0) setCap(v);
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

  function appendText(t: string) {
    const clean = t.trim();
    if (!clean) return;
    setText((prev) => (prev.trim() ? `${prev.trim().replace(/,$/, "")}, ${clean}` : clean));
  }

  async function startSpeak() {
    setComposerMode("speak");
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
  const liveSpot = spots.find((s) => s.type === "live") ?? null;
  const reels = spots.filter((s) => s !== liveSpot).slice(0, 8);
  const rings = useMemo(() => {
    const list = stores.map((s) => ({ id: s.id, name: s.name, logo: s.logo_url, live: truthy(s.is_live), viewers: s.live_viewer_count, href: `/store/${s.id}` }));
    if (!list.length) {
      const seen = new Set<string>();
      for (const s of spots) if (!seen.has(s.store_id)) { seen.add(s.store_id); list.push({ id: s.store_id, name: s.store_name, logo: s.store_logo ?? null, live: s.type === "live", viewers: s.viewer_count, href: `/store/${s.store_id}` }); }
    }
    return list.sort((a, b) => Number(b.live) - Number(a.live)).slice(0, 10);
  }, [stores, spots]);
  const deals = useMemo(() => {
    const rows = products.map((p) => ({ p, pr: productPricing(p) }));
    const disc = rows.filter((r) => r.pr.discount > 0).sort((a, b) => b.pr.discount - a.pr.discount);
    const rest = rows.filter((r) => r.pr.discount === 0);
    return [...disc, ...rest].slice(0, 4);
  }, [products]);
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
  const nothingLoaded = loaded && !stores.length && !spots.length;

  return (
    <div className="buy-home customer-nav-content-clearance mx-auto max-w-lg px-4 pb-6 pt-3">
      {/* location + bag */}
      <div className="flex items-center justify-between gap-2">
        <p className="buy-pill min-w-0"><MapPin className="h-4 w-4 shrink-0 buy-gold" aria-hidden /><span className="truncate">{placeLabel ?? "Your location"}</span></p>
        <Link href="/cart" className="buy-iconbtn relative" aria-label={`Bag, ${cart.totalQuantity} item${cart.totalQuantity === 1 ? "" : "s"}`}>
          <ShoppingBag className="h-[19px] w-[19px]" aria-hidden />
          {cart.totalQuantity > 0 && <span className="buy-badge">{cart.totalQuantity}</span>}
        </Link>
      </div>

      <h1 className="mt-4 text-[23px] font-extrabold leading-tight tracking-tight">
        <span className="block text-[13px] font-semibold tracking-normal text-ink-500">{greet}{firstName ? `, ${firstName}` : ""}</span>
        What do you need today?
      </h1>
      <ShoppingExtras />

      {/* composer */}
      <section className="buy-card mt-3 p-3.5" aria-label="Shopping list">
        <div className="flex items-center justify-between gap-2">
          <div className="buy-modes" role="group" aria-label="How to add your list">
            <button type="button" aria-pressed={composerMode === "type"} onClick={() => setComposerMode("type")}><List className="h-3.5 w-3.5" aria-hidden />Type</button>
            <button type="button" aria-pressed={composerMode === "speak"} onClick={startSpeak}>
              {listening ? <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}{listening ? "Stop" : "Speak"}
            </button>
            <button type="button" aria-pressed={composerMode === "snap"} onClick={() => { setComposerMode("snap"); fileRef.current?.click(); }}><Camera className="h-3.5 w-3.5" aria-hidden />Snap</button>
          </div>
          <span className="buy-trust"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Escrow</span>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onSnap(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <label className="sr-only" htmlFor="buy-list">Your shopping list</label>
        <textarea
          id="buy-list" rows={2} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="2kg tomatoes, tray of eggs, 1L milk…"
          className="buy-text mt-2.5 w-full resize-none bg-transparent text-[15px] leading-snug outline-none"
        />
        {listening && <p className="buy-listening" role="status"><span aria-hidden />Listening… say your items</p>}
        {hint && <p className="mt-1 text-[12px] font-semibold text-ink-500" role="status">{hint}</p>}
        {parsed.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Items found">
            {chips.map(({ it }, i) => (
              <span key={`${it.name}-${i}`} className="buy-item">
                {it.name} <b className={it.unitGuessed ? "is-guess" : ""}>{unitLabel(it)}{it.unitGuessed ? "?" : ""}</b>
                <button type="button" aria-label={`Remove ${it.name}`} onClick={() => setText(removePhrase(text, i, unitSettings))}><X className="h-3 w-3" aria-hidden /></button>
              </span>
            ))}
            {!showAllChips && parsed.length > 4 && <button type="button" className="buy-more" onClick={() => setShowAllChips(true)}>+{parsed.length - 4} more</button>}
          </div>
        )}
        <div className="buy-est mt-3 flex items-center justify-between gap-2 pt-2.5">
          {capEditing ? (
            <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get("cap")); saveCap(v > 0 ? v : null); setCapEditing(false); }}>
              <span className="text-[12px] font-semibold text-ink-500">UGX</span>
              <input name="cap" inputMode="numeric" autoFocus defaultValue={cap ?? ""} aria-label="Budget cap in UGX" className="buy-capinput w-24" />
              <button className="text-[12px] font-bold buy-gold" type="submit">Save</button>
            </form>
          ) : (
            <button type="button" className="text-[12px] font-semibold text-ink-500" onClick={() => setCapEditing(true)}>{cap ? `Budget cap ${ugx(cap)}` : "+ Set a budget cap"}</button>
          )}
          {pricedCount > 0 ? <span className="text-[12px] font-semibold text-ink-500">≈ <b className="text-[15px] text-ink">{ugx(estimate)}</b></span> : parsed.length > 0 ? <span className="text-[12px] font-semibold text-ink-500">Shopper confirms prices</span> : null}
        </div>
        {cap && pricedCount > 0 && (
          <div className="buy-cap" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={estimate} aria-label="Estimate against budget cap">
            <i style={{ width: `${Math.min(100, (estimate / cap) * 100)}%` }} className={estimate > cap ? "is-over" : ""} />
          </div>
        )}
      </section>

      {/* active order */}
      {active && (
        <Link href={`/orders/${active.id}`} className="buy-card mt-3 flex items-center gap-3 p-3" aria-label="Your shopping order">
          <span className="buy-avatar">{(active.rider_name ?? "P").charAt(0)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold">{active.rider_name ? `${active.rider_name.split(" ")[0]} · ${shoppingStageLabel(active.stage)}` : shoppingStageLabel(active.stage)}</span>
            <span className="block truncate text-[11.5px] font-semibold text-ink-500">{active.store_name ?? active.destination_area ?? "Your list"}{active.eta_minutes ? ` · about ${active.eta_minutes} min` : ""}</span>
          </span>
          <span className="buy-swap"><ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />Track</span>
        </Link>
      )}

      {/* live rings + featured live */}
      {(rings.length > 0 || liveSpot) && (
        <>
          <SectionHead title="Live now" href="/spotlight" />
          {rings.length > 0 && (
            <div className="buy-scroll flex gap-3" role="list">
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
          )}
          {liveSpot && (
            <section className="buy-stage mt-3.5" aria-label={`Live from ${liveSpot.store_name}`}>
              <Link href="/spotlight" className="absolute inset-0" aria-label={`Watch ${liveSpot.store_name} live`}>
                {spotImg(liveSpot) && <img src={spotImg(liveSpot)!} alt="" className="buy-stage__img" />}
              </Link>
              <div className="buy-stage__top">
                <span className="min-w-0"><b className="block truncate">{liveSpot.store_name}</b><small className="block truncate">{liveSpot.title}</small></span>
                <span className="flex shrink-0 items-center gap-1.5"><span className="buy-live">LIVE</span>{liveSpot.viewer_count ? <span className="buy-glass"><Eye className="h-3 w-3" aria-hidden />{liveSpot.viewer_count}</span> : null}</span>
              </div>
              <div className="buy-pin">
                {spotImg(liveSpot) && <img src={spotImg(liveSpot)!} alt="" />}
                <span className="min-w-0 flex-1"><b className="block truncate">{liveSpot.product.title}</b>
                  <small>{ugx(liveSpot.product.price)}{liveSpot.product.compare_at_price && liveSpot.product.compare_at_price > liveSpot.product.price ? <s> {liveSpot.product.compare_at_price.toLocaleString("en-UG")}</s> : null}</small></span>
                <AddButton label={`Add ${liveSpot.product.title}`} text="Add" onAdd={async () => addToCart(await addSpotlightItemToCart(liveSpot, (id) => api.getMarketplaceProduct(id)))} />
              </div>
            </section>
          )}
        </>
      )}

      {/* buy again */}
      {buyAgain.length > 0 && (
        <>
          <SectionHead title="Buy again" href="/cart" />
          <div className="buy-scroll flex gap-2.5" role="list">
            {buyAgain.map((it) => (
              <div key={it.id} role="listitem" className="w-[84px] shrink-0">
                <div className="buy-thumb relative h-[72px]">
                  {it.imageUrl && <img src={it.imageUrl} alt="" />}
                  <AddButton small label={`Add ${it.title} again`} onAdd={() => addToCart({ ...it, quantity: 1 })} />
                </div>
                <p className="mt-1 truncate text-[11.5px] font-semibold">{it.title}</p>
                <p className="text-[11px] font-semibold text-ink-500">{ugx(it.price)}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* stores */}
      {stores.length > 0 && (
        <>
          <SectionHead title="Open near you" href="/stores" />
          <div className="buy-scroll flex gap-2.5" role="list">
            {stores.slice(0, 8).map((s) => (
              <Link key={s.id} href={`/store/${s.id}`} role="listitem" className="buy-card buy-store">
                <span className="buy-store__ban">
                  {(() => { const b = s.banner_url?.startsWith("/") ? s.banner_url : products.find((p) => p.store_id === s.id && p.image_url?.startsWith("/"))?.image_url ?? s.banner_url; return b ? <img src={b} alt="" /> : null; })()}
                  <span className={`buy-open ${truthy(s.is_open ?? 1) ? "" : "is-closed"}`}>{truthy(s.is_open ?? 1) ? "Open" : "Closed"}</span>
                  {s.logo_url && <img src={s.logo_url} alt="" className="buy-store__logo" />}
                </span>
                <span className="block px-3 pb-3 pt-5">
                  <b className="block truncate text-[14.5px]">{s.name}</b>
                  <span className="mt-0.5 flex gap-2 text-[11.5px] font-semibold text-ink-500">
                    {s.distance_km != null && <span className="text-ink">{formatDistanceKm(s.distance_km)}</span>}
                    {s.min_order_amount ? <span>Min {ugx(s.min_order_amount)}</span> : null}
                  </span>
                  <span className="mt-2 flex gap-1">
                    {truthy(s.delivery_enabled ?? 1) && <span className="buy-tag">Delivery</span>}
                    {truthy(s.pickup_enabled) && <span className="buy-tag">Pickup</span>}
                    <span className="buy-tag"><ShieldCheck className="h-3 w-3" aria-hidden />Escrow</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* deals */}
      {deals.length > 0 && (
        <>
          <SectionHead title={deals.some((d) => d.pr.discount) ? "Deals today" : "Popular now"} href="/groceries" />
          <div className="grid grid-cols-2 gap-2.5">
            {deals.map(({ p, pr }) => (
              <div key={p.id} className="buy-card buy-product">
                <Link href={`/product/${p.id}`} className="buy-thumb relative block h-[112px]">
                  {p.image_url && <img src={p.image_url} alt="" />}
                  {pr.discount > 0 && <span className="buy-off">−{pr.discount}%</span>}
                </Link>
                <AddButton label={`Add ${p.title}`} onAdd={() => {
                  const v = p.variants?.[0];
                  addToCart({ productId: p.id, storeId: p.store_id, storeName: p.store_name, storeSlug: p.store_slug, title: p.title, variantId: v?.id, variantTitle: v?.title, price: v ? Number(v.price) : p.price, compareAtPrice: (v ? v.compare_at_price : p.compare_at_price) ?? undefined, imageUrl: p.image_url ?? undefined, category: p.store_category });
                }} className="buy-product__add" />
                <Link href={`/product/${p.id}`} className="block px-1 pb-1">
                  <p className="mt-2 truncate text-[12.5px] font-semibold">{p.title}</p>
                  <p className="text-[13.5px] font-extrabold tabular-nums">{pr.from && <span className="mr-1 text-[11px] font-semibold text-ink-500">from</span>}{ugx(pr.price)}{pr.compareAt && <s className="ml-1 text-[11.5px] font-medium text-ink-500">{pr.compareAt.toLocaleString("en-UG")}</s>}</p>
                  {p.inventory_quantity != null && p.inventory_quantity > 0 && p.inventory_quantity <= 10 && <p className="text-[10.5px] font-bold text-[#C2410C]">Only {p.inventory_quantity} left</p>}
                </Link>
              </div>
            ))}
          </div>
        </>
      )}

      {/* reels */}
      {reels.length > 0 && (
        <>
          <SectionHead title="Reels, replays & picks" href="/spotlight" />
          <div className="buy-scroll flex gap-2" role="list">
            {reels.map((r) => (
              <Link key={r.id} href="/spotlight" role="listitem" className="buy-reel" aria-label={`${r.title} from ${r.store_name}`}>
                {spotImg(r) && <img src={spotImg(r)!} alt="" />}
                {r.type === "video" ? <span className="buy-reel__play"><Play className="h-2.5 w-2.5 fill-current" aria-hidden /></span> : <span className="buy-reel__price">{ugx(r.product.price)}</span>}
                <span className="buy-reel__t"><b>{r.product.title}</b><small>{r.store_name}</small></span>
              </Link>
            ))}
          </div>
        </>
      )}

      {nothingLoaded && (
        <section className="buy-card mt-6 p-4 text-center">
          <Store className="mx-auto h-6 w-6 buy-gold" aria-hidden />
          <p className="mt-2 text-[14px] font-bold">Shops will show here soon</p>
          <p className="mt-1 text-[12.5px] text-ink-500">You can still send a shopper with your list above, or browse groceries and stores.</p>
          <div className="mt-3 flex justify-center gap-2"><Link className="buy-tag" href="/groceries">Groceries</Link><Link className="buy-tag" href="/stores">Stores</Link></div>
        </section>
      )}

      {/* pharmacy, in the pharmacy's own look */}
      <SectionHead title="Pharmacy" href="/pharmacy" />
      <div className="rx-page">
        <Link href="/pharmacy" className="rx-hero flex w-full items-center gap-4 rounded-[26px] p-4 text-left">
          <span className="rx-hero-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"><FileText className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">Send a prescription</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">A pharmacist quotes first. You only pay if you accept.</span>
          </span>
          <span className="rx-hero-go flex h-9 w-9 shrink-0 items-center justify-center rounded-full"><Pill className="h-4 w-4" aria-hidden /></span>
        </Link>
      </div>
      <p className="mt-6 text-center text-[11.5px] font-semibold text-ink-500"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-green" aria-hidden />Shops are paid only after you receive your order</p>

      {listOpen && <ShoppingListModal initialItems={toModalItems()} onClose={() => setListOpen(false)} />}
      {!loaded && <p className="sr-only" role="status"><Loader2 aria-hidden />Loading shops</p>}
    </div>
  );
}

function removePhrase(text: string, index: number, settings: ShoppingUnitSettings): string {
  const parts = text.split(/[,\n;]+|\s+and\s+|\s+na\s+/i).filter((p) => parseListText(p, settings).length > 0);
  return parts.filter((_, i) => i !== index).map((p) => p.trim()).join(", ");
}

function SectionHead({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-2.5 mt-7 flex items-baseline justify-between">
      <h2 className="text-[15.5px] font-bold tracking-tight">{title}</h2>
      <Link href={href} className="flex items-center text-[12.5px] font-semibold text-ink-500">See all<ChevronRight className="h-3.5 w-3.5" aria-hidden /></Link>
    </div>
  );
}

function AddButton({ label, onAdd, small, text, className = "" }: { label: string; onAdd: () => unknown; small?: boolean; text?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button
      type="button" aria-label={label} disabled={state === "busy"}
      onClick={async (e) => { e.preventDefault(); e.stopPropagation(); setState("busy"); try { await onAdd(); setState("done"); window.setTimeout(() => setState("idle"), 1200); } catch { setState("idle"); } }}
      className={`buy-add ${small ? "is-small" : ""} ${text ? "has-text" : ""} ${state === "done" ? "is-done" : ""} ${className}`}
    >
      {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={2.6} aria-hidden />}
      {text && <span>{state === "done" ? "Added" : text}</span>}
    </button>
  );
}

