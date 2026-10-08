"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { api } from "../lib/api";

export function RentalVehicleGallery({ vehicleId, photoIds, name }: {
  vehicleId: string;
  photoIds: string[];
  name: string;
}) {
  const [photos, setPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const openerButton = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const photoKey = photoIds.join("\u0000");

  useEffect(() => {
    let disposed = false;
    const urls: string[] = [];
    Promise.all((photoKey ? photoKey.split("\u0000") : []).map(async (id) => {
      try {
        const blob = await api.carVehiclePhotoBlob(vehicleId, id);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return { id, url };
      } catch {
        return null;
      }
    })).then((loaded) => {
      if (!disposed) setPhotos(loaded.filter((photo): photo is { id: string; url: string } => photo !== null));
    });
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoKey, vehicleId]);

  useEffect(() => {
    if (!open) return;
    const opener = openerButton.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowRight") setActive((index) => (index + 1) % photos.length);
      if (event.key === "ArrowLeft") setActive((index) => (index - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
  }, [open, photos.length]);

  const move = (direction: -1 | 1) => setActive((index) => (index + direction + photos.length) % photos.length);
  const activePhoto = photos[active];

  return <>
    <div className="space-y-2">
      <div className="group relative aspect-[16/10] w-full overflow-hidden bg-[rgb(var(--surface-muted))]">
        <button ref={openerButton} type="button" onClick={() => photos.length && setOpen(true)} disabled={!activePhoto} aria-label={activePhoto ? `Open ${name} photo gallery` : `${name} photo loading`} className="absolute inset-0 block h-full w-full text-left disabled:cursor-wait">
        {activePhoto ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activePhoto.url} alt={`${name}, photo ${active + 1}`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
          {photos.length > 1 && <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm"><Images className="h-3.5 w-3.5" />{active + 1} / {photos.length}</span>}
        </> : <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-500"><Images className="h-7 w-7" /><span className="text-xs">Vehicle photos unavailable</span></div>}
        </button>
        {photos.length > 1 && <>
          <button type="button" onClick={() => move(-1)} aria-label="Previous photo" className="absolute inset-y-0 left-0 z-10 flex items-center px-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"><ChevronLeft className="h-5 w-5" /></span></button>
          <button type="button" onClick={() => move(1)} aria-label="Next photo" className="absolute inset-y-0 right-0 z-10 flex items-center px-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"><ChevronRight className="h-5 w-5" /></span></button>
        </>}
      </div>
      {photos.length > 1 && <div className="flex gap-2 overflow-x-auto px-4 pb-1" aria-label={`${name} photos`}>
        {photos.map((photo, index) => <button key={photo.id} type="button" onClick={() => { setActive(index); setOpen(true); }} aria-label={`Open photo ${index + 1} of ${photos.length}`} aria-current={index === active} className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${index === active ? "border-gold" : "border-transparent opacity-75"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" className="h-full w-full object-cover" />
        </button>)}
        <button type="button" onClick={() => setOpen(true)} className="flex h-14 shrink-0 items-center gap-1 rounded-lg bg-[rgb(var(--surface-muted))] px-3 text-xs font-semibold text-ink"><Images className="h-4 w-4" /> View all</button>
      </div>}
    </div>

    {open && activePhoto && <div role="dialog" aria-modal="true" aria-label={`${name} photo gallery`} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 text-white" onClick={() => setOpen(false)} onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => {
      if (touchStartX.current == null) return;
      const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
      if (Math.abs(distance) > 45) move(distance < 0 ? 1 : -1);
      touchStartX.current = null;
    }}>
      <button ref={closeButton} type="button" onClick={() => setOpen(false)} aria-label="Close gallery" className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
      {photos.length > 1 && <button type="button" onClick={(event) => { event.stopPropagation(); move(-1); }} aria-label="Previous photo" className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10"><ChevronLeft className="h-6 w-6" /></button>}
      <figure className="flex max-h-full w-full max-w-5xl flex-col items-center gap-3" onClick={(event) => event.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={activePhoto.url} alt={`${name}, photo ${active + 1} of ${photos.length}`} className="max-h-[78svh] max-w-full rounded-xl object-contain" />
        <figcaption className="text-sm text-white/75">{name} <span className="mx-1.5">·</span> {active + 1} of {photos.length}</figcaption>
        {photos.length > 1 && <div className="flex max-w-full gap-2 overflow-x-auto py-1">
          {photos.map((photo, index) => <button key={photo.id} type="button" onClick={() => setActive(index)} aria-label={`Go to photo ${index + 1}`} aria-current={index === active} className={`h-12 w-16 shrink-0 overflow-hidden rounded-md border-2 ${index === active ? "border-gold" : "border-white/20 opacity-60"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="" className="h-full w-full object-cover" />
          </button>)}
        </div>}
      </figure>
      {photos.length > 1 && <button type="button" onClick={(event) => { event.stopPropagation(); move(1); }} aria-label="Next photo" className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10"><ChevronRight className="h-6 w-6" /></button>}
    </div>}
  </>;
}
