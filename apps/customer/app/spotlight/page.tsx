"use client";

import { isPracticeMode, type PostView, type PublisherType } from "@peebee/shared";
import { Plus, Radio, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, errorMessage } from "../../lib/api";
import { useCart } from "../../lib/cart";
import { addSpotlightItemToCart } from "../../lib/spotlight-cart";
import { CartDrawer } from "../../components/CartDrawer";
import { SpotlightCard, type SpotlightItem } from "../../components/spotlight/SpotlightCard";
import { PostSpotlightCard } from "../../components/channels/PostSpotlightCard";
import { useAuth } from "../../lib/auth-context";
import { useChannelsConfig } from "../../lib/channels";
import { setSpotlightFilter, useSpotlightFilter, type SpotlightFilter } from "../../lib/spotlight-filter";
import "../../components/spotlight/spotlight.css";

const ugx = (val: number) => `UGX ${Number(val).toLocaleString()}`;

/** Room the floating menu takes at the bottom of each card. */
const NAV_CLEARANCE = 96;

/** Which publishers each menu button shows. "For you" shows everyone; the rest are narrower. */
const PUBLISHERS: Record<SpotlightFilter, PublisherType[] | null> = {
  foryou: null,
  following: null,
  creators: ["channel", "personal"],
  market: ["store", "restaurant"],
  learn: ["learn"],
};
/** Store products (with a Buy button) belong to For you and Market. */
const SHOWS_STORE_ITEMS: Record<SpotlightFilter, boolean> = { foryou: true, following: false, creators: false, market: true, learn: false };
/** A filtered feed is cut from ranked pages, so it keeps reading pages until it has enough to fill the screen. */
const MIN_POSTS = 6;
const MAX_PAGES = 5;

/** One thing in the feed: a store's post (with a product to buy) or a post from anyone else on Peebee. */
type FeedEntry = { kind: "store"; item: SpotlightItem } | { kind: "post"; post: PostView };

/** Shows creators' posts and store posts one after the other, so neither crowds out the other. */
function interleave(posts: PostView[], stores: SpotlightItem[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  const max = Math.max(posts.length, stores.length);
  for (let i = 0; i < max; i++) {
    if (posts[i]) out.push({ kind: "post", post: posts[i]! });
    if (stores[i]) out.push({ kind: "store", item: stores[i]! });
  }
  return out;
}

export default function SpotlightPage() {
  const [items, setItems] = useState<SpotlightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filter = useSpotlightFilter();
  const { user } = useAuth();
  const { config: channelsConfig } = useChannelsConfig();
  // Practice mode has its own demo posts from every kind of publisher, so the feed is on there even though real Channels are not.
  const practice = useSyncExternalStore(() => () => undefined, isPracticeMode, () => false);
  const channelsOn = channelsConfig?.enabled === true || practice;
  const [posts, setPosts] = useState<PostView[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const loadingMore = useRef(false);
  const [isMuted, setIsMuted] = useState(true);

  // Likes and comments state per item
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  // Item whose comments drawer is open (VOD / images only; live shows comments inline).
  const [activeCommentsId, setActiveCommentsId] = useState<string | null>(null);
  const [itemComments, setItemComments] = useState<Record<string, Array<{ user: string; text: string }>>>({});

  // Quick buy writes to the shared marketplace cart (lib/cart.ts), the same
  // one the cart drawer and /cart read. It used to be local page state.
  const { totalQuantity: cartItemCount, total: cartTotal } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [quickBuyNotice, setQuickBuyNotice] = useState("");

  // Carousel current indexes per item
  const [carouselIndices, setCarouselIndices] = useState<Record<string, number>>({});

  useEffect(() => {
    loadSpotlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, channelsOn]);

  // Who the viewer already follows, so the follow button only shows for new channels.
  useEffect(() => {
    if (!channelsOn || !user) return;
    api.followingChannels().then((r) => setFollowed(new Set(r.channels.map((c) => c.id)))).catch(() => undefined);
  }, [channelsOn, user]);

  const loadMorePosts = useCallback(async () => {
    if (nextCursor === null || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const more = await readPosts(filter, nextCursor, 2);
      setPosts((prev) => [...prev, ...more.posts.filter((p) => !prev.some((x) => x.id === p.id))]);
      setNextCursor(more.nextCursor);
    } finally {
      loadingMore.current = false;
    }
  }, [nextCursor, filter]);

  /** Reads feed pages for one menu button, keeping only that button's publishers, until there is enough to show. */
  async function readPosts(which: SpotlightFilter, from: number, maxPages: number): Promise<{ posts: PostView[]; nextCursor: number | null }> {
    const allowed = PUBLISHERS[which];
    const out: PostView[] = [];
    let cursor: number | null = from;
    for (let page = 0; page < maxPages && cursor !== null; page++) {
      const feed = await api.spotlightFeed(which === "following" ? "following" : "all", cursor);
      out.push(...feed.posts.filter((p) => !allowed || (p.publisher !== null && allowed.includes(p.publisher.type))));
      cursor = feed.nextCursor;
      if (out.length >= MIN_POSTS) break;
    }
    return { posts: out, nextCursor: cursor };
  }

  async function loadSpotlight() {
    setLoading(true);
    setError("");
    try {
      // Posts from creators and every other publisher come from the shared feed; stores keep their own.
      const feedPromise = channelsOn ? readPosts(filter, 0, MAX_PAGES).catch(() => null) : Promise.resolve(null);
      const res = SHOWS_STORE_ITEMS[filter] ? await api.getMarketplaceSpotlight("all") : { spotlight: [] as SpotlightItem[] };
      const feed = await feedPromise;
      setPosts(feed ? feed.posts : []);
      setNextCursor(feed ? feed.nextCursor : null);
      const list: SpotlightItem[] = res.spotlight || [];
      setItems(list);

      // Initialize like counts
      const counts: Record<string, number> = {};
      const comments: Record<string, Array<{ user: string; text: string }>> = {};
      list.forEach((item) => {
        counts[item.id] = item.likes_count || 120;
        comments[item.id] = [
          { user: item.store_name, text: "Welcome! Tap the product card to buy with same-day dispatch ⚡" },
          { user: "Amina K.", text: "Is this currently in stock in Kampala?" },
          { user: "Kato P.", text: "Love the quality of this! Super clean." },
        ];
      });
      setLikeCounts(counts);
      setItemComments(comments);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleToggleLike(id: string) {
    const isCurrentlyLiked = likedMap[id];
    setLikedMap((prev) => ({ ...prev, [id]: !isCurrentlyLiked }));
    setLikeCounts((prev) => ({
      ...prev,
      [id]: (prev[id] || 0) + (isCurrentlyLiked ? -1 : 1),
    }));
  }

  function handleAddComment(itemId: string, text: string) {
    if (!text.trim()) return;
    setItemComments((prev) => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), { user: "You", text: text.trim() }],
    }));
  }

  async function handleQuickBuy(item: SpotlightItem) {
    await addSpotlightItemToCart(item, (id) => api.getMarketplaceProduct(id));
    setQuickBuyNotice(`Added "${item.product.title}" to cart`);
    setTimeout(() => setQuickBuyNotice(""), 2400);
  }

  function handleCarouselNav(itemId: string, direction: "prev" | "next", total: number) {
    setCarouselIndices((prev) => {
      const current = prev[itemId] || 0;
      const nextIndex = direction === "next" ? (current + 1) % total : (current - 1 + total) % total;
      return { ...prev, [itemId]: nextIndex };
    });
  }

  // Room reserved at the bottom of each card for the floating cart pill.
  const bottomPad = NAV_CLEARANCE + (cartItemCount > 0 ? 72 : 0);

  // A store that is live on camera already has its live post in the feed: drop its store card so it is not shown twice.
  const liveStores = new Set(posts.filter((p) => p.liveStatus === "live" && p.publisher?.type === "store").map((p) => p.publisher!.id));
  const storeItems = items.filter((i) => !liveStores.has(i.store_id));
  const entries: FeedEntry[] = SHOWS_STORE_ITEMS[filter] ? interleave(posts, storeItems) : posts.map((post) => ({ kind: "post" as const, post }));

  const topControls = (
    <div className="flex items-center justify-end gap-3 px-4">
      {channelsOn && !practice && channelsConfig?.live?.enabled && (
        <Link href="/live" aria-label="Go live" className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-3.5 text-xs font-extrabold text-white transition active:scale-95">
          <Radio className="h-4 w-4" aria-hidden /> Live
        </Link>
      )}
      {channelsOn && !practice && (
        <Link href="/studio/new" aria-label="Create a post" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-ink-gold transition active:scale-95">
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      )}
      <button
        type="button"
        onClick={() => setIsMuted((prev) => !prev)}
        aria-label={isMuted ? "Unmute" : "Mute"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-md transition active:scale-95"
      >
        {isMuted ? <VolumeX className="h-[18px] w-[18px]" aria-hidden /> : <Volume2 className="h-[18px] w-[18px] text-gold" aria-hidden />}
      </button>
    </div>
  );

  return (
    <div className="sl-root relative h-dvh w-full overflow-hidden bg-black text-white">
      {quickBuyNotice && (
        <div role="status" className="absolute inset-x-4 top-20 z-40 mx-auto max-w-sm rounded-full bg-gold px-4 py-2.5 text-center text-xs font-semibold text-ink-gold shadow-[var(--shadow-glow-gold)] animate-fade-in">
          {quickBuyNotice}
        </div>
      )}

      {loading ? (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            <p className="text-xs text-white/60">Loading Spotlight…</p>
          </div>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex h-full w-full flex-col">
          <div className="pt-3">{topControls}</div>
          <div className="flex flex-1 flex-col items-center justify-center space-y-3 p-6 text-center">
            <h2 className="text-base font-semibold">Nothing in Spotlight yet</h2>
            <p className="max-w-xs text-xs text-white/60">
              {error || "Try another button on the menu or check back shortly for new posts."}
            </p>
            <button type="button" onClick={() => setSpotlightFilter("foryou")} className="rounded-full bg-gold px-5 py-2.5 text-xs font-semibold text-ink-gold">
              Show everything
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`no-scrollbar h-full w-full snap-y snap-mandatory ${activeCommentsId ? "overflow-hidden" : "overflow-y-scroll"}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight * 2.5 >= el.scrollHeight) void loadMorePosts();
          }}
        >
          {entries.map((entry) =>
            entry.kind === "post" ? (
              <PostSpotlightCard
                key={`post-${entry.post.id}`}
                post={entry.post}
                muted={isMuted}
                topInset={topControls}
                bottomPad={bottomPad}
                following={entry.post.publisher?.type === "channel" && followed.has(entry.post.publisher.id)}
                onFollowChange={(id, now) => setFollowed((prev) => { const next = new Set(prev); if (now) next.add(id); else next.delete(id); return next; })}
              />
            ) : (
              <SpotlightCard
                key={entry.item.id}
                item={entry.item}
                isMuted={isMuted}
                liked={!!likedMap[entry.item.id]}
                likeCount={likeCounts[entry.item.id] || 0}
                comments={itemComments[entry.item.id] || []}
                carouselIdx={carouselIndices[entry.item.id] || 0}
                drawerOpen={activeCommentsId === entry.item.id}
                topInset={topControls}
                bottomPad={bottomPad}
                onToggleLike={() => handleToggleLike(entry.item.id)}
                onCarouselNav={(dir, total) => handleCarouselNav(entry.item.id, dir, total)}
                onQuickBuy={() => void handleQuickBuy(entry.item)}
                onAddComment={(text) => handleAddComment(entry.item.id, text)}
                onDrawerChange={(open) => setActiveCommentsId(open ? entry.item.id : null)}
              />
            ),
          )}
        </div>
      )}

      {cartItemCount > 0 && !activeCommentsId && (
        <div className="absolute inset-x-4 z-40 mx-auto max-w-md animate-slide-up" style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${NAV_CLEARANCE + 12}px)` }}>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label={`View cart, ${cartItemCount} items`}
            className="flex h-14 w-full items-center justify-between rounded-full bg-[rgb(var(--surface-card))] pl-2 pr-5 text-ink shadow-[var(--shadow-float-capsule)] transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-sm font-bold text-ink-gold">{cartItemCount}</span>
              <span className="text-sm font-semibold">View cart</span>
            </span>
            <span className="text-sm font-bold">{ugx(cartTotal)}</span>
          </button>
        </div>
      )}

      <CartDrawer isOpen={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}
