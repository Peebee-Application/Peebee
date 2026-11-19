"use client";

import type { PostView } from "@peebee/shared";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useChannelsConfig } from "../../lib/channels";
import { Avatar, CommentsSheet, PostActions, PublisherLine, ReportSheet, TipSheet } from "./PostParts";
import { PostMedia } from "./PostMedia";
import { LiveViewerBadge, LiveViewerChat } from "../live/ViewerLive";
import { useLiveFeed } from "../live/useLiveFeed";
import { LiveShopStrip, StoreLiveBadge, useLiveStoreItems } from "../live/LiveShopStrip";
import { usePost } from "./usePost";

/** True while the card is the one on screen, so only that video plays (and its ads run). */
function useInView(threshold = 0.6) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/** One post from any publisher in the full-screen Spotlight feed. */
export function PostSpotlightCard({ post: initial, muted, topInset, bottomPad = 0, following, onFollowChange }: {
  post: PostView; muted: boolean; topInset: ReactNode; /** Room kept clear at the bottom for the floating menu. */ bottomPad?: number; following: boolean; onFollowChange: (channelId: string, now: boolean) => void;
}) {
  const { config } = useChannelsConfig();
  const { user } = useAuth();
  const s = usePost(initial);
  const { ref, inView } = useInView();
  const [open, setOpen] = useState(false);
  const p = s.post;
  // A stream that is on right now: watch its viewer count and comments while this card is the one on screen.
  const isLive = p.liveStatus === "live";
  const liveFeed = useLiveFeed(isLive && inView ? p.id : null);
  // A store's live: the items it is selling, with a Buy button, while the card is on screen.
  const storeLive = isLive && p.publisher?.type === "store";
  const shop = useLiveStoreItems(p.id, storeLive && inView);
  const channelId = p.publisher?.type === "channel" ? p.publisher.id : null;

  async function toggleFollow() {
    if (!channelId) return;
    if (!user) { window.location.href = "/login"; return; }
    onFollowChange(channelId, !following);
    try {
      if (following) await api.unfollowChannel(channelId); else await api.followChannel(channelId);
    } catch {
      onFollowChange(channelId, following);
    }
  }

  return (
    <section ref={ref} aria-label={p.caption.slice(0, 60) || "Post"} className="relative h-full w-full snap-start overflow-hidden bg-black text-white">
      {inView ? (
        <PostMedia post={p} muted={muted} fullscreen onChanged={s.replace} />
      ) : (
        <div className="absolute inset-0 bg-neutral-950">
          {p.media.coverUrl && <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${p.media.coverUrl})` }} aria-hidden />}
          {p.media.images[0] && p.type !== "video" && <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${p.media.images[0]})` }} aria-hidden />}
        </div>
      )}
      {isLive && <LiveViewerBadge feed={liveFeed} />}
      {storeLive && p.publisher && liveFeed.state?.status !== "ended" && <StoreLiveBadge name={p.publisher.name} />}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[50%] bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

      <div className="absolute inset-x-0 top-0 z-20" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>{topInset}</div>

      <aside className="absolute right-3 z-20 flex flex-col items-center gap-5" style={{ bottom: 120 + bottomPad }}>
        {p.publisher && (
          <div className="relative">
            {p.publisher.type === "channel" && p.publisher.handle ? (
              <Link href={`/c/${p.publisher.handle}`} aria-label={`Open ${p.publisher.name}`}><Avatar name={p.publisher.name} url={p.publisher.avatarUrl} size={44} /></Link>
            ) : <Avatar name={p.publisher.name} url={p.publisher.avatarUrl} size={44} />}
            {channelId && !following && !p.isMine && (
              <button type="button" onClick={toggleFollow} aria-label={`Follow ${p.publisher.name}`} className="absolute -bottom-1.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-gold text-ink-gold"><Plus className="h-3.5 w-3.5" aria-hidden /></button>
            )}
          </div>
        )}
        <PostActions post={p} config={config} dark vertical liked={s.liked} likeCount={s.likes} commentCount={s.comments}
          onLike={s.toggleLike} onComments={() => s.setSheet("comments")} onTip={() => s.setSheet("tip")} onReport={() => s.setSheet("report")} />
      </aside>

      <div className="absolute inset-x-0 bottom-0 z-20 space-y-2 px-4 pr-20" style={{ paddingBottom: `calc(max(1rem, env(safe-area-inset-bottom)) + ${bottomPad}px)` }}>
        {isLive && <LiveViewerChat post={p} feed={liveFeed} />}
        {storeLive && <LiveShopStrip data={shop} />}
        <PublisherLine post={p} dark />
        {p.type !== "text" && p.caption && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="block w-full text-left" aria-expanded={open}>
            <p className={`whitespace-pre-wrap break-words text-sm text-white/90 ${open ? "" : "line-clamp-2"}`}>{p.caption}{p.locked ? "…" : ""}</p>
          </button>
        )}
        {p.tags.length > 0 && <p className="line-clamp-1 text-xs text-gold">{p.tags.map((t) => `#${t}`).join(" ")}</p>}
        {p.access !== "free" && !p.locked && <p className="text-[11px] font-semibold text-gold">{p.access === "members" ? "Members only" : "Paid post · unlocked"}</p>}
      </div>

      <CommentsSheet post={p} open={s.sheet === "comments"} onClose={() => s.setSheet(null)} onCountChange={s.addComments} />
      {channelId && p.publisher && <TipSheet channelId={channelId} channelName={p.publisher.name} postId={p.id} config={config} open={s.sheet === "tip"} onClose={() => s.setSheet(null)} />}
      <ReportSheet postId={p.id} open={s.sheet === "report"} onClose={() => s.setSheet(null)} />
    </section>
  );
}
