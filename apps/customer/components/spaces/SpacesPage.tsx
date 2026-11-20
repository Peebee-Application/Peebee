"use client";

import { BedDouble, Building2, Home, KeyRound, Warehouse } from "lucide-react";
import Link from "next/link";
import { useHomeMenu } from "../../lib/home-menu";
import { SPACE_PAGES } from "../../lib/nav-layout";

const icons = [BedDouble, Home, Building2, Warehouse, KeyRound];

export function SpacesPage({ category }: { category?: string }) {
  const menu = useHomeMenu();
  const page = SPACE_PAGES.find((p) => p.id === category);
  return <section className="space-y-8 px-5 py-8">
    <div className="space-y-3"><p className="text-xs font-bold uppercase tracking-widest text-gold">{menu.navigation.spacesLabel}</p>
      <h1 className="text-4xl font-extrabold tracking-tight text-ink">{page?.label ?? menu.navigation.spacesLabel}</h1>
      <p className="text-ink-500">{page?.description ?? "A place for every part of your life."}</p>
    </div>
    <div className="rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-7 text-center">
      <Building2 className="mx-auto mb-4 h-12 w-12 text-gold" aria-hidden />
      <h2 className="text-2xl font-bold">{menu.navigation.spacesEnabled ? "Coming soon" : "Currently unavailable"}</h2>
      <p className="mt-3 text-sm text-ink-500">{menu.navigation.spacesEnabled ? "We’re making room for something new. Explore Peebee while we get Spaces ready." : "Explore the other services available on Peebee."}</p>
    </div>
    {menu.navigation.spacesEnabled && <div className="grid grid-cols-2 gap-3" aria-label="Spaces categories">{SPACE_PAGES.map((p, i) => { const Icon = icons[i]; return <Link key={p.id} href={`/spaces/${p.id}`} aria-current={page?.id === p.id ? "page" : undefined} className={`flex min-h-24 flex-col gap-3 rounded-2xl border p-4 font-bold ${page?.id === p.id ? "border-gold bg-gold/15" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}><Icon className="h-6 w-6 text-gold" aria-hidden />{p.label}</Link>; })}</div>}
    <Link href="/" className="inline-flex min-h-12 items-center rounded-full bg-gold px-6 font-bold text-ink-gold">Back to Home</Link>
  </section>;
}
