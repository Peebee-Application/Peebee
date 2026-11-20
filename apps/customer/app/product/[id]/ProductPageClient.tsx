"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronRight,
  Heart,
  Minus,
  Play,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  Zap,
} from "lucide-react";
import { api, errorMessage } from "../../../lib/api";
import { ProductImage } from "../../../components/ProductImage";
import { addToCart, useCart } from "../../../lib/cart";
import { CartDrawer, CartDrawerTrigger } from "../../../components/CartDrawer";
import { ShareButton } from "../../../components/ShareButton";
import { clearReel, navigateWithPush, productArmedFor, reelArmedFor } from "../../../lib/buy-motion";
import { defaultSelection, findVariant, selectValue, type ProductOption, type Selection } from "@peebee/shared";
import { OptionPicker } from "../../../components/buy/OptionPicker";
import { BottomNav } from "../../../components/BottomNav";
import { goBackOr, useRegisterNavBack, useRegisterNavPrimaryAction } from "../../../lib/nav-primary-action";

interface ProductVariant {
  id: string;
  title: string;
  price: number;
  compare_at_price?: number;
  inventory_quantity?: number;
  image_url?: string | null;
  values?: string[];
  option1_name?: string | null; option1_value?: string | null;
  option2_name?: string | null; option2_value?: string | null;
  option3_name?: string | null; option3_value?: string | null;
}

interface ProductData {
  id: string;
  store_id: string;
  title: string;
  slug?: string;
  description?: string | null;
  price: number;
  compare_at_price?: number | null;
  badge?: string | null;
  image_url?: string | null;
  /** The full photo gallery from the add-item wizard; the first one is image_url. */
  images?: string[];
  video_url?: string | null;
  delivery?: { delivery?: boolean; pickup?: boolean; sameDay?: boolean; readyInDays?: number; returnsDays?: number } | null;
  category_name?: string | null;
  inventory_quantity?: number;
  has_variants?: number | boolean;
  variants?: ProductVariant[];
  options?: ProductOption[];
}

interface StoreData {
  id: string;
  name: string;
  slug?: string;
  logo_url?: string | null;
  address?: string | null;
  is_open?: number | boolean;
  is_live?: number | boolean;
  delivery_enabled?: number | boolean;
  category?: string;
}

export function ProductPageClient() {
  const params = useParams();
  const router = useRouter();
  const productId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ProductData | null>(null);
  const [store, setStore] = useState<StoreData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState(1);
  const [isFavorited, setIsFavorited] = useState(false);
  const [addedToast, setAddedToast] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  const { totalQuantity } = useCart();

  useEffect(() => {
    let active = true;

    async function fetchProduct() {
      if (!productId) return;
      setLoading(true);
      setError(null);

      try {
        const res = await api.getMarketplaceProduct(productId);
        if (!active) return;

        if (res && res.product) {
          setProduct(res.product);
          setStore(res.store || null);

          // Select first variant if available
          if (res.product.variants && res.product.variants.length > 0) {
            const options: ProductOption[] = res.product.options ?? [];
            const tracked = res.product.track_inventory == null || !!res.product.track_inventory;
            if (options.length > 0) {
              const start = defaultSelection(res.product.variants, options, tracked);
              setSelection(start);
              setSelectedVariant(findVariant(res.product.variants, options, start) ?? res.product.variants[0]);
            } else {
              setSelectedVariant(res.product.variants[0]);
            }
          }
        } else {
          setError("Product not found");
        }
      } catch (err) {
        if (!active) return;
        setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchProduct();
    return () => {
      active = false;
    };
  }, [productId]);

  const activePrice = selectedVariant ? selectedVariant.price : (product?.price ?? 0);
  const media: { kind: "image" | "video"; src: string }[] = [
    ...(product?.images?.length ? product.images : product?.image_url ? [product.image_url] : []).map((src) => ({ kind: "image" as const, src })),
    ...(product?.video_url ? [{ kind: "video" as const, src: product.video_url }] : []),
  ];
  const activeCompareAt = selectedVariant
    ? selectedVariant.compare_at_price
    : product?.compare_at_price;

  const discountPercent =
    activeCompareAt && activeCompareAt > activePrice
      ? Math.round(((activeCompareAt - activePrice) / activeCompareAt) * 100)
      : null;

  const handleAddToCart = (directToCart = false) => {
    if (!product) return;

    addToCart({
      productId: product.id,
      storeId: product.store_id,
      storeName: store?.name || "Marketplace Partner",
      storeSlug: store?.slug,
      title: product.title,
      variantId: selectedVariant?.id,
      variantTitle: selectedVariant?.title,
      price: activePrice,
      compareAtPrice: activeCompareAt || undefined,
      imageUrl: selectedVariant?.image_url || product.image_url || undefined,
      category: product.category_name || undefined,
      quantity,
    });

    if (directToCart) {
      router.push("/cart");
    } else {
      setCartDrawerOpen(true);
      setAddedToast(true);
      setTimeout(() => setAddedToast(false), 2000);
    }
  };

  useRegisterNavBack(!!product && !cartDrawerOpen, () => goBackOr(router, store?.id ? `/store/${store.id}` : "/stores"));
  useRegisterNavPrimaryAction(product && !cartDrawerOpen ? {
    label: "Add to cart", detail: `UGX ${(activePrice * quantity).toLocaleString()}`,
    disabled: (selectedVariant?.inventory_quantity ?? product.inventory_quantity ?? 1) <= 0,
    onClick: () => handleAddToCart(false),
  } : null);

  if (loading) {
    return (
      <div className="flex min-h-[75vh] items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-3 border-gold border-t-transparent" />
          <p className="text-sm font-semibold text-ink-500">Loading product…</p>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="mx-auto max-w-md p-6 text-center space-y-4 pt-16">
        <div className="w-16 h-16 mx-auto rounded-full bg-surface-subtle flex items-center justify-center text-ink-500">
          <ShoppingBag className="w-8 h-8 opacity-40" />
        </div>
        <h2 className="text-xl font-bold text-ink">Product Not Found</h2>
        <p className="text-xs text-ink-500">
          {error || "This item may have been moved or is currently out of stock."}
        </p>
        <Link
          href="/stores"
          className="inline-block rounded-full bg-gold px-6 py-3 text-xs font-bold text-ink-gold shadow-md"
        >
          Explore Other Stores
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-32 text-ink">
      {/* Container restricted to mobile/tablet column */}
      <div className="mx-auto max-w-md relative">
        {/* =========================================================================
            HERO IMAGE MEDIA CARD (Screen 2: Curved Bottom [40px] & Floating Buttons)
        ========================================================================= */}
        <div className="px-4 pt-4">
        <div data-product-hero="" className="relative w-full aspect-[4/5] sm:aspect-[1/1] overflow-hidden rounded-[32px] bg-[rgb(var(--surface-muted))] shadow-[var(--shadow-card-hover)]" data-reel-vt={reelArmedFor(product.id) ? "" : undefined}>
          {media[photoIndex]?.kind === "video" ? (
            <video src={media[photoIndex].src} className="w-full h-full object-cover" controls playsInline autoPlay muted />
          ) : (
            <ProductImage
              src={photoIndex === 0 ? selectedVariant?.image_url || media[0]?.src || product.image_url : media[photoIndex]?.src}
              alt={product.title}
              category={product.category_name || undefined}
              priority
              className="w-full h-full object-cover"
            />
          )}
          {media.length > 1 && (
            <div className="absolute bottom-4 inset-x-0 flex justify-center gap-1.5 z-10" aria-hidden="true">
              {media.map((m, i) => (
                <span key={m.src} className={`h-1.5 rounded-full transition-all ${i === photoIndex ? "w-5 bg-gold" : "w-1.5 bg-white/70"}`} />
              ))}
            </div>
          )}

          {/* Floating Top Nav (Back Button & Favorite Button) */}
          <div className="buy-rise absolute top-4 inset-x-4 flex items-center justify-between z-20">
            <button
              type="button"
              onClick={() => {
                if (reelArmedFor(product.id)) {
                  clearReel();
                  void navigateWithPush(router, "", "back", "reel");
                } else if (productArmedFor(product.id)) {
                  void navigateWithPush(router, "", "back", "card");
                } else router.back();
              }}
              aria-label="Back"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-[rgb(var(--surface-card)/.9)] backdrop-blur-md border border-[var(--border-faint)] text-ink shadow-[var(--shadow-card)] active:scale-95 transition-transform"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            </button>

            <div className="flex items-center gap-2">
              <ShareButton
                target={{
                  url: `/product/${encodeURIComponent(product.id)}`,
                  title: product.title,
                  text: `${product.title} for UGX ${Math.round(activePrice).toLocaleString("en-US")}${store?.name ? ` at ${store.name}` : ""} on Peebee`,
                }}
                label={`Share ${product.title}`}
                className="w-11 h-11 rounded-full flex items-center justify-center bg-[rgb(var(--surface-card)/.9)] backdrop-blur-md border border-[var(--border-faint)] text-ink shadow-[var(--shadow-card)] active:scale-95 transition-transform"
              />
              {/* Cart Drawer Shortcut Button */}
              <CartDrawerTrigger
                onClick={() => setCartDrawerOpen(true)}
                className="w-11 h-11"
              />

              <button
                type="button"
                onClick={() => setIsFavorited(!isFavorited)}
                aria-label="Favorite"
                className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md active:scale-95 transition-transform ${
                  isFavorited
                    ? "bg-red-500 text-white border-red-400"
                    : "bg-[rgb(var(--surface-card)/.9)] text-ink border-[var(--border-faint)]"
                }`}
              >
                <Heart
                  className="w-5 h-5"
                  fill={isFavorited ? "currentColor" : "none"}
                  strokeWidth={2.2}
                />
              </button>
            </div>
          </div>

        </div>
        {media.length > 1 && (
          <div data-product-gallery="" className="flex gap-2 overflow-x-auto pt-3 pb-1 [scrollbar-width:none]">
            {media.map((m, i) => (
              <button
                key={m.src}
                type="button"
                onClick={() => setPhotoIndex(i)}
                aria-label={m.kind === "video" ? "Play video" : `Photo ${i + 1}`}
                aria-pressed={i === photoIndex}
                className={`relative shrink-0 w-16 h-16 rounded-2xl overflow-hidden border-2 bg-[rgb(var(--surface-muted))] ${i === photoIndex ? "border-gold" : "border-transparent"}`}
              >
                {m.kind === "video" ? (
                  <span className="absolute inset-0 flex items-center justify-center text-ink"><Play className="w-6 h-6" /></span>
                ) : (
                  <ProductImage src={m.src} alt="" className="w-full h-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}
        </div>

        {/* =========================================================================
            PRODUCT DETAILS & PRICE (Screen 2: Title Left, Bold Price Right)
        ========================================================================= */}
        <div className={`px-6 pt-6 space-y-5${productArmedFor(product.id) ? " buy-card-follow" : ""}`}>
          {/* Header Row: Title on Left, Price on Right */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Category / Badge Pill */}
              <div className="flex items-center gap-2 mb-1.5">
                {product.badge ? (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-gold/20 text-gold border border-gold/30">
                    {product.badge}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                    {product.category_name || "Featured Product"}
                  </span>
                )}
                {discountPercent && (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 border border-red-500/20">
                    {discountPercent}% OFF
                  </span>
                )}
              </div>

              <h1 className="text-2xl font-bold text-ink tracking-tight leading-tight">
                {product.title}
              </h1>

              {/* Store Reference Link */}
              {store && (
                <Link
                  href={`/store/${store.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-gold mt-1 transition-colors"
                >
                  <Store className="w-3.5 h-3.5" />
                  <span>{store.name}</span>
                  <ChevronRight className="w-3 h-3 opacity-60" />
                </Link>
              )}
            </div>

            {/* Right: Bold Price */}
            <div className="text-right shrink-0">
              <div className="text-xl font-bold text-ink tracking-tight">
                UGX {activePrice.toLocaleString()}
              </div>
              {activeCompareAt && activeCompareAt > activePrice && (
                <div className="text-xs text-ink-500 line-through font-semibold mt-0.5">
                  UGX {activeCompareAt.toLocaleString()}
                </div>
              )}
            </div>
          </div>

          {/* Description Section */}
          {product.description && (
            <div>
              <h2 className="sr-only">Description</h2>
              <p
                className={`text-sm text-ink-500 leading-relaxed font-normal ${
                  showFullDesc ? "" : "line-clamp-3"
                }`}
              >
                {product.description}
              </p>
              {product.description.length > 140 && (
                <button
                  type="button"
                  onClick={() => setShowFullDesc(!showFullDesc)}
                  className="text-xs font-bold text-gold hover:underline mt-1 inline-block"
                >
                  {showFullDesc ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}

          {product.delivery && (
            <div data-product-delivery="" className="flex flex-wrap gap-2">
              {product.delivery.delivery !== false && (
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[rgb(var(--surface-muted))] text-xs font-semibold text-ink">
                  <Truck className="w-4 h-4 text-gold" /> Delivery
                </span>
              )}
              {product.delivery.pickup !== false && (
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[rgb(var(--surface-muted))] text-xs font-semibold text-ink">
                  <Store className="w-4 h-4 text-gold" /> Pickup
                </span>
              )}
              {product.delivery.sameDay && (
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[rgb(var(--surface-muted))] text-xs font-semibold text-ink">
                  <Zap className="w-4 h-4 text-gold" /> Same day
                </span>
              )}
              {!product.delivery.sameDay && (product.delivery.readyInDays ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[rgb(var(--surface-muted))] text-xs font-semibold text-ink">
                  Ready in {product.delivery.readyInDays} {product.delivery.readyInDays === 1 ? "day" : "days"}
                </span>
              )}
              {(product.delivery.returnsDays ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[rgb(var(--surface-muted))] text-xs font-semibold text-ink">
                  <ShieldCheck className="w-4 h-4 text-gold" /> {product.delivery.returnsDays}-day returns
                </span>
              )}
            </div>
          )}

          {/* =========================================================================
              VARIANT SELECTOR (Screen 2: Sizes / Options Pills)
          ========================================================================= */}
          {product.variants && product.variants.length > 0 && (product.options?.length ?? 0) > 0 && (
            <div className="pt-2">
              <OptionPicker
                options={product.options!}
                variants={product.variants}
                selection={selection}
                idPrefix="pdp"
                onSelect={(key, value) => {
                  const next = selectValue(product.variants!, product.options!, selection, key, value);
                  setSelection(next);
                  setSelectedVariant(findVariant(product.variants!, product.options!, next));
                }}
              />
              {!selectedVariant && <p className="mt-2 text-xs font-semibold text-ink-500">That combination is not available. Pick another option.</p>}
            </div>
          )}
          {product.variants && product.variants.length > 0 && !(product.options?.length) && (
            <div className="pt-2 ">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-500">
                  Select Option
                </span>
                {selectedVariant && (
                  <span className="text-xs font-bold text-gold">
                    {selectedVariant.title}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => {
                  const isSelected = selectedVariant?.id === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVariant(v)}
                      className={`min-h-11 px-4 rounded-full text-xs font-semibold transition-all border active:scale-95 ${
                        isSelected
                          ? "bg-gold text-ink-gold border-gold shadow-[var(--shadow-glow-gold)]"
                          : "bg-[rgb(var(--surface-muted))] text-ink-500 border-transparent hover:text-ink"
                      }`}
                    >
                      {v.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity Stepper & Stock Status */}
          <div className="pt-3  flex items-center justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-ink-500 block mb-1">
                Quantity
              </span>
              <div className="field-box inline-flex items-center gap-1 rounded-full px-1">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="h-11 w-11 rounded-full flex items-center justify-center text-ink active:scale-95"
                  aria-label="Decrease quantity"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-sm font-black w-6 text-center" aria-live="polite">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="h-11 w-11 rounded-full flex items-center justify-center text-ink active:scale-95"
                  aria-label="Increase quantity"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="text-right">
              <div className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[rgb(var(--color-green)/.12)] px-3 text-xs font-bold text-green">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{(product.inventory_quantity ?? 1) > 0 ? "In stock" : "Out of stock"}</span>
              </div>
              <p className="text-[11px] font-semibold text-ink-500 mt-1">Paid to the shop after you receive it</p>
            </div>
          </div>
        </div>

        {/* Toast Notification */}
        {addedToast && (
          <div className="fixed top-4 inset-x-4 z-50 mx-auto max-w-sm rounded-2xl bg-gold p-3 text-center text-xs font-bold text-ink-gold shadow-2xl flex items-center justify-center gap-2 animate-in fade-in slide-in-from-top duration-200">
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Added {quantity} item(s) to bag!</span>
          </div>
        )}

        <BottomNav />

        {/* Slide-in Shopping Cart Drawer */}
        <CartDrawer
          isOpen={cartDrawerOpen}
          onClose={() => setCartDrawerOpen(false)}
        />
      </div>
    </div>
  );
}
