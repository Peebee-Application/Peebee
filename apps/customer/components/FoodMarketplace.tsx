"use client";

import { FOOD_BUSINESS_TYPES, foodBusinessLabel, type FoodBusinessType, type Restaurant } from "@peebee/shared";
import { demoRestaurantPhotoPath } from "@peebee/shared/demo-food";
import { ArrowLeft, ArrowRight, ChefHat, CookingPot, Croissant, Search, SlidersHorizontal, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";

type FoodMarketplaceProps =
  | { mode: "home" }
  | { mode: "directory"; category: FoodBusinessType };

const categoryIcons = [UtensilsCrossed, ChefHat, CookingPot, Croissant];
const categoryHrefs: Record<FoodBusinessType, string> = {
  restaurant: "/restaurants",
  kitchen: "/kitchens",
  street_food: "/streetfood",
  bakery: "/bakeries",
};

function BusinessCard({ business }: { business: Restaurant }) {
  const image = business.is_demo
    ? demoRestaurantPhotoPath(business.id) ?? "/brand/food-hero.webp"
    : "/brand/food-hero.webp";

  return (
    <Link href={`/restaurants/${business.id}`} className="food-menu-card !overflow-hidden !p-0">
      <Image src={image} alt={`${business.name} cover`} className="aspect-[4/3] w-full object-cover" width={320} height={240} loading="lazy" />
      <div className="p-3">
        <p className="text-[10px] font-semibold text-gold">{foodBusinessLabel(business.business_type)}</p>
        <h3 className="mt-1 font-bold leading-snug">{business.name}</h3>
        <p className="mt-1 truncate text-xs text-ink-500">{business.cuisine ?? business.description ?? "Explore the menu"}</p>
        <p className="mt-3 text-xs font-semibold">{business.is_open ? "Open now" : "Closed"}<span className="float-right text-gold">Menu →</span></p>
      </div>
    </Link>
  );
}

export function FoodMarketplace(props: FoodMarketplaceProps) {
  const isHome = props.mode === "home";
  const [businesses, setBusinesses] = useState<Restaurant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const results = useRef<HTMLHeadingElement>(null);
  const selectedCategory = isHome ? null : props.category;
  const categoryInfo = selectedCategory ? FOOD_BUSINESS_TYPES.find((type) => type.value === selectedCategory) : null;

  useEffect(() => {
    api.listRestaurants()
      .then((res) => {
        setBusinesses(res.restaurants);
        setPaused(!!res.paused);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const filtered = businesses?.filter((business) =>
    (!selectedCategory || (business.business_type ?? "restaurant") === selectedCategory)
    && (!openOnly || !!business.is_open)
    && `${business.name} ${business.cuisine ?? ""} ${business.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  ) ?? [];

  return (
    <div className="space-y-5 px-4 pb-8 pt-4">
      {isHome ? (
        <>
          <div>
            <p className="text-xs font-semibold text-gold">Made nearby. Delivered to you.</p>
            <h1 className="mt-1 text-2xl font-bold">Peebee Food</h1>
          </div>
          <section className="food-hero">
            <Image src="/brand/food-hero.webp" alt="Ugandan dishes, a fresh Rolex and golden pastries" width={1536} height={1024} priority />
            <div className="food-hero-copy">
              <p className="text-xs font-bold uppercase tracking-widest">Something delicious</p>
              <h2>Good food.<br />Close to home.</h2>
              <p className="mt-3 text-sm">From neighbourhood favourites to home-cooked comfort.</p>
              <button className="food-hero-cta" onClick={() => results.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })}>
                Explore food <ArrowRight size={16} />
              </button>
            </div>
          </section>
          <div className="food-categories" aria-label="Browse food categories">
            {FOOD_BUSINESS_TYPES.map((type, index) => {
              const Icon = categoryIcons[index];
              return (
                <Link key={type.value} href={categoryHrefs[type.value]}>
                  <span><Icon size={23} strokeWidth={1.5} /></span>
                  <strong>{type.label}</strong>
                </Link>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <Link href="/food" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-ink-500">
            <ArrowLeft size={18} aria-hidden /> Food home
          </Link>
          <div>
            <p className="text-xs font-semibold text-gold">Explore Peebee Food</p>
            <h1 className="mt-1 text-2xl font-bold">{categoryInfo?.label ?? "Food"}</h1>
            <p className="mt-1 text-sm text-ink-500">{categoryInfo?.description}</p>
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <div className="field-box flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl px-3">
          <Search size={18} className="shrink-0 text-ink-500" />
          <input aria-label={`Search ${categoryInfo?.label.toLowerCase() ?? "food businesses"}`} placeholder="Search food, kitchens, bakeries…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 w-full border-0 outline-none" />
        </div>
        <button aria-label="Show only open businesses" aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-faint)] ${openOnly ? "bg-gold/20 text-gold" : "bg-[rgb(var(--surface-card))]"}`}>
          <SlidersHorizontal size={20} />
        </button>
      </div>

      {isHome && (
        <div className="flex items-center justify-between">
          <h2 ref={results} className="scroll-mt-20 text-lg font-bold">Discover nearby</h2>
          <Link href="/restaurants" className="text-sm font-semibold text-gold">Restaurants →</Link>
        </div>
      )}
      {!isHome && businesses !== null && <p className="text-sm text-ink-500">{filtered.length} {categoryInfo?.label.toLowerCase()} nearby</p>}
      {openOnly && <p role="status" className="text-xs text-ink-500">Showing businesses open now.</p>}
      {paused && <p role="status" className="home-card text-sm">Food ordering is currently paused by the platform.</p>}
      {error && <p role="alert" className="home-card text-sm">{error}</p>}
      {!error && businesses === null && <p role="status" className="py-8 text-center text-sm text-ink-500">Loading food businesses…</p>}
      {!error && businesses !== null && filtered.length === 0 && (
        <div className="home-card py-8 text-center">
          <p className="font-semibold">Nothing here just yet.</p>
          <p className="mt-2 text-sm text-ink-500">Try another search or browse a different food category.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map((business) => <BusinessCard key={business.id} business={business} />)}
      </div>
    </div>
  );
}
