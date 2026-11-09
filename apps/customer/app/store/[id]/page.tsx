"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, LayoutGrid } from "lucide-react";
import { api, errorMessage } from "../../../lib/api";
import { LiveStreamChannel, LiveStreamViewer, PinnedProduct } from "../../../components/LiveStreamViewer";
import { CategoryChips, MarketProductCard, MarketSearchBar, defaultVariant, productPricing, softCard, ugx } from "../../../components/marketplace/MarketplaceUI";
import { ProductImage } from "../../../components/ProductImage";
import { addToCart } from "../../../lib/cart";
import { CartDrawer, CartDrawerTrigger } from "../../../components/CartDrawer";
import { DigitalShelf } from "../../../components/marketplace/DigitalShelf";
import { useCustomerLocation, formatDistanceKm, haversineKm } from "../../../lib/location";

interface StoreDetail {
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
  lat?: number | null;
  lng?: number | null;
  distance_km?: number | null;
  is_open?: number | boolean;
  delivery_enabled?: number | boolean;
  pickup_enabled?: number | boolean;
  min_order_amount?: number;
  is_live?: number | boolean;
  live_channel_title?: string | null;
  live_stream_url?: string | null;
  live_viewer_count?: number;
}

interface ProductVariant {
  id: string;
  title: string;
  price: number;
  compare_at_price?: number;
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
  has_variants?: number | boolean;
  variants?: ProductVariant[];
}

export default function StoreDetailPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [digitalItems, setDigitalItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // "All", "Deals" (badged or discounted items) or one of the store's categories.
  const [activeChip, setActiveChip] = useState<string>("All");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [error, setError] = useState("");
  const [showLiveViewer, setShowLiveViewer] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  const { lat: userLat, lng: userLng } = useCustomerLocation();

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!storeId) return;
      setLoading(true);
      setError("");

      try {
        const [storeRes, productsRes] = await Promise.all([
          api.getMarketplaceStore(storeId, userLat, userLng).catch(() => null),
          api.getMarketplaceStoreProducts(storeId).catch(() => null),
        ]);

        if (!active) return;

        if (storeRes && storeRes.store) {
          const loadedStore: StoreDetail = storeRes.store;
          if (
            loadedStore.distance_km == null &&
            userLat != null &&
            userLng != null &&
            loadedStore.lat != null &&
            loadedStore.lng != null
          ) {
            loadedStore.distance_km =
              Math.round(haversineKm(userLat, userLng, Number(loadedStore.lat), Number(loadedStore.lng)) * 10) / 10;
          }
          setStore(loadedStore);
          setDigitalItems((storeRes as { digitalProducts?: any[] }).digitalProducts ?? []);
        } else {
          setError("Store not found");
        }

        if (productsRes && productsRes.products) {
          setProducts(productsRes.products);
        }
      } catch (err) {
        if (!active) return;
        setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadData();
    return () => {
      active = false;
    };
  }, [storeId, userLat, userLng]);

  const isDeal = (p: StoreProduct) => !!p.badge || (p.compare_at_price != null && p.compare_at_price > p.price);

  const filteredProducts = products.filter((p) => {
    if (activeChip === "Deals" && !isDeal(p)) return false;
    if (activeChip !== "All" && activeChip !== "Deals" && p.category_name !== activeChip) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        p.title.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  const categoryNames = Array.from(
    new Set(products.map((p) => p.category_name).filter((c): c is string => !!c)),
  );
  const chips = [
    "All",
    ...(products.some(isDeal) ? ["Deals"] : []),
    ...(categoryNames.length > 1 ? categoryNames : []),
  ];

  // Feature a product with a real discount on the price the card shows.
  const promoProduct = products.find((p) => productPricing(p).discount > 0) || products[0];
  const promoPricing = promoProduct ? productPricing(promoProduct) : null;
  const promoDiscount = promoPricing?.discount ?? 0;
  const promoDefault = promoProduct ? defaultVariant(promoProduct) : undefined;

  // Same default as the product page: first variant when the product has variants.
  function addProduct(p: StoreProduct) {
    const v = p.variants?.[0];
    addToCart({
      productId: p.id,
      storeId: p.store_id,
      storeName: store?.name || "Partner Store",
      storeSlug: store?.slug,
      title: p.title,
      variantId: v?.id,
      variantTitle: v?.title,
      price: v?.price ?? p.price,
      compareAtPrice: (v?.compare_at_price ?? p.compare_at_price) || undefined,
      imageUrl: p.image_url || undefined,
      category: p.category_name || undefined,
      quantity: 1,
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-[75vh] items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-3 border-gold border-t-transparent" />
          <p className="text-sm font-semibold text-ink-500">Opening store…</p>
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="mx-auto max-w-md p-6 text-center space-y-4 pt-16">
        <h2 className="text-xl font-bold text-ink">Store Not Found</h2>
        <p className="text-xs text-ink-500">
          {error || "The store you requested is not currently active."}
        </p>
        <Link
          href="/stores"
          className="inline-block rounded-full bg-gold px-6 py-3 text-xs font-bold text-ink-gold"
        >
          Browse Marketplace Stores
        </Link>
      </div>
    );
  }

  const liveChannel: LiveStreamChannel = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    logo_url: store.logo_url,
    banner_url: store.banner_url,
    category: store.category,
    live_channel_title: store.live_channel_title ?? null,
    live_stream_url: store.live_stream_url ?? null,
    live_viewer_count: store.live_viewer_count || 0,
  };

  return (
    <div className="min-h-screen bg-cream pb-32 pt-2 px-4 max-w-md mx-auto text-ink">
      {/* =========================================================================
          SCREEN 1: STOREFRONT HEADER (Inspiration Screen 1)
      ========================================================================= */}
      <header className="flex items-center justify-between py-2">
        {/* Left: 4-square grid button in soft squircle */}
        <button
          type="button"
          onClick={() => router.push("/stores")}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgb(var(--surface-card))] border border-[var(--border-faint)] text-ink active:scale-95"
          aria-label="All Stores"
        >
          <LayoutGrid className="h-5 w-5" />
        </button>

        {/* Center: Greeting & Store Name */}
        <div className="text-center min-w-0 px-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500 truncate">
            {store.distance_km != null ? `${formatDistanceKm(store.distance_km)} · ` : ""}
            {store.address ? store.address.split(",")[0] : "Kampala, UG"}
          </p>
          <h1 className="text-base font-extrabold text-ink truncate leading-tight">
            {store.name}
          </h1>
          <p className="truncate text-[12px] font-semibold text-ink-500">
            <span className={store.is_open === 0 || store.is_open === false ? "" : "text-green"}>{store.is_open === 0 || store.is_open === false ? "Closed" : "Open"}</span>
            {store.delivery_enabled === 0 || store.delivery_enabled === false ? "" : " · Delivery"}
            {store.pickup_enabled ? " · Pickup" : ""}
            {" · Escrow"}
          </p>
        </div>

        {/* Right: Cart Drawer Trigger & Store Avatar */}
        <div className="flex items-center gap-2">
          <CartDrawerTrigger
            onClick={() => setCartDrawerOpen(true)}
            className="h-11 w-11"
          />
          {store.logo_url ? (
            <img
              src={store.logo_url}
              alt={store.name}
              className="h-11 w-11 rounded-full object-cover border-2 border-gold/40 shadow-xs"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
          ) : null}
          <div
            style={{ display: store.logo_url ? "none" : "flex" }}
            className="h-11 w-11 items-center justify-center rounded-full bg-gold/20 border-2 border-gold/40 font-bold text-gold text-sm shadow-xs"
          >
            {store.name.slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      {/* Search + filter toggle (shared marketplace search bar). */}
      <div className="mt-3">
        <MarketSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={`Search ${store.name}…`}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((v) => !v)}
        />
      </div>

      {/* Featured deal: compact, one line of copy. */}
      {promoProduct && (
        <Link
          href={`/product/${promoProduct.id}`}
          className={`${softCard} mt-4 flex items-center gap-3 p-2.5 pr-4 transition active:scale-[0.99]`}
        >
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[16px] bg-[rgb(var(--surface-muted))]">
            <ProductImage
              src={promoProduct.image_url}
              alt={promoProduct.title}
              category={promoProduct.category_name || undefined}
              className="h-full w-full object-cover"
              aspectRatio="square"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gold">
              {promoDiscount ? `Featured deal · -${promoDiscount}%` : "Featured"}
            </p>
            <h2 className="mt-0.5 truncate text-sm font-bold text-ink">{promoProduct.title}</h2>
            <p className="mt-0.5 whitespace-nowrap text-xs font-semibold tabular-nums text-ink">
              {promoPricing?.from && <span className="mr-1 text-[11px] font-medium text-ink-500">from</span>}
              {ugx(promoPricing?.price ?? promoProduct.price)}
              {promoPricing?.compareAt != null ? (
                <span className="ml-1.5 text-[10px] font-medium text-ink-500 line-through">
                  {promoPricing.compareAt.toLocaleString()}
                </span>
              ) : null}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
        </Link>
      )}

      {/* Live now: slim row instead of a full-width banner. */}
      {store.is_live ? (
        <button
          type="button"
          onClick={() => setShowLiveViewer(true)}
          className={`${softCard} mt-3 flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition active:scale-[0.99]`}
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-red-600">Live now</span>
            <span className="block truncate text-xs font-semibold text-ink">
              {store.live_channel_title || `${store.name} is live`}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-[11px] font-bold text-ink-gold">Watch</span>
        </button>
      ) : null}

      {/* One chip row: All, Deals and the store's own categories. */}
      {filtersOpen && chips.length > 1 && (
        <div className="mt-3">
          <CategoryChips items={chips} active={activeChip} onSelect={setActiveChip} />
        </div>
      )}

      {/* =========================================================================
          2-COLUMN PRODUCT GRID
      ========================================================================= */}
      <section className="mt-3">
        <p className="mb-3 px-0.5 text-[11px] font-medium text-ink-500">
          {filteredProducts.length} item{filteredProducts.length === 1 ? "" : "s"} · Delivery 20–35 min
        </p>

        {filteredProducts.length === 0 ? (
          <div className={`${softCard} space-y-2 p-8 text-center`}>
            <p className="text-sm font-bold text-ink">No items match your filter</p>
            <p className="text-xs text-ink-500">Try &quot;All&quot; or clear your search.</p>
            <button
              type="button"
              onClick={() => {
                setActiveChip("All");
                setSearchQuery("");
              }}
              className="mt-2 text-xs font-bold text-gold underline"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            {filteredProducts.map((p) => (
              <MarketProductCard
                key={p.id}
                product={p}
                fallbackCategory={store.category}
                onAdd={() => addProduct(p)}
              />
            ))}
          </div>
        )}
      </section>

      <DigitalShelf items={digitalItems} />

      {/* Slide-in Shopping Cart Drawer */}
      <CartDrawer
        isOpen={cartDrawerOpen}
        onClose={() => setCartDrawerOpen(false)}
      />

      {/* Live Stream Viewer Modal */}
      {showLiveViewer && (
        <LiveStreamViewer
          channel={liveChannel}
          onClose={() => setShowLiveViewer(false)}
          pinnedProduct={
            promoProduct
              ? {
                  id: promoProduct.id,
                  title: promoProduct.title,
                  // Pinned price = what Buy adds (the default option).
                  price: promoDefault?.price ?? promoProduct.price,
                  compare_at_price: (promoDefault ? promoDefault.compare_at_price : promoProduct.compare_at_price) || undefined,
                  image_url: promoProduct.image_url || undefined,
                  badge: promoProduct.badge || undefined,
                }
              : null
          }
          onAddToCart={() => {
            if (promoProduct) addProduct(promoProduct);
          }}
        />
      )}
    </div>
  );
}
