"use client";

import {
  Building2,
  Check,
  ChevronRight,
  Crown,
  ExternalLink,
  FileText,
  Gift,
  Globe,
  Layers,
  MapPin,
  Minus,
  Package,
  Percent,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Truck,
  Video,
  X,
  BookOpen,
  Download,
  GraduationCap,
  Key,
  Clock,
  PlayCircle,
  FileCode,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.peebee.online";
const CUSTOMER_APP_URL = process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ?? "https://app.peebee.online";

const ugx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString()}`;

interface StorefrontSection {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  enabled: boolean;
  order: number;
  settings?: Record<string, any>;
}

export interface StorefrontOptions {
  checkoutMode: "handoff_to_app" | "inline_web_checkout" | "whatsapp_order" | string;
  renderMode?: string;
  metaPixelId: string | null;
  tiktokPixelId: string | null;
}

/** What the server page already fetched, so the first paint is the real store (and search engines see it). */
export interface StorefrontInitial {
  store: any;
  products: any[];
  collections: any[];
  discounts: any[];
  outlets: any[];
  bundles: any[];
  sections: any[];
  digitalProducts: any[];
  courses: any[];
  storefront: StorefrontOptions | null;
}

interface StoreBundleItem {
  productId: string;
  title: string;
  quantity: number;
}

export interface StoreDigitalProductItem {
  id: string;
  store_id?: string;
  title: string;
  slug?: string;
  kind: "download" | "license_key" | "course" | "template" | "service" | string;
  description: string | null;
  price?: number;
  price_ugx?: number;
  compare_at_price?: number | null;
  compare_at_price_ugx?: number | null;
  file_name?: string | null;
  file_url?: string | null;
  file_size_bytes?: number;
  mime_type?: string | null;
  delivery_instructions?: string | null;
  badge?: string | null;
  downloads_count?: number;
}

export interface StoreLmsCourseItem {
  id: string;
  school_id?: string;
  title: string;
  slug?: string;
  summary?: string | null;
  subtitle?: string | null;
  description?: string | null;
  stream?: string;
  category?: string;
  level?: string;
  duration_minutes?: number;
  lessons_count?: number;
  price_ugx: number;
  status?: string;
  is_published?: number | boolean;
}

interface StoreBundle {
  id: string;
  title: string;
  description: string | null;
  price: number;
  compare_at_price?: number | null;
  items: StoreBundleItem[];
}

interface StoreCollection {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  kind: "manual" | "smart";
  rule_field: "category" | "price_lte" | "price_gte" | "badge" | "in_stock" | null;
  rule_value: string | null;
  pinned: number | boolean;
}

interface StoreDiscount {
  id: string;
  code: string;
  title: string;
  kind: "percent" | "fixed" | "free_delivery" | "bogo";
  value: number;
  min_order_amount: number;
  is_automatic: number | boolean;
}

interface StoreOutlet {
  id: string;
  name: string;
  code: string;
  address: string | null;
  status: string;
}

interface ProductVariant {
  id: string;
  title: string;
  price: number;
  compare_at_price?: number | null;
  inventory_quantity?: number;
}

interface StoreProduct {
  id: string;
  store_id: string;
  title: string;
  slug?: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  badge?: string | null;
  image_url: string | null;
  category_name?: string | null;
  inventory_quantity?: number;
  variants?: ProductVariant[];
}

interface StorefrontStore {
  id: string;
  name: string;
  slug: string;
  category: "groceries" | "stores";
  sub_category?: string;
  description: string | null;
  announcement?: string | null;
  logo_url: string | null;
  banner_url: string | null;
  phone: string | null;
  whatsapp_number?: string | null;
  address?: string | null;
  is_open?: number | boolean;
  min_order_amount?: number;
  pro_tier?: "free" | "pro_store" | "pro_live" | "elite";
  elite_tier?: number | boolean;
  custom_domain?: string | null;
  subdomain_url?: string;
  marketplace_url?: string;
  theme_layout?: "grid" | "editorial" | "compact";
  theme_accent?: "gold" | "ink" | "cream";
  hero_headline?: string | null;
  hero_subheadline?: string | null;
  hero_cta_text?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  loyalty_enabled?: number | boolean;
  loyalty_cashback_percent?: number;
  b2b_wholesale_enabled?: number | boolean;
  b2b_min_order_amount?: number;
  is_live?: number | boolean;
  live_channel_title?: string | null;
}

interface BagItem {
  productId: string;
  variantId?: string;
  title: string;
  variantTitle?: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
}

export default function StorefrontClient({ overrideSlug, initial }: { overrideSlug?: string; initial?: StorefrontInitial | null } = {}) {
  const params = useParams();
  const slug = overrideSlug || (params?.slug as string) || "";

  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [store, setStore] = useState<StorefrontStore | null>(initial?.store ?? null);
  const [products, setProducts] = useState<StoreProduct[]>(initial?.products ?? []);
  const [collections, setCollections] = useState<StoreCollection[]>(initial?.collections ?? []);
  const [discounts, setDiscounts] = useState<StoreDiscount[]>(initial?.discounts ?? []);
  const [outlets, setOutlets] = useState<StoreOutlet[]>(initial?.outlets ?? []);
  const [bundles, setBundles] = useState<StoreBundle[]>(initial?.bundles ?? []);
  const [sections, setSections] = useState<StorefrontSection[]>(initial?.sections ?? []);
  const [digitalProducts, setDigitalProducts] = useState<StoreDigitalProductItem[]>(initial?.digitalProducts ?? []);
  const [courses, setCourses] = useState<StoreLmsCourseItem[]>(initial?.courses ?? []);
  const [options, setOptions] = useState<StorefrontOptions | null>(initial?.storefront ?? null);
  // A code the customer typed, checked by the server against the real bag.
  const [serverPromo, setServerPromo] = useState<{ code: string; title: string; kind: string; amount: number; freeDelivery: boolean } | null>(null);
  const [promoMessage, setPromoMessage] = useState("");

  const [activeCollectionId, setActiveCollectionId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [bag, setBag] = useState<BagItem[]>([]);
  const [bagOpen, setBagOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");

  // B2B Wholesale Modal State
  const [b2bOpen, setB2bOpen] = useState(false);
  const [b2bName, setB2bName] = useState("");
  const [b2bPhone, setB2bPhone] = useState("");
  const [b2bCompany, setB2bCompany] = useState("");
  const [b2bTerms, setB2bTerms] = useState<"immediate" | "net_7" | "net_14" | "net_30">("net_14");
  const [b2bNotes, setB2bNotes] = useState("");
  const [b2bQuantities, setB2bQuantities] = useState<Record<string, number>>({});
  const [b2bStatus, setB2bStatus] = useState("");
  const [b2bSubmitting, setB2bSubmitting] = useState(false);
  // Phone-code step (shown only when the platform asks for it).
  const [b2bProof, setB2bProof] = useState("");
  const [b2bChallenge, setB2bChallenge] = useState("");
  const [b2bCode, setB2bCode] = useState("");
  const [b2bNeedsCode, setB2bNeedsCode] = useState(false);

  useEffect(() => {
    if (!slug) return;
    // The server already rendered this store; nothing to fetch for the first paint.
    if (initial && initial.store && (initial.store.slug === slug || initial.store.id === slug)) return;
    let active = true;
    setLoading(true);
    setError("");
    setUnavailable(false);

    (async () => {
      try {
        const storeHttp = await fetch(`${API_BASE}/v1/marketplace/stores/${encodeURIComponent(slug)}`);
        if (!active) return;
        if (storeHttp.status === 410) {
          setUnavailable(true);
          return;
        }
        const storeRes = storeHttp.ok ? await storeHttp.json() : null;
        if (!storeRes?.store) {
          setError("Storefront not found.");
          return;
        }
        // The merchant chose not to have a web store (they are listed in the app only).
        if (storeRes.store.web_store_enabled === 0 || storeRes.store.web_store_enabled === false) {
          setUnavailable(true);
          return;
        }
        const prodRes = await fetch(`${API_BASE}/v1/marketplace/stores/${encodeURIComponent(slug)}/products?channel=web`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!active) return;
        setStore(storeRes.store);
        setCollections(storeRes.collections ?? []);
        setDiscounts(storeRes.discounts ?? []);
        setOutlets(storeRes.outlets ?? []);
        setBundles(storeRes.bundles ?? []);
        setSections(storeRes.sections ?? []);
        setDigitalProducts(storeRes.digitalProducts ?? []);
        setCourses(storeRes.courses ?? []);
        setOptions(storeRes.storefront ?? null);
        setProducts(prodRes?.products ?? []);

        // Auto-apply automatic store discount if available
        const autoDisc = (storeRes.discounts ?? []).find((d: StoreDiscount) => Boolean(d.is_automatic));
        if (autoDisc) {
          setAppliedPromoCode(autoDisc.code);
          setPromoInput(autoDisc.code);
        }
      } catch {
        if (active) setError("Could not connect to storefront.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // The automatic offer is applied for the customer, as before.
  useEffect(() => {
    if (!initial) return;
    const autoDisc = (initial.discounts ?? []).find((d: StoreDiscount) => Boolean(d.is_automatic));
    if (autoDisc) {
      setAppliedPromoCode(autoDisc.code);
      setPromoInput(autoDisc.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) ?? null,
    [collections, activeCollectionId],
  );

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (activeCollectionId === "deals") {
        const hasDeal = !!p.badge || (p.compare_at_price != null && p.compare_at_price > p.price);
        if (!hasDeal) return false;
      } else if (activeCollection && activeCollection.kind === "smart" && activeCollection.rule_field) {
        const val = String(activeCollection.rule_value || "").toLowerCase();
        if (activeCollection.rule_field === "category" && !String(p.category_name || "").toLowerCase().includes(val)) return false;
        if (activeCollection.rule_field === "badge" && !String(p.badge || "").toLowerCase().includes(val)) return false;
        if (activeCollection.rule_field === "price_lte" && Number(p.price || 0) > (Number(activeCollection.rule_value) || 0)) return false;
        if (activeCollection.rule_field === "price_gte" && Number(p.price || 0) < (Number(activeCollection.rule_value) || 0)) return false;
        if (activeCollection.rule_field === "in_stock" && Number(p.inventory_quantity ?? 1) <= 0) return false;
      } else if (activeCollectionId.startsWith("cat:")) {
        const cat = activeCollectionId.slice(4);
        if (p.category_name !== cat) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          p.title.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          (p.category_name && p.category_name.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [products, activeCollectionId, activeCollection, searchQuery]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category_name).filter((c): c is string => !!c))),
    [products],
  );

  function addToBag(product: StoreProduct) {
    const v = product.variants?.[0];
    const price = v?.price ?? product.price;
    const variantTitle = v?.title;
    const variantId = v?.id;
    setServerPromo(null);
    setBag((prev) => {
      const idx = prev.findIndex((i) => i.productId === product.id && i.variantTitle === variantTitle);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          productId: product.id,
          variantId,
          title: product.title,
          variantTitle,
          price,
          quantity: 1,
          imageUrl: product.image_url,
        },
      ];
    });
  }

  function updateBagQty(productId: string, delta: number) {
    setServerPromo(null);
    setBag((prev) =>
      prev
        .map((item) => (item.productId === productId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0),
    );
  }

  const bagSubtotal = useMemo(() => bag.reduce((sum, it) => sum + it.price * it.quantity, 0), [bag]);
  const bagCount = useMemo(() => bag.reduce((sum, it) => sum + it.quantity, 0), [bag]);

  // What the bag is worth after a promo. A code the customer typed is checked by the server (private codes are
  // never listed); the store's automatic offer comes with the page and is evaluated here for display.
  const promoEvaluation = useMemo((): {
    discount: { code: string; title: string; min_order_amount?: number } | null;
    amount: number;
    freeDelivery: boolean;
    belowMin?: boolean;
  } => {
    if (serverPromo) {
      return { discount: { code: serverPromo.code, title: serverPromo.title }, amount: serverPromo.amount, freeDelivery: serverPromo.freeDelivery };
    }
    const match = discounts.find((d) => Boolean(d.is_automatic)) ?? null;
    if (!match) return { discount: null, amount: 0, freeDelivery: false };
    if (bagSubtotal < Number(match.min_order_amount || 0)) {
      return { discount: match, amount: 0, freeDelivery: false, belowMin: true };
    }
    if (match.kind === "percent") {
      return { discount: match, amount: Math.min(bagSubtotal, Math.round((bagSubtotal * Number(match.value || 0)) / 100)), freeDelivery: false };
    }
    if (match.kind === "fixed") {
      return { discount: match, amount: Math.min(bagSubtotal, Number(match.value || 0)), freeDelivery: false };
    }
    if (match.kind === "bogo") {
      if (bagCount >= 2) {
        const cheapest = Math.min(...bag.map((i) => i.price));
        return { discount: match, amount: Math.min(bagSubtotal, cheapest), freeDelivery: false };
      }
      return { discount: match, amount: 0, freeDelivery: false };
    }
    if (match.kind === "free_delivery") return { discount: match, amount: 0, freeDelivery: true };
    return { discount: null, amount: 0, freeDelivery: false };
  }, [discounts, serverPromo, bagSubtotal, bagCount, bag]);

  async function applyPromoCode() {
    const code = promoInput.trim().toUpperCase();
    setPromoMessage("");
    setServerPromo(null);
    setAppliedPromoCode(code);
    if (!code || !store || bag.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/v1/marketplace/stores/${encodeURIComponent(store.slug || store.id)}/promo-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, items: bag.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.valid) {
        setServerPromo({ code: data.code, title: data.title, kind: data.kind, amount: Number(data.amount) || 0, freeDelivery: Boolean(data.freeDelivery) });
      } else {
        setPromoMessage(data.message || "That code isn't valid for this bag.");
      }
    } catch {
      setPromoMessage("Could not check the code. Please try again.");
    }
  }

  const netBagTotal = Math.max(0, bagSubtotal - promoEvaluation.amount);
  const loyaltyCashbackUgx = useMemo(() => {
    if (!store?.loyalty_enabled || !store?.loyalty_cashback_percent) return 0;
    return Math.round((netBagTotal * Number(store.loyalty_cashback_percent)) / 100);
  }, [store, netBagTotal]);

  async function handleSubmitB2bQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!store) return;
    const selectedItems = products
      .filter((p) => (b2bQuantities[p.id] || 0) > 0)
      .map((p) => ({
        productId: p.id,
        title: p.title,
        unitPrice: p.price,
        quantity: b2bQuantities[p.id],
      }));
    if (selectedItems.length === 0) {
      setB2bStatus("Select at least 1 product quantity for your wholesale quote.");
      return;
    }
    setB2bSubmitting(true);
    setB2bStatus("");
    try {
      const res = await fetch(`${API_BASE}/v1/marketplace/stores/${encodeURIComponent(store.slug || store.id)}/b2b-inquiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(b2bProof ? { "x-phone-proof": b2bProof } : {}) },
        body: JSON.stringify({
          customer_name: b2bName,
          customer_phone: b2bPhone,
          customer_company: b2bCompany || undefined,
          payment_terms: b2bTerms,
          notes: b2bNotes || undefined,
          items: selectedItems,
        }),
      });
      const data = await res.json();
      if (!res.ok && data.error === "phone_proof_required") {
        setB2bNeedsCode(true);
        setB2bStatus("To stop spam, we need to confirm your phone number. Send yourself a code, then submit again.");
      } else if (!res.ok) {
        setB2bStatus(data.message || "Could not submit wholesale quote.");
      } else {
        setB2bStatus(`Wholesale Quote #${String(data.id).slice(-6).toUpperCase()} sent to ${store.name}! Total: ${ugx(data.total)}`);
        setB2bQuantities({});
      }
    } catch {
      setB2bStatus("Network error while sending wholesale inquiry.");
    } finally {
      setB2bSubmitting(false);
    }
  }

  async function sendB2bCode() {
    setB2bStatus("");
    try {
      const res = await fetch(`${API_BASE}/v1/public/phone-proof/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: b2bPhone, purpose: "b2b_inquiry" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setB2bStatus(data.message || "We couldn't send a code right now.");
        return;
      }
      setB2bChallenge(data.challenge);
      setB2bStatus("We texted you a 6-digit code. Enter it below.");
    } catch {
      setB2bStatus("Network error while sending the code.");
    }
  }

  async function confirmB2bCode() {
    try {
      const res = await fetch(`${API_BASE}/v1/public/phone-proof/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: b2bChallenge, code: b2bCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setB2bStatus(data.message || "That code isn't right.");
        return;
      }
      setB2bProof(data.proof);
      setB2bNeedsCode(false);
      setB2bStatus("Phone confirmed. Now submit your inquiry.");
    } catch {
      setB2bStatus("Network error while checking the code.");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream p-6 text-ink">
        <div className="text-center space-y-3">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-gold border-t-transparent" />
          <p className="text-sm font-bold text-ink-500">Loading brand storefront…</p>
        </div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-cream p-6 text-center text-ink">
        <Store className="h-12 w-12 text-gold" />
        <h1 className="mt-4 text-2xl font-black">This store isn&apos;t open right now</h1>
        <p className="mt-2 max-w-md text-sm text-ink-500">The shop is paused or temporarily closed. Please check back soon.</p>
        <a href={`${CUSTOMER_APP_URL}/stores`} className="mt-6 inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-ink-gold">
          Browse other stores
          <ChevronRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-cream p-6 text-center text-ink">
        <Store className="h-12 w-12 text-gold" />
        <h1 className="mt-4 text-2xl font-black">Storefront Unavailable</h1>
        <p className="mt-2 max-w-md text-sm text-ink-500">
          {error || "This merchant storefront has not been activated yet."}
        </p>
        <a
          href={`${CUSTOMER_APP_URL}/stores`}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-ink-gold"
        >
          Explore Peebee Marketplace
          <ChevronRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  const themeLayout = store.theme_layout || "grid";
  const themeAccent = store.theme_accent || "gold";
  const isElite = store.pro_tier === "elite" || Boolean(store.elite_tier);
  const dedicatedHost = store.custom_domain || `${store.slug}.peebee.online`;
  const customerAppStoreUrl = `${CUSTOMER_APP_URL}/store/${store.slug}`;
  // Admin decides how a web shopper completes an order (handoff to the app, or the store's WhatsApp).
  const checkoutMode = options?.checkoutMode ?? "handoff_to_app";
  const whatsappDigits = String(store.whatsapp_number || store.phone || "").replace(/[^0-9]/g, "");
  const whatsappOrderHref = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
        `Hello ${store.name} (${dedicatedHost}), I would like to order:\n` +
          bag.map((i) => `- ${i.quantity}x ${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ""}: ${ugx(i.price * i.quantity)}`).join("\n") +
          (promoEvaluation.discount ? `\nPromo Code: ${promoEvaluation.discount.code}` : "") +
          `\nNet Total: ${ugx(netBagTotal)}` +
          (deliveryAddress ? `\nDelivery to: ${deliveryAddress}` : ""),
      )}`
    : null;

  // Theme accent classes using Peebee's core tokens (gold, ink, cream)
  const heroBgClass =
    themeAccent === "ink"
      ? "bg-black-900 text-white"
      : themeAccent === "cream"
        ? "bg-surface-muted text-ink border border-[var(--border-faint)]"
        : "bg-black-900 text-white border-b-4 border-gold";

  const primaryBtnClass =
    themeAccent === "ink"
      ? "bg-ink text-cream"
      : "bg-gold text-ink-gold";

  return (
    <div className="min-h-screen bg-cream text-ink pb-28">
      {/* The store's own ad pixels, only when admin allows them and the IDs are the right shape (the API checks too). */}
      {options?.metaPixelId && /^\d{5,20}$/.test(options.metaPixelId) && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${options.metaPixelId}');fbq('track','PageView');`}
        </Script>
      )}
      {options?.tiktokPixelId && /^[A-Z0-9]{8,32}$/.test(options.tiktokPixelId) && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]={};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${options.tiktokPixelId}');ttq.page()}(window,document,'ttq');`}
        </Script>
      )}
      {/* Top Announcement & Dual-Channel Sync Bar */}
      <div className="bg-black-900 px-4 py-2 text-xs text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-0.5 text-[11px] font-bold text-gold">
              <Globe className="h-3 w-3" />
              {dedicatedHost}
            </span>
            <span className="truncate text-white/80">
              {store.announcement || `Welcome to ${store.name}`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {Boolean(store.loyalty_enabled) && Number(store.loyalty_cashback_percent || 0) > 0 && (
              <span className="inline-flex items-center gap-1 font-bold text-gold">
                <Gift className="h-3.5 w-3.5" />
                Earn {store.loyalty_cashback_percent}% VIP Cashback
              </span>
            )}
            <a
              href={customerAppStoreUrl}
              className="inline-flex items-center gap-1 font-bold text-white/90 underline decoration-gold underline-offset-4 hover:text-gold"
            >
              Open in Peebee App
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Storefront Brand Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-faint)] bg-cream/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            {store.logo_url ? (
              <img
                src={store.logo_url}
                alt={store.name}
                className="h-11 w-11 rounded-2xl object-cover border border-[var(--border-faint)]"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold font-black text-ink-gold">
                {store.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-black text-ink">{store.name}</h1>
                {isElite && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-ink">
                    <Crown className="h-3 w-3 text-gold" />
                    Elite Brand Store
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-ink-500">
                {store.address || ""}
                {outlets.length > 1 ? ` · ${outlets.length} Branch Locations` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {Boolean(store.b2b_wholesale_enabled) && (
              <button
                type="button"
                onClick={() => setB2bOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-surface-muted px-4 py-2 text-xs font-bold text-ink hover:border-gold"
              >
                <FileText className="h-3.5 w-3.5 text-gold" />
                B2B Wholesale Quote
              </button>
            )}
            <button
              type="button"
              onClick={() => setBagOpen(true)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-black shadow-sm ${primaryBtnClass}`}
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Bag ({bagCount})</span>
              {bagSubtotal > 0 && <span className="hidden md:inline">· {ugx(netBagTotal)}</span>}
            </button>
          </div>
        </div>
      </header>

      {/* Customized Storefront 2.0 Hero Section */}
      <section className="mx-auto max-w-6xl px-4 pt-5">
        <div className={`relative overflow-hidden rounded-[28px] p-6 sm:p-10 ${heroBgClass}`}>
          {store.banner_url && (
            <img
              src={store.banner_url}
              alt={store.name}
              className="absolute inset-0 h-full w-full object-cover opacity-25"
            />
          )}
          <div className="relative z-10 max-w-2xl space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[11px] font-black uppercase tracking-wider text-ink-gold">
                <Sparkles className="h-3 w-3" />
                {themeLayout === "editorial"
                  ? "Editorial Showcase"
                  : themeLayout === "compact"
                    ? "Express Wholesale & Retail"
                    : "Official Brand Storefront"}
              </span>
              {Boolean(store.is_live) && (
                <a
                  href={customerAppStoreUrl}
                  className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-[11px] font-black uppercase text-white animate-pulse"
                >
                  <Video className="h-3 w-3" />
                  Live Selling Now
                </a>
              )}
            </div>

            <h2 className="text-3xl font-black leading-tight sm:text-5xl">
              {store.hero_headline || `Welcome to ${store.name}`}
            </h2>
            <p className="text-sm sm:text-base opacity-85 max-w-xl">
              {store.hero_subheadline ||
                store.description ||
                `Shop ${store.name} online and have it delivered by Peebee.`}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href="#catalog"
                className="inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-xs font-black text-ink-gold"
              >
                {store.hero_cta_text || "Shop Collection"}
                <ChevronRight className="h-4 w-4" />
              </a>
              {Boolean(store.b2b_wholesale_enabled) && (
                <button
                  type="button"
                  onClick={() => setB2bOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-xs font-bold backdrop-blur-sm"
                >
                  <FileText className="h-4 w-4 text-gold" />
                  Request B2B Wholesale Invoice
                  {store.b2b_min_order_amount ? ` (Min ${ugx(store.b2b_min_order_amount)})` : ""}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Active Store Promotions & Coupons Strip */}
      {discounts.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-4">
          <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-gold/40 bg-gold/10 p-3.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-black text-ink">
              <Percent className="h-4 w-4 text-gold" />
              Active Storefront Offers:
            </span>
            {discounts.map((d) => {
              const isApplied = appliedPromoCode.toUpperCase() === d.code.toUpperCase();
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setAppliedPromoCode(d.code);
                    setPromoInput(d.code);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold transition ${
                    isApplied
                      ? "bg-ink text-cream"
                      : "bg-surface-card text-ink border border-[var(--border-faint)] hover:border-gold"
                  }`}
                >
                  <Tag className="h-3 w-3 text-gold" />
                  <span>{d.title}</span>
                  <span className="font-mono text-[11px] font-black uppercase">({d.code})</span>
                  {isApplied && <Check className="h-3 w-3 text-gold" />}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Multi-Outlet Branch Availability Strip */}
      {outlets.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-faint)] bg-surface-card px-4 py-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-ink">
              <Building2 className="h-4 w-4 text-gold" />
              <span>Fulfilled from nearest stocked branch:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {outlets.map((o) => (
                <span
                  key={o.id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1 font-semibold text-ink"
                >
                  <MapPin className="h-3 w-3 text-gold" />
                  {o.name}
                  {o.address ? ` (${o.address})` : ""}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Search + Smart Collection Tabs */}
      <section id="catalog" className="mx-auto max-w-6xl px-4 pt-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Smart Collections & Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCollectionId("all")}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-black transition ${
                activeCollectionId === "all"
                  ? "bg-ink text-cream"
                  : "bg-surface-muted text-ink hover:bg-gold/20"
              }`}
            >
              All ({products.length})
            </button>
            {collections.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => setActiveCollectionId(col.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black transition ${
                  activeCollectionId === col.id
                    ? "bg-gold text-ink-gold"
                    : "bg-surface-muted text-ink hover:bg-gold/20"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                {col.title}
              </button>
            ))}
            {products.some((p) => !!p.badge || (p.compare_at_price != null && p.compare_at_price > p.price)) && (
              <button
                type="button"
                onClick={() => setActiveCollectionId("deals")}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-black transition ${
                  activeCollectionId === "deals"
                    ? "bg-gold text-ink-gold"
                    : "bg-surface-muted text-ink hover:bg-gold/20"
                }`}
              >
                Special Offers
              </button>
            )}
            {digitalProducts.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveCollectionId("digital")}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black transition ${
                  activeCollectionId === "digital"
                    ? "bg-gold text-ink-gold"
                    : "bg-surface-muted text-ink hover:bg-gold/20"
                }`}
              >
                <Download className="h-3.5 w-3.5" />
                Digital Downloads ({digitalProducts.length})
              </button>
            )}
            {courses.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveCollectionId("courses")}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black transition ${
                  activeCollectionId === "courses"
                    ? "bg-gold text-ink-gold"
                    : "bg-surface-muted text-ink hover:bg-gold/20"
                }`}
              >
                <GraduationCap className="h-3.5 w-3.5" />
                Courses &amp; Learn ({courses.length})
              </button>
            )}
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCollectionId(`cat:${cat}`)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${
                  activeCollectionId === `cat:${cat}`
                    ? "bg-ink text-cream"
                    : "bg-surface-muted text-ink hover:bg-gold/20"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Solid single-shade search field-box */}
          <div className="field-box flex items-center gap-2 rounded-2xl px-3.5 py-2 sm:w-72">
            <Search className="h-4 w-4 shrink-0 text-ink-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${store.name}…`}
              className="w-full text-xs font-semibold text-ink placeholder:text-ink-500 focus:outline-none"
            />
          </div>
        </div>

        {activeCollection?.description && (
          <p className="text-xs font-semibold text-ink-500">{activeCollection.description}</p>
        )}

        {/* Bundles & Gift Hampers */}
        {bundles.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-ink">Bundles & Gift Hampers</h2>
                <p className="text-xs text-ink-500">Curated combo kits and value packs</p>
              </div>
              <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-gold">Package Deals</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {bundles.map((bundle) => {
                const savings = bundle.compare_at_price && bundle.compare_at_price > bundle.price ? bundle.compare_at_price - bundle.price : 0;
                return (
                  <div
                    key={bundle.id}
                    className="flex flex-col justify-between rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-base text-ink">{bundle.title}</h3>
                        {savings > 0 && (
                          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-black text-emerald-600">
                            Save {ugx(savings)}
                          </span>
                        )}
                      </div>
                      {bundle.description && <p className="mt-1 text-xs text-ink-500">{bundle.description}</p>}
                      <div className="mt-3 flex items-center gap-2">
                        <span className="font-mono font-black text-base text-gold">{ugx(bundle.price)}</span>
                        {bundle.compare_at_price && (
                          <span className="font-mono text-xs text-ink-400 line-through">{ugx(bundle.compare_at_price)}</span>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-[var(--border-faint)] pt-3 text-xs text-ink-500 space-y-2">
                      <span className="block text-[11px] font-bold">Includes:</span>
                      <ul className="space-y-1">
                        {bundle.items?.map((it: any, i: number) => (
                          <li key={i} className="flex items-center gap-1.5 text-xs text-ink">
                            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                            <span>{it.quantity}x {it.title}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => {
                          addToBag({
                            id: bundle.id,
                            name: bundle.title,
                            price: bundle.price,
                            image_url: null,
                            quantity: 1,
                          } as any);
                        }}
                        className="w-full mt-2 rounded-2xl bg-gold py-2.5 text-xs font-bold text-ink-gold shadow transition active:scale-95"
                      >
                        Add Bundle to Bag
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Digital Products Showcase (E-books, Software, Guides, Presets) */}
        {digitalProducts.length > 0 && (activeCollectionId === "all" || activeCollectionId === "digital") && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-ink flex items-center gap-2">
                  <Download className="h-5 w-5 text-gold" />
                  Instant Digital Downloads &amp; Resources
                </h2>
                <p className="text-xs text-ink-500">Automated instant download links &amp; license keys delivered upon payment</p>
              </div>
              <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-black text-gold">Instant Delivery</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {digitalProducts.map((dig) => {
                const digPrice = Number(dig.price_ugx ?? dig.price ?? 0);
                const digCompare = dig.compare_at_price_ugx ?? dig.compare_at_price ?? null;
                const savings = digCompare && digCompare > digPrice ? digCompare - digPrice : 0;
                const sizeMb = dig.file_size_bytes ? (dig.file_size_bytes / (1024 * 1024)).toFixed(1) + " MB" : null;
                const kindBadge = dig.kind === "license_key" ? "Software License Key" : dig.kind === "template" ? "Digital Toolkit" : dig.kind === "course" ? "Masterclass" : "Instant Download";
                return (
                  <div
                    key={dig.id}
                    className="flex flex-col justify-between rounded-3xl border border-gold/30 bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4 hover:border-gold transition"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-gold">
                          {kindBadge}
                        </span>
                        {savings > 0 && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-600">
                            Save {ugx(savings)}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 font-bold text-base text-ink leading-tight">{dig.title}</h3>
                      {dig.description && <p className="mt-1 text-xs text-ink-500 line-clamp-2">{dig.description}</p>}
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-mono font-black text-base text-gold">{ugx(digPrice)}</span>
                        {digCompare && (
                          <span className="font-mono text-xs text-ink-400 line-through">{ugx(digCompare)}</span>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-[var(--border-faint)] pt-3 text-xs text-ink-500 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1 font-semibold text-ink">
                          <CheckCircle2 className="h-3.5 w-3.5 text-gold" />
                          {sizeMb ? `File: ${sizeMb}` : "Instant access"}
                        </span>
                        <span className="text-ink-400">⚡ Instant access</span>
                      </div>
                      {/* Digital goods are paid from the wallet in the Peebee app, not added to the delivery bag. */}
                      <a
                        href={`${customerAppStoreUrl}#digital`}
                        className="mt-2 flex w-full items-center justify-center rounded-2xl bg-gold py-2.5 text-xs font-black text-ink-gold shadow transition hover:opacity-90 active:scale-95"
                      >
                        Buy in the Peebee app ({ugx(digPrice)})
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Online Video Masterclasses & Courses (Synced with Peebee Learn) */}
        {courses.length > 0 && (activeCollectionId === "all" || activeCollectionId === "courses") && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-ink flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-gold" />
                  Online Courses &amp; Masterclasses
                </h2>
                <p className="text-xs text-ink-500">Official masterclasses synced directly with Peebee Learn LMS player</p>
              </div>
              <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-black text-gold">Peebee Learn Certified</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {courses.map((course) => {
                return (
                  <div
                    key={course.id}
                    className="flex flex-col justify-between rounded-3xl border border-gold/30 bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4 hover:border-gold transition"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-ink">
                          <Sparkles className="h-3 w-3 text-gold" />
                          {course.category || "Masterclass"}
                        </span>
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-ink-500 uppercase">
                          {course.level || "All Levels"}
                        </span>
                      </div>
                      <h3 className="mt-2 font-bold text-base text-ink leading-tight">{course.title}</h3>
                      {(course.summary || course.subtitle || course.description) && (
                        <p className="mt-1 text-xs text-ink-500 line-clamp-2">{course.summary || course.subtitle || course.description}</p>
                      )}
                      <div className="mt-3 flex items-center gap-4 text-xs text-ink font-semibold">
                        <span className="flex items-center gap-1">
                          <PlayCircle className="h-3.5 w-3.5 text-gold" />
                          {course.lessons_count ?? 12} Lessons
                        </span>
                        {course.duration_minutes ? (
                          <span className="flex items-center gap-1 text-ink-500">
                            <Clock className="h-3.5 w-3.5 text-gold" />
                            {Math.round(course.duration_minutes / 60)}h {course.duration_minutes % 60}m
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-mono font-black text-base text-gold">{ugx(course.price_ugx)}</span>
                        <span className="text-[11px] font-bold text-emerald-600">Lifetime Learn Access</span>
                      </div>
                    </div>
                    <div className="border-t border-[var(--border-faint)] pt-3 text-xs text-ink-500 space-y-2">
                      <div className="flex items-center gap-2">
                        <a
                          href={`${CUSTOMER_APP_URL}/learn/course/${course.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 text-center rounded-2xl border border-[var(--border-faint)] bg-surface-muted py-2 text-[11px] font-bold text-ink hover:border-gold transition"
                        >
                          Preview Curriculum
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            addToBag({
                              id: course.id,
                              title: course.title,
                              price: course.price_ugx,
                              image_url: null,
                              store_id: store.id,
                              description: course.subtitle,
                            } as any);
                          }}
                          className="flex-1 rounded-2xl bg-gold py-2 text-[11px] font-black text-ink-gold shadow transition hover:opacity-90 active:scale-95"
                        >
                          Enroll Now
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Product Catalog Layout: Editorial vs Compact vs Standard Grid */}
        {filteredProducts.length === 0 ? (
          <div className="rounded-3xl border border-[var(--border-faint)] bg-surface-card p-12 text-center">
            <Package className="mx-auto h-8 w-8 text-ink-500" />
            <p className="mt-3 text-sm font-bold text-ink">No matching products in this collection</p>
            <button
              type="button"
              onClick={() => {
                setActiveCollectionId("all");
                setSearchQuery("");
              }}
              className="mt-3 rounded-full bg-gold px-4 py-2 text-xs font-bold text-ink-gold"
            >
              Show All Products
            </button>
          </div>
        ) : themeLayout === "compact" ? (
          /* COMPACT / WHOLESALE LIST THEME */
          <div className="divide-y divide-[var(--border-faint)] rounded-3xl border border-[var(--border-faint)] bg-surface-card overflow-hidden">
            {filteredProducts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 p-4 hover:bg-surface-muted/50">
                <div className="flex items-center gap-3.5 min-w-0">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.title} className="h-14 w-14 rounded-2xl object-cover shrink-0" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-ink-500 shrink-0">
                      <Package className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-black text-ink">{p.title}</h3>
                      {p.badge && (
                        <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-black text-ink">
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-500">{p.description || p.category_name || "In Stock"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-black text-ink">{ugx(p.price)}</p>
                    {p.compare_at_price && p.compare_at_price > p.price && (
                      <p className="text-[11px] text-ink-500 line-through">{ugx(p.compare_at_price)}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => addToBag(p)}
                    className={`inline-flex items-center gap-1 rounded-full px-4 py-2 text-xs font-black ${primaryBtnClass}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : themeLayout === "editorial" ? (
          /* EDITORIAL LUXURY MAGAZINE THEME */
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {filteredProducts.map((p) => (
              <article
                key={p.id}
                className="group overflow-hidden rounded-[28px] border border-[var(--border-faint)] bg-surface-card shadow-sm transition hover:shadow-md"
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-muted">
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.title}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-ink-500">
                      <Package className="h-10 w-10" />
                    </div>
                  )}
                  {p.badge && (
                    <span className="absolute left-4 top-4 rounded-full bg-black-900/90 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-gold">
                      {p.badge}
                    </span>
                  )}
                </div>
                <div className="p-6 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
                        {p.category_name || store.name}
                      </p>
                      <h3 className="mt-1 text-xl font-black text-ink">{p.title}</h3>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-ink">{ugx(p.price)}</p>
                      {p.compare_at_price && p.compare_at_price > p.price && (
                        <p className="text-xs text-ink-500 line-through">{ugx(p.compare_at_price)}</p>
                      )}
                    </div>
                  </div>
                  {p.description && <p className="text-xs leading-relaxed text-ink-500 line-clamp-2">{p.description}</p>}
                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-ink-500">
                      {p.inventory_quantity != null ? `${p.inventory_quantity} available` : "Ready for dispatch"}
                    </span>
                    <button
                      type="button"
                      onClick={() => addToBag(p)}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-black ${primaryBtnClass}`}
                    >
                      <Plus className="h-4 w-4" />
                      Add to Bag
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          /* STANDARD MODERN GRID THEME */
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((p) => (
              <article
                key={p.id}
                className="flex flex-col justify-between overflow-hidden rounded-3xl border border-[var(--border-faint)] bg-surface-card p-3 transition hover:shadow-md"
              >
                <div>
                  <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-surface-muted">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink-500">
                        <Package className="h-8 w-8" />
                      </div>
                    )}
                    {p.badge && (
                      <span className="absolute left-2.5 top-2.5 rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-black text-ink-gold">
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 space-y-1 px-1">
                    <p className="text-[10px] font-bold uppercase text-ink-500 truncate">
                      {p.category_name || store.category}
                    </p>
                    <h3 className="text-sm font-black text-ink line-clamp-2">{p.title}</h3>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between px-1 pt-2 border-t border-[var(--border-faint)]">
                  <div>
                    <p className="text-sm font-black text-ink">{ugx(p.price)}</p>
                    {p.compare_at_price && p.compare_at_price > p.price && (
                      <p className="text-[10px] text-ink-500 line-through">{ugx(p.compare_at_price)}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => addToBag(p)}
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${primaryBtnClass}`}
                    aria-label={`Add ${p.title}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Sections the merchant wrote in the Store 2.0 builder (reviews, promises, FAQ, video). Nothing is invented here. */}
      <ContentSections sections={sections} />

      {/* Storefront Footer — Powered by Peebee Commerce OS */}
      <footer className="mx-auto mt-16 max-w-6xl border-t border-[var(--border-faint)] px-4 pt-8 text-xs text-ink-500">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-black text-ink">{store.name} · Official Brand Storefront ({dedicatedHost})</p>
            <p className="mt-1">
              Powered by Peebee · Delivery by verified Peebee riders.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={customerAppStoreUrl}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-4 py-2 font-bold text-ink"
            >
              View on Peebee Marketplace App
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </footer>

      {/* Storefront Shopping Bag & Promo Checkout Drawer */}
      {bagOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
          <div className="flex h-full w-full max-w-md flex-col justify-between bg-cream p-5 text-ink shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-4">
              <div>
                <h2 className="text-lg font-black">{store.name} Bag</h2>
                <p className="text-xs text-ink-500">{dedicatedHost}</p>
              </div>
              <button
                type="button"
                onClick={() => setBagOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              {bag.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <ShoppingBag className="mx-auto h-10 w-10 text-ink-500" />
                  <p className="text-sm font-bold">Your storefront bag is empty</p>
                  <p className="text-xs text-ink-500">Add items from {store.name} to calculate promos and delivery.</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2.5">
                    {bag.map((item) => (
                      <div
                        key={`${item.productId}-${item.variantTitle || ""}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-faint)] bg-surface-card p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-black text-ink">{item.title}</p>
                          <p className="text-[11px] text-ink-500">{ugx(item.price)} each</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateBagQty(item.productId, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-5 text-center text-xs font-black">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateBagQty(item.productId, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Promo Code Box (Single solid fill via field-box) */}
                  <div className="space-y-1.5 pt-2">
                    <label className="text-[11px] font-bold uppercase text-ink-500">Promo / Coupon Code</label>
                    <div className="flex gap-2">
                      <div className="field-box flex flex-1 items-center gap-2 rounded-xl px-3">
                        <Tag className="h-4 w-4 text-gold shrink-0" />
                        <input
                          type="text"
                          value={promoInput}
                          onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                          placeholder="Enter promo code"
                          className="w-full py-2 font-mono text-xs font-bold uppercase focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void applyPromoCode()}
                        className="rounded-xl bg-ink px-4 py-2 text-xs font-black text-cream"
                      >
                        Apply
                      </button>
                    </div>
                    {promoMessage && <p className="text-xs font-semibold text-red-600">{promoMessage}</p>}
                    {promoEvaluation.discount && !promoEvaluation.belowMin && (
                      <p className="text-xs font-bold text-green-600">
                        ✓ Applied {promoEvaluation.discount.code}: {promoEvaluation.discount.title}
                        {promoEvaluation.amount > 0 ? ` (-${ugx(promoEvaluation.amount)})` : ""}
                        {promoEvaluation.freeDelivery ? " (Free Delivery)" : ""}
                      </p>
                    )}
                    {promoEvaluation.discount && promoEvaluation.belowMin && (
                      <p className="text-xs font-semibold text-gold">
                        Add {ugx(Number(promoEvaluation.discount.min_order_amount) - bagSubtotal)} more to unlock {promoEvaluation.discount.code}.
                      </p>
                    )}
                  </div>

                  {/* Delivery Destination Input */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase text-ink-500">Delivery Area / Landmark</label>
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="e.g. Acacia Mall, Kololo / Ntinda"
                      className="w-full rounded-xl text-xs font-semibold"
                    />
                  </div>

                  {/* Summary Breakdown */}
                  <div className="rounded-2xl border border-[var(--border-faint)] bg-surface-card p-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-ink-500">Items Subtotal</span>
                      <span className="font-bold">{ugx(bagSubtotal)}</span>
                    </div>
                    {promoEvaluation.amount > 0 && (
                      <div className="flex justify-between text-green-600 font-bold">
                        <span>Promo Discount ({promoEvaluation.discount?.code})</span>
                        <span>-{ugx(promoEvaluation.amount)}</span>
                      </div>
                    )}
                    {promoEvaluation.freeDelivery && (
                      <div className="flex justify-between text-green-600 font-bold">
                        <span>Delivery Promo</span>
                        <span>FREE DELIVERY</span>
                      </div>
                    )}
                    {loyaltyCashbackUgx > 0 && (
                      <div className="flex justify-between text-gold font-bold">
                        <span>Loyalty cashback ({store.loyalty_cashback_percent}%)</span>
                        <span>+{ugx(loyaltyCashbackUgx)} credited after delivery</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-[var(--border-faint)] pt-2 text-sm font-black">
                      <span>Storefront Total</span>
                      <span>{ugx(netBagTotal)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {bag.length > 0 && (
              <div className="space-y-2 border-t border-[var(--border-faint)] pt-4">
                {checkoutMode !== "whatsapp_order" && (
                  <a
                    href={`${customerAppStoreUrl}?promo=${encodeURIComponent(serverPromo?.code ?? appliedPromoCode)}&channel=dedicated_storefront`}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-xs font-black text-ink-gold"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Continue in the Peebee app to pay ({ugx(netBagTotal)})
                  </a>
                )}
                {whatsappOrderHref && (
                  <a
                    href={whatsappOrderHref}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex min-h-10 w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold ${
                      checkoutMode === "whatsapp_order" ? "bg-gold text-ink-gold" : "border border-[var(--border-faint)] bg-surface-muted text-ink"
                    }`}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {checkoutMode === "whatsapp_order" ? `Send my order to ${store.name} on WhatsApp` : "Order via the store's WhatsApp"}
                  </a>
                )}
                {checkoutMode === "whatsapp_order" && !whatsappOrderHref && (
                  <p className="text-center text-xs text-ink-500">This store hasn&apos;t added a WhatsApp number yet.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* B2B Wholesale Quote Request Modal */}
      {b2bOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-cream p-6 text-ink shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
              <div>
                <h2 className="text-lg font-black">B2B Wholesale Inquiry · {store.name}</h2>
                <p className="text-xs text-ink-500">
                  Request a wholesale invoice with Net-7/14/30 credit terms directly from {dedicatedHost}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setB2bOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitB2bQuote} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-bold mb-1">Contact Name *</label>
                  <input
                    required
                    value={b2bName}
                    onChange={(e) => setB2bName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Phone / WhatsApp *</label>
                  <input
                    required
                    value={b2bPhone}
                    onChange={(e) => setB2bPhone(e.target.value)}
                    placeholder="+256 7..."
                    className="w-full rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-bold mb-1">Company / Organization</label>
                  <input
                    value={b2bCompany}
                    onChange={(e) => setB2bCompany(e.target.value)}
                    placeholder="Business name"
                    className="w-full rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Payment Terms</label>
                  <select
                    value={b2bTerms}
                    onChange={(e) => setB2bTerms(e.target.value as any)}
                    className="w-full rounded-xl"
                  >
                    <option value="immediate">Immediate on Delivery</option>
                    <option value="net_7">Net 7 Days</option>
                    <option value="net_14">Net 14 Days</option>
                    <option value="net_30">Net 30 Days</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="block font-bold">Wholesale Quantities</label>
                <div className="max-h-48 overflow-y-auto space-y-2 rounded-2xl border border-[var(--border-faint)] bg-surface-card p-3">
                  {products.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{p.title}</p>
                        <p className="text-[11px] text-ink-500">{ugx(p.price)} / unit</p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={b2bQuantities[p.id] ?? 0}
                        onChange={(e) =>
                          setB2bQuantities((prev) => ({
                            ...prev,
                            [p.id]: Math.max(0, parseInt(e.target.value || "0", 10)),
                          }))
                        }
                        className="w-20 rounded-xl text-center font-bold"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Delivery / Purchase Order Notes</label>
                <input
                  value={b2bNotes}
                  onChange={(e) => setB2bNotes(e.target.value)}
                  placeholder="TIN, delivery schedule, or special instructions"
                  className="w-full rounded-xl"
                />
              </div>

              {b2bNeedsCode && (
                <div className="space-y-2 rounded-xl bg-surface-muted p-3">
                  <button type="button" onClick={() => void sendB2bCode()} className="rounded-xl bg-ink px-4 py-2 text-xs font-black text-cream">
                    Text me a code
                  </button>
                  {b2bChallenge && (
                    <div className="flex gap-2">
                      <div className="field-box flex-1 rounded-xl">
                        <input
                          inputMode="numeric"
                          maxLength={6}
                          value={b2bCode}
                          onChange={(e) => setB2bCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="6-digit code"
                          aria-label="6-digit code"
                          className="w-full p-2.5 text-xs font-mono font-bold focus:outline-none"
                        />
                      </div>
                      <button type="button" onClick={() => void confirmB2bCode()} className="rounded-xl bg-gold px-4 py-2 text-xs font-black text-ink-gold">
                        Confirm
                      </button>
                    </div>
                  )}
                </div>
              )}
              {b2bStatus && (
                <p className="rounded-xl bg-gold/15 p-3 font-bold text-ink">{b2bStatus}</p>
              )}

              <button
                type="submit"
                disabled={b2bSubmitting}
                className="w-full rounded-full bg-gold py-3 text-xs font-black text-ink-gold"
              >
                {b2bSubmitting ? "Sending Wholesale Inquiry…" : "Submit B2B Wholesale Inquiry"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


/** The merchant's own page sections, in the order they chose. A section with nothing in it shows nothing. */
function ContentSections({ sections }: { sections: StorefrontSection[] }) {
  const ordered = [...sections].filter((sec) => sec.enabled).sort((a, b) => a.order - b.order);
  return (
    <>
      {ordered.map((sec) => {
        const items = (Array.isArray(sec.settings?.items) ? sec.settings!.items : []) as Array<Record<string, any>>;
        if (sec.type === "testimonials" && items.length > 0) {
          return (
            <section key={sec.id} className="mx-auto mt-16 max-w-6xl space-y-4 px-4">
              <div>
                <h2 className="text-xl font-black text-ink">{sec.title}</h2>
                {sec.subtitle && <p className="text-xs text-ink-500">{sec.subtitle}</p>}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {items.map((t, i) => (
                  <figure key={i} className="space-y-2 rounded-3xl border border-[var(--border-faint)] bg-surface-card p-5 shadow-xs">
                    {sec.settings?.showRatings !== false && t.rating ? (
                      <div className="flex text-xs text-gold" aria-label={`${t.rating} out of 5`}>{"★".repeat(Number(t.rating))}{"☆".repeat(5 - Number(t.rating))}</div>
                    ) : null}
                    <blockquote className="text-xs italic text-ink-600">&ldquo;{String(t.quote)}&rdquo;</blockquote>
                    <figcaption className="pt-2 text-[11px] font-bold text-ink">{String(t.author)}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          );
        }
        if (sec.type === "trust_badges" && items.length > 0) {
          return (
            <section key={sec.id} className="mx-auto mt-12 max-w-6xl px-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {items.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-surface-card p-3.5 shadow-xs">
                    {b.icon ? <span className="text-2xl" aria-hidden>{String(b.icon)}</span> : null}
                    <div>
                      <div className="text-xs font-black text-ink">{String(b.title)}</div>
                      {b.text ? <div className="text-[10px] text-ink-500">{String(b.text)}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        }
        if (sec.type === "faq" && items.length > 0) {
          return (
            <section key={sec.id} className="mx-auto mt-12 max-w-6xl space-y-4 px-4">
              <h2 className="text-xl font-black text-ink">{sec.title}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {items.map((q, i) => (
                  <details key={i} className="rounded-2xl border border-[var(--border-faint)] bg-surface-card p-4">
                    <summary className="cursor-pointer text-xs font-black text-ink">{String(q.question)}</summary>
                    <p className="mt-2 text-xs text-ink-500">{String(q.answer)}</p>
                  </details>
                ))}
              </div>
            </section>
          );
        }
        if (sec.type === "video_spotlight" && typeof sec.settings?.videoUrl === "string" && sec.settings.videoUrl) {
          const url = sec.settings.videoUrl as string;
          const direct = /\.(mp4|webm)(\?.*)?$/i.test(url);
          return (
            <section key={sec.id} className="mx-auto mt-12 max-w-6xl space-y-3 px-4">
              <h2 className="text-xl font-black text-ink">{sec.title}</h2>
              {direct ? (
                <video src={url} controls playsInline muted={Boolean(sec.settings.autoPlayMuted)} className="w-full rounded-3xl bg-black" />
              ) : (
                <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-3 text-xs font-black text-ink-gold">
                  <PlayCircle className="h-4 w-4" />
                  Watch the video
                </a>
              )}
            </section>
          );
        }
        return null;
      })}
    </>
  );
}
