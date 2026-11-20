"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SalesTier, StoreSales } from "../../lib/store-sales";
import styles from "./StoreSales.module.css";

const slides: Array<{ id: string; tier: SalesTier; kicker: string; title: string; accent: string; description: string; image: string }> = [
  { id: "storefront", tier: "pro", kicker: "SELL BEYOND THE COUNTER", title: "Put your products in", accent: "the spotlight.", description: "Create your storefront. Let customers discover what you sell.", image: "/store-upgrade/pro-grocery.webp" },
  { id: "business", tier: "elite", kicker: "BRING IT ALL TOGETHER", title: "Your business.", accent: "Working as one.", description: "Your website, shop, stock and deliveries. One place to run it all.", image: "/store-upgrade/elite-electronics.webp" },
  { id: "live", tier: "pro", kicker: "LET THEM SEE IT LIVE", title: "Go live. Bring your products", accent: "to life.", description: "Show the details. Answer questions. Connect with your customers.", image: "/store-upgrade/live-bakery.webp" },
];

export function StoreHeroCarousel({ data, onExplore }: { data: StoreSales; onExplore: (tier: SalesTier) => void }) {
  const enabled = slides.filter(slide => slide.id !== "live" || data.plans.pro.live);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const touchStart = useRef<number | null>(null);
  const active = index % enabled.length;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPaused(!data.carousel.autoplay || media.matches);
    const motionChanged = () => { if (media.matches) setPaused(true); };
    const visibilityChanged = () => setVisible(!document.hidden);
    visibilityChanged();
    media.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { media.removeEventListener("change", motionChanged); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, [data.carousel.autoplay]);
  useEffect(() => {
    if (paused || hovered || focused || !visible || !data.carousel.autoplay || enabled.length < 2) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % enabled.length), data.carousel.seconds * 1000);
    return () => window.clearInterval(timer);
  }, [paused, hovered, focused, visible, data.carousel.autoplay, data.carousel.seconds, enabled.length]);
  const step = (delta: number) => { setPaused(true); setIndex(value => (value + delta + enabled.length) % enabled.length); };
  return <section aria-label="Grow with Peebee" aria-roledescription="carousel" className={`${styles.hero} relative overflow-hidden rounded-[30px] border border-gold/30 bg-black text-white`}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    onTouchStart={event => { touchStart.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={event => { if (touchStart.current !== null) { const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current; if (Math.abs(delta) > 45) step(delta > 0 ? -1 : 1); } touchStart.current = null; }}>
    <div className={`${styles.track} flex`} style={{ transform: `translateX(-${active * 100}%)` }}>
      {enabled.map((slide, i) => <div key={slide.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${enabled.length}`} aria-hidden={i !== active} inert={i !== active} className={`${styles.slide} relative min-w-full`}>
        <Image src={slide.image} alt="" fill sizes="(max-width: 768px) 100vw, 800px" priority={i === 0} className={styles.art} />
        <div aria-hidden className={`${styles.shade} absolute inset-0`} />
        <div className={`${styles.copy} relative z-10 flex flex-col items-start`}>
          <p className="mb-3 text-[10px] font-black tracking-wide text-gold sm:text-xs">{slide.kicker}</p>
          <h2 className="text-[27px] font-black leading-[1.06] tracking-tight sm:text-[39px] lg:text-[44px]">{slide.title}<span className="mt-1 block text-gold">{slide.accent}</span></h2>
          <p className="mt-3 text-[13px] font-medium leading-snug text-white/90 sm:text-[17px]">{slide.description}</p>
          <button type="button" onClick={() => onExplore(slide.tier)} className="mt-5 inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full bg-gold px-3 text-[13px] font-black text-ink-gold sm:min-h-12 sm:px-5 sm:text-base">Explore {slide.tier === "pro" ? "Pro" : "Elite"}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden /></button>
        </div>
      </div>)}
    </div>
    <div className="absolute inset-x-0 bottom-2 z-20 flex items-center justify-center gap-1.5 sm:bottom-3">
      <button type="button" aria-label="Previous slide" onClick={() => step(-1)} className="grid h-10 w-10 place-items-center rounded-full border border-white/35 bg-black/70"><ArrowLeft className="h-4 w-4" aria-hidden /></button>
      {data.carousel.autoplay && <button type="button" aria-label={paused ? "Play slides" : "Pause slides"} onClick={() => { setPaused(value => !value); setFocused(false); }} className="grid h-10 w-10 place-items-center rounded-full border border-white/35 bg-black/70">{paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}</button>}
      {enabled.map((slide, i) => <button key={slide.id} type="button" aria-label={`Show slide ${i + 1}`} aria-current={i === active ? "true" : undefined} onClick={() => { setPaused(true); setIndex(i); }} className="grid h-10 w-8 place-items-center rounded-full bg-black/70"><span className={`h-2.5 w-2.5 rounded-full ${i === active ? "bg-gold" : "bg-white/70"}`} /></button>)}
      <button type="button" aria-label="Next slide" onClick={() => step(1)} className="grid h-10 w-10 place-items-center rounded-full border border-white/35 bg-black/70"><ArrowRight className="h-4 w-4" aria-hidden /></button>
    </div>
  </section>;
}
