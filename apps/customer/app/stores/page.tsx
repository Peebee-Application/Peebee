"use client";

import {
  Flame,
  Radio,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Store,
  Tag,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { LiveStreamChannel, LiveStreamViewer, PinnedProduct } from "../../components/LiveStreamViewer";
import { CartDrawer, CartDrawerTrigger } from "../../components/CartDrawer";
import { useCustomerLocation, formatDistanceKm, haversineKm } from "../../lib/location";
import { useCart, addToCart as addMarketplaceCartItem } from "../../lib/cart";
import {
  CategoryChips,
  MarketGreetingHeader,
  MarketProductCard,
  type MarketVariant,
  defaultVariant,
  MarketSearchBar,
  PromoBanner,
} from "../../components/marketplace/MarketplaceUI";
import { CollectionHero, LiveRail, useCollectionTitleFocus } from "../../components/shopping/collection";

interface MarketplaceStore {
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
  min_order_amount?: number;
  is_live?: number | boolean;
  live_channel_title?: string | null;
  live_stream_url?: string | null;
  live_viewer_count?: number;
}

interface ProductItem {
  id: string;
  store_id: string;
  store_name?: string;
  title: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  badge?: string | null;
  image_url: string | null;
  category_name?: string | null;
  variants?: MarketVariant[] | null;
}

const STORE_CATEGORIES = [
  "All",
  "Fashion & Boutique",
  "Footwear",
  "Accessories",
  "Gadgets",
  "Beauty",
];

const ugx = (val: number) => `UGX ${Number(val).toLocaleString()}`;

export default function StoresPage() {
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<MarketplaceStore[]>([]);
  const [liveChannels, setLiveChannels] = useState<LiveStreamChannel[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<ProductItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [error, setError] = useState("");

  // Live Stream modal state
  const [activeLiveChannel, setActiveLiveChannel] = useState<LiveStreamChannel | null>(null);
  const [pinnedProduct, setPinnedProduct] = useState<PinnedProduct | null>(null);

  // Cart state
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [cartNotice, setCartNotice] = useState("");

  const { totalQuantity } = useCart();
  const { lat: userLat, lng: userLng } = useCustomerLocation();

  useEffect(() => {
    loadData();
  }, [userLat, userLng]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [storesRes, liveRes] = await Promise.all([
        api.getMarketplaceStores("stores", userLat, userLng).catch(() => ({ stores: [] })),
        api.getMarketplaceLiveChannels().catch(() => ({ liveChannels: [] })),
      ]);

      let retailStores: MarketplaceStore[] = storesRes.stores || [];
      if (userLat != null && userLng != null) {
        retailStores = retailStores.map((s) => {
          let dist = s.distance_km;
          if (dist == null && s.lat != null && s.lng != null) {
            dist = Math.round(haversineKm(userLat, userLng, Number(s.lat), Number(s.lng)) * 10) / 10;
          }
          return { ...s, distance_km: dist };
        });
        retailStores.sort((a, b) => (a.distance_km ?? 999999) - (b.distance_km ?? 999999));
      }
      setStores(retailStores);

      // Filter live channels for retail stores
      const live: LiveStreamChannel[] = (liveRes.liveChannels || [])
        .filter((c: any) => c.category === "stores" || !c.category)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          logo_url: c.logo_url,
          banner_url: c.banner_url,
          category: c.category || "stores",
          live_channel_title: c.live_channel_title,
          live_stream_url: c.live_stream_url,
          live_viewer_count: c.live_viewer_count || 215,
        }));
      setLiveChannels(live);

      // Load products from primary boutique store
      if (retailStores.length > 0) {
        const primaryStore = retailStores[0];
        const prodRes = await api.getMarketplaceStoreProducts(primaryStore.id).catch(() => ({ products: [] }));
        const prods: ProductItem[] = (prodRes.products || []).map((p: any) => ({
          id: p.id,
          store_id: primaryStore.id,
          store_name: primaryStore.name,
          title: p.title,
          description: p.description,
          price: Number(p.price) || 0,
          compare_at_price: p.compare_at_price ? Number(p.compare_at_price) : null,
          badge: p.badge,
          image_url: p.image_url,
          category_name: p.category_name,
          // Keep options so cards can show "from" pricing and add the default option.
          variants: Array.isArray(p.variants)
            ? p.variants.map((v: any) => ({
                id: String(v.id),
                title: String(v.title),
                price: Number(v.price) || 0,
                compare_at_price: v.compare_at_price ? Number(v.compare_at_price) : null,
              }))
            : null,
        }));
        setFeaturedProducts(prods);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleOpenLive(channel: LiveStreamChannel) {
    setActiveLiveChannel(channel);
    const samplePinned = featuredProducts.find((p) => p.store_id === channel.id) || featuredProducts[0];
    if (samplePinned) {
      setPinnedProduct({
        id: samplePinned.id,
        title: samplePinned.title,
        price: samplePinned.price,
        compare_at_price: samplePinned.compare_at_price || undefined,
        image_url: samplePinned.image_url || undefined,
        badge: samplePinned.badge || undefined,
      });
    }
  }

  function handleAddToCart(item: {
    id: string;
    title: string;
    price: number;
    store_id?: string;
    store_name?: string;
    compare_at_price?: number | null;
    image_url?: string | null;
    category_name?: string | null;
    variants?: MarketVariant[] | null;
  }) {
    // Same default as the store grid and product page: the first option.
    const v = defaultVariant(item);
    addMarketplaceCartItem({
      productId: item.id,
      storeId: item.store_id || "store_default",
      storeName: item.store_name || "Partner Store",
      title: item.title,
      variantId: v?.id,
      variantTitle: v?.title,
      price: v?.price ?? item.price,
      compareAtPrice: (v ? v.compare_at_price : item.compare_at_price) || undefined,
      imageUrl: item.image_url || undefined,
      category: item.category_name || undefined,
      quantity: 1,
    });
    setCartDrawerOpen(true);
    setCartNotice(`Added "${item.title}" to bag!`);
    setTimeout(() => setCartNotice(""), 2500);
  }

  const filteredStores = stores.filter((s) =>
    `${s.name} ${s.description || ""} ${s.address || ""}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredProducts = featuredProducts.filter((p) => {
    const matchesCat = selectedCategory === "All" || p.category_name === selectedCategory;
    const matchesQuery = `${p.title} ${p.description || ""}`.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  const cartItemCount = totalQuantity;
  useCollectionTitleFocus("stores-title");
  const heroSlides = [
    ...liveChannels.slice(0, 2).map((c) => ({
      id: `live-${c.id}`,
      title: c.live_channel_title || `Live from ${c.name}`,
      subtitle: c.name,
      imageUrl: c.banner_url || c.logo_url,
      cta: "Watch",
      onCta: () => handleOpenLive(c),
    })),
    ...featuredProducts.filter((p) => p.image_url).slice(0, 4).map((p) => ({
      id: p.id,
      title: p.title,
      subtitle: p.store_name,
      imageUrl: p.image_url,
      href: `/product/${p.id}`,
    })),
  ];

  return (
    <div className="shop-page mx-auto max-w-xl space-y-5 px-4 pb-28 pt-4">
      <MarketGreetingHeader
        trailing={<CartDrawerTrigger onClick={() => setCartDrawerOpen(true)} className="h-11 w-11" />}
      />

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 id="stores-title" tabIndex={-1} className="shop-title text-ink outline-none">Boutiques & Stores</h1>
          <p className="mt-0.5 text-sm text-ink-500">Fashion, gadgets and more from verified local stores.</p>
        </div>
        <Link
          href="/shoplist"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3.5 py-2 text-xs font-semibold text-ink transition hover:text-gold"
        >
          <span>Saved</span>
          <ShoppingBag className="h-3.5 w-3.5 text-gold" />
        </Link>
      </div>

      <MarketSearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search fashion, sneakers, gadgets…"
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
      />

      <PromoBanner
        eyebrow="Verified stores"
        title="Free delivery over UGX 50,000"
        body="Shop fashion, gadgets and beauty from trusted Kampala stores."
        icon={<ShoppingBasket className="h-8 w-8" aria-hidden />}
      />

      <CollectionHero slides={heroSlides} label="Featured from stores" />
      <LiveRail shops={liveChannels} onOpen={handleOpenLive} />

      {filtersOpen && (
        <CategoryChips items={STORE_CATEGORIES} active={selectedCategory} onSelect={setSelectedCategory} />
      )}

      {/* Notice Banner */}
      {cartNotice && (
        <div className="flex items-center justify-between rounded-[20px] bg-gold/15 px-4 py-3 text-xs font-semibold text-ink animate-fade-in">
          <span>{cartNotice}</span>
          <span className="text-gold font-mono">{cartItemCount} items</span>
        </div>
      )}

      {/* Featured Products Catalog Grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-ink">
            {selectedCategory === "All" ? "Trending in Stores" : selectedCategory}
          </h2>
          <span className="text-xs font-medium text-ink-500">{filteredProducts.length} items</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="aspect-[4/5] animate-pulse rounded-[22px] bg-[rgb(var(--surface-muted))]"
              />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="rounded-[24px] bg-[rgb(var(--surface-muted))] p-8 text-center text-sm text-ink-500">
            <span className="shop-empty block">Nothing matches this filter.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            {filteredProducts.map((p) => (
              <MarketProductCard key={p.id} product={p} fallbackCategory={undefined} onAdd={() => handleAddToCart(p)} />
            ))}
          </div>
        )}
      </section>

      {/* Boutiques & Stores Directory */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-ink">Boutiques & Merchant Stores</h2>
          <span className="text-xs font-medium text-ink-500">{filteredStores.length} stores</span>
        </div>

        <div className="space-y-3">
          {filteredStores.map((s) => (
            <Link
              key={s.id}
              href={`/store/${s.id}`}
              className="flex items-center gap-3.5 rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3.5 shadow-[var(--shadow-card)] transition hover:shadow-[var(--shadow-card-hover)] active:scale-[0.98]"
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[18px] bg-[rgb(var(--surface-muted))]">
                {s.logo_url ? (
                  <img
                    src={s.logo_url}
                    alt={s.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = "flex";
                    }}
                  />
                ) : null}
                <div
                  style={{ display: s.logo_url ? "none" : "flex" }}
                  className="h-full w-full items-center justify-center bg-gold/20 font-bold text-gold text-lg"
                >
                  {s.name.slice(0, 2).toUpperCase()}
                </div>
                {s.is_live ? (
                  <span className="absolute bottom-1 inset-x-1 rounded-full bg-red-600 text-center text-[7px] font-black uppercase text-white animate-pulse">
                    LIVE
                  </span>
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-sm text-ink truncate">{s.name}</h3>
                  {s.distance_km != null && (
                    <span className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/25">
                      📍 {formatDistanceKm(s.distance_km)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-500 line-clamp-1">
                  {s.address ? `${s.address.split(",")[0]} · ` : ""}{s.description || "Curated fashion, accessories, and designer goods"}
                </p>
                <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold text-ink-500">
                  <span className="flex items-center gap-1 text-gold">
                    <Truck className="h-3 w-3" /> Same Day Delivery
                  </span>
                  <span>Min {ugx(s.min_order_amount || 10000)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>


      {/* Slide-in Shopping Cart Drawer */}
      <CartDrawer
        isOpen={cartDrawerOpen}
        onClose={() => setCartDrawerOpen(false)}
      />

      {/* Live Stream Viewer Modal */}
      {activeLiveChannel && (
        <LiveStreamViewer
          channel={activeLiveChannel}
          pinnedProduct={pinnedProduct}
          onClose={() => setActiveLiveChannel(null)}
          onAddToCart={(p) =>
            handleAddToCart({
              id: p.id,
              title: p.title,
              price: p.price,
              compare_at_price: p.compare_at_price,
              image_url: p.image_url,
              store_id: activeLiveChannel.id,
              store_name: activeLiveChannel.name,
            })
          }
        />
      )}
    </div>
  );
}
