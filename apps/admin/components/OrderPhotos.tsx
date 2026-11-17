"use client";

import type { OrderPhoto } from "@peebee/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** Photos the customer attached for the rider. Tap one to open it full size. */
export function OrderPhotos({ orderId, itemName }: { orderId: string; itemName: (listItemId: string) => string | undefined }) {
  const [photos, setPhotos] = useState<Array<OrderPhoto & { url: string }>>([]);
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    api
      .orderPhotos(orderId)
      .then(async ({ photos: list }) => {
        const loaded = await Promise.all(
          list.map(async (p) => {
            try {
              const url = URL.createObjectURL(await api.orderPhotoBlob(orderId, p.id));
              urls.push(url);
              return { ...p, url };
            } catch {
              return null;
            }
          }),
        );
        if (alive) setPhotos(loaded.filter((p): p is OrderPhoto & { url: string } => p != null));
      })
      .catch(() => {});
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [orderId]);

  if (!photos.length) return null;
  return (
    <section className="home-card space-y-2" aria-label="Customer photos">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Customer photos</h2>
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((p) => {
          const item = p.list_item_id ? itemName(p.list_item_id) : undefined;
          return (
            <li key={p.id} className="space-y-1">
              <a href={p.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.note ?? item ?? "Customer photo"} className="h-full w-full object-cover" />
              </a>
              {item && <p className="truncate text-xs font-semibold text-ink">{item}</p>}
              {p.note && <p className="text-xs text-ink-500">{p.note}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
