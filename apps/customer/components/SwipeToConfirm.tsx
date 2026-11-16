"use client";

import { Check, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SwipeToConfirmProps {
  label?: string;
  confirmedLabel?: string;
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  /** Fraction of the track that commits. Wallet sends use 0.6; other callers stay at 0.7. */
  commitAt?: number;
  /** Ink track matches the wallet review screen. */
  tone?: "muted" | "ink";
}

export function SwipeToConfirm({
  label = "Slide to confirm",
  confirmedLabel = "Confirmed",
  onConfirm,
  disabled = false,
  className = "",
  commitAt = 0.7,
  tone = "muted",
}: SwipeToConfirmProps) {
  const commitAtRef = useRef(commitAt);
  useEffect(() => { commitAtRef.current = commitAt; }, [commitAt]);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const dragXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const maxDragRef = useRef(0);

  const THUMB_SIZE = 48;
  const PADDING = 4;

  const getMaxDrag = useCallback(() => {
    if (!trackRef.current) return 0;
    return Math.max(0, trackRef.current.clientWidth - THUMB_SIZE - PADDING * 2);
  }, []);

  // Sync maxDrag on resize/orientation change, and via ResizeObserver for
  // cases plain "resize" never fires — e.g. this control mounting inside a
  // modal/drawer while it's still animating open, where the track's real
  // width isn't known until the entrance transition settles. Without this,
  // a maxDrag computed as 0 at that moment would silently block every drag
  // (see handlePointerDown's `if (maxDrag <= 0) return`) until an actual
  // browser resize happened to fire — which on a phone might be never.
  useEffect(() => {
    const updateMaxDrag = () => {
      maxDragRef.current = getMaxDrag();
    };
    updateMaxDrag();
    window.addEventListener("resize", updateMaxDrag);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateMaxDrag) : null;
    if (ro && trackRef.current) ro.observe(trackRef.current);
    return () => {
      window.removeEventListener("resize", updateMaxDrag);
      ro?.disconnect();
    };
  }, [getMaxDrag]);

  // Runs the caller's action and only shows the confirmed/checkmark state
  // once it actually resolves — never optimistically. `onConfirm` is
  // expected to throw on any failure (validation included: a caller that
  // catches its own error internally and returns normally makes this
  // control lie about success), so every call site needs to propagate its
  // errors here rather than swallowing them.
  const triggerConfirm = useCallback(async () => {
    if (disabled || isConfirmed || isBusy) return;
    setIsBusy(true);

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(45);
      } catch {}
    }

    try {
      await onConfirm();
      setIsConfirmed(true);
    } catch (err) {
      // Snap the thumb back so it's clear the action did NOT go through.
      dragXRef.current = 0;
      setDragX(0);
      throw err;
    } finally {
      setIsBusy(false);
    }
  }, [disabled, isConfirmed, isBusy, onConfirm]);

  // Bound to the whole track (not just the 48px thumb) — a real touchscreen
  // swipe rarely lands precisely on a small handle, and starting the drag
  // wherever the finger comes down (snapping the thumb to that point) is
  // what "slide to confirm" controls are expected to feel like.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || isConfirmed || isBusy) return;
    // Only primary button
    if (e.button !== 0 && e.buttons !== 1) return;

    const maxDrag = getMaxDrag();
    maxDragRef.current = maxDrag;
    if (maxDrag <= 0) return;

    const trackRect = trackRef.current?.getBoundingClientRect();
    const startDrag = trackRect
      ? Math.max(0, Math.min(e.clientX - trackRect.left - THUMB_SIZE / 2, maxDrag))
      : 0;
    dragXRef.current = startDrag;
    setDragX(startDrag);

    isDraggingRef.current = true;
    setIsDragging(true);
    startXRef.current = e.clientX - startDrag;
  };

  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const maxDrag = maxDragRef.current;
      const newX = e.clientX - startXRef.current;
      const clamped = Math.max(0, Math.min(newX, maxDrag));
      dragXRef.current = clamped;
      setDragX(clamped);
    };

    const handleGlobalPointerUp = async () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);

      const maxDrag = maxDragRef.current;
      const currentDrag = dragXRef.current;

      if (maxDrag > 0 && currentDrag >= maxDrag * commitAtRef.current) {
        dragXRef.current = maxDrag;
        setDragX(maxDrag);
        // triggerConfirm rethrows so the caller's own error state (which
        // already shows the message) doesn't get double-handled here —
        // swallow it at this boundary so it doesn't surface as an
        // unhandled rejection.
        await triggerConfirm().catch(() => {});
      } else {
        // Snap back to 0
        dragXRef.current = 0;
        setDragX(0);
      }
    };

    window.addEventListener("pointermove", handleGlobalPointerMove, { passive: true });
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);

    return () => {
      window.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [triggerConfirm]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || isConfirmed || isBusy) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
      e.preventDefault();
      const maxDrag = getMaxDrag();
      dragXRef.current = maxDrag;
      setDragX(maxDrag);
      triggerConfirm().catch(() => {});
    }
  };

  // The track width is measured from the DOM; the drag math already keeps a ref copy up to date.
  // eslint-disable-next-line react-hooks/refs -- existing measurement of the track element
  const maxDrag = getMaxDrag();
  const progress = maxDrag > 0 ? dragX / maxDrag : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled || isConfirmed ? -1 : 0}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-label={label}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      style={{
        boxShadow: "var(--shadow-inner-track)",
        touchAction: "none",
      }}
      className={`relative flex w-full select-none items-center overflow-hidden rounded-full p-1 transition-colors duration-300 touch-none focus:outline-none focus:ring-2 focus:ring-gold/50 ${
        isConfirmed
          ? "h-14 bg-green text-white"
          : tone === "ink"
            ? "h-[66px] border border-white/10 bg-gradient-to-br from-black-700 to-ink text-cream shadow-[0_10px_24px_-8px_rgba(0,0,0,.45)]"
            : "h-14 bg-[rgb(var(--surface-muted))] border border-[var(--border-faint)]"
      } ${disabled ? "opacity-50 pointer-events-none" : ""} ${className}`}
    >
      {/* Dynamic Gold Fill Track responding to drag progress */}
      {!isConfirmed && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-gold/15 transition-all"
          style={{
            width: `${dragX + THUMB_SIZE}px`,
            transition: isDragging ? "none" : "width var(--duration-fluid) var(--ease-spring)",
          }}
        />
      )}

      {/* Label layer */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-bold tracking-wide transition-opacity duration-200 select-none"
        style={{
          opacity: isConfirmed ? 1 : Math.max(0, 1 - progress * 1.6),
          color: isConfirmed ? "#FFFFFF" : tone === "ink" ? "rgb(var(--color-cream))" : "rgb(var(--color-ink))",
        }}
      >
        {isConfirmed ? (
          <span className="flex items-center gap-1.5 animate-drawer-in">
            <Check className="h-5 w-5 stroke-[2.5]" aria-hidden />
            {confirmedLabel}
          </span>
        ) : (
          <span>{label}</span>
        )}
      </div>

      {/* Draggable thumb */}
      {!isConfirmed && (
        <div
          ref={thumbRef}
          style={{
            transform: `translateX(${dragX}px)`,
            transition: isDragging ? "none" : "transform var(--duration-fluid) var(--ease-spring)",
            width: `${THUMB_SIZE}px`,
            height: `${THUMB_SIZE}px`,
            touchAction: "none",
          }}
          className="relative z-10 flex shrink-0 cursor-grab items-center justify-center rounded-full bg-gold text-ink-gold shadow-[var(--shadow-glow-gold)] active:cursor-grabbing active:scale-95 transition-transform touch-none select-none"
        >
          {isBusy ? (
            <span className="pointer-events-none h-5 w-5 animate-spin rounded-full border-2 border-ink-gold border-t-transparent" />
          ) : (
            <div className="pointer-events-none flex items-center -space-x-1">
              <ChevronRight className="h-5 w-5 stroke-[2.5]" aria-hidden />
              <ChevronRight className="h-4 w-4 stroke-[2.5] opacity-60" aria-hidden />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
