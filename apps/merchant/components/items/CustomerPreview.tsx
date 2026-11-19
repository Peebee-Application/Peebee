"use client";

import { ArrowLeft, CalendarCheck, Clock, Download, Heart, MapPin, Share2, ShieldCheck, ShoppingBag, Store, Truck, Video, Zap } from "lucide-react";
import type { CSSProperties } from "react";

export type PreviewItem = {
  type: "physical" | "digital" | "service";
  title: string;
  description: string;
  category: string;
  badge: string;
  images: string[];
  price: number;
  was: number | null;
  storeName: string;
  sizes: string[];
  colours: { name: string; hex: string }[];
  delivery: { rider: boolean; pickup: boolean; readyIn: string; returnsDays: number };
  digitalKind: string;
  duration: number;
  location: string;
};

const LIGHT = { "--cream": "255 255 255", "--ink": "10 10 10", "--ink-muted": "92 102 112", "--surface-card": "255 255 255", "--surface-muted": "242 242 242", "--border-faint": "rgba(10,10,10,.08)" };
const DARK = { "--cream": "14 14 14", "--ink": "245 245 245", "--ink-muted": "170 170 170", "--surface-card": "30 30 30", "--surface-muted": "39 39 39", "--border-faint": "rgba(247,243,238,.1)" };

/**
 * A scaled copy of the customer app's product page (apps/customer ProductPageClient) so the merchant sees what buyers
 * will see, in light or dark, before publishing.
 */
export function CustomerPreview({ item, dark }: { item: PreviewItem; dark: boolean }) {
  const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-US")}`;
  const vars = (dark ? DARK : LIGHT) as unknown as CSSProperties;
  const chip = "inline-flex h-7 items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] px-2.5 text-[10px] font-semibold text-[rgb(var(--ink))]";
  return (
    <div className="mx-auto w-[300px] rounded-[40px] border border-gold/30 bg-black p-2 shadow-2xl" data-testid="customer-preview">
      <div className="relative h-[600px] overflow-hidden rounded-[32px]" style={{ ...vars, background: "rgb(var(--cream))", color: "rgb(var(--ink))" }}>
        <div className="h-full overflow-y-auto pb-20 [scrollbar-width:none]">
          <div className="px-3 pt-3">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[24px] bg-[rgb(var(--surface-muted))]">
              {item.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.images[0]} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[rgb(var(--ink-muted))]">
                  {item.type === "service" ? <CalendarCheck className="h-14 w-14" /> : item.type === "digital" ? <Download className="h-14 w-14" /> : <ShoppingBag className="h-14 w-14" />}
                </div>
              )}
              <div className="absolute inset-x-3 top-3 flex justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-card)/.9)]"><ArrowLeft className="h-4 w-4" /></span>
                <span className="flex gap-1.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-card)/.9)]"><Share2 className="h-4 w-4" /></span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-card)/.9)]"><Heart className="h-4 w-4" /></span>
                </span>
              </div>
              {item.images.length > 1 && (
                <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1">
                  {item.images.map((src, i) => <span key={src} className={`h-1.5 rounded-full ${i === 0 ? "w-4 bg-gold" : "w-1.5 bg-white/70"}`} />)}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3 px-4 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.badge && <span className="rounded-full border border-gold/30 bg-gold/20 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-gold">{item.badge}</span>}
                  {item.category && <span className="text-[8px] font-bold uppercase tracking-wider text-[rgb(var(--ink-muted))]">{item.category}</span>}
                </div>
                <p className="mt-1 break-words text-base font-bold leading-tight">{item.title || "Item name"}</p>
                <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[rgb(var(--ink-muted))]"><Store className="h-3 w-3" /> {item.storeName}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold">{ugx(item.price)}</p>
                {item.was && item.was > item.price && <p className="text-[10px] font-semibold text-[rgb(var(--ink-muted))] line-through">{ugx(item.was)}</p>}
              </div>
            </div>
            {item.description && <p className="line-clamp-3 text-[11px] leading-relaxed text-[rgb(var(--ink-muted))]">{item.description}</p>}
            {item.type === "physical" && (
              <div className="flex flex-wrap gap-1.5">
                {item.delivery.rider && <span className={chip}><Truck className="h-3 w-3 text-gold" /> Delivery</span>}
                {item.delivery.pickup && <span className={chip}><Store className="h-3 w-3 text-gold" /> Pickup</span>}
                {item.delivery.readyIn !== "2_days" && <span className={chip}><Zap className="h-3 w-3 text-gold" /> Same day</span>}
                {item.delivery.returnsDays > 0 && <span className={chip}><ShieldCheck className="h-3 w-3 text-gold" /> {item.delivery.returnsDays}-day returns</span>}
              </div>
            )}
            {item.type === "service" && (
              <div className="flex flex-wrap gap-1.5">
                <span className={chip}><Clock className="h-3 w-3 text-gold" /> {item.duration} min</span>
                <span className={chip}>{item.location === "virtual" ? <Video className="h-3 w-3 text-gold" /> : <MapPin className="h-3 w-3 text-gold" />} {item.location === "virtual" ? "Online" : item.location === "client_site" ? "At your place" : "In store"}</span>
              </div>
            )}
            {item.type === "digital" && <div className="flex flex-wrap gap-1.5"><span className={chip}><Download className="h-3 w-3 text-gold" /> Instant</span></div>}
            {item.sizes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {item.sizes.map((s, i) => <span key={s} className={`flex h-8 min-w-8 items-center justify-center rounded-full px-3 text-[10px] font-semibold ${i === 0 ? "bg-gold text-black" : "border border-[var(--border-faint)]"}`}>{s}</span>)}
              </div>
            )}
            {item.colours.length > 0 && (
              <div className="flex gap-1.5">
                {item.colours.map((c, i) => <span key={c.name} className={`h-7 w-7 rounded-full border-2 ${i === 0 ? "border-gold" : "border-[var(--border-faint)]"}`} style={{ background: c.hex }} />)}
              </div>
            )}
          </div>
        </div>
        <div className="absolute inset-x-3 bottom-3 flex gap-2">
          <span className="flex h-11 flex-1 items-center justify-between rounded-full bg-gold px-4 text-[11px] font-semibold text-black">
            <span>{item.type === "service" ? "Book" : item.type === "digital" ? "Buy now" : "Add to cart"}</span><b>{ugx(item.price)}</b>
          </span>
          {item.type === "physical" && <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"><ShoppingBag className="h-4 w-4" /></span>}
        </div>
      </div>
    </div>
  );
}
