"use client";

import type { OrderRating } from "@peebee/shared";
import { Star, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";

export function RateDeliveryCard({
  orderId,
  rating,
  onRated,
}: {
  orderId: string;
  rating: OrderRating | null;
  onRated: (rating: OrderRating) => void;
}) {
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [comment, setComment] = useState("");
  const [recommended, setRecommended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rating) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-green">Delivered — thank you!</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={`h-4 w-4 ${n <= rating.rating ? "fill-gold text-gold" : "text-ink-500/30"}`}
              strokeWidth={1.5}
              aria-hidden
            />
          ))}
          <span className="ml-1 text-xs text-ink-500">You rated this delivery</span>
        </div>
        {rating.comment && <p className="text-xs italic text-ink-500">&ldquo;{rating.comment}&rdquo;</p>}
        {rating.recommended && (
          <p className="flex items-center gap-1 text-xs font-semibold text-green">
            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            You recommended this rider
          </p>
        )}
      </div>
    );
  }

  async function submit() {
    if (stars === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.rateOrder(orderId, { rating: stars, comment: comment.trim() || undefined, recommended });
      onRated({ rating: res.rating, comment: res.comment, recommended: res.recommended });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-green">Delivered — thank you!</p>
      <div className="space-y-3 rounded-xl border border-[var(--border-faint)] p-3">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-ink-500">Rate your rider</p>
        <div className="flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              onMouseEnter={() => setHoverStars(n)}
              onMouseLeave={() => setHoverStars(0)}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
            >
              <Star
                className={`h-7 w-7 ${(hoverStars || stars) >= n ? "fill-gold text-gold" : "text-ink-500/30"}`}
                strokeWidth={1.5}
                aria-hidden
              />
            </button>
          ))}
        </div>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment (optional)"
          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold"
        />
        <button
          type="button"
          onClick={() => setRecommended((v) => !v)}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
            recommended
              ? "border-green bg-green/10 text-green"
              : "border-[var(--border-faint)] text-ink-500"
          }`}
        >
          <ThumbsUp className={`h-4 w-4 ${recommended ? "fill-green" : ""}`} strokeWidth={2} aria-hidden />
          {recommended ? "Recommended" : "Recommend this rider"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy || stars === 0}
          className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? "Submitting…" : "Submit rating"}
        </button>
      </div>
    </div>
  );
}
