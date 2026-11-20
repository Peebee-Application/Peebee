"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Crown, Download, Globe, Laptop, Package, Radio, Scale, Store, Truck } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { useStoreSales, type SalesTier } from "../../lib/store-sales";
import { PlanChoice, SalesLoading, UpgradeAction } from "./StoreSalesUI";
import { StoreHeroCarousel } from "./StoreHeroCarousel";
import { card } from "./StoreUI";

const proBenefits = [
  { icon: Store, title: "Your storefront, on Peebee", description: "Display your products so customers can discover and browse them online." },
  { icon: Radio, title: "Go live with your customers", description: "Show your products, answer questions and sell in real time." },
];
const eliteBenefits = [
  { icon: Laptop, title: "Your own e-commerce website", description: "Share your link. Let customers browse and shop online." },
  { icon: Package, title: "POS, stock and business management", description: "Keep sales, inventory, suppliers and customers connected." },
  { icon: Truck, title: "Deliver with Relay", description: "Connect your orders to Peebee delivery on supported routes." },
  { icon: Download, title: "Sell digital products and premium courses", description: "Turn your expertise and digital work into products." },
];

/** Approved sales journey: choose one plan to explore, then compare the complete offering on its own page. */
export function StoreUpgrade() {
  const { data, error, retry } = useStoreSales();
  const [selected, setSelected] = useState<SalesTier>("pro");
  const selector = useRef<HTMLDivElement>(null);
  if (!data) return <SalesLoading error={error} retry={retry} />;
  const chooseFromHero = (tier: SalesTier) => {
    setSelected(tier);
    selector.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    selector.current?.querySelector<HTMLButtonElement>(`#sales-tab-${tier}`)?.focus({ preventScroll: true });
  };
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "pro" : event.key === "End" ? "elite" : selected === "pro" ? "elite" : "pro";
    setSelected(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#sales-tab-${next}`)?.focus();
  };
  const benefits = selected === "pro" ? proBenefits.filter(item => item.icon !== Radio || data.plans.pro.live).filter(item => item.icon !== Store || data.plans.pro.catalog) : eliteBenefits;
  return <div className="space-y-5 sm:space-y-6" data-testid="store-upgrade">
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-[30px] font-black leading-tight text-ink">Store</h1>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-2 text-xs font-bold text-ink sm:text-sm"><Store className="h-4 w-4 shrink-0 text-gold" aria-hidden />Your plan · {data.current === "merchant" ? "Merchant" : data.current === "elite" ? "Elite" : "Pro"}</span>
    </header>
    <StoreHeroCarousel data={data} onExplore={chooseFromHero} />
    <div className={`${card} flex items-center justify-between gap-1 p-3 sm:px-6`} aria-label="Merchant, Pro and Elite plans">
      <span className="flex min-w-0 items-center gap-2 rounded-full bg-gold/10 px-2 py-2 sm:px-4"><Store className="h-6 w-6 shrink-0 text-gold" aria-hidden /><span><span className="block text-sm font-black text-ink sm:text-base">Merchant</span><span className="block text-[10px] font-bold text-ink-500 sm:text-xs">{data.current === "merchant" ? "You are here" : "Code payments"}</span></span></span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-500" aria-hidden /><span className="inline-flex items-center gap-1.5 text-sm font-black text-ink sm:text-base"><Package className="h-6 w-6 text-gold" aria-hidden />Pro</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-500" aria-hidden /><span className="inline-flex items-center gap-1.5 text-sm font-black text-ink sm:text-base"><Crown className="h-7 w-7 text-gold" aria-hidden />Elite</span>
    </div>
    <div ref={selector} className="scroll-mt-24 space-y-4">
      <h2 className="text-[26px] font-black leading-tight text-ink sm:text-[30px]">What’s your next move?</h2>
      <div role="tablist" aria-label="Explore a plan" className="grid grid-cols-2 gap-3" onKeyDown={tabKeys}>
        <PlanChoice tier="pro" data={data} selected={selected === "pro"} onClick={() => setSelected("pro")} />
        <PlanChoice tier="elite" data={data} selected={selected === "elite"} onClick={() => setSelected("elite")} />
      </div>
    </div>
    <section role="tabpanel" id="sales-plan-panel" aria-labelledby={`sales-tab-${selected}`} tabIndex={0} className={`${card} space-y-5 p-4 sm:p-6`} data-testid={`sales-panel-${selected}`}>
      <h2 className="text-[26px] font-black leading-tight tracking-tight text-ink sm:text-[32px]">{selected === "pro" ? "Your products. A bigger audience." : "Your whole business. In your hands."}</h2>
      {selected === "elite" && <p className="flex items-center gap-3 rounded-full bg-gold/15 px-4 py-3 text-base font-black text-ink"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold text-ink-gold"><Check className="h-4 w-4" strokeWidth={3} aria-hidden /></span>Everything in Pro, included</p>}
      {selected === "pro" ? <div className="grid grid-cols-3 gap-2" aria-label="For electronics shops, groceries and bakeries">
        {[["anc-earbuds.jpg", "Electronics and accessories"], ["fresh-avocados.jpg", "Groceries and fresh produce"], ["croissant-bakery.jpg", "Bakeries and food businesses"]].map(([src, alt]) => <div key={src} className="relative aspect-square overflow-hidden rounded-[18px]"><Image src={`/products/${src}`} alt={alt} fill sizes="(max-width: 768px) 29vw, 220px" className="object-cover" /></div>)}
      </div> : <div className="relative aspect-[3/1] overflow-hidden rounded-[20px]"><Image src="/store-upgrade/elite-business.webp" alt="An online shop, smartphone business tools and organized stock" fill sizes="(max-width: 768px) 90vw, 720px" className="object-cover" /></div>}
      <div className="space-y-3">
        {benefits.map(({ icon: Icon, title, description }) => <div key={title} className={`flex items-start gap-3 ${selected === "elite" ? `${card} !rounded-[20px] p-3` : "border-b border-[var(--border-faint)] py-3 last:border-0"}`}>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-gold/15 text-gold sm:h-14 sm:w-14"><Icon className="h-7 w-7" aria-hidden /></span>
          <div className="min-w-0"><h3 className="text-[18px] font-black leading-tight text-ink sm:text-[21px]">{title}</h3><p className="mt-1 text-[15px] leading-snug text-ink-500 sm:text-[17px]">{description}</p></div>
        </div>)}
        {selected === "pro" && !benefits.length && <p className="text-base text-ink-500">Pro’s selling tools are currently unavailable. Compare the plans to see the current offering.</p>}
      </div>
      <UpgradeAction data={data} tier={selected} />
    </section>
    <Link href="/store/compare" className="flex items-center gap-4 rounded-[28px] border border-gold/30 bg-black p-5 text-white sm:p-6" data-testid="compare-plans">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-cream text-gold"><Scale className="h-8 w-8" aria-hidden /></span>
      <span className="min-w-0 flex-1 border-l border-gold/60 pl-4"><span className="block text-[23px] font-black leading-tight">See the full picture</span><span className="mt-1 block text-[15px] leading-snug text-white/75">Every Pro and Elite feature, side by side.</span><span className="mt-3 inline-flex min-h-11 items-center gap-3 rounded-full bg-gold px-4 text-sm font-black text-ink-gold">Compare plans<ArrowRight className="h-5 w-5" aria-hidden /></span></span>
    </Link>
    <p className="flex items-center justify-center gap-2 text-center text-xs text-ink-500"><Globe className="h-4 w-4 shrink-0" aria-hidden />Your Merchant payments and account stay with you.</p>
  </div>;
}
