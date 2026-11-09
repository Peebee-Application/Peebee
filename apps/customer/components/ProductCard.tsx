"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, Check, Plus, ShoppingBag } from "lucide-react";
import { ProductImage } from "./ProductImage";
import { addToCart } from "../lib/cart";

export interface ProductCardData {
  id: string;
  store_id: string;
  title: string;
  slug?: string;
  description?: string | null;
  price: number;
  compare_at_price?: number | null;
  image_url?: string | null;
  badge?: string | null;
  category_name?: string | null;
  inventory_quantity?: number | null;
  has_variants?: number | boolean | null;
  variants?: Array<{
    id: string;
    title: string;
    price: number;
    compare_at_price?: number | null;
  }>;
}

interface ProductCardProps {
  product: ProductCardData;
  storeName?: string;
  className?: string;
}

export function ProductCard({
  product,
  storeName,
  className = "",
}: ProductCardProps) {
  const [bookmarked, setBookmarked] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const discountPercent =
    product.compare_at_price && product.compare_at_price > product.price
      ? Math.round(
          ((product.compare_at_price - product.price) / product.compare_at_price) * 100
        )
      : null;

  const handleBookmark = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBookmarked(!bookmarked);
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Default to first variant if product has variants
    const defaultVariant = product.variants?.[0];

    addToCart({
      productId: product.id,
      storeId: product.store_id,
      storeName: storeName || "Partner Store",
      title: product.title,
      variantId: defaultVariant?.id,
      variantTitle: defaultVariant?.title,
      price: defaultVariant?.price ?? product.price,
      compareAtPrice: (defaultVariant?.compare_at_price ?? product.compare_at_price) || undefined,
      imageUrl: product.image_url || undefined,
      category: product.category_name || undefined,
      quantity: 1,
    });

    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
  };

  return (
    <Link
      href={`/product/${product.id}`}
      className={`group relative flex flex-col rounded-3xl overflow-hidden shadow-sm bg-surface-card border border-surface-border/50 text-left cursor-pointer ${className}`}
    >
      {/* Visual Image Area */}
      <div className="relative w-full aspect-[4/5] overflow-hidden bg-surface-subtle">
        <ProductImage
          src={product.image_url}
          alt={product.title}
          category={product.category_name || undefined}
          className="buy-zoom w-full h-full object-cover"
        />

        {/* Top Badges & Bookmark Controls */}
        <div className="absolute top-3 inset-x-3 flex items-center justify-between z-10 pointer-events-none">
          {/* Top-left frosted tag */}
          <div className="pointer-events-auto">
            {product.badge ? (
              <span className="inline-flex items-center text-[11px] font-bold tracking-tight text-white px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/20 shadow-sm">
                {product.badge}
              </span>
            ) : discountPercent ? (
              <span className="inline-flex items-center text-[11px] font-black tracking-tight text-white px-2.5 py-1 rounded-full bg-red-600/80 backdrop-blur-md border border-white/20 shadow-sm">
                {discountPercent}% OFF
              </span>
            ) : (
              <span className="inline-flex items-center text-[10px] font-bold tracking-wider text-white/90 px-2 py-0.5 rounded-full bg-black/35 backdrop-blur-md border border-white/15 uppercase">
                {product.category_name || "PRO"}
              </span>
            )}
          </div>

          {/* Top-right bookmark circle button */}
          <button
            type="button"
            onClick={handleBookmark}
            aria-label="Save to favorites"
            className={`pointer-events-auto w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all duration-200 border shadow-sm ${
              bookmarked
                ? "bg-gold text-ink border-gold"
                : "bg-black/35 text-white/90 border-white/25 hover:bg-black/55 hover:text-white"
            } active:scale-90`}
          >
            <Bookmark
              className="w-4 h-4"
              fill={bookmarked ? "currentColor" : "none"}
              strokeWidth={2.2}
            />
          </button>
        </div>

        {/* Gradient Scrim for readable text overlay on image (matching Image 1) */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none" />

        {/* Content pinned inside the bottom gradient overlay */}
        <div className="absolute bottom-0 inset-x-0 p-3.5 z-10 flex flex-col justify-end text-white pointer-events-none">
          <h3 className="font-bold text-base leading-snug tracking-tight text-white drop-shadow-sm line-clamp-1">
            {product.title}
          </h3>

          {product.description && (
            <p className="text-white/75 text-xs line-clamp-1 mt-0.5 font-normal drop-shadow-sm">
              {product.description}
            </p>
          )}

          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="font-black text-white text-base tracking-tight">
              UGX {product.price.toLocaleString()}
            </span>
            {product.compare_at_price && product.compare_at_price > product.price && (
              <span className="text-white/60 text-xs line-through">
                UGX {product.compare_at_price.toLocaleString()}
              </span>
            )}
          </div>

          {/* Full-width "Add to Cart" pill button (matching Image 1) */}
          <button
            type="button"
            onClick={handleAdd}
            className={`pointer-events-auto mt-2.5 w-full py-2.5 px-3 rounded-full font-bold text-xs sm:text-sm tracking-tight flex items-center justify-center gap-1.5 transition-all duration-200 shadow-lg ${
              justAdded
                ? "bg-emerald-500 text-white shadow-emerald-500/30 scale-[0.98]"
                : "bg-white text-ink hover:bg-cream hover:shadow-white/30 active:scale-[0.97]"
            }`}
          >
            {justAdded ? (
              <>
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Added to Cart</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Add to Cart</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Link>
  );
}
