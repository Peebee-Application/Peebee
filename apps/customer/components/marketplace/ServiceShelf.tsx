"use client";

import { CalendarCheck, Clock, MapPin, Video } from "lucide-react";
import { softCard, ugx } from "./MarketplaceUI";

export type ServiceItem = {
  id: string;
  title: string;
  description?: string | null;
  pricing_type?: string;
  price_ugx?: number;
  compare_at_price_ugx?: number | null;
  duration_minutes?: number;
  location_type?: string;
  image_url?: string | null;
  booking_url: string;
};

const PRICE_SUFFIX: Record<string, string> = { hourly: " / hr", deposit: " deposit" };

/** The store owner's bookable services (from the Services module), shown in Buy next to products. */
export function ServiceShelf({ items }: { items: ServiceItem[] }) {
  if (!items.length) return null;
  return (
    <section id="services" className="mt-6 scroll-mt-4" aria-labelledby="services-heading">
      <h2 id="services-heading" className="mb-3 px-0.5 text-sm font-black text-ink">Services</h2>
      <div className="space-y-3">
        {items.map((item) => {
          const price = Number(item.price_ugx) || 0;
          const Where = item.location_type === "virtual" ? Video : MapPin;
          return (
            <article key={item.id} data-service-card="" className={`${softCard} flex items-start gap-3 p-4`}>
              {item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover bg-surface-muted" loading="lazy" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"><CalendarCheck className="h-5 w-5" aria-hidden /></span>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-ink">{item.title}</h3>
                {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{item.description}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
                  {item.duration_minutes ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{item.duration_minutes} min</span> : null}
                  <span className="inline-flex items-center gap-1"><Where className="h-3.5 w-3.5" aria-hidden />{item.location_type === "virtual" ? "Online" : item.location_type === "client_site" ? "At your place" : "In store"}</span>
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-ink">
                    {item.pricing_type === "custom_quote" ? "Quote" : price > 0 ? `${ugx(price)}${PRICE_SUFFIX[item.pricing_type ?? ""] ?? ""}` : "Free"}
                  </p>
                  <a href={item.booking_url} className="inline-flex min-h-10 items-center rounded-full bg-gold px-5 text-xs font-black text-ink-gold">Book</a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
