"use client";

import type { StudioSlide } from "@peebee/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Slides the learner swipes through. Reaching the last one counts as having seen the deck. */
export function SlideDeck({ slides, onFinished }: { slides: StudioSlide[]; onFinished: () => void }) {
  const [index, setIndex] = useState(0);
  const touch = useRef<number | null>(null);
  const finished = useRef(false);
  const done = useRef(onFinished);
  done.current = onFinished;
  // The deck starts over only when its content changes, not when the lesson is refetched.
  const signature = slides.map((s) => `${s.title}|${s.body}`).join("");

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(slides.length - 1, to));
      setIndex(next);
      if (next === slides.length - 1 && !finished.current) {
        finished.current = true;
        done.current();
      }
    },
    [slides.length],
  );

  useEffect(() => {
    setIndex(0);
    finished.current = false;
    if (slides.length === 1) go(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  if (slides.length === 0) return <p className="text-sm text-ink-500">This lesson has no slides yet.</p>;
  const slide = slides[index];

  return (
    <div
      className="flex min-h-[60vh] flex-col gap-4"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="flex flex-1 flex-col justify-center gap-4 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6 text-center shadow-sm">
        {slide.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slide.imageUrl} alt="" className="mx-auto max-h-56 w-auto rounded-2xl object-contain" />
        )}
        <h2 className="font-[family-name:var(--font-lh-display)] text-2xl font-bold tracking-[-0.01em] text-ink">{slide.title}</h2>
        {slide.body && <p className="whitespace-pre-line text-base leading-relaxed text-ink">{slide.body}</p>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide" className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="flex items-center gap-1.5" aria-label={`Slide ${index + 1} of ${slides.length}`}>
          {slides.map((_, i) => (
            <button key={i} type="button" onClick={() => go(i)} aria-label={`Go to slide ${i + 1}`} className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-gold" : "w-2 bg-[rgb(var(--surface-muted))]"}`} />
          ))}
        </div>
        <button type="button" onClick={() => go(index + 1)} disabled={index === slides.length - 1} aria-label="Next slide" className="flex h-11 w-11 items-center justify-center rounded-full bg-gold text-ink-gold disabled:opacity-30">
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
