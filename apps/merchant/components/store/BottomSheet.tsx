"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Full-width sheet that slides up from the bottom of the screen.
 *
 * - Drag the handle (or the header) down, tap the dimmed backdrop, press Escape, tap the close button, or use the
 *   phone's back button to close it.
 * - The page behind does not scroll while it is open.
 * - The footer stays at the bottom and keeps clear of the phone's home bar.
 */
export function BottomSheet({
  title,
  subtitle,
  imageUrl,
  onClose,
  footer,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<number | null>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Slide in on the next frame.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  // Keep the page behind still.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prev = { body: body.style.overflow, html: html.style.overflow, pad: body.style.paddingRight };
    const gap = window.innerWidth - html.clientWidth;
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => { body.style.overflow = prev.body; html.style.overflow = prev.html; body.style.paddingRight = prev.pad; };
  }, []);

  // The phone's back button closes the sheet instead of leaving the page.
  useEffect(() => {
    let pushed = false;
    try {
      window.history.pushState({ ...(window.history.state ?? {}), peebeeSheet: true }, "", window.location.href);
      pushed = true;
    } catch { /* history unavailable: the on-screen controls still work */ }
    const onPop = () => {
      // Still on a sheet entry (e.g. a stale back from a remount): nothing to close.
      if ((window.history.state as { peebeeSheet?: boolean } | null)?.peebeeSheet) return;
      pushed = false;
      if (!closing.current) { closing.current = true; onCloseRef.current(); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      // Closed by Save or the close button: drop the history entry we added.
      if (pushed && (window.history.state as { peebeeSheet?: boolean } | null)?.peebeeSheet) {
        try { window.history.back(); } catch { /* ignore */ }
      }
    };
  }, []);

  function requestClose() {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    window.setTimeout(() => onCloseRef.current(), 220);
  }

  function onPointerDown(e: React.PointerEvent) {
    start.current = e.clientY;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (start.current == null) return;
    setDrag(Math.max(0, e.clientY - start.current));
  }
  function onPointerUp() {
    if (start.current == null) return;
    start.current = null;
    setDragging(false);
    if (drag > 110) requestClose();
    setDrag(0);
  }

  const offset = shown ? drag : 0;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={requestClose}
        className={`absolute inset-0 h-full w-full bg-black/60 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[32px] bg-[rgb(var(--surface-card))] shadow-[0_-12px_40px_rgba(0,0,0,0.35)] ring-1 ring-gold/25"
        style={{
          top: "max(40px, calc(env(safe-area-inset-top) + 16px))",
          transform: shown ? `translateY(${offset}px)` : "translateY(100%)",
          transition: dragging ? "none" : "transform 260ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div
          className="shrink-0 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="flex h-7 items-center justify-center" aria-hidden="true">
            <span className="h-1.5 w-14 rounded-full bg-ink-500/45" />
          </div>
          <div className="flex items-center gap-3.5 px-4 pb-3">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-[60px] w-[60px] shrink-0 rounded-2xl border border-[var(--border-faint)] object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="text-[26px] font-black leading-tight text-ink">{title}</h2>
              {subtitle ? <p className="mt-0.5 break-words text-[17px] font-semibold leading-snug text-ink-500">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={requestClose}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink active:scale-95"
            >
              <X className="h-7 w-7" strokeWidth={2.6} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6" data-sheet-body>
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 pt-3" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
