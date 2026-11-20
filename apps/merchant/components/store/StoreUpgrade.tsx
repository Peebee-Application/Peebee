"use client";

import Link from "next/link";
import { ArrowRight, Check, Crown, Monitor, Package, Radio, Store } from "lucide-react";

/** Promotional Store landing; choosing a plan continues into the existing checkout. */
export function StoreUpgrade({ proPrice, elitePrice, free, eliteEnabled, liveEnabled, canChoose, setupRequired = false }: {
  proPrice: number; elitePrice: number; free: boolean; eliteEnabled: boolean; liveEnabled: boolean; canChoose: boolean; setupRequired?: boolean;
}) {
  const price = (amount: number) => free ? "Free now" : `UGX ${Math.round(amount).toLocaleString("en-US")} / month`;
  const plansHref = setupRequired ? "/store/setup" : "/store/plans";
  return <div className="space-y-5" data-testid="store-upgrade">
    <section className="home-card space-y-4 !p-6">
      <span className="inline-flex items-center gap-2 text-sm font-bold text-gold"><Store className="h-5 w-5" aria-hidden /> PEEBEE STORE</span>
      <h1 className="max-w-lg text-4xl font-black leading-tight text-ink">Your next chapter starts with a store.</h1>
      <p className="text-lg leading-relaxed text-ink-500">Turn your business into a place customers can discover, shop and come back to. Choose Pro to sell online, or Elite to run more of your business in one place.</p>
      <p className="flex items-start gap-2 text-base text-ink-500"><Check className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />Your Merchant plan already includes code payments, your wallet and your account.</p>
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      <section className="home-card flex flex-col gap-4 !p-6" aria-labelledby="upgrade-pro">
        <Package className="h-9 w-9 text-gold" aria-hidden />
        <div><p className="text-sm font-bold text-ink-500">START SELLING ONLINE</p><h2 id="upgrade-pro" className="mt-1 text-3xl font-black text-ink">Merchant Pro</h2><p className="mt-2 text-xl font-bold text-ink">{price(proPrice)}</p></div>
        <p className="text-lg text-ink-500">Give your products a storefront of their own.</p>
        <ul className="flex-1 space-y-3 text-base text-ink">
          <li className="flex gap-3"><Check className="h-5 w-5 shrink-0 text-gold" aria-hidden />Product catalog and online storefront</li>
          {liveEnabled && <li className="flex gap-3"><Radio className="h-5 w-5 shrink-0 text-gold" aria-hidden />Live selling with your customers</li>}
          <li className="flex gap-3"><Check className="h-5 w-5 shrink-0 text-gold" aria-hidden />Tools to plan your promotions</li>
        </ul>
        {canChoose && <Link href={`${plansHref}?tier=pro_live`} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-gold px-5 text-lg font-bold text-ink-gold">Explore Pro<ArrowRight className="h-5 w-5" aria-hidden /></Link>}
      </section>
      <section className="home-card flex flex-col gap-4 !border-gold !p-6" aria-labelledby="upgrade-elite">
        <Crown className="h-9 w-9 text-gold" aria-hidden />
        <div><p className="text-sm font-bold text-ink-500">GROW YOUR OPERATIONS</p><h2 id="upgrade-elite" className="mt-1 text-3xl font-black text-ink">Merchant Elite</h2><p className="mt-2 text-xl font-bold text-ink">{price(elitePrice)}</p></div>
        <p className="text-lg text-ink-500">Bring your online store and daily operations together.</p>
        <ul className="flex-1 space-y-3 text-base text-ink">
          <li className="flex gap-3"><Check className="h-5 w-5 shrink-0 text-gold" aria-hidden />The Pro store experience</li>
          <li className="flex gap-3"><Monitor className="h-5 w-5 shrink-0 text-gold" aria-hidden />Point of sale, stock and business insights</li>
          <li className="flex gap-3"><Check className="h-5 w-5 shrink-0 text-gold" aria-hidden />Digital products and courses</li>
        </ul>
        {!eliteEnabled ? <p className="text-base font-bold text-ink-500">Elite is currently unavailable.</p> : canChoose && <Link href={`${plansHref}?tier=elite`} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-gold px-5 text-lg font-bold text-ink-gold">Explore Elite<ArrowRight className="h-5 w-5" aria-hidden /></Link>}
      </section>
    </div>
    {canChoose ? <Link href={plansHref} className="flex min-h-12 items-center justify-center gap-2 text-lg font-bold text-ink">Compare plans and billing<ArrowRight className="h-5 w-5" aria-hidden /></Link> : <p className="text-center text-base text-ink-500">Ask your business owner to choose a plan.</p>}
  </div>;
}
