"use client";

import { DEFAULT_SHOPPING_FEATURES, resolveShoppingFeatures, type ShoppingFeatureSettings } from "@peebee/shared";
import { Camera, ChevronLeft, ChevronRight, QrCode, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { loadInStoreCode, loadMembership, searchCatalogueByPhoto } from "../../lib/shopping-capabilities";
import { SnapDots, useSnapTrack } from "../buy/motion";

/** Admin-gated shopping extras. Hidden switches stay off the screen. Unavailable backends say so instead of showing made-up results. */
export function ShoppingExtras() {
  const [features, setFeatures] = useState<ShoppingFeatureSettings>(DEFAULT_SHOPPING_FEATURES);
  const [member, setMember] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [codeNote, setCodeNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const slides = features.heroEnabled ? features.heroSlides : [];
  const snap = useSnapTrack(heroRef, slides.length);

  useEffect(() => {
    let live = true;
    api.getSettings().then(({ settings }) => {
      if (!live) return;
      const next = resolveShoppingFeatures(settings.shoppingFeatures);
      setFeatures(next);
      if (next.memberBadgeEnabled) loadMembership().then((state) => { if (live) setMember(state.active); }).catch(() => undefined);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  async function onPhoto(file: File | undefined) {
    setPhotoNote(null);
    if (!file) return;
    const result = await searchCatalogueByPhoto(file);
    setPhotoNote(result.status === "unavailable" ? "Photo search is coming soon. Type a product name for now." : null);
  }

  async function openCode() {
    const result = await loadInStoreCode();
    setCodeNote(result.status === "unavailable" ? "In-store codes are coming soon." : result.code);
  }

  const banner = features.membershipBannerEnabled && features.membershipBannerTitle;
  const anything = features.cameraSearchEnabled || (features.memberBadgeEnabled && member) || features.inStoreCodeEnabled || banner || slides.length > 0;
  if (!anything && !photoNote && !codeNote) return null;

  return (
    <div className="mt-4 space-y-3">
      {features.memberBadgeEnabled && member && (
        <p className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[rgb(var(--color-gold)/.18)] px-3 text-sm font-bold text-ink">
          <ShieldCheck className="h-4 w-4 text-gold" aria-hidden />{features.memberBadgeLabel}
        </p>
      )}
      {banner && (
        <Link href={features.membershipBannerHref} className="block rounded-[26px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-[var(--shadow-card)]">
          <span className="block text-[16px] font-extrabold">{features.membershipBannerTitle}</span>
          {features.membershipBannerBody && <span className="mt-1 block text-[13px] font-semibold text-ink-500">{features.membershipBannerBody}</span>}
        </Link>
      )}
      {slides.length > 0 && (
        <div className="buy-extra">
          <div ref={heroRef} className="buy-extra__track" aria-label="Featured">
            {slides.map((slide) => (
              <Link key={slide.id} href={slide.href} className="buy-extra__slide overflow-hidden rounded-[28px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-[var(--shadow-card)]">
                {slide.imageUrl && <img src={slide.imageUrl} alt="" className="buy-fade h-36 w-full object-cover" onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }} />}
                <span className="block p-4">
                  <span className="block text-[18px] font-extrabold leading-tight">{slide.title}</span>
                  {slide.subtitle && <span className="mt-1 block text-[13px] font-semibold text-ink-500">{slide.subtitle}</span>}
                </span>
              </Link>
            ))}
          </div>
          <SnapDots count={slides.length} index={snap.index} moving={snap.moving} labels={slides.map((slide) => `Show ${slide.title}`)} onPick={snap.go} />
          {slides.length > 1 && (
            <div className="mt-1 flex justify-end gap-1">
              <button type="button" className="h-11 w-11" aria-label="Previous featured slide" onClick={() => snap.go(snap.index - 1)}><ChevronLeft className="mx-auto h-5 w-5" /></button>
              <button type="button" className="h-11 w-11" aria-label="Next featured slide" onClick={() => snap.go(snap.index + 1)}><ChevronRight className="mx-auto h-5 w-5" /></button>
            </div>
          )}
        </div>
      )}
      {(features.cameraSearchEnabled || features.inStoreCodeEnabled) && (
        <div className="flex flex-wrap gap-2">
          {features.cameraSearchEnabled && (
            <>
              <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 text-sm font-bold shadow-[var(--shadow-card)]" onClick={() => fileRef.current?.click()}>
                <Camera className="h-4 w-4" aria-hidden />Search by photo
              </button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </>
          )}
          {features.inStoreCodeEnabled && (
            <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 text-sm font-bold shadow-[var(--shadow-card)]" onClick={() => void openCode()}>
              <QrCode className="h-4 w-4" aria-hidden />In-store code
            </button>
          )}
        </div>
      )}
      {photoNote && <p className="text-[13px] font-semibold text-ink-500" role="status">{photoNote}</p>}
      {codeNote && <p className="rounded-[22px] bg-[rgb(var(--surface-card))] p-4 text-[14px] font-semibold text-ink-500" role="status">{codeNote}</p>}
    </div>
  );
}
