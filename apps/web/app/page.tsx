import {
  ArrowRight,
  Bike,
  CheckCircle2,
  MapPin,
  Package,
  ShieldCheck,
  ShoppingCart,
  Star,
  Store,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SiteFooter } from "../components/SiteFooter";
import { ThemeModeToggle } from "../components/ThemeModeToggle";

const CUSTOMER_APP_URL = "https://customer.peebee.online";
const RIDER_APP_URL = "https://rider.peebee.online";
const RESTAURANT_APP_URL = "https://restaurant.peebee.online";

const SERVICES = [
  {
    title: "Ride",
    body: "Request a trusted rider and move across town with live tracking.",
    icon: Bike,
  },
  {
    title: "Food",
    body: "Order from nearby restaurants and keep the conversation in one place.",
    icon: UtensilsCrossed,
  },
  {
    title: "Shopping",
    body: "Send a list, approve substitutions, and get essentials brought home.",
    icon: ShoppingCart,
  },
  {
    title: "Parcels",
    body: "Move packages across the city with proof, chat, and rider updates.",
    icon: Package,
  },
];

const STATS = [
  { label: "Rides, food, errands", value: "4-in-1" },
  { label: "Payment options", value: "MoMo + cash" },
  { label: "Built for", value: "Uganda" },
];

const STEPS = [
  "Choose what you need",
  "Match with a verified rider",
  "Track, chat, and confirm",
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-cream">
      <section className="hero-shell relative min-h-[92vh] px-5 text-ink sm:px-8">
        <Image
          src="/images/hero-rider.png"
          alt="Tuma rider ready for delivery on a city street"
          fill
          className="object-cover object-[64%_center]"
          priority
          sizes="100vw"
        />
        <div className="hero-overlay absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[rgb(var(--color-cream))] to-transparent" />

        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between py-5">
          <Image src="/brand/tuma-logo-navy.png" alt="Tuma" width={116} height={30} className="h-7 w-auto dark:hidden" priority />
          <Image src="/brand/tuma-logo-white.png" alt="Tuma" width={116} height={30} className="hidden h-7 w-auto dark:block" priority />
          <nav className="hidden items-center gap-7 text-sm font-semibold text-ink-500 md:flex">
            <Link href="#services" className="transition hover:text-ink">
              Services
            </Link>
            <Link href="#how-it-works" className="transition hover:text-ink">
              How it works
            </Link>
            <Link href="#partners" className="transition hover:text-ink">
              Partners
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <a className="button button-light" href={CUSTOMER_APP_URL}>
              Open app
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
            <ThemeModeToggle />
          </div>
        </header>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col justify-center pb-28 pt-16 sm:pb-32 sm:pt-24 lg:min-h-[calc(92vh-80px)]">
          <div className="hero-copy max-w-2xl">
            <span className="hero-pill inline-flex items-center gap-2 border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]/90 px-3 py-1.5 text-xs font-bold uppercase text-ink-500 shadow-[var(--shadow-card)] backdrop-blur">
              <MapPin className="h-3.5 w-3.5 text-gold" aria-hidden />
              Uganda's everyday movement app
            </span>
            <h1 className="mt-7 max-w-xl text-5xl font-black leading-[0.96] text-ink sm:text-6xl lg:text-7xl">
              Get it done with Tuma.
            </h1>
            <p className="mt-5 max-w-xl text-xl font-semibold leading-tight text-ink sm:text-2xl">
              Rides, food, shopping, and parcels with verified riders in one app.
            </p>
            <p className="mt-5 max-w-lg text-base leading-7 text-ink-500">
              Tuma keeps the whole job visible: request, rider match, live updates, chat, and payment confirmation from pickup to doorstep.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={CUSTOMER_APP_URL} className="button button-primary">
                Start with Tuma
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href={RIDER_APP_URL} className="button button-ghost">
                Become a rider
              </a>
            </div>
          </div>

          <div className="hero-stats mt-14 grid max-w-3xl grid-cols-1 overflow-hidden border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]/88 shadow-[var(--shadow-card)] backdrop-blur-md sm:grid-cols-3">
            {STATS.map((stat) => (
              <div key={stat.label} className="border-[var(--border-faint)] px-5 py-4 sm:border-r sm:last:border-r-0">
                <p className="text-2xl font-black text-ink">{stat.value}</p>
                <p className="mt-1 text-sm font-semibold text-ink-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="services" className="mx-auto grid max-w-7xl grid-cols-1 gap-3 px-5 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        {SERVICES.map((service) => (
          <article key={service.title} className="service-card">
            <div className="flex h-12 w-12 items-center justify-center">
              <service.icon className="h-5 w-5" aria-hidden />
            </div>
            <h2 className="mt-6 text-2xl font-black text-ink">{service.title}</h2>
            <p className="mt-3 text-sm leading-6 text-ink-500">{service.body}</p>
          </article>
        ))}
      </section>

      <section id="how-it-works" className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
        <div>
          <p className="eyebrow">Simple by design</p>
          <h2 className="mt-3 max-w-lg text-4xl font-black leading-tight text-ink sm:text-5xl">
            One request becomes a completed delivery.
          </h2>
        </div>
        <div className="grid gap-3">
          {STEPS.map((step, index) => (
            <div key={step} className="process-row">
              <span>{index + 1}</span>
              <p>{step}</p>
              <CheckCircle2 className="h-5 w-5 text-green" aria-hidden />
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 py-18 sm:px-8">
        <div className="trust-panel card mx-auto grid max-w-7xl gap-10 !p-8 text-white lg:grid-cols-[1fr_1.1fr] lg:items-center lg:!p-14 xl:!p-16">
          <div>
            <p className="eyebrow text-gold">Trust built in</p>
            <h2 className="mt-3 max-w-md text-4xl font-black leading-tight sm:text-5xl">
              Designed for real errands, real riders, and real payments.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="dark-card">
              <ShieldCheck className="h-6 w-6 text-gold" aria-hidden />
              <p>Verified riders</p>
            </div>
            <div className="dark-card">
              <Wallet className="h-6 w-6 text-gold" aria-hidden />
              <p>Escrow-aware payments</p>
            </div>
            <div className="dark-card">
              <Star className="h-6 w-6 text-gold" aria-hidden />
              <p>English and Luganda</p>
            </div>
          </div>
        </div>
      </section>

      <section id="partners" className="mx-auto grid max-w-7xl gap-3 px-5 py-20 sm:px-8 lg:grid-cols-2">
        <article className="partner-panel bg-gold text-ink-gold">
          <h2>Earn as a Tuma rider</h2>
          <p>Claim nearby jobs, serve customers across town, and get paid through the channels riders already use.</p>
          <a href={RIDER_APP_URL} className="button button-dark">
            Sign up to ride
            <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </article>
        <article className="partner-panel bg-[rgb(var(--surface-card))] text-ink">
          <Store className="h-7 w-7 text-green" aria-hidden />
          <h2>List your restaurant</h2>
          <p>Bring your menu online, chat with customers, and let Tuma's rider network handle the handoff.</p>
          <a href={RESTAURANT_APP_URL} className="button button-outline">
            Join as a restaurant
            <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </article>
      </section>

      <SiteFooter />
    </main>
  );
}
