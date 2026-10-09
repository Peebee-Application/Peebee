import { ArrowRight, Archive, Bike, BookOpen, Briefcase, Car, CarFront, Clock3, ListChecks, Package, Pill, ShoppingBasket, Store, Truck, UsersRound, WashingMachine, Wrench } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type LandingGroup = "ride" | "shopping" | "deliver" | "service";
type LandingItem = { title: string; description: string; icon: LucideIcon; href?: string };

const landingContent: Record<LandingGroup, { eyebrow: string; title: string; description: string; items: LandingItem[] }> = {
  ride: {
    eyebrow: "Get where you need to go",
    title: "Ride with Peebee",
    description: "Choose a ride that fits your trip. Compare the options before you book.",
    items: [
      { title: "Boda", description: "A quick ride through town.", icon: Bike, href: "/ride/boda" },
      { title: "Car", description: "A comfortable ride for your journey.", icon: Car, href: "/ride/car" },
      { title: "Rideshare", description: "Share a trip and travel together.", icon: UsersRound, href: "/carpool" },
      { title: "Selfdrive", description: "Choose a car and drive yourself.", icon: CarFront, href: "/rent" },
    ],
  },
  shopping: {
    eyebrow: "Your errands, made easier",
    title: "Buy",
    description: "Build a list for your next shop, then let a Peebee rider take care of the trip.",
    items: [
      { title: "List", description: "Create and send a shopping list.", icon: ListChecks, href: "/shoplist" },
      { title: "Groceries", description: "Browse nearby markets and groceries.", icon: Store },
      { title: "Stores", description: "Shop from local stores.", icon: ShoppingBasket },
      { title: "Pharma", description: "Get everyday health essentials.", icon: Pill },
      { title: "Services", description: "Find practical help for everyday tasks.", icon: Briefcase, href: "/service" },
    ],
  },
  deliver: {
    eyebrow: "Send something across town",
    title: "Send with Peebee",
    description: "Choose how to send a parcel, move goods, or arrange storage.",
    items: [
      { title: "Parcels", description: "Send a package to someone.", icon: Package, href: "/deliver/parcel" },
      { title: "Goods", description: "Arrange pickup and delivery for your goods.", icon: ShoppingBasket },
      { title: "Move", description: "Move larger items across town.", icon: Truck },
      { title: "Storage", description: "Arrange space for items you need to store.", icon: Archive },
    ],
  },
  service: {
    eyebrow: "Help for everyday tasks",
    title: "Service",
    description: "Find practical help for home, work, learning, and more.",
    items: [
      { title: "Laundry", description: "Arrange laundry pickup and care.", icon: WashingMachine },
      { title: "Fix", description: "Find help for repairs and maintenance.", icon: Wrench },
      { title: "Hire", description: "Find a skilled person for the job.", icon: Briefcase },
      { title: "Learn", description: "Discover lessons and learning support.", icon: BookOpen },
    ],
  },
};

export function ServiceLanding({ group }: { group: LandingGroup }) {
  const content = landingContent[group];

  return (
    <main className="space-y-6 px-4 pb-8 pt-5">
      <section className="home-card overflow-hidden border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-gold">{content.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{content.title}</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">{content.description}</p>
      </section>

      <section aria-label={`${content.title} services`} className="grid grid-cols-2 gap-3">
        {content.items.map((item) => {
          const Icon = item.icon;
          const card = (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/12 text-gold">
                <Icon size={22} strokeWidth={1.8} aria-hidden />
              </span>
              <span className="mt-4 flex items-center justify-between gap-2">
                <strong className="text-base">{item.title}</strong>
                {item.href ? <ArrowRight size={17} className="shrink-0 text-gold" aria-hidden /> : <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] px-2 py-1 text-[10px] font-semibold text-ink-500"><Clock3 size={12} aria-hidden />Soon</span>}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-500">{item.description}</span>
            </>
          );
          const classes = "home-card min-h-[148px] rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-left transition-transform active:scale-[0.98]";

          return item.href ? (
            <Link key={item.title} href={item.href} className={`block ${classes}`}>{card}</Link>
          ) : (
            <div key={item.title} aria-disabled="true" className={`${classes} opacity-75`}>{card}</div>
          );
        })}
      </section>
    </main>
  );
}
