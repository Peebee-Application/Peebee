"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { productIdFromHref } from "../../lib/buy-motion";
import { PushLink, SnapDots, useSnapTrack } from "../buy/motion";
import "../../app/shopping-collection.css";

export type CollectionSlide = {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  href?: string;
  cta?: string;
  onCta?: () => void;
};

/** Snap carousel for a collection. Slides come from live shops or catalogue rows already loaded. */
export function CollectionHero({ slides, label }: { slides: CollectionSlide[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { index, moving, go } = useSnapTrack(ref, slides.length);
  if (slides.length === 0) return null;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    go(e.key === "ArrowRight" ? Math.min(slides.length - 1, index + 1) : Math.max(0, index - 1));
  }

  return (
    <section className="shop-hero" aria-roledescription="carousel" aria-label={label}>
      <div ref={ref} className="shop-hero__track" onKeyDown={onKey} tabIndex={0}>
        {slides.map((slide, i) => (
          <article key={slide.id} data-product-source={slide.href ? productIdFromHref(slide.href) ?? undefined : undefined} className="shop-hero__slide" aria-label={slide.title}>
            <div className="shop-hero__copy">
              <p className="shop-hero__title">{slide.title}</p>
              {slide.subtitle && <p className="shop-hero__sub">{slide.subtitle}</p>}
              {slide.onCta ? (
                <button type="button" className="shop-hero__cta" onClick={slide.onCta}>{slide.cta ?? "Shop now"}</button>
              ) : slide.href ? (
                <PushLink href={slide.href} className="shop-hero__cta">{slide.cta ?? "Shop now"}</PushLink>
              ) : null}
            </div>
            <div className="shop-hero__media">
              {slide.imageUrl && <img className="buy-fade" src={slide.imageUrl} alt="" loading={i === 0 ? "eager" : "lazy"} onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }} />}
            </div>
          </article>
        ))}
      </div>
      <SnapDots count={slides.length} index={index} moving={moving} labels={slides.map((slide) => `Show ${slide.title}`)} onPick={go} />
    </section>
  );
}

export type LiveShop = { id: string; name: string; logo_url?: string | null };

export function LiveRail<T extends LiveShop>({ shops, onOpen }: { shops: T[]; onOpen: (shop: T) => void }) {
  if (shops.length === 0) return null;
  return (
    <section aria-label="Live selling now">
      <div className="shop-section">
        <h2>Live now</h2>
      </div>
      <div className="shop-live" role="list">
        {shops.map((shop) => (
          <button key={shop.id} type="button" role="listitem" className="shop-live__item" onClick={() => onOpen(shop)} aria-label={`${shop.name}, live now`}>
            <span className="shop-live__ring">
              {shop.logo_url ? <img src={shop.logo_url} alt="" /> : <span className="shop-live__fallback">{shop.name.slice(0, 2).toUpperCase()}</span>}
              <span className="shop-live__tag">LIVE</span>
            </span>
            <span className="shop-live__name">{shop.name.split(" ")[0]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Move focus to the collection title when the page opens. */
export function useCollectionTitleFocus(id: string) {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id]);
}
