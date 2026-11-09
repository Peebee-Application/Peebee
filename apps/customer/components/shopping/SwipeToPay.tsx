"use client";

import { useEffect, useRef, useState } from "react";

/** Final payment commitment. Drag the knob across, or use the button. Both call the same pay function, which refuses a second charge while one is in progress. */
export function SwipeToPay({ label, disabled, busy, onConfirm }: { label: string; disabled: boolean; busy: boolean; onConfirm: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [reduce, setReduce] = useState(false);
  const dragging = useRef(false);
  const start = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  function max() {
    const width = track.current?.clientWidth ?? 0;
    return Math.max(0, width - 52);
  }
  function finish(next: number) {
    dragging.current = false;
    if (!disabled && next >= max() * 0.85) {
      setOffset(0);
      onConfirm();
    } else setOffset(0);
  }

  if (reduce) {
    return (
      <button type="button" className="min-h-14 w-full rounded-full bg-gold text-base font-bold text-ink-gold disabled:opacity-50" disabled={disabled || busy} onClick={onConfirm}>
        {busy ? "Please wait…" : label}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={track}
        className="relative h-14 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]"
        onPointerDown={(e) => {
          if (disabled || busy) return;
          dragging.current = true;
          start.current = e.clientX - offset;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          setOffset(Math.min(max(), Math.max(0, e.clientX - start.current)));
        }}
        onPointerUp={(e) => finish(Math.min(max(), Math.max(0, e.clientX - start.current)))}
        onPointerCancel={() => finish(0)}
      >
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-bold text-ink-500">{busy ? "Please wait…" : `Swipe to ${label}`}</p>
        <span className="absolute left-1 top-1 grid h-12 w-12 place-items-center rounded-full bg-gold text-sm font-black text-ink-gold" style={{ transform: `translateX(${offset}px)` }} aria-hidden>›</span>
      </div>
      <button type="button" className="min-h-11 w-full text-sm font-bold text-ink-500 disabled:opacity-50" disabled={disabled || busy} onClick={onConfirm}>
        {label} without swiping
      </button>
    </div>
  );
}
