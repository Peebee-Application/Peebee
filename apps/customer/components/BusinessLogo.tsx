"use client";

import type { FoodRestaurantTrust } from "@peebee/shared";
import { BadgeCheck, CalendarDays, ShoppingBag, Star, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

function formatMemberSince(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "Recently joined";
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

export function BusinessLogo({
  id,
  name,
  logoKey,
  businessType,
  isOpen,
  isDemo = false,
  createdAt,
  trust,
}: {
  id: string;
  name: string;
  logoKey?: string | null;
  businessType: string;
  isOpen: boolean;
  isDemo?: boolean;
  createdAt: string;
  trust: FoodRestaurantTrust | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!logoKey) return;
    let disposed = false;
    let url: string | undefined;
    api.restaurantLogoBlob(id, logoKey).then((blob) => {
      if (disposed) return;
      url = URL.createObjectURL(blob);
      setImage({ key: logoKey, url });
    }).catch(() => {});
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, logoKey]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  const logo = image?.key === logoKey && image
    ? (
      // Restaurant logos are fetched as authenticated blob URLs; next/image cannot optimize these URLs.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image.url} alt="" className="h-full w-full rounded-full object-cover" />
    )
    : <Store size={24} aria-hidden />;

  return (
    <div ref={rootRef} className="relative h-14 w-14 shrink-0">
      <section
        aria-label={`${name} restaurant profile`}
        aria-hidden={!expanded}
        inert={!expanded}
        onClick={() => setExpanded(false)}
        className={`restaurant-trust-card absolute right-0 top-0 z-20 ${expanded ? "is-open" : ""}`}
      >
        <div className="restaurant-trust-card__heading">
          <div className="min-w-0 pr-2">
            <span className={`restaurant-trust-card__approval ${isDemo ? "is-demo" : ""}`}>
              {isDemo ? <Store size={14} aria-hidden /> : <BadgeCheck size={15} aria-hidden />}
              {isDemo ? "Sample profile" : "Peebee approved"}
            </span>
            <h2 className="mt-2 truncate text-lg font-bold leading-tight">{name}</h2>
            <p className="mt-1 truncate text-sm text-ink-500">{businessType}</p>
          </div>
        </div>

        <div className="restaurant-trust-card__metrics">
          <div className="restaurant-trust-card__metric">
            <span className="restaurant-trust-card__metric-icon"><Star size={16} aria-hidden /></span>
            <span className="restaurant-trust-card__metric-value">
              {!trust || !trust.menuReviewsAvailable ? "—" : trust.averageMenuRating == null ? "New" : `${trust.averageMenuRating.toFixed(1)} / 5`}
            </span>
            <span className="restaurant-trust-card__metric-label">
              {!trust ? isDemo ? "Demo data" : "Loading review details" : !trust.menuReviewsAvailable ? "Dish reviews unavailable" : trust.menuReviewCount ? `${trust.menuReviewCount.toLocaleString()} verified dish reviews` : "No dish reviews yet"}
            </span>
          </div>
          <div className="restaurant-trust-card__metric">
            <span className="restaurant-trust-card__metric-icon"><ShoppingBag size={16} aria-hidden /></span>
            <span className="restaurant-trust-card__metric-value">
              {trust ? trust.completedOrderCount.toLocaleString() : "—"}
            </span>
            <span className="restaurant-trust-card__metric-label">{trust ? "Completed orders" : isDemo ? "Sample orders" : "Loading order details"}</span>
          </div>
        </div>

        <div className="restaurant-trust-card__footer">
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays size={16} className="shrink-0 text-gold" aria-hidden />
            <span className="truncate">On Peebee since {formatMemberSince(createdAt)}</span>
          </span>
          <span className={`restaurant-trust-card__status ${isOpen ? "is-open" : ""}`}>
            {isOpen ? "Open now" : "Closed"}
          </span>
        </div>
      </section>

      <button
        type="button"
        aria-label={expanded ? `Close ${name} profile` : `View ${name} profile`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={`restaurant-logo-trigger relative z-30 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-sm ${expanded ? "is-expanded" : ""}`}
      >
        {logo}
      </button>
    </div>
  );
}
