"use client";

/**
 * Presentation-only building blocks for the marketplace screens
 * (groceries, stores, product detail, cart). Light, airy surfaces, large
 * rounded corners and soft shadows, using Peebee's existing colour tokens
 * only (gold is the accent; no new colours are introduced).
 */
import { Check, MapPin, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useAuth } from "../../lib/auth-context";
import { useLocationLabel } from "../../lib/use-location-label";
import { ProductImage } from "../ProductImage";
import "../../app/shopping-collection.css";
import { defaultVariant, productPricing, type MarketVariant } from "../../lib/product-pricing";

export { defaultVariant, productPricing, type MarketVariant };

export const ugx = (val: number) => `UGX ${Number(val).toLocaleString()}`;

/** Soft card surface shared by the marketplace screens. */
export const softCard =
  "rounded-[24px] bg-[rgb(var(--surface-card))] shadow-[var(--shadow-card)] border border-[var(--border-faint)]";

function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Greeting + current location, with an avatar on the left and an optional action on the right. */
export function MarketGreetingHeader({ trailing }: { trailing?: ReactNode }) {
  const { user } = useAuth();
  const { label, status } = useLocationLabel();
  const firstName = user?.name?.trim().split(/\s+/)[0];
  const location = status === "locating" ? "Locating…" : label ?? "Kampala";
  return (
    <header className="flex items-center justify-between gap-3">
      <Link
        href="/account"
        aria-label="Your account"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-sm font-bold text-ink shadow-[var(--shadow-card)]"
      >
        {initials(user?.name)}
      </Link>
      <div className="min-w-0 flex-1 text-center">
        <p className="text-xs font-medium text-ink-500">Hello{firstName ? `, ${firstName}` : ""}</p>
        <p className="mt-0.5 flex items-center justify-center gap-1 truncate text-sm font-bold text-ink">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          <span className="truncate">{location}</span>
        </p>
      </div>
      <div className="flex h-11 min-w-11 shrink-0 items-center justify-end">{trailing}</div>
    </header>
  );
}

/** Rounded search field with a square-ish filter button beside it. */
export function MarketSearchBar({
  value,
  onChange,
  placeholder,
  filtersOpen,
  onToggleFilters,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="field-box shop-search relative min-w-0 flex-1">
        <span className="sr-only">Search</span>
        <Search className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        {value && (
          <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="shop-iconbtn">
            <X className="h-4 w-4" />
          </button>
        )}
      </label>
      <button
        type="button"
        onClick={onToggleFilters}
        aria-label={filtersOpen ? "Hide categories" : "Show categories"}
        aria-expanded={filtersOpen}
        className={`shop-iconbtn border border-[var(--border-faint)] shadow-[var(--shadow-card)] ${filtersOpen ? "is-on" : "bg-[rgb(var(--surface-card))]"}`}
      >
        <SlidersHorizontal className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

/** Rounded promotional card in the brand accent. */
export function PromoBanner({ eyebrow, title, body, icon }: { eyebrow: string; title: string; body: string; icon?: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="relative overflow-hidden rounded-[24px] bg-gold px-5 py-5 text-ink-gold shadow-[var(--shadow-glow-gold)]"
    >
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/20" />
      <div aria-hidden className="pointer-events-none absolute -bottom-12 right-10 h-28 w-28 rounded-full bg-white/10" />
      <div className="relative flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-bold leading-tight">{title}</h2>
          <p className="mt-1 text-xs leading-snug opacity-80">{body}</p>
        </div>
        {icon && (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-white/25">{icon}</div>
        )}
      </div>
    </section>
  );
}

/** Horizontal pill chips; the active one uses the brand accent. */
export function CategoryChips({ items, active, onSelect }: { items: string[]; active: string; onSelect: (item: string) => void }) {
  return (
    <div role="tablist" aria-label="Categories" className="shop-cats">
      {items.map((cat) => {
        const isActive = active === cat;
        return (
          <button key={cat} type="button" role="tab" aria-selected={isActive} onClick={() => onSelect(cat)} className="shop-cat">
            {cat}
          </button>
        );
      })}
    </div>
  );
}

export type MarketProduct = {
  id: string;
  title: string;
  description?: string | null;
  price: number;
  compare_at_price?: number | null;
  badge?: string | null;
  image_url?: string | null;
  category_name?: string | null;
  variants?: MarketVariant[] | null;
};

/**
 * Rounded image card: tap the image/name for detail, round button adds to cart.
 * Shows only the essentials: image, one-line name, one-line price (strike
 * price small and optional) and at most one small badge.
 */
export function MarketProductCard({ product, fallbackCategory, onAdd }: { product: MarketProduct; fallbackCategory?: string; onAdd: () => void }) {
  const [added, setAdded] = useState(false);
  const pricing = productPricing(product);
  const discount = pricing.discount;
  // One badge at most: a real discount beats a merchandising tag.
  const badge = discount >= 5 ? `-${discount}%` : product.badge || null;

  function handleAdd() {
    onAdd();
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1200);
  }

  return (
    <article className="flex min-w-0 flex-col">
      <Link href={`/product/${product.id}`} className="group block">
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[22px] bg-[rgb(var(--surface-muted))] shadow-[var(--shadow-card)]">
          <ProductImage
            src={product.image_url}
            alt={product.title}
            category={product.category_name || fallbackCategory}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          {badge && (
            <span className="absolute left-2.5 top-2.5 z-10 max-w-[75%] truncate rounded-full bg-[rgb(var(--surface-card)/.92)] px-2.5 py-1 text-[10px] font-semibold text-ink shadow-sm">
              {badge}
            </span>
          )}
        </div>
      </Link>
      <div className="mt-2.5 flex items-center justify-between gap-2 px-1">
        <Link href={`/product/${product.id}`} className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink">{product.title}</h3>
          <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
            {pricing.from && <span className="shrink-0 text-[11px] font-medium text-ink-500">from</span>}
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-ink">{ugx(pricing.price)}</span>
            {pricing.compareAt != null && (
              <span className="truncate text-[10px] font-medium tabular-nums text-ink-500 line-through">
                {pricing.compareAt.toLocaleString()}
              </span>
            )}
          </p>
        </Link>
        <button
          type="button"
          onClick={handleAdd}
          aria-label={added ? `${product.title} added to cart` : `Add ${product.title} to cart`}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
            added ? "bg-ink text-cream" : "bg-gold text-ink-gold shadow-[var(--shadow-glow-gold)]"
          }`}
        >
          {added ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </article>
  );
}

/** Rounded checkbox used in the cart. */
export function RoundCheck({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border transition ${
        checked ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"
      }`}
    >
      {checked && (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3.5} aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
