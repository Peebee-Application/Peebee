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
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
} from "lucide-react";
import { api, errorMessage } from "../../../lib/api";
import { ProductImage } from "../../../components/ProductImage";
import { addToCart, useCart } from "../../../lib/cart";
import { CartDrawer, CartDrawerTrigger } from "../../../components/CartDrawer";
import { ShareButton } from "../../../components/ShareButton";

interface ProductVariant {
  id: string;
  title: string;
  price: number;
  compare_at_price?: number;
  inventory_quantity?: number;
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
  category_name?: string | null;
  inventory_quantity?: number;
  has_variants?: number | boolean;
  variants?: ProductVariant[];
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
  const [quantity, setQuantity] = useState(1);
  const [isFavorited, setIsFavorited] = useState(false);
  const [addedToast, setAddedToast] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

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
            setSelectedVariant(res.product.variants[0]);
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
      imageUrl: product.image_url || undefined,
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
        <div className="relative w-full aspect-[4/5] sm:aspect-[1/1] overflow-hidden rounded-[32px] bg-[rgb(var(--surface-muted))] shadow-[var(--shadow-card-hover)]">
          <ProductImage
            src={product.image_url}
            alt={product.title}
            category={product.category_name || undefined}
            priority
            className="w-full h-full object-cover"
          />

          {/* Floating Top Nav (Back Button & Favorite Button) */}
          <div className="absolute top-4 inset-x-4 flex items-center justify-between z-20">
            <button
              type="button"
              onClick={() => router.back()}
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
        </div>

        {/* =========================================================================
            PRODUCT DETAILS & PRICE (Screen 2: Title Left, Bold Price Right)
        ========================================================================= */}
        <div className="px-6 pt-6 space-y-5">
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

          {/* =========================================================================
              VARIANT SELECTOR (Screen 2: Sizes / Options Pills)
          ========================================================================= */}
          {product.variants && product.variants.length > 0 && (
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

        {/* =========================================================================
            BOTTOM FIXED ACTION BAR (Screen 2: Cart Shortcut + Big "Add to Cart" Pill)
        ========================================================================= */}
        <div className="fixed bottom-0 inset-x-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-[rgb(var(--color-cream))] via-[rgb(var(--color-cream)/.92)] to-transparent">
          <div className="mx-auto max-w-md flex items-center gap-3">
            {/* Wide pill: add to bag and go straight to the cart */}
            <button
              type="button"
              onClick={() => handleAddToCart(true)}
              className="flex-1 h-14 px-6 rounded-full bg-gold text-ink-gold active:scale-[0.98] transition font-semibold text-base shadow-[var(--shadow-glow-gold)] flex items-center justify-between"
            >
              <span>Buy Now</span>
              <span className="font-bold">UGX {(activePrice * quantity).toLocaleString()}</span>
            </button>

            {/* Round cart button: add to bag and keep browsing (opens the bag drawer) */}
            <button
              type="button"
              onClick={() => handleAddToCart(false)}
              className="relative h-14 w-14 rounded-full bg-[rgb(var(--surface-card))] border border-[var(--border-faint)] shadow-[var(--shadow-card)] flex items-center justify-center text-ink active:scale-95 transition shrink-0"
              aria-label="Add to cart"
            >
              <ShoppingBag className="w-6 h-6" aria-hidden />
              {totalQuantity > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 rounded-full bg-gold text-ink-gold text-[10px] font-black flex items-center justify-center px-1 shadow-sm">
                  {totalQuantity}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Slide-in Shopping Cart Drawer */}
        <CartDrawer
          isOpen={cartDrawerOpen}
          onClose={() => setCartDrawerOpen(false)}
        />
      </div>
    </div>
  );
}
