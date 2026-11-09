"use client";

import type { PharmacyPrescription } from "@peebee/shared";
import { ChevronRight, FileText, HeartPulse, MapPin, Pill, Plus, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ProductImage } from "../../components/ProductImage";
import { RxSheet } from "../../components/pharmacy/RxSheet";
import { api } from "../../lib/api";
import { addToCart, useCart } from "../../lib/cart";
import { formatDistanceKm, useCustomerLocation } from "../../lib/location";

interface PharmacyStore {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  address?: string | null;
  distance_km?: number | null;
  supervising_pharmacist?: string;
  is_nda_verified?: boolean;
}

interface Medicine {
  id: string;
  store_id: string;
  store_name?: string;
  title: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  image_url: string | null;
  category_name?: string | null;
  rx_required?: boolean;
  dosage_form?: string;
  pack_size?: string;
  active_ingredient?: string;
}

/** Preferred order for the category chips; only categories that have stock are shown. */
const CATEGORY_ORDER = ["Pain & Fever", "Cold & Allergy", "Vitamins & Wellness", "First Aid", "Digestion & Stomach", "Mother & Baby"];

const ugx = (amount: number) => `UGX ${Math.round(amount).toLocaleString("en-UG")}`;

const RX_STATUS: Record<PharmacyPrescription["status"], { label: string; tone: "" | "is-done" | "is-off" }> = {
  pending_review: { label: "Pharmacist reviewing", tone: "" },
  priced_ready: { label: "Quote ready", tone: "is-done" },
  dispensed: { label: "Dispensed", tone: "is-done" },
  declined: { label: "Declined", tone: "is-off" },
  cancelled: { label: "Cancelled", tone: "is-off" },
};

function shortDate(ts: string) {
  const d = new Date(/Z|[+-]\d\d:\d\d$/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-UG", { day: "numeric", month: "short" });
}

export default function PharmacyPage() {
  const { lat, lng, label: locationLabel } = useCustomerLocation();
  const { items: cartItems } = useCart();
  const [stores, setStores] = useState<PharmacyStore[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [prescriptions, setPrescriptions] = useState<PharmacyPrescription[]>([]);
  const [showAllRx, setShowAllRx] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const [rxFor, setRxFor] = useState<Medicine | null>(null);
  const [popped, setPopped] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getMarketplaceStores("pharmacy", lat, lng)
      .then(async (res) => {
        const list: PharmacyStore[] = res.stores ?? [];
        const perStore = await Promise.all(
          list.slice(0, 4).map((s) =>
            api.getMarketplaceStoreProducts(s.id).then((r) => (r.products ?? []).map((p: Medicine) => ({ ...p, store_name: s.name }))).catch(() => [] as Medicine[]),
          ),
        );
        if (cancelled) return;
        setStores(list);
        setMedicines(perStore.flat());
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lat, lng]);

  useEffect(() => {
    api.getCustomerPrescriptions().then((r) => setPrescriptions(r.prescriptions)).catch(() => {});
  }, []);

  const categories = useMemo(() => {
    const present = new Set(medicines.map((m) => m.category_name).filter(Boolean) as string[]);
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    return ["All", ...ordered, ...[...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort()];
  }, [medicines]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return medicines.filter((m) => {
      if (category !== "All" && m.category_name !== category) return false;
      if (!q) return true;
      return [m.title, m.description, m.active_ingredient, m.category_name].some((v) => v?.toLowerCase().includes(q));
    });
  }, [medicines, category, query]);

  const quantityOf = (m: Medicine) => cartItems.find((i) => i.productId === m.id && !i.variantId)?.quantity ?? 0;

  function add(m: Medicine) {
    addToCart({
      productId: m.id,
      storeId: m.store_id,
      storeName: m.store_name,
      title: m.title,
      price: m.price,
      compareAtPrice: m.compare_at_price ?? undefined,
      imageUrl: m.image_url ?? undefined,
      category: m.category_name ?? "Pharmacy",
      quantity: 1,
    });
    setPopped(m.id);
    window.setTimeout(() => setPopped((id) => (id === m.id ? null : id)), 300);
  }

  function openRx(m: Medicine | null) {
    setRxFor(m);
    setRxOpen(true);
  }

  async function cancelRx(id: string) {
    try {
      await api.cancelPrescription(id);
      setPrescriptions((list) => list.map((rx) => (rx.id === id ? { ...rx, status: "cancelled" } : rx)));
    } catch {
      /* stays as it was */
    }
  }

  const rxShown = showAllRx ? prescriptions : prescriptions.slice(0, 2);
  useEffect(() => { document.getElementById("pharmacy-title")?.focus(); }, []);

  return (
    <div className="rx-page mx-auto max-w-lg space-y-7 px-4 pb-8 pt-5">
      {/* Title */}
      <header className="space-y-4">
        <div>
          <p className="rx-eyebrow flex items-center gap-1.5 text-[11px] font-bold uppercase">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden /> NDA-verified pharmacies
          </p>
          <h1 id="pharmacy-title" tabIndex={-1} className="mt-1.5 text-[30px] font-extrabold leading-[1.1] tracking-tight text-ink outline-none">Pharmacy &amp; Health</h1>
          <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-500">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
            <span className="truncate">Delivering to {locationLabel || "Kampala"}</span>
          </p>
        </div>
        <label className="rx-search field-box flex min-h-[52px] items-center gap-2.5 rounded-full px-4">
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-500" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search medicines or ingredients"
            aria-label="Search medicines"
            className="w-full min-w-0 bg-transparent text-[15px] text-ink placeholder:text-ink-500/70 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="rounded-full p-1 text-ink-500">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </header>

      {/* Doctor's slip */}
      <button type="button" onClick={() => openRx(null)} className="rx-hero flex w-full items-center gap-4 rounded-[26px] p-4 text-left">
        <span className="rx-hero-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"><FileText className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-extrabold leading-tight text-ink">Have a prescription?</span>
          <span className="mt-1 block text-[13px] leading-snug text-ink-500">Send a photo of your doctor&apos;s slip. A licensed pharmacist prices it for you.</span>
        </span>
        <span className="rx-hero-go flex h-9 w-9 shrink-0 items-center justify-center rounded-full"><ChevronRight className="h-5 w-5" aria-hidden /></span>
      </button>

      {/* Your prescriptions (real, from the pharmacy service) */}
      {prescriptions.length > 0 && (
        <section className="space-y-2.5" aria-labelledby="rx-mine">
          <div className="flex items-baseline justify-between">
            <h2 id="rx-mine" className="text-[20px] font-extrabold tracking-tight text-ink">Your prescriptions</h2>
            {prescriptions.length > 2 && (
              <button type="button" onClick={() => setShowAllRx((v) => !v)} className="text-xs font-bold text-ink-500">{showAllRx ? "Show less" : `All ${prescriptions.length}`}</button>
            )}
          </div>
          <ul className="space-y-2">
            {rxShown.map((rx) => {
              const s = RX_STATUS[rx.status] ?? RX_STATUS.pending_review;
              const canCancel = rx.status === "pending_review" || rx.status === "priced_ready";
              return (
                <li key={rx.id} className="rx-row rounded-2xl px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className={`rx-status ${s.tone} mt-1.5 flex items-center`} aria-hidden><span className="rx-status-dot h-2 w-2 rounded-full" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-bold text-ink">{s.label}{rx.status === "priced_ready" && rx.quotedTotalUgx > 0 ? ` · ${ugx(rx.quotedTotalUgx)}` : ""}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-500">{shortDate(rx.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-ink-500">{rx.pharmacyName}</span>
                        {canCancel && <button type="button" onClick={() => void cancelRx(rx.id)} className="shrink-0 text-xs font-semibold text-ink-500 underline-offset-2 hover:underline">Cancel</button>}
                      </span>
                    </span>
                  </div>
                  {rx.status === "priced_ready" && (rx.dosageInstructions || rx.pharmacistNotes) && (
                    <p className="mt-2 line-clamp-2 border-t border-[var(--border-faint)] pt-2 text-xs text-ink-500">{rx.dosageInstructions || rx.pharmacistNotes}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Everyday health */}
      <section className="space-y-3.5" aria-labelledby="rx-everyday">
        <div className="flex items-baseline justify-between">
          <h2 id="rx-everyday" className="text-[20px] font-extrabold tracking-tight text-ink">Everyday health</h2>
          {!loading && <span className="text-xs text-ink-500">{visible.length} item{visible.length === 1 ? "" : "s"}</span>}
        </div>
        {categories.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5" role="tablist" aria-label="Categories">
            {categories.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)} className={`rx-chip shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold ${category === c ? "is-active" : ""}`}>
                {c}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="rx-card h-64 animate-pulse rounded-[22px]" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="rx-row flex flex-col items-center rounded-3xl px-6 py-10 text-center">
            <HeartPulse className="h-8 w-8 text-gold" strokeWidth={1.7} aria-hidden />
            <p className="mt-3 text-sm font-bold text-ink">Nothing matches that</p>
            <p className="mt-1 text-xs text-ink-500">Try another name or ingredient, or send your prescription instead.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {visible.map((m) => {
              const qty = quantityOf(m);
              return (
                <li key={m.id} className="rx-card flex flex-col overflow-hidden rounded-[22px]">
                  <div className="rx-card-media relative m-1.5 mb-0 aspect-[4/3.4] overflow-hidden rounded-[18px]">
                    {m.image_url ? (
                      <ProductImage src={m.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink-500/50"><Pill className="h-8 w-8" aria-hidden /></div>
                    )}
                    {m.dosage_form && <span className="rx-glass-chip absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full px-2 py-0.5 text-[10px] font-bold">{m.dosage_form}</span>}
                    {m.rx_required && <span className="rx-badge-rx absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-black">Rx</span>}
                  </div>
                  <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
                    {m.active_ingredient && <p className="rx-ingredient truncate text-[11px] font-semibold">{m.active_ingredient}</p>}
                    <h3 className="mt-0.5 line-clamp-2 text-[13.5px] font-bold leading-snug text-ink">{m.title}</h3>
                    {m.pack_size && <p className="mt-0.5 truncate text-[11px] text-ink-500">{m.pack_size}</p>}
                    <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-extrabold tabular-nums leading-none text-ink">{ugx(m.price)}</p>
                        {m.compare_at_price && m.compare_at_price > m.price && <p className="mt-1 text-[11px] tabular-nums text-ink-500 line-through">{ugx(m.compare_at_price)}</p>}
                      </div>
                      {m.rx_required ? (
                        <button type="button" onClick={() => openRx(m)} aria-label={`${m.title} needs a prescription. Send yours`} className="rx-add is-rx flex h-9 shrink-0 items-center rounded-full px-3 text-[11px] font-black">Send Rx</button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => add(m)}
                          aria-label={qty > 0 ? `Add another ${m.title}, ${qty} in bag` : `Add ${m.title} to bag`}
                          className={`rx-add flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 ${popped === m.id ? "is-in" : ""}`}
                        >
                          {qty > 0 ? <span className="text-[13px] font-black tabular-nums">{qty}</span> : <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Verified pharmacies */}
      {stores.length > 0 && (
        <section className="space-y-3" aria-labelledby="rx-stores">
          <div className="flex items-baseline justify-between">
            <h2 id="rx-stores" className="text-[20px] font-extrabold tracking-tight text-ink">Licensed pharmacies</h2>
            <span className="text-xs text-ink-500">{stores.length} near you</span>
          </div>
          <ul className="space-y-2.5">
            {stores.map((s) => (
              <li key={s.id}>
                <Link href={`/store/${s.slug || s.id}`} className="rx-row flex items-center gap-3.5 rounded-[22px] p-3">
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-[rgb(var(--surface-muted))]">
                    {s.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.logo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ink-500"><Pill className="h-5 w-5" aria-hidden /></span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-ink">{s.name}</span>
                      {s.is_nda_verified && <ShieldCheck className="h-4 w-4 shrink-0 text-gold" aria-label="NDA verified" />}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-500">
                      {[s.distance_km != null ? `${formatDistanceKm(s.distance_km)} away` : null, s.supervising_pharmacist].filter(Boolean).join(" · ") || s.address || s.description}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/50" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RxSheet
        open={rxOpen}
        onClose={() => setRxOpen(false)}
        onSent={(rx) => setPrescriptions((list) => [rx, ...list])}
        medicine={rxFor?.title ?? null}
        preferredPharmacyId={rxFor?.store_id ?? null}
        defaultAddress={locationLabel || ""}
      />
    </div>
  );
}
