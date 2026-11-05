"use client";

import { Ambulance, ArrowRight, Bike, Briefcase, Bus, Car, CarFront, ClipboardList, Clock3, Crown, Flame, HardHat, ListChecks, Package, Pill, ShoppingBasket, Sparkles, Store, Truck, UsersRound, WashingMachine, Wrench } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { HiveShortcutId } from "@peebee/shared";
import { useHireAvailability, useHomeMenu } from "../lib/home-menu";
import { markOffline, useModules } from "../lib/modules";
import { useSpecialCarServices } from "../lib/special-car";
import { useTaxipress } from "../lib/taxipress";

type LandingGroup = "ride" | "shopping";
type LandingItem = { title: string; description: string; icon: LucideIcon; href?: string; wide?: boolean; /** The Services module that shows or hides this card. */ module?: string };

const landingContent: Record<LandingGroup, { eyebrow: string; title: string; description: string; items: LandingItem[] }> = {
  ride: {
    eyebrow: "Get where you need to go",
    title: "Ride with Peebee",
    description: "Choose a ride that fits your trip. Compare the options before you book.",
    items: [
      { title: "Boda", description: "A quick ride through town.", icon: Bike, href: "/ride/boda", module: "ride.boda" },
      { title: "Car", description: "A comfortable ride for your journey.", icon: Car, href: "/ride/car", module: "ride.car" },
      { title: "Rideshare", description: "Share a trip and travel together.", icon: UsersRound, href: "/carpool", module: "ride.car.carpool" },
      { title: "Selfdrive", description: "Choose a car and drive yourself.", icon: CarFront, href: "/rent", module: "ride.car.selfdrive" },
      { title: "Move", description: "Vans and trucks for moving and cargo.", icon: Truck, href: "/ride/move", module: "ride.move" },
      { title: "Parcel", description: "Send a package to someone.", icon: Package, href: "/deliver/parcel", module: "deliver.parcel" },
    ],
  },
  shopping: {
    eyebrow: "Your errands, made easier",
    title: "Buy",
    description: "Build a list for your next shop, browse groceries & stores, or watch spotlight streams.",
    items: [
      { title: "List", description: "Create and send a shopping list.", icon: ListChecks, href: "/shoplist", module: "buy.shopping" },
      { title: "Groceries", description: "Browse nearby markets and groceries.", icon: ShoppingBasket, href: "/groceries", module: "buy.shopping" },
      { title: "Stores", description: "Shop from verified local stores.", icon: Store, href: "/stores", module: "buy.marketplace" },
      { title: "Pharma", description: "Get everyday health essentials.", icon: Pill, href: "/pharmacy", module: "buy.pharmacy" },
      { title: "Spotlight", description: "Watch live shopping streams, reels & creator carousels.", icon: Flame, href: "/spotlight" },
    ],
  },
};

/** Luxury and Ambulance appear on the Ride home screen once Peebee has an approved vehicle of that kind. */
const specialRideItems: { key: "luxury" | "ambulance"; item: LandingItem }[] = [
  { key: "luxury", item: { title: "VIP", description: "Chauffeur cars for weddings, parties and red carpet.", icon: Crown, href: "/ride/luxury", module: "ride.luxury" } },
  { key: "ambulance", item: { title: "Ambulance", description: "Emergency transport, sent to you at once.", icon: Ambulance, href: "/ride/ambulance", wide: true, module: "ride.ambulance" } },
];

/** Taxipress appears once staff have switched it on and a route is running. It is a full-width card, with Ambulance stacked right below it. */
const taxipressItem: LandingItem = { title: "Taxipress", description: "Book a seat on the next taxi along a fixed route.", icon: Bus, href: "/ride/taxipress", wide: true, module: "ride.taxipress" };

export function ServiceLanding({ group }: { group: LandingGroup }) {
  const special = useSpecialCarServices();
  const taxipress = useTaxipress();
  const moduleOn = useModules();
  const base = landingContent[group];
  const withExtras = group === "ride" ? { ...base, items: [...base.items, ...(taxipress.enabled ? [taxipressItem] : []), ...specialRideItems.filter((s) => special[s.key]).map((s) => s.item)] } : base;
  // A card whose module is switched off in Admin → Services stays, inactive; the code behind it stays ready.
  const content = { ...withExtras, items: markOffline(withExtras.items, moduleOn) };
  // Wide cards (Taxipress, Ambulance) stack full-width under the two-column grid; the rest stay in it.
  const gridItems = content.items.filter((item) => !item.wide);
  const wideItems = content.items.filter((item) => item.wide);

  return (
    <main className="space-y-6 px-4 pb-8 pt-5">
      <section className="home-card overflow-hidden border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-gold">{content.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{content.title}</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">{content.description}</p>
      </section>

      <section aria-label={`${content.title} services`} className="grid grid-cols-2 gap-3">
        {[...gridItems, ...wideItems].map((item, index) => {
          const Icon = item.icon;
          const card = (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/10 text-gold">
                <Icon size={22} strokeWidth={1.8} aria-hidden />
              </span>
              <span className="mt-4 flex items-center justify-between gap-2">
                <strong className="text-base">{item.title}</strong>
                {item.offline ? <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] px-2 py-1 text-[10px] font-semibold text-ink-500"><Clock3 size={12} aria-hidden />Offline</span> : item.href ? <ArrowRight size={17} className="shrink-0 text-gold" aria-hidden /> : <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] px-2 py-1 text-[10px] font-semibold text-ink-500"><Clock3 size={12} aria-hidden />Soon</span>}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-500">{item.description}</span>
            </>
          );
          // An odd last card spans both columns so the grid never leaves a hole.
          const span = item.wide || (index === gridItems.length - 1 && gridItems.length % 2 === 1) ? " col-span-2" : "";
          const classes = "home-card min-h-[148px] rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-left transition-transform active:scale-[0.98]";

          return item.offline ? (
            <div key={item.title} aria-disabled="true" title="Currently Offline" className={`${classes}${span} cursor-not-allowed opacity-40`}>{card}</div>
          ) : item.href ? (
            <Link key={item.title} href={item.href} className={`block ${classes}${span}`}>{card}</Link>
          ) : (
            <div key={item.title} aria-disabled="true" className={`${classes}${span} opacity-75`}>{card}</div>
          );
        })}
      </section>
    </main>
  );
}

type HiveServiceId = "clean" | "laundry" | "fix";
const HIVE_CARD: Record<HiveServiceId, { description: string; icon: LucideIcon; href: string }> = {
  clean: { description: "Homes, offices, cars and more, cleaned for you.", icon: Sparkles, href: "/services/clean" },
  laundry: { description: "Doorstep wash & fold, dry cleaning, ironing.", icon: WashingMachine, href: "/services/laundry" },
  fix: { description: "Home repairs, plumbing, electrical and car servicing.", icon: Wrench, href: "/services/fix" },
};

/** The person-centred shortcuts: finding someone for a quick odd job, or hiring for a project or contract. */
const HIVE_PERSON: Record<"workers" | "hire", { description: string; icon: LucideIcon; href: string }> = {
  workers: { description: "Quick odd jobs: find a worker nearby, or post the job.", icon: HardHat, href: "/services/hire/workers?segment=informal" },
  hire: { description: "A project or a longer contract with someone you choose.", icon: Briefcase, href: "/services/hire" },
};

/** Hive: Peebee-delivered services at a clear price, with a separate section for finding a person.
 * Names, order and what is on come from the admin's home menu setting. */
export function HiveLanding() {
  const menu = useHomeMenu();
  const availability = useHireAvailability();
  const { hive } = menu;
  const cards = hive.shortcuts.filter((s): s is typeof s & { id: HiveServiceId } => s.enabled && s.id !== "workers" && s.id !== "hire");
  const people = hive.shortcuts.filter((s): s is typeof s & { id: "workers" | "hire" } => s.enabled && (s.id === "workers" ? availability.workers : s.id === "hire" ? availability.hire : false));
  const showPeople = hive.hireBanner.enabled && people.length > 0;

  return (
    <main className="space-y-6 px-4 pb-8 pt-5">
      <section className="home-card overflow-hidden border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-gold">{hive.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{menu.clusters.hive.label}</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">{hive.description}</p>
      </section>

      {cards.length > 0 && (
        <section aria-label={`${menu.clusters.hive.label} services`} className="grid grid-cols-2 gap-3">
          {cards.map((item) => {
            const card = HIVE_CARD[item.id];
            const Icon = card.icon;
            return (
              <Link key={item.id} href={card.href} className="home-card block min-h-[148px] rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-left transition-transform active:scale-[0.98]">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/10 text-gold">
                  <Icon size={22} strokeWidth={1.8} aria-hidden />
                </span>
                <span className="mt-4 flex items-center justify-between gap-2">
                  <strong className="text-base">{item.label}</strong>
                  <ArrowRight size={17} className="shrink-0 text-gold" aria-hidden />
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-500">{card.description}</span>
              </Link>
            );
          })}
        </section>
      )}

      {/* Finding a person is a different thing from a service Peebee delivers, so it sits apart from the cards above. */}
      {showPeople && (
        <section aria-label={hive.hireBanner.title} className="space-y-2 rounded-3xl border border-dashed border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-4">
          <div className="px-1">
            <strong className="block text-base">{hive.hireBanner.title}</strong>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{hive.hireBanner.text}</span>
          </div>
          {people.map((item) => {
            const row = HIVE_PERSON[item.id];
            const Icon = row.icon;
            return (
              <Link key={item.id} href={row.href} className="flex items-center gap-3 rounded-2xl bg-[rgb(var(--surface-card))] p-3 transition-transform active:scale-[0.98]">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
                  <Icon size={20} strokeWidth={1.8} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">{item.label}</strong>
                  <span className="block text-xs leading-relaxed text-ink-500">{row.description}</span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-gold" aria-hidden />
              </Link>
            );
          })}
        </section>
      )}

      <Link href="/services/work" className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-500 transition-opacity active:opacity-60">
        <ClipboardList size={16} aria-hidden />
        My bookings
        <ArrowRight size={14} className="text-gold" aria-hidden />
      </Link>
    </main>
  );
}
