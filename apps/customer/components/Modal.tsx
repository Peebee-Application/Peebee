"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isLocationFlowOpen, registerServiceSheet, subscribeToLocationFlow } from "../lib/location-flow-state";
import { BottomNav } from "./BottomNav";
import { HomeMapHero } from "./home/HomeMapHero";
import type { SelectedRouteLocations } from "./maps/SelectedRoadRoute";

export function Modal({
  title,
  onClose,
  children,
  withMap = false,
  mapRoute,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Order-flow screens: live map across the top, the form in a rounded
   * sheet over its lower edge. Everything else stays a plain dimmed sheet. */
  withMap?: boolean;
  mapRoute?: SelectedRouteLocations;
}) {
  const [mounted, setMounted] = useState(false);
  const locationFlowOpen = useSyncExternalStore(subscribeToLocationFlow, isLocationFlowOpen, () => false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const mapBandRef = useRef<HTMLDivElement>(null);
  const mapSheetRef = useRef<HTMLDivElement>(null);
  const [mapBottomInset, setMapBottomInset] = useState(0);
  closeRef.current = onClose;

  useEffect(() => {
    if (!mounted || !withMap || !mapBandRef.current || !mapSheetRef.current) return;
    const measure = () => {
      const band = mapBandRef.current?.getBoundingClientRect();
      const sheet = mapSheetRef.current?.getBoundingClientRect();
      if (band && sheet) setMapBottomInset(Math.max(0, band.bottom - sheet.top));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(mapBandRef.current);
    observer.observe(mapSheetRef.current);
    measure();
    return () => observer.disconnect();
  }, [mounted, withMap]);

  useEffect(() => {
    if (!mounted) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
    (focusable()[0] ?? dialog)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mounted]);

  useEffect(() => {
    setMounted(true);
    const unregisterServiceSheet = withMap ? registerServiceSheet() : null;
    document.body.style.overflow = "hidden";

    // Android draws its status bar as opaque OS chrome, colored from this
    // meta tag — it's never covered by page content, so without this the
    // bar stays the app's normal navy while everything below it dims,
    // leaving a bright, uncovered-looking seam right at the top of the
    // screen. Swap it to match the dim overlay while the modal is open.
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", "#0a0a0a");

    return () => {
      unregisterServiceSheet?.();
      document.body.style.overflow = "";
      if (meta && previousThemeColor !== null) meta.setAttribute("content", previousThemeColor);
    };
  }, [withMap]);

  if (!mounted) return null;

  // Portaled to <body> rather than rendered in place — a sticky-positioned
  // ancestor (the page header) can end up painting above a same-context
  // fixed overlay regardless of z-index in some browsers, leaving a strip
  // of the header visible through the dim/blur. Being a direct child of
  // <body> keeps this out of that stacking-context fight entirely.
  const header = (
    <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-faint)] px-5 py-4">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <button
        onClick={onClose}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink-500"
        aria-label="Close"
      >
        <X className="h-4 w-4" strokeWidth={2.25} />
      </button>
    </div>
  );

  if (withMap) {
    return createPortal(
      <div className="fixed inset-0 z-[70] bg-cream">
        <div ref={mapBandRef} className="absolute inset-x-0 bottom-[34dvh] top-0 mx-auto max-w-lg">
          <HomeMapHero className="isolate h-full w-full overflow-hidden" {...mapRoute} bottomInset={mapBottomInset} />
        </div>
        <div ref={mapSheetRef} className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[68dvh] min-h-[36dvh] w-full max-w-lg flex-col">
          <div
            className="soft-drawer relative z-10 flex min-h-0 flex-1 flex-col"
            role="dialog"
            ref={dialogRef}
            tabIndex={-1}
            aria-modal="true"
            aria-label={title}
          >
            <span className="mx-auto mt-2.5 block h-1.5 w-10 shrink-0 rounded-full bg-[rgb(var(--color-ink-500)/0.25)]" aria-hidden />
            {header}
            <div className="flex-1 overflow-y-auto px-5 py-4 pb-[calc(8rem+env(safe-area-inset-bottom))]">{children}</div>
          </div>
        </div>
        {!locationFlowOpen && <BottomNav overlay />}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <div
        className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-cream shadow-2xl sm:rounded-[28px]"
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-label={title}
      >
        {header}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
