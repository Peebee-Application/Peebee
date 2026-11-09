"use client";

import { ChevronLeft, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { buyCategoryNames } from "../../lib/buy-home";
import { addToCart } from "../../lib/cart";
import { navigateWithPush } from "../../lib/buy-motion";
import { formatDistanceKm, haversineKm, useCustomerLocation } from "../../lib/location";
import { useRegisterNavBack } from "../../lib/nav-primary-action";
import { defaultVariant, productPricing, type MarketVariant } from "../../lib/product-pricing";
import { CategoryChips, MarketProductCard } from "../marketplace/MarketplaceUI";
import { CollectionHero, type CollectionSlide } from "../shopping/collection";
import { Crossfade, PushLink, useFadeImages, useScrollLink } from "./motion";

type Shop = {
  id: string; name: string; slug?: string; category?: string; logo_url?: string | null; banner_url?: string | null;
  lat?: number | null; lng?: number | null; distance_km?: number | null; is_open?: number | boolean;
  min_order_amount?: number | null; delivery_enabled?: number | boolean; pickup_enabled?: number | boolean;
};
type Product = {
  id: string; store_id: string; store_name?: string; store_slug?: string; store_category?: string; title: string; price: number;
  compare_at_price?: number | null; image_url?: string | null; inventory_quantity?: number | null; variants?: MarketVariant[] | null;
  category_name?: string | null; badge?: string | null;
};

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-UG")}`;
const truthy = (v: unknown) => v === true || v === 1 || v === "1";

function useBuyShops() {
  const { lat, lng } = useCustomerLocation();
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [g, s] = await Promise.all([
        api.getMarketplaceStores("groceries", lat, lng).catch(() => ({ stores: [] as Shop[] })),
        api.getMarketplaceStores("stores", lat, lng).catch(() => ({ stores: [] as Shop[] })),
      ]);
      if (cancelled) return;
      const seen = new Set<string>();
      const all = [...(g.stores ?? []), ...(s.stores ?? [])]
        .filter((x) => x?.id && x.category !== "pharmacy" && !seen.has(x.id) && !!seen.add(x.id))
        .map((x) => {
          let d = x.distance_km ?? null;
          if (d == null && lat != null && lng != null && x.lat != null && x.lng != null) d = Math.round(haversineKm(lat, lng, Number(x.lat), Number(x.lng)) * 10) / 10;
          return { ...x, distance_km: d };
        })
        .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
      setShops(all);
      const lists = await Promise.all(all.slice(0, 8).map((st) =>
        api.getMarketplaceStoreProducts(st.id)
          .then((r) => (r.products ?? []).map((p: Product) => ({ ...p, store_id: st.id, store_name: st.name, store_slug: st.slug, store_category: st.category, price: Number(p.price) || 0 })))
          .catch(() => [] as Product[]),
      ));
      if (!cancelled) { setProducts(lists.flat()); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);
  return { shops, products, loaded };
}

function Shell({ title, id, query, onQuery, placeholder, filters, active, onSelect, children }: {
  title: string; id: string; query: string; onQuery: (value: string) => void; placeholder: string;
  filters: string[]; active: string; onSelect: (name: string) => void; children: ReactNode;
}) {
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const back = () => { void navigateWithPush(router, "/shopping", "back"); };
  useRegisterNavBack(true, back);
  useScrollLink("--c", 48, pageRef);
  useFadeImages(pageRef);
  useEffect(() => { document.getElementById(id)?.focus({ preventScroll: true }); }, [id]);
  return (
    <div ref={pageRef} className="buy-collection shop-page mx-auto max-w-lg px-4 pt-2">
      <div className="buy-collection__pin">
        <button type="button" className="buy-collection__back" aria-label="Back to Buy" onClick={back}><ChevronLeft className="h-5 w-5" aria-hidden /></button>
        <span className="buy-collection__compact">{title}</span>
      </div>
      <h1 id={id} tabIndex={-1} className="shop-title buy-collection__hero-title text-ink outline-none">{title}</h1>
      <label className="field-box shop-search relative mt-4">
        <span className="sr-only">Search</span>
        <Search className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} />
        {query && (
          <button type="button" onClick={() => onQuery("")} aria-label="Clear search" className="shop-iconbtn">
            <X className="h-4 w-4" />
          </button>
        )}
      </label>
      {filters.length > 0 && (
        <div className="buy-collection__bar">
          <CategoryChips items={filters} active={active} onSelect={onSelect} animatedIndicator />
        </div>
      )}
      <div className="mt-3 space-y-4">
        <Crossfade id={active}>{children}</Crossfade>
      </div>
    </div>
  );
}

function addProduct(p: Product) {
  const v = defaultVariant(p);
  addToCart({
    productId: p.id,
    storeId: p.store_id,
    storeName: p.store_name,
    storeSlug: p.store_slug,
    title: p.title,
    variantId: v?.id,
    variantTitle: v?.title,
    price: v ? Number(v.price) : p.price,
    compareAtPrice: (v ? v.compare_at_price : p.compare_at_price) ?? undefined,
    imageUrl: p.image_url ?? undefined,
    category: p.category_name || p.store_category,
  });
}

export function DealsCollection() {
  const { products, loaded } = useBuyShops();
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const names = useMemo(() => buyCategoryNames(products), [products]);
  const active = filter !== "All" && names.includes(filter) ? filter : "All";
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = products.filter((p) => {
      if (active !== "All" && p.category_name?.trim() !== active) return false;
      if (q && !`${p.title} ${p.store_name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const ranked = matched.map((p) => ({ p, discount: productPricing(p).discount }));
    ranked.sort((a, b) => b.discount - a.discount);
    return ranked.map((row) => row.p);
  }, [products, active, query]);
  const slides: CollectionSlide[] = rows.filter((p) => p.image_url).slice(0, 4).map((p) => ({
    id: p.id,
    title: p.title,
    subtitle: p.store_name,
    imageUrl: p.image_url,
    href: `/product/${p.id}`,
    cta: "Shop now",
  }));
  return (
    <Shell title="Deals" id="buy-deals-title" query={query} onQuery={setQuery} placeholder="Search deals" filters={names.length ? ["All", ...names] : []} active={active} onSelect={setFilter}>
      {loaded && slides.length > 0 && <CollectionHero slides={slides} label="Deals" />}
      {!loaded && <p className="sr-only" role="status">Loading deals</p>}
      {!loaded && <div className="shop-skel" aria-hidden="true"><i /><i /><i /><i /></div>}
      {loaded && rows.length === 0 && <p className="shop-empty">Nothing in this filter yet.</p>}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6">
          {rows.map((p) => <MarketProductCard key={p.id} product={p} onAdd={() => addProduct(p)} />)}
        </div>
      )}
    </Shell>
  );
}

export function NearbyCollection() {
  const { shops, loaded } = useBuyShops();
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const kinds = useMemo(() => {
    const seen = new Set<string>();
    for (const shop of shops) {
      const name = shop.category?.trim();
      if (name) seen.add(name);
    }
    return [...seen];
  }, [shops]);
  const filters = ["All", "Open", ...kinds.map((k) => k.charAt(0).toUpperCase() + k.slice(1))];
  const q = query.trim().toLowerCase();
  const shown = shops.filter((shop) => {
    if (q && !shop.name.toLowerCase().includes(q)) return false;
    if (filter === "Open") return truthy(shop.is_open ?? 1);
    if (filter === "All") return true;
    return shop.category?.toLowerCase() === filter.toLowerCase();
  });
  const slides: CollectionSlide[] = shown.slice(0, 4).map((shop) => ({
    id: shop.id,
    title: shop.name,
    subtitle: shop.distance_km != null ? formatDistanceKm(shop.distance_km) : undefined,
    imageUrl: shop.banner_url || shop.logo_url,
    href: `/store/${shop.id}`,
    cta: "View shop",
  }));
  return (
    <Shell title="Open near you" id="buy-nearby-title" query={query} onQuery={setQuery} placeholder="Search shops" filters={filters} active={filter} onSelect={setFilter}>
      {loaded && slides.length > 0 && <CollectionHero slides={slides} label="Shops near you" />}
      {!loaded && <p className="sr-only" role="status">Loading shops</p>}
      {!loaded && <div className="shop-skel" aria-hidden="true"><i /><i /></div>}
      {loaded && shown.length === 0 && <p className="shop-empty">No shops in this filter yet.</p>}
      {shown.length > 0 && (
        <div className="space-y-3">
          {shown.map((s) => {
            const open = truthy(s.is_open ?? 1);
            const service = [truthy(s.delivery_enabled ?? 1) ? "Delivery" : null, truthy(s.pickup_enabled) ? "Pickup" : null, "Escrow"].filter(Boolean).join(" · ");
            return (
              <PushLink key={s.id} href={`/store/${s.id}`} className="buy-press flex items-center gap-3.5 rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3.5 shadow-[var(--shadow-card)]">
                <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[18px] bg-[rgb(var(--surface-muted))] text-sm font-bold text-ink">
                  {(s.banner_url || s.logo_url) ? <img src={(s.banner_url || s.logo_url)!} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{s.name}</span>
                  <span className="mt-0.5 block text-xs font-semibold text-ink-500">
                    <span className={open ? "text-[rgb(var(--color-green))]" : undefined}>{open ? "Open" : "Closed"}</span>
                    {s.distance_km != null ? ` · ${formatDistanceKm(s.distance_km)}` : ""}
                    {s.min_order_amount ? ` · Min ${ugx(s.min_order_amount)}` : ""}
                  </span>
                  <span className="mt-1 block text-[11px] font-semibold text-ink-500">{service}</span>
                </span>
              </PushLink>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
