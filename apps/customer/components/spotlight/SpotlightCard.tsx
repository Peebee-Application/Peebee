"use client";

import { ChevronLeft, ChevronRight, Heart, MessageCircle, Plus, Send, Share2, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIdleReveal } from "./useIdleReveal";
import { useRevealDrawer } from "./useRevealDrawer";

export interface SpotlightItem {
  id: string;
  store_id: string;
  store_name: string;
  store_slug: string;
  store_logo: string;
  store_category: "groceries" | "stores";
  type: "live" | "video" | "image" | "carousel";
  media_url: string;
  poster_url?: string;
  carousel_images?: string[];
  title: string;
  description: string;
  product: {
    id: string;
    title: string;
    price: number;
    compare_at_price?: number;
    image_url: string;
    badge?: string;
  };
  viewer_count?: number;
  likes_count: number;
  comments_count: number;
}

export type SpotlightComment = { user: string; text: string };

const ugx = (val: number) => `UGX ${Number(val).toLocaleString()}`;

type Props = {
  item: SpotlightItem;
  isMuted: boolean;
  liked: boolean;
  likeCount: number;
  comments: SpotlightComment[];
  carouselIdx: number;
  drawerOpen: boolean;
  topInset: ReactNode;
  bottomPad: number;
  onToggleLike: () => void;
  onCarouselNav: (direction: "prev" | "next", total: number) => void;
  onQuickBuy: () => void;
  onAddComment: (text: string) => void;
  onDrawerChange: (open: boolean) => void;
};

function RailButton({ label, count, onClick, active, children }: { label: string; count?: ReactNode; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className="flex flex-col items-center gap-1 transition active:scale-90">
      <span className={`flex h-11 w-11 items-center justify-center rounded-full transition ${active ? "bg-gold text-ink-gold" : "bg-white/15 text-white"}`}>
        {children}
      </span>
      {count != null && <span className="text-[11px] font-semibold text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/.5)]">{count}</span>}
    </button>
  );
}

function CommentComposer({ onSubmit, placeholder, autoFocus }: { onSubmit: (text: string) => void; placeholder: string; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText("");
  };
  return (
    <div className="flex items-center gap-2" data-no-drag>
      <input
        type="text"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={placeholder}
        aria-label="Add a comment"
        className="h-11 min-w-0 flex-1 rounded-full border !border-white/15 !bg-white/10 px-4 text-sm !text-white placeholder:text-white/50 backdrop-blur-md focus:border-gold focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!text.trim()}
        aria-label="Post comment"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-ink-gold transition active:scale-95 disabled:opacity-40"
      >
        <Send className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function SpotlightCard(props: Props) {
  const { item, isMuted, liked, likeCount, comments, carouselIdx, drawerOpen, topInset, bottomPad } = props;
  const isLive = item.type === "live";
  const idle = useIdleReveal();
  const drawer = useRevealDrawer(drawerOpen, props.onDrawerChange, !isLive);
  const listRef = useRef<HTMLDivElement>(null);
  const carouselList = item.carousel_images && item.carousel_images.length > 0 ? item.carousel_images : [item.media_url];

  // Keep the drawer list scrolled to the newest comment.
  useEffect(() => {
    if (drawerOpen && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [drawerOpen, comments.length]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onDrawerChange(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, props]);

  const share = () => {
    if (navigator.share) navigator.share({ title: item.title, url: window.location.href }).catch(() => {});
  };

  // Overlays only follow the idle-transparency rule on live streams.
  const fade = isLive ? "sl-idle" : "";
  const commentCount = comments.length || item.comments_count || 12;

  return (
    <section
      aria-label={item.title}
      className="sl-stage relative h-full w-full snap-start overflow-hidden bg-black"
      style={{ ["--sl-p" as string]: drawer.progress }}
      data-open={drawerOpen}
      data-dragging={drawer.dragging}
      {...drawer.handlers}
    >
      {/* Comments panel: sits behind the media and is revealed as the media slides left. */}
      {!isLive && (
        <aside
          aria-label="Comments"
          aria-hidden={!drawerOpen}
          className="sl-panel absolute inset-y-0 right-0 flex w-[90%] flex-col bg-neutral-950 px-4 text-white"
          style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))", visibility: drawer.progress === 0 ? "hidden" : "visible" }}
        >
          <div className="flex items-center justify-between pb-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold">Comments</h3>
              <p className="truncate text-xs text-white/50">{commentCount} on {item.title}</p>
            </div>
            <button
              type="button"
              onClick={() => props.onDrawerChange(false)}
              aria-label="Close comments"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <div ref={listRef} className="no-scrollbar -mx-1 flex-1 space-y-4 overflow-y-auto px-1 py-2" data-no-drag>
            {comments.map((c, i) => (
              <div key={i} className="sl-comment-in flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-gold">
                  {c.user.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/70">{c.user}</p>
                  <p className="mt-0.5 text-sm leading-snug text-white/90">{c.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-3">
            <CommentComposer onSubmit={props.onAddComment} placeholder="Add a comment…" />
          </div>
        </aside>
      )}

      {/* Media layer (slides left to reveal the comments panel on VOD/images). */}
      <div
        className="sl-media absolute inset-0 overflow-hidden bg-black"
        data-active={idle.active}
        {...(isLive ? idle.bind : {})}
      >
        <div className="absolute inset-0">
          {item.type === "live" || item.type === "video" ? (
            <video src={item.media_url} poster={item.poster_url} autoPlay loop muted={isMuted} playsInline className="h-full w-full object-cover" />
          ) : (
            <img src={item.type === "carousel" ? carouselList[carouselIdx] : item.media_url} alt={item.title} className="h-full w-full object-cover transition duration-300" draggable={false} />
          )}
          {/* Soft vignettes: just enough for legible text. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/45 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
        </div>

        {/* Top: shared feed controls + live/viewer pill */}
        <div className={`absolute inset-x-0 top-0 z-20 ${fade}`} style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          {topInset}
          {isLive && (
            <div className="mt-3 px-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
                LIVE · {item.viewer_count || 142} watching
              </span>
            </div>
          )}
        </div>

        {/* Carousel controls */}
        {item.type === "carousel" && carouselList.length > 1 && (
          <>
            <button type="button" onClick={() => props.onCarouselNav("prev", carouselList.length)} aria-label="Previous image" className="absolute left-3 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white/90 backdrop-blur-md">
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button type="button" onClick={() => props.onCarouselNav("next", carouselList.length)} aria-label="Next image" className="absolute right-[72px] top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white/90 backdrop-blur-md">
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </>
        )}

        {/* Right action rail */}
        <aside className={`absolute right-3 z-20 flex flex-col items-center gap-5 ${fade}`} style={{ bottom: bottomPad + (isLive ? 215 : 150) }}>
          <Link href={`/store/${item.store_id}`} aria-label={`Visit ${item.store_name}`} className="relative transition active:scale-95">
            <span className="block h-11 w-11 overflow-hidden rounded-full border border-white/40 bg-neutral-900">
              <img src={item.store_logo} alt="" className="h-full w-full object-cover" />
            </span>
            <span className="absolute -bottom-1.5 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-gold text-ink-gold">
              <Plus className="h-3 w-3" aria-hidden />
            </span>
          </Link>
          <RailButton label={liked ? "Unlike" : "Like"} count={likeCount} onClick={props.onToggleLike} active={liked}>
            <Heart className={`h-5 w-5 ${liked ? "fill-current" : ""}`} aria-hidden />
          </RailButton>
          {!isLive && (
            <RailButton label="Open comments" count={commentCount} onClick={() => props.onDrawerChange(true)}>
              <MessageCircle className="h-5 w-5" aria-hidden />
            </RailButton>
          )}
          <RailButton label="Share" onClick={share}>
            <Share2 className="h-[18px] w-[18px]" aria-hidden />
          </RailButton>
        </aside>

        {/* Live comments: anchored at the bottom, fading out by the vertical midpoint. */}
        {isLive && (
          <div
            className={`sl-live-comments pointer-events-none absolute left-0 right-20 top-1/2 z-10 flex flex-col justify-end overflow-hidden px-4 ${fade}`}
            style={{ bottom: bottomPad + 215 }}
            aria-live="polite"
          >
            <div className="space-y-2">
              {comments.slice(-12).map((c, i, arr) => (
                <p key={comments.length - arr.length + i} className="sl-comment-in w-fit max-w-full rounded-2xl bg-black/25 px-3 py-1.5 text-[13px] leading-snug text-white backdrop-blur-sm">
                  <span className="mr-1.5 font-semibold text-gold">{c.user}</span>
                  {c.text}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Bottom: store, caption, product chip (+ live composer) */}
        <div className={`absolute inset-x-0 bottom-0 z-20 space-y-3 px-4 ${fade}`} style={{ paddingBottom: bottomPad + 16 }}>
          <div className="pr-16">
            <Link href={`/store/${item.store_id}`} className="text-sm font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/.5)]">
              {item.store_name}
            </Link>
            {!isLive && (
              <>
                <h2 className="mt-1 line-clamp-1 text-[15px] font-semibold leading-snug text-white">{item.title}</h2>
                {item.description && <p className="mt-0.5 line-clamp-1 text-xs text-white/70">{item.description}</p>}
              </>
            )}
            {item.type === "carousel" && carouselList.length > 1 && (
              <div className="mt-2 flex gap-1.5" aria-hidden>
                {carouselList.map((_, d) => (
                  <span key={d} className={`h-1 rounded-full transition-all ${d === carouselIdx ? "w-4 bg-gold" : "w-1.5 bg-white/40"}`} />
                ))}
              </div>
            )}
          </div>

          {item.product && (
            <div className="flex items-center gap-3 rounded-[20px] bg-black/35 p-2 pr-2 backdrop-blur-md">
              <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[14px] bg-white/10">
                {item.product.image_url ? (
                  <img src={item.product.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ShoppingBag className="m-3 h-5 w-5 text-white/60" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-white">{item.product.title}</p>
                <p className="text-xs text-white/80">
                  <span className="font-semibold text-gold">{ugx(item.product.price)}</span>
                  {item.product.compare_at_price && <span className="ml-1.5 text-white/45 line-through">{ugx(item.product.compare_at_price)}</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={props.onQuickBuy}
                aria-label={`Buy ${item.product.title}`}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 text-xs font-semibold text-ink-gold active:scale-95"
              >
                <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
                Buy
              </button>
            </div>
          )}

          {isLive && <CommentComposer onSubmit={props.onAddComment} placeholder="Say something…" />}
        </div>

        {/* When the drawer is open, the visible 10% slice of media closes it. */}
        {!isLive && drawer.progress > 0 && (
          <button
            type="button"
            onClick={() => props.onDrawerChange(false)}
            aria-label="Close comments and return to the post"
            className="absolute inset-0 z-30 cursor-pointer bg-black/20"
            style={{ opacity: drawer.progress }}
          />
        )}
      </div>
    </section>
  );
}
