"use client";

import {
  Calendar,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  Info,
  Layers,
  LocateFixed,
  MapPin,
  Minus,
  Package,
  PhoneCall,
  Plus,
  Scale,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Sun,
  Sunrise,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
import { cardClass, Notice, primaryBtn, Spinner, UnavailablePanel, WorkPage } from "./WorkUI";
import { WorkTopUp } from "./WorkTopUp";
import {
  formatUgx,
  newIdempotencyKey,
  workFailure,
  type WorkFailure,
} from "./work-utils";

type LaundryItem = {
  id: string;
  name: string;
  category: string;
  maxCount: number;
  washUgx: number | null;
  dryCleanUgx: number | null;
  ironUgx: number | null;
  sortOrder: number;
  active: boolean;
};

type LaundryPackage = {
  id: string;
  name: string;
  description: string;
  minLb: number | null;
  maxLb: number | null;
  priceUgx: number;
  maxCount: number;
  sortOrder: number;
  active: boolean;
};

type LaundryCatalogData = {
  items: LaundryItem[];
  packages: LaundryPackage[];
  settings: {
    pricing: Record<string, "fixed" | "estimate">;
    offer: { minPercent: number; maxPercent: number; stepUgx: number };
    tips: { freeEnabled: boolean; conditionalEnabled: boolean; maxUgx: number; stepUgx: number; ontimeHours: number };
    rides: { pickupPayer: string; deliveryPayer: string; splitCustomerPercent: number };
    overageUgxPerLb: number;
  };
};

type QuoteData = {
  currency: string;
  lines: Array<{ itemId: string; treatment: string; count: number; unitUgx: number; lineUgx: number; name?: string }>;
  packageLines: Array<{ packageId: string; name: string; count: number; unitUgx: number; lineUgx: number }>;
  catalogueUgx: number;
  pricingMode: "fixed" | "estimate";
  offerBand: { minUgx: number; averageUgx: number; maxUgx: number; stepUgx: number } | null;
  goodsUgx: number;
  tip: { kind: string; amountUgx: number };
  rides: { customerUgx: number; providerUgx: number; pickup: { customer: number; provider: number }; delivery: { customer: number; provider: number } };
  customerFeeUgx: number;
  customerTotalUgx: number;
};

const TIME_SLOTS_MORNING = [
  { id: "09:00", label: "9:00 AM – 10:00 AM" },
  { id: "10:00", label: "10:00 AM – 11:00 AM" },
  { id: "11:00", label: "11:00 AM – 12:00 PM" },
];

const TIME_SLOTS_AFTERNOON = [
  { id: "13:00", label: "1:00 PM – 2:00 PM" },
  { id: "14:00", label: "2:00 PM – 3:00 PM" },
  { id: "15:00", label: "3:00 PM – 4:00 PM" },
  { id: "16:00", label: "4:00 PM – 5:00 PM" },
];

function getPackageIcon(id: string) {
  if (id.includes("single")) return ShoppingBag;
  if (id.includes("couple")) return Package;
  if (id.includes("family")) return Layers;
  return Sparkles;
}

export function LaundryBooking() {
  const router = useRouter();
  useRegisterNavBack(true, () => router.push("/services"));

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LaundryCatalogData | null>(null);
  const [loadError, setLoadError] = useState<WorkFailure | null>(null);

  // Tab: "packages" | "custom"
  const [mode, setMode] = useState<"packages" | "custom">("packages");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Selection
  const [pkgCounts, setPkgCounts] = useState<Record<string, number>>({});
  const [itemSelections, setItemSelections] = useState<Record<string, { treatment: "wash" | "dry_clean" | "iron"; count: number }>>({});

  // Offer (Estimate Mode)
  const [offerUgx, setOfferUgx] = useState<number | null>(null);

  // Tip
  const [tipKind, setTipKind] = useState<"none" | "free" | "conditional">("none");
  const [tipUgx, setTipUgx] = useState<number>(0);

  // Preferences
  const [frequency, setFrequency] = useState<"one_time" | "weekly" | "biweekly">("one_time");
  const [detergent, setDetergent] = useState<"standard" | "fragrance_free">("standard");
  const [contactless, setContactless] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");

  // Location & Schedule
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [coords, setCoords] = useState<{ lat?: number; lng?: number }>({});
  const [locating, setLocating] = useState(false);

  // Collection Time
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [whenMode, setWhenMode] = useState<"now" | "slot">("slot");
  const [pickupDate, setPickupDate] = useState<string>(todayStr);
  const [pickupSlot, setPickupSlot] = useState<string>("10:00");

  // Live Quote
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Order submission
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WorkFailure | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<{ needed: number; nonce: number } | null>(null);
  const nonce = useRef(0);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  // Load catalog
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.laundryCatalog();
      setData(res);
      // Pre-select first active package by default if nothing selected
      const firstPkg = res.packages.find((p: LaundryPackage) => p.active && p.priceUgx > 0) ?? res.packages[0];
      if (firstPkg) {
        setPkgCounts({ [firstPkg.id]: 1 });
      }
    } catch (err) {
      setLoadError(workFailure(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Read saved address
  useEffect(() => {
    try {
      const raw = localStorage.getItem("peebee_current_location");
      if (raw) {
        const loc = JSON.parse(raw);
        if (loc?.address) setAddress(loc.address);
        if (loc?.name) setArea(loc.name);
        if (loc?.lat && loc?.lng) setCoords({ lat: loc.lat, lng: loc.lng });
      }
    } catch {}
  }, []);

  // Compute scheduled timestamp
  const scheduledTimestamp = useMemo(() => {
    if (whenMode === "now") return undefined;
    if (!pickupDate || !pickupSlot) return undefined;
    return `${pickupDate}T${pickupSlot}:00`;
  }, [whenMode, pickupDate, pickupSlot]);

  // Build quote input
  const buildQuoteInput = useCallback(() => {
    const packages = Object.entries(pkgCounts)
      .filter(([, count]) => count > 0)
      .map(([packageId, count]) => ({ packageId, count }));

    const items = Object.entries(itemSelections)
      .filter(([, val]) => val.count > 0)
      .map(([itemId, val]) => ({ itemId, treatment: val.treatment, count: val.count }));

    return {
      packages: mode === "packages" ? packages : [],
      items: mode === "custom" ? items : [],
      offerUgx: offerUgx ?? undefined,
      tip: tipKind !== "none" && tipUgx > 0 ? { kind: tipKind, amountUgx: tipUgx } : undefined,
    };
  }, [mode, pkgCounts, itemSelections, offerUgx, tipKind, tipUgx]);

  const refreshQuote = useCallback(async () => {
    const input = buildQuoteInput();
    if (input.packages.length === 0 && input.items.length === 0) {
      setQuote(null);
      return;
    }
    setQuoteLoading(true);
    try {
      const q = await api.laundryQuote(input);
      setQuote(q);
      if (q.pricingMode === "estimate" && q.offerBand && offerUgx === null) {
        setOfferUgx(q.offerBand.averageUgx);
      }
    } catch {
      // Degrade gracefully
    } finally {
      setQuoteLoading(false);
    }
  }, [buildQuoteInput, offerUgx]);

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshQuote();
    }, 200);
    return () => clearTimeout(t);
  }, [refreshQuote]);

  // GPS locate
  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (!address) setAddress("Current Location");
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Submit order
  const attemptOrder = async () => {
    setLocalError(null);
    setFailure(null);
    if (!address.trim()) {
      setLocalError("Please enter your pickup and delivery address.");
      return;
    }
    const input = buildQuoteInput();
    if (input.packages.length === 0 && input.items.length === 0) {
      setLocalError("Please select at least one laundry package or clothing item.");
      return;
    }

    const payload = {
      ...input,
      address: address.trim(),
      area: area.trim() || undefined,
      lat: coords.lat,
      lng: coords.lng,
      scheduledFor: scheduledTimestamp,
      frequency,
      detergent,
      contactless,
      notes: notes.trim() || undefined,
      expectedTotalUgx: quote?.customerTotalUgx,
    };

    const sig = JSON.stringify(payload);
    if (!keyRef.current || keyRef.current.sig !== sig) {
      keyRef.current = { sig, key: newIdempotencyKey() };
    }

    setBusy(true);
    try {
      const res = await api.laundryOrder({ ...payload, idempotencyKey: keyRef.current.key });
      setTopUp(null);
      router.push(`/services/work/${encodeURIComponent(res.job.id)}`);
    } catch (err) {
      const f = workFailure(err);
      setFailure(f);
      if (f.topUp) {
        const needed = quote?.customerTotalUgx ?? 0;
        nonce.current += 1;
        setTopUp(needed > 0 ? { needed, nonce: nonce.current } : null);
      } else {
        setTopUp(null);
      }
      setBusy(false);
    }
  };

  // Sticky capsule button via nav-primary-action (single canonical action button)
  const totalLabel = quote ? formatUgx(quote.customerTotalUgx) : "...";
  const primaryAction = useMemo(() => {
    if (loading || loadError) return null;
    return {
      tone: "gold" as const,
      confirmation: true,
      label: busy ? "Confirming..." : `Book & Pay ${totalLabel}`,
      sublabel: "In-app payment held securely",
      icon: Wallet,
      busy,
      disabled: busy || quoteLoading || !quote,
      onClick: attemptOrder,
    };
  }, [loading, loadError, busy, totalLabel, quoteLoading, quote]);

  useRegisterNavPrimaryAction(primaryAction);

  // Categories for custom garments
  const categories = useMemo(() => {
    if (!data?.items) return [];
    const set = new Set<string>();
    for (const item of data.items) {
      if (item.category) set.add(item.category);
    }
    return ["all", ...Array.from(set)];
  }, [data?.items]);

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    if (selectedCategory === "all") return data.items;
    return data.items.filter((i) => i.category === selectedCategory);
  }, [data?.items, selectedCategory]);

  if (loading) {
    return (
      <WorkPage eyebrow="Work" title="Laundry & Dry Cleaning" backHref="/services" backLabel="Services">
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading laundry services..." />
        </div>
      </WorkPage>
    );
  }

  if (loadError || !data) {
    return (
      <WorkPage eyebrow="Work" title="Laundry & Dry Cleaning" backHref="/services" backLabel="Services">
        <UnavailablePanel title="Laundry Unavailable" message={loadError?.message ?? "Could not load laundry services."} backHref="/services" />
      </WorkPage>
    );
  }

  return (
    <WorkPage eyebrow="Work" title="Laundry & Dry Cleaning" backHref="/services" backLabel="Services">
      <form onSubmit={(e) => { e.preventDefault(); void attemptOrder(); }} className="space-y-6">

        {/* Header Eyebrow & Title */}
        <div className="text-center pt-1 pb-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gold">— CURRENT OPTIONS —</p>
          <h2 className="mt-1 text-2xl font-black text-ink tracking-tight">Choose your order size</h2>
        </div>

        {/* Tab Switcher: Packages vs Custom Item Order */}
        <div className="flex rounded-2xl bg-[rgb(var(--surface-muted))] p-1">
          <button
            type="button"
            onClick={() => {
              setMode("packages");
              setOfferUgx(null);
            }}
            className={`flex-1 rounded-xl py-2.5 text-center text-xs font-bold transition ${
              mode === "packages" ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500 hover:text-ink"
            }`}
          >
            Wash & Fold Packages
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("custom");
              setOfferUgx(null);
            }}
            className={`flex-1 rounded-xl py-2.5 text-center text-xs font-bold transition ${
              mode === "custom" ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500 hover:text-ink"
            }`}
          >
            Dry Cleaning & Custom Items
          </button>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* MODE: WASH & FOLD PACKAGES (Card Grid matching reference UI) */}
        {/* ------------------------------------------------------------- */}
        {mode === "packages" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.packages.map((pkg) => {
                const count = pkgCounts[pkg.id] ?? 0;
                const isSelected = count > 0;
                const IconComponent = getPackageIcon(pkg.id);

                return (
                  <div
                    key={pkg.id}
                    className={`flex flex-col justify-between rounded-3xl border p-4 transition-all duration-200 ${
                      isSelected
                        ? "border-gold bg-[rgb(var(--surface-card))] ring-2 ring-gold/70 shadow-[0_4px_20px_rgba(201,162,39,0.15)]"
                        : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"
                    }`}
                  >
                    <div>
                      {/* Icon Bubble */}
                      <div className="flex items-center justify-between">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                          <IconComponent className="h-5 w-5" />
                        </div>
                        {isSelected && (
                          <span className="flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-0.5 text-[11px] font-bold text-gold">
                            <CheckCircle2 className="h-3 w-3" /> Selected
                          </span>
                        )}
                      </div>

                      {/* Package Name & Price */}
                      <h3 className="mt-3 text-base font-bold text-ink">{pkg.name}</h3>
                      <div className="mt-0.5 text-xl font-extrabold text-ink">{formatUgx(pkg.priceUgx)}</div>
                      <p className="mt-1 text-xs text-ink-500 leading-snug">
                        {pkg.description || (pkg.minLb && pkg.maxLb ? `${pkg.minLb}–${pkg.maxLb} lbs` : "Per load")}
                      </p>
                    </div>

                    {/* Action button or stepper */}
                    <div className="mt-4 pt-3 border-t border-[var(--border-faint)]">
                      {count === 0 ? (
                        <button
                          type="button"
                          onClick={() => setPkgCounts({ [pkg.id]: 1 })}
                          className="w-full rounded-2xl border border-transparent bg-ink py-2.5 text-xs font-bold uppercase tracking-wider text-[rgb(var(--surface-card))] transition active:scale-98 hover:bg-gold hover:text-ink"
                        >
                          Choose Pickup
                        </button>
                      ) : (
                        <div className="flex items-center justify-between rounded-2xl bg-gold/15 p-1 ring-1 ring-gold">
                          <button
                            type="button"
                            aria-label={`Decrease ${pkg.name}`}
                            onClick={() => setPkgCounts((prev) => ({ ...prev, [pkg.id]: Math.max(0, count - 1) }))}
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold text-ink font-bold transition active:scale-95"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="text-xs font-bold text-ink">
                            {count} {count === 1 ? "Bag" : "Bags"}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${pkg.name}`}
                            onClick={() => setPkgCounts((prev) => ({ ...prev, [pkg.id]: Math.min(pkg.maxCount, count + 1) }))}
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold text-ink font-bold transition active:scale-95"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Overage note */}
            <p className="text-center text-xs text-ink-500">
              Any additional weight will be {formatUgx(data.settings.overageUgxPerLb || 1500)}/lb (We weigh your order at pickup)
            </p>

            {/* Quick Price List for Dry Cleaning & Ironing (Reference preview from screenshot) */}
            {data.items.length > 0 && (
              <div className={`${cardClass} space-y-3 mt-6`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-ink">Dry Cleaning & Pressing Catalogue</h3>
                    <p className="text-xs text-ink-500">Also order individual shirts, suits, and dresses</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("custom");
                      setPkgCounts({});
                    }}
                    className="text-xs font-bold text-gold underline"
                  >
                    Custom items →
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  {data.items.slice(0, 6).map((item) => {
                    const price = item.dryCleanUgx ?? item.washUgx ?? item.ironUgx ?? 0;
                    return (
                      <div key={item.id} className="flex items-center justify-between rounded-xl bg-[rgb(var(--surface-muted))] px-2.5 py-1.5">
                        <span className="truncate text-ink font-medium">{item.name}</span>
                        <span className="ml-1.5 font-bold text-gold shrink-0">{formatUgx(price)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* MODE: CUSTOM ITEM BUILDER (Garment items & steppers)          */}
        {/* ------------------------------------------------------------- */}
        {mode === "custom" && (
          <div className="space-y-4">
            {/* Category Filter Pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize whitespace-nowrap transition ${
                    selectedCategory === cat
                      ? "bg-gold text-ink-gold shadow-sm"
                      : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                  }`}
                >
                  {cat === "all" ? "All Items" : cat}
                </button>
              ))}
            </div>

            {/* Item list */}
            <div className="space-y-2.5">
              {filteredItems.map((item) => {
                const current = itemSelections[item.id] ?? {
                  treatment: item.washUgx ? "wash" : item.dryCleanUgx ? "dry_clean" : "iron",
                  count: 0,
                };
                const hasTreatment = (t: "wash" | "dry_clean" | "iron") => {
                  if (t === "wash") return item.washUgx != null && item.washUgx > 0;
                  if (t === "dry_clean") return item.dryCleanUgx != null && item.dryCleanUgx > 0;
                  if (t === "iron") return item.ironUgx != null && item.ironUgx > 0;
                  return false;
                };

                return (
                  <div key={item.id} className={`${cardClass} flex items-center justify-between gap-3 py-3`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink">{item.name}</div>
                      {/* Treatment pills */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {hasTreatment("wash") && (
                          <button
                            type="button"
                            onClick={() => setItemSelections((prev) => ({ ...prev, [item.id]: { ...current, treatment: "wash" } }))}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                              current.treatment === "wash"
                                ? "bg-gold text-ink-gold shadow-sm"
                                : "bg-[rgb(var(--surface-muted))] text-ink-500"
                            }`}
                          >
                            Wash {formatUgx(item.washUgx!)}
                          </button>
                        )}
                        {hasTreatment("dry_clean") && (
                          <button
                            type="button"
                            onClick={() => setItemSelections((prev) => ({ ...prev, [item.id]: { ...current, treatment: "dry_clean" } }))}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                              current.treatment === "dry_clean"
                                ? "bg-gold text-ink-gold shadow-sm"
                                : "bg-[rgb(var(--surface-muted))] text-ink-500"
                            }`}
                          >
                            Dry Clean {formatUgx(item.dryCleanUgx!)}
                          </button>
                        )}
                        {hasTreatment("iron") && (
                          <button
                            type="button"
                            onClick={() => setItemSelections((prev) => ({ ...prev, [item.id]: { ...current, treatment: "iron" } }))}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                              current.treatment === "iron"
                                ? "bg-gold text-ink-gold shadow-sm"
                                : "bg-[rgb(var(--surface-muted))] text-ink-500"
                            }`}
                          >
                            Iron {formatUgx(item.ironUgx!)}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Decrease ${item.name}`}
                        onClick={() =>
                          setItemSelections((prev) => ({
                            ...prev,
                            [item.id]: { ...current, count: Math.max(0, current.count - 1) },
                          }))
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-faint)] text-ink transition active:scale-95"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-bold text-ink">{current.count}</span>
                      <button
                        type="button"
                        aria-label={`Increase ${item.name}`}
                        onClick={() =>
                          setItemSelections((prev) => ({
                            ...prev,
                            [item.id]: { ...current, count: Math.min(item.maxCount, current.count + 1) },
                          }))
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold text-ink font-bold transition active:scale-95"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* PICKUP TIME & 1-HOUR SLOTS (Matching screenshot 3)            */}
        {/* ------------------------------------------------------------- */}
        <div className={`${cardClass} space-y-4`}>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">Pickup time</h3>
              <p className="text-xs text-ink-500">Choose the day and a 1-hour pickup slot.</p>
            </div>
          </div>

          {/* Mode: Soon vs Slot */}
          <div className="flex rounded-2xl bg-[rgb(var(--surface-muted))] p-1">
            <button
              type="button"
              onClick={() => setWhenMode("slot")}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                whenMode === "slot" ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500 hover:text-ink"
              }`}
            >
              Schedule 1-Hour Slot
            </button>
            <button
              type="button"
              onClick={() => setWhenMode("now")}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                whenMode === "now" ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500 hover:text-ink"
              }`}
            >
              Pickup ASAP
            </button>
          </div>

          {whenMode === "slot" && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="text-xs font-semibold text-ink-500">Pickup date</label>
                <div className="field-box mt-1 flex items-center rounded-2xl border border-[var(--border-faint)] px-3 py-2.5">
                  <Calendar className="h-4 w-4 text-ink-500 mr-2 shrink-0" />
                  <input
                    type="date"
                    min={todayStr}
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="w-full text-xs text-ink outline-none"
                  />
                </div>
                <p className="mt-1 text-[11px] text-ink-500">A request, not a reserved slot. We confirm it with you.</p>
              </div>

              {/* Slots: Morning & Afternoon */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-semibold text-ink-500">Pickup slot (1 hour)</span>

                {/* Morning */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-ink-500 mb-1.5">
                    <Sunrise className="h-3.5 w-3.5 text-gold" /> Morning
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {TIME_SLOTS_MORNING.map((slot) => {
                      const active = pickupSlot === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setPickupSlot(slot.id)}
                          className={`rounded-2xl border py-2.5 px-3 text-center text-xs font-bold transition ${
                            active
                              ? "border-gold bg-gold text-ink-gold shadow-sm"
                              : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink hover:border-gold/50"
                          }`}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Afternoon */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-ink-500 mb-1.5">
                    <Sun className="h-3.5 w-3.5 text-gold" /> Afternoon
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {TIME_SLOTS_AFTERNOON.map((slot) => {
                      const active = pickupSlot === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setPickupSlot(slot.id)}
                          className={`rounded-2xl border py-2.5 px-3 text-center text-xs font-bold transition ${
                            active
                              ? "border-gold bg-gold text-ink-gold shadow-sm"
                              : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink hover:border-gold/50"
                          }`}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-[11px] font-bold text-gold">
                  <Clock className="h-3.5 w-3.5" /> Pickup hours to be confirmed
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* FREQUENCY (Matching screenshot 3)                             */}
        {/* ------------------------------------------------------------- */}
        <div className={`${cardClass} space-y-3`}>
          <h3 className="text-sm font-bold text-ink">Frequency</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "one_time", label: "One-time" },
              { id: "weekly", label: "Weekly" },
              { id: "biweekly", label: "Biweekly" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFrequency(f.id as any)}
                className={`rounded-2xl py-2.5 text-xs font-bold transition ${
                  frequency === f.id
                    ? "bg-gold text-ink-gold shadow-sm"
                    : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* PREFERENCES & SPECIAL INSTRUCTIONS                            */}
        {/* ------------------------------------------------------------- */}
        <div className={`${cardClass} space-y-3`}>
          <h3 className="text-sm font-bold text-ink">Preferences</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-ink-500">Detergent</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDetergent("standard")}
                  className={`flex-1 rounded-2xl py-2 text-xs font-bold transition ${
                    detergent === "standard"
                      ? "bg-gold text-ink-gold shadow-sm"
                      : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                  }`}
                >
                  Standard Detergent
                </button>
                <button
                  type="button"
                  onClick={() => setDetergent("fragrance_free")}
                  className={`flex-1 rounded-2xl py-2 text-xs font-bold transition ${
                    detergent === "fragrance_free"
                      ? "bg-gold text-ink-gold shadow-sm"
                      : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                  }`}
                >
                  Fragrance-Free
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 pt-1 text-xs font-medium text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={contactless}
                onChange={(e) => setContactless(e.target.checked)}
                className="h-4 w-4 rounded accent-gold"
              />
              Contactless pickup & door delivery
            </label>

            <div>
              <label className="text-xs font-semibold text-ink-500">Access instructions or laundry preferences</label>
              <div className="field-box mt-1 rounded-2xl border border-[var(--border-faint)] px-3 py-2.5">
                <input
                  type="text"
                  placeholder="e.g. gate code, where to leave items, special care instructions"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-xs text-ink outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* PICKUP & DELIVERY ADDRESS (Solid edge-to-edge field-box)      */}
        {/* ------------------------------------------------------------- */}
        <div className={`${cardClass} space-y-3`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Pickup & Delivery Address</h3>
            <button
              type="button"
              onClick={locateMe}
              disabled={locating}
              className="flex items-center gap-1 text-xs font-bold text-gold"
            >
              <LocateFixed className="h-3.5 w-3.5" />
              {locating ? "Locating..." : "Use GPS"}
            </button>
          </div>
          <div className="space-y-2">
            <div className="field-box flex items-center rounded-2xl border border-[var(--border-faint)] px-3 py-2.5">
              <MapPin className="h-4 w-4 text-ink-500 mr-2 shrink-0" />
              <input
                type="text"
                placeholder="Street address or building..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full text-xs text-ink outline-none"
              />
            </div>
            <div className="field-box rounded-2xl border border-[var(--border-faint)] px-3 py-2.5">
              <input
                type="text"
                placeholder="Area / Neighborhood (e.g. Kololo, Ntinda, Bugolobi)"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className="w-full text-xs text-ink outline-none"
              />
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* OFFER SLIDER (When Admin Sets Estimate Pricing Mode)          */}
        {/* ------------------------------------------------------------- */}
        {quote?.pricingMode === "estimate" && quote.offerBand && (
          <div className={`${cardClass} space-y-3`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-ink">Your Offer Price</span>
                <p className="text-xs text-ink-500">Service providers can accept or counter your offer.</p>
              </div>
              <span className="text-base font-extrabold text-gold">
                {formatUgx(offerUgx ?? quote.offerBand.averageUgx)}
              </span>
            </div>
            <input
              type="range"
              min={quote.offerBand.minUgx}
              max={quote.offerBand.maxUgx}
              step={quote.offerBand.stepUgx}
              value={offerUgx ?? quote.offerBand.averageUgx}
              onChange={(e) => setOfferUgx(Number(e.target.value))}
              className="w-full accent-gold"
            />
            <div className="flex justify-between text-[11px] font-semibold text-ink-500">
              <span>Min: {formatUgx(quote.offerBand.minUgx)}</span>
              <span>Avg: {formatUgx(quote.offerBand.averageUgx)}</span>
              <span>Max: {formatUgx(quote.offerBand.maxUgx)}</span>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TIPS (Free Direct / Conditional On-Time)                      */}
        {/* ------------------------------------------------------------- */}
        {(data.settings.tips.freeEnabled || data.settings.tips.conditionalEnabled) && (
          <div className={`${cardClass} space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Add a Tip</h3>
              <span className="text-xs text-ink-500">Optional</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTipKind("none");
                  setTipUgx(0);
                }}
                className={`rounded-2xl py-2.5 text-xs font-bold transition ${
                  tipKind === "none"
                    ? "bg-gold text-ink-gold shadow-sm"
                    : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                }`}
              >
                No Tip
              </button>
              {data.settings.tips.freeEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    setTipKind("free");
                    if (tipUgx === 0) setTipUgx(2000);
                  }}
                  className={`rounded-2xl py-2.5 text-xs font-bold transition ${
                    tipKind === "free"
                      ? "bg-gold text-ink-gold shadow-sm"
                      : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                  }`}
                >
                  Direct Tip
                </button>
              )}
              {data.settings.tips.conditionalEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    setTipKind("conditional");
                    if (tipUgx === 0) setTipUgx(2000);
                  }}
                  className={`rounded-2xl py-2.5 text-xs font-bold transition ${
                    tipKind === "conditional"
                      ? "bg-gold text-ink-gold shadow-sm"
                      : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                  }`}
                >
                  On-Time Tip
                </button>
              )}
            </div>
            {tipKind === "conditional" && (
              <p className="text-[11px] text-ink-500">
                Released only if your laundry is delivered on-schedule and without disputes; refunded otherwise.
              </p>
            )}
            {tipKind !== "none" && (
              <div className="flex items-center gap-2 pt-1">
                {[1000, 2000, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setTipUgx(amt)}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                      tipUgx === amt
                        ? "bg-ink text-[rgb(var(--surface-card))]"
                        : "bg-[rgb(var(--surface-muted))] text-ink hover:bg-gold/20"
                    }`}
                  >
                    {formatUgx(amt)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* WHAT HAPPENS NEXT? (Matching screenshot 3)                     */}
        {/* ------------------------------------------------------------- */}
        <div className={`${cardClass} space-y-4`}>
          <h3 className="text-sm font-bold text-ink">What happens next?</h3>
          <div className="space-y-3.5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-ink">We review your request</h4>
                <p className="text-[11px] text-ink-500 mt-0.5">We check the details and assign a verified laundry partner.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <Truck className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-ink">We confirm timing and rider</h4>
                <p className="text-[11px] text-ink-500 mt-0.5">A trusted Boda rider collects your laundry bag from your doorstep.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <Scale className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-ink">We check your bag at pickup</h4>
                <p className="text-[11px] text-ink-500 mt-0.5">We verify the load size and garment count before we wash.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <PhoneCall className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-ink">We deliver when fresh & ready</h4>
                <p className="text-[11px] text-ink-500 mt-0.5">Clean, neatly folded, or pressed clothes delivered right to your door.</p>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* COST BREAKDOWN SUMMARY                                        */}
        {/* ------------------------------------------------------------- */}
        {quote && (
          <div className={`${cardClass} space-y-2.5 text-xs`}>
            <h3 className="font-bold text-ink text-xs uppercase tracking-wider">Pricing summary</h3>
            <div className="flex justify-between text-ink-500">
              <span>Laundry Service Total</span>
              <span className="font-bold text-ink">{formatUgx(quote.goodsUgx)}</span>
            </div>
            {quote.rides.customerUgx > 0 && (
              <div className="flex justify-between text-ink-500">
                <span>Rider Pickup & Delivery Share</span>
                <span className="font-bold text-ink">{formatUgx(quote.rides.customerUgx)}</span>
              </div>
            )}
            {quote.tip.amountUgx > 0 && (
              <div className="flex justify-between text-ink-500">
                <span>Tip ({quote.tip.kind === "conditional" ? "On-Time" : "Direct"})</span>
                <span className="font-bold text-ink">{formatUgx(quote.tip.amountUgx)}</span>
              </div>
            )}
            {quote.customerFeeUgx > 0 && (
              <div className="flex justify-between text-ink-500">
                <span>Peebee Platform Fee</span>
                <span className="font-bold text-ink">{formatUgx(quote.customerFeeUgx)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-[var(--border-faint)] pt-2.5 text-base font-extrabold text-ink">
              <span>Total Payable</span>
              <span className="text-gold">{formatUgx(quote.customerTotalUgx)}</span>
            </div>
          </div>
        )}

        {/* Error Notices & Wallet Top-up */}
        <Notice text={localError ?? undefined} />
        <Notice failure={failure} inlineTopUp={!!topUp} />
        {topUp && <WorkTopUp key={topUp.nonce} neededUgx={topUp.needed} onCredited={() => void attemptOrder()} />}

        {/* Hidden Accessible Form Submit (Single canonical button is in the floating nav capsule!) */}
        <button type="submit" disabled={busy || !quote} className="sr-only">
          {busy ? "Confirming Order..." : `Confirm & Pay with Wallet • ${totalLabel}`}
        </button>

        <p className="flex items-start justify-center gap-2 text-center text-xs text-ink-500 pb-8">
          <ShieldCheck className="h-4 w-4 shrink-0 text-gold" />
          Funds are held safely in your Peebee wallet and released to providers upon delivery.
        </p>
      </form>
    </WorkPage>
  );
}
