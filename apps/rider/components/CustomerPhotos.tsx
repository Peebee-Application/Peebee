"use client";

import type { OrderPhoto } from "@peebee/shared";
import { Camera, ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import { api } from "../lib/api";

export type LoadedPhoto = OrderPhoto & { url: string };

/** The customer's photos for an order (brand, pack, label), loaded as blobs since they need the rider's token. */
export function useOrderPhotos(orderId: string): LoadedPhoto[] {
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
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
        if (alive) setPhotos(loaded.filter((p): p is LoadedPhoto => p != null));
      })
      .catch(() => {});
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [orderId]);
  return photos;
}

/** "Photos from customer": a small grid; tap for full screen with the item and the note. */
export function CustomerPhotos({ photos, itemName, customerName }: { photos: LoadedPhoto[]; itemName: (listItemId: string) => string | undefined; customerName?: string | null }) {
  if (!photos.length) return null;
  const captionOf = (p: LoadedPhoto) => p.note || (p.list_item_id ? itemName(p.list_item_id) : undefined) || "";
  return (
    <section className="customer-photos rounded-[22px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3.5 shadow-[var(--shadow-card)]" aria-label="Photos from customer">
      <div className="flex items-center gap-2.5">
        <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[13px] bg-gold/15 text-gold">
          <Camera className="h-[19px] w-[19px]" strokeWidth={2} aria-hidden />
        </span>
        <span className="flex-1 text-[14.5px] font-bold text-ink">Photos from customer</span>
        <span className="text-xs font-bold text-ink-500">{photos.length}</span>
      </div>
      <PhotoProvider
        loop={photos.length > 1}
        maskOpacity={0.96}
        overlayRender={({ index, onIndexChange }) => {
          const p = photos[index];
          if (!p) return null;
          const item = p.list_item_id ? itemName(p.list_item_id) : undefined;
          return (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[20] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {photos.length > 1 && (
                <div className="mb-3 flex justify-center gap-1.5">
                  {photos.map((ph, i) => (
                    <button
                      key={ph.id}
                      type="button"
                      onClick={() => onIndexChange(i)}
                      className={`pointer-events-auto h-1.5 rounded-full ${i === index ? "w-4 bg-[rgb(var(--color-gold))]" : "w-1.5 bg-white/40"}`}
                      aria-label={`Photo ${i + 1}`}
                    />
                  ))}
                </div>
              )}
              {(item || p.note) && (
                <div className="mx-auto max-w-md rounded-[20px] border border-white/10 bg-white/10 p-3.5 text-white backdrop-blur-md">
                  {item && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--color-gold))] px-3 py-1 text-xs font-extrabold text-[#0a0a0a]">
                      <ShoppingBag className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                      {item}
                    </span>
                  )}
                  {p.note && <p className="mt-2 text-[15px] font-semibold leading-snug">&ldquo;{p.note}&rdquo;</p>}
                  {p.note && <p className="mt-1 text-xs text-white/60">Note from {customerName || "the customer"}</p>}
                </div>
              )}
            </div>
          );
        }}
      >
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {photos.map((p) => {
            const caption = captionOf(p);
            return (
              <li key={p.id}>
                <PhotoView src={p.url}>
                  <button type="button" className="relative block aspect-square w-full overflow-hidden rounded-2xl" aria-label={caption ? `Photo: ${caption}` : "Photo from customer"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                    {caption && (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-4 text-left text-[11px] font-semibold text-white">{caption}</span>
                    )}
                  </button>
                </PhotoView>
              </li>
            );
          })}
        </ul>
      </PhotoProvider>
      <p className="mt-2.5 text-xs text-ink-500">Tap a photo to see it full screen.</p>
    </section>
  );
}
