"use client";

import type { LiveStoreItems } from "@peebee/shared";
import { Check, Plus, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { addSpotlightItemToCart } from "../../lib/spotlight-cart";

const POLL_MS = 10_000;
const ugx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString()}`;

/** The items a store is selling on its live stream, polled while the card is on screen. */
export function useLiveStoreItems(postId: string, active: boolean) {
  const [data, setData] = useState<LiveStoreItems | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await api.liveStoreItems(postId);
        if (stop) return;
        setData(r);
        if (r.status === "ended") return;
      } catch { /* the next poll tries again */ }
      if (!stop) t = setTimeout(load, POLL_MS);
    };
    void load();
    return () => { stop = true; if (t) clearTimeout(t); };
  }, [postId, active]);
  return data;
}

/** "STORE LIVE" next to the LIVE badge, so shoppers know they can buy from this stream. */
export function StoreLiveBadge({ name }: { name: string }) {
  return (
    <span className="absolute left-3 top-[5.25rem] z-20 inline-flex max-w-[70%] items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[12px] font-extrabold text-ink-gold" data-testid="store-live-badge">
      <Store className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">Store live · {name}</span>
    </span>
  );
}

/** A row of the items for sale on a store's live, each with a one-tap Add (or Choose, when it has sizes/colours). */
export function LiveShopStrip({ data }: { data: LiveStoreItems | null }) {
  const [added, setAdded] = useState<string | null>(null);
  if (!data || data.status !== "live" || !data.store || !data.items.length) return null;
  const store = data.store;

  async function add(item: LiveStoreItems["items"][number]) {
    await addSpotlightItemToCart(
      { store_id: store.id, store_name: store.name, store_slug: store.slug, store_category: store.category, product: { id: item.id, title: item.title, price: item.price, compare_at_price: item.compare_at_price, image_url: item.image_url } },
      (id) => api.getMarketplaceProduct(id),
    );
    setAdded(item.id);
    setTimeout(() => setAdded((cur) => (cur === item.id ? null : cur)), 2000);
  }

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 pt-1 [scrollbar-width:none]" data-testid="live-shop-strip" aria-label={`Buy from ${store.name}`}>
      {data.items.map((item, i) => (
        <div key={item.id} className={`flex w-[14.5rem] shrink-0 items-center gap-2.5 rounded-2xl p-2 backdrop-blur-md ${i === 0 ? "bg-white text-[#111]" : "bg-black/60 text-white"}`} data-testid={`live-shop-item-${item.id}`}>
          <Link href={`/product/${item.id}`} className="shrink-0" aria-label={`Open ${item.title}`}>
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
            ) : <span className="grid h-14 w-14 place-items-center rounded-xl bg-white/15"><ShoppingBag className="h-6 w-6" aria-hidden /></span>}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[14px] font-bold leading-tight">{item.title}</p>
            <p className={`text-[13px] font-extrabold ${i === 0 ? "text-[#111]" : "text-gold"}`}>{ugx(item.price)}</p>
          </div>
          {!item.in_stock ? (
            <span className="shrink-0 rounded-full bg-black/40 px-2.5 py-1.5 text-[11px] font-bold text-white/80">Sold out</span>
          ) : item.has_variants ? (
            <Link href={`/product/${item.id}`} className="flex h-11 shrink-0 items-center rounded-full bg-gold px-3.5 text-[13px] font-extrabold text-ink-gold" data-testid="live-shop-choose">Choose</Link>
          ) : (
            <button type="button" onClick={() => void add(item)} aria-label={`Add ${item.title} to cart`} data-testid="live-shop-add"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold text-ink-gold transition active:scale-90">
              {added === item.id ? <Check className="h-5 w-5" strokeWidth={3} aria-hidden /> : <Plus className="h-5 w-5" strokeWidth={3} aria-hidden />}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
