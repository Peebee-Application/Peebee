import { parseWordList, type ChannelsConfig } from "@peebee/shared";
import { liveModules } from "../lib/modules.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { getAsset, type VideoAssetRow } from "../video/service.js";
import { entitlement, type Entitlement } from "./access.js";
import { loadEventViews, type EventView } from "./events.js";
import { absUrl, ChannelsError, parseJson, requireChannels, sqlTime, type Row } from "./common.js";
import { followedChannelIds } from "./channels.js";
import { ownMediaPath } from "./media.js";
import { describePublishers, driverOnJob, publisherKey, resolveIdentity, type PublisherInfo } from "./publishers.js";

export type PostRow = Row & {
  id: string; publisher_type: string; publisher_id: string; author_id: string; type: string; caption: string | null; status: string;
  access: string; price_ugx: number; preview_seconds: number; min_tier_id: string | null; video_asset_id: string | null;
  to_channel: number; to_spotlight: number; scheduled_at: string | null; published_at: string | null; live_status: string | null;
};

export type PostInput = {
  publisherType: string;
  publisherId: string;
  type: string;
  caption?: string;
  tags?: string[];
  language?: string;
  images?: string[];
  audioPath?: string | null;
  liveUrl?: string | null;
  videoAssetId?: string | null;
  coverPath?: string | null;
  poll?: { question?: string; options: string[] } | null;
  productRef?: { type: string; id: string } | null;
  access?: string;
  priceUgx?: number;
  previewSeconds?: number;
  minTierId?: string | null;
  toChannel?: boolean;
  toSpotlight?: boolean;
  publish?: boolean;
  scheduledAt?: string | null;
};

const POST_TYPES = ["video", "image", "carousel", "text", "audio", "live"];
/** The Services module each kind of publisher, and each kind of tagged item, belongs to: a post is left out of the Spotlight while its module is off. */
const PUBLISHER_MODULE: Record<string, string> = { store: "buy.marketplace", restaurant: "buy.food", learn: "learn", driver: "ride" };
const PRODUCT_MODULE: Record<string, string> = { product: "buy.marketplace", dish: "buy.food", course: "learn" };

const PRODUCT_REF_TYPES: Record<string, string[]> = { store: ["product"], restaurant: ["dish"], learn: ["course"] };

export function containsBlockedWord(text: string, cfg: ChannelsConfig): boolean {
  const words = parseWordList(cfg.moderation.blockedWords);
  if (!words.length) return false;
  const hay = text.toLowerCase();
  return words.some((w) => hay.includes(w));
}

export async function getPost(id: string): Promise<PostRow | null> {
  const res = await db.execute({ sql: "SELECT * FROM posts WHERE id = ?", args: [id] });
  return (res.rows[0] as unknown as PostRow | undefined) ?? null;
}

/** Whether a new post must wait for staff: the global mode, the publisher's first posts, or a blocked word. */
async function needsReview(publisherType: string, publisherId: string, text: string, cfg: ChannelsConfig): Promise<boolean> {
  if (cfg.moderation.mode === "before") return true;
  if (containsBlockedWord(text, cfg)) return true;
  if (cfg.moderation.reviewFirstPosts > 0) {
    const res = await db.execute({ sql: "SELECT COUNT(*) AS n FROM posts WHERE publisher_type = ? AND publisher_id = ? AND status = 'published'", args: [publisherType, publisherId] });
    if (Number((res.rows[0] as Row).n) < cfg.moderation.reviewFirstPosts) return true;
  }
  return false;
}

async function postsToday(publisherType: string, publisherId: string): Promise<number> {
  const res = await db.execute({ sql: "SELECT COUNT(*) AS n FROM posts WHERE publisher_type = ? AND publisher_id = ? AND created_at > datetime('now', '-1 day')", args: [publisherType, publisherId] });
  return Number((res.rows[0] as Row).n);
}

type Cleaned = {
  caption: string | null;
  tags: string[];
  media: { images?: string[]; audioPath?: string | null; liveUrl?: string | null };
  poll: { question: string; options: string[] } | null;
  coverPath: string | null;
  video: VideoAssetRow | null;
  access: "free" | "members" | "pay_per_view";
  priceUgx: number;
  previewSeconds: number;
  minTierId: string | null;
};

/** Checks a post's content against the type, the Admin limits and the access rules. */
async function validateContent(userId: string, input: PostInput, cfg: ChannelsConfig, publisherType: string, publisherId: string, event = false): Promise<Cleaned> {
  const type = input.type;
  // Going live from the phone has its own Admin switch (Go live), so it does not also need "live" in the post types.
  if (!POST_TYPES.includes(type) || !(cfg.publishing.postTypes.includes(type) || (type === "live" && (cfg.live.enabled || (event && cfg.live.broadcastsEnabled))))) throw new ChannelsError("post_type_unavailable", "That kind of post is not available.", 400);
  const caption = (input.caption ?? "").trim();
  if (caption.length > cfg.publishing.maxCaptionChars) throw new ChannelsError("caption_too_long", `Captions can be up to ${cfg.publishing.maxCaptionChars} characters.`, 400);
  const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter((t) => /^[\p{L}\p{N}_]{1,30}$/u.test(t)))].slice(0, cfg.publishing.maxTags);

  const out: Cleaned = {
    caption: caption || null, tags, media: {}, poll: null, coverPath: ownMediaPath(input.coverPath), video: null,
    access: "free", priceUgx: 0, previewSeconds: 0, minTierId: null,
  };

  if (type === "video") {
    if (!input.videoAssetId) throw new ChannelsError("video_required", "Choose a video.", 400);
    const asset = await getAsset(input.videoAssetId);
    if (!asset || asset.owner_id !== userId) throw new ChannelsError("video_not_found", "That video was not found in your library.", 404);
    if (asset.status === "failed") throw new ChannelsError("video_failed", "That video could not be processed.", 400);
    out.video = asset;
  } else if (type === "image" || type === "carousel") {
    const images = (input.images ?? []).map(ownMediaPath).filter((v): v is string => !!v);
    if (type === "image" && images.length !== 1) throw new ChannelsError("image_required", "Add one picture.", 400);
    if (type === "carousel" && (images.length < 2 || images.length > cfg.publishing.maxCarouselImages)) {
      throw new ChannelsError("carousel_size", `A carousel needs 2 to ${cfg.publishing.maxCarouselImages} pictures.`, 400);
    }
    out.media.images = images;
  } else if (type === "audio") {
    const audio = ownMediaPath(input.audioPath);
    if (!audio) throw new ChannelsError("audio_required", "Add an audio file.", 400);
    out.media.audioPath = audio;
  } else if (type === "live" && !event) {
    const url = input.liveUrl ? new URL(input.liveUrl.startsWith("http") ? input.liveUrl : "https://invalid") : null;
    if (!url || url.protocol !== "https:" || !/\.m3u8$/i.test(url.pathname)) throw new ChannelsError("live_url_required", "Add the https address of your live stream (an .m3u8 playlist).", 400);
    out.media.liveUrl = url.toString();
  } else if (type === "text") {
    const options = (input.poll?.options ?? []).map((o) => o.trim().slice(0, 80)).filter(Boolean);
    if (input.poll) {
      if (options.length < 2 || options.length > cfg.publishing.maxPollOptions) throw new ChannelsError("poll_options", `A poll needs 2 to ${cfg.publishing.maxPollOptions} options.`, 400);
      out.poll = { question: (input.poll.question ?? "").trim().slice(0, 200), options };
    } else if (!caption) {
      throw new ChannelsError("text_required", "Write something.", 400);
    }
  }

  if (input.productRef) {
    const allowed = PRODUCT_REF_TYPES[publisherType];
    if (!allowed || !allowed.includes(input.productRef.type)) throw new ChannelsError("product_not_allowed", "Only stores, restaurants and schools can tag what they sell.", 400);
  }

  const access = input.access ?? "free";
  if (!["free", "members", "pay_per_view"].includes(access)) throw new ChannelsError("invalid_access", "Unknown access level.", 400);
  if (access !== "free") {
    if (publisherType !== "channel") throw new ChannelsError("locked_channels_only", "Only channels can lock posts.", 400);
    if (!cfg.monetization.enabled || (access === "members" && !cfg.monetization.memberships) || (access === "pay_per_view" && !cfg.monetization.payPerView)) {
      throw new ChannelsError("locking_unavailable", "Locked posts are not available yet.", 400);
    }
    if (type === "live") throw new ChannelsError("live_cannot_lock", "Live streams cannot be locked.", 400);
    out.access = access as Cleaned["access"];
    if (access === "pay_per_view") {
      const price = Math.round(input.priceUgx ?? 0);
      if (price < cfg.monetization.minPayPerViewUgx || price > cfg.monetization.maxPayPerViewUgx) {
        throw new ChannelsError("invalid_price", `A paid post costs between UGX ${cfg.monetization.minPayPerViewUgx.toLocaleString()} and UGX ${cfg.monetization.maxPayPerViewUgx.toLocaleString()}.`, 400);
      }
      out.priceUgx = price;
    }
    if (access === "members") {
      const tiers = await db.execute({ sql: "SELECT id FROM channel_tiers WHERE channel_id = ? AND active = 1", args: [publisherId] });
      if (!tiers.rows.length) throw new ChannelsError("no_tiers", "Create a membership tier before posting members-only content.", 400);
      if (input.minTierId) {
        const t = (await db.execute({ sql: "SELECT id FROM channel_tiers WHERE id = ? AND channel_id = ? AND active = 1", args: [input.minTierId, publisherId] })).rows[0];
        if (!t) throw new ChannelsError("tier_not_found", "That tier was not found.", 404);
        out.minTierId = input.minTierId;
      }
    }
    if (type === "video") {
      if (out.video?.visibility !== "protected") throw new ChannelsError("video_not_protected", "Upload this video again with locking turned on, then attach it.", 400);
      const preview = Math.max(0, Math.min(cfg.monetization.maxPreviewSeconds, Math.round(input.previewSeconds ?? 0)));
      out.previewSeconds = preview;
    }
  }
  return out;
}

/** Creates a draft, schedules it, or publishes it. */
export async function createPost(user: { sub: string; role: string }, input: PostInput, opts: { event?: boolean } = {}): Promise<PostRow> {
  const cfg = await requireChannels();
  const identity = await resolveIdentity(user, input.publisherType, input.publisherId);
  if (!identity) throw new ChannelsError("not_your_identity", "You cannot post as that.", 403);
  if (identity.type === "personal" ? !cfg.publishing.personalPosting : !cfg.publishing.publishers.includes(identity.type)) {
    throw new ChannelsError("publisher_unavailable", "Posting is not available for this yet.", 403);
  }
  if (identity.type === "driver" && cfg.publishing.driverBlockWhileOnJob && (await driverOnJob(user.sub))) {
    throw new ChannelsError("on_a_job", "Finish your current trip or delivery first.", 409);
  }
  if ((await postsToday(identity.type, identity.id)) >= cfg.publishing.postsPerDay) {
    throw new ChannelsError("daily_post_limit", "You have reached today's posting limit.", 429);
  }
  const cleaned = await validateContent(user.sub, input, cfg, identity.type, identity.id, opts.event === true);

  const toSpotlight = input.toSpotlight !== false;
  const toChannel = identity.type === "channel" ? input.toChannel !== false : false;
  if (!toSpotlight && !toChannel) throw new ChannelsError("no_destination", "Choose where to show this post.", 400);

  let status: PostRow["status"] = "draft";
  let scheduledAt: string | null = null;
  if (input.publish) {
    if (input.scheduledAt) {
      const at = new Date(input.scheduledAt);
      if (Number.isNaN(at.getTime())) throw new ChannelsError("invalid_schedule", "That date is not valid.", 400);
      if (at.getTime() > Date.now() + 60_000) {
        if (!cfg.publishing.schedulingEnabled) throw new ChannelsError("scheduling_off", "Scheduling is not available.", 400);
        status = "scheduled";
        scheduledAt = sqlTime(at);
      }
    }
    if (status === "draft") {
      if (cleaned.video && cleaned.video.status !== "ready") throw new ChannelsError("video_not_ready", "Your video is still processing. Try again in a moment.", 409);
      status = (await needsReview(identity.type, identity.id, `${cleaned.caption ?? ""} ${cleaned.poll?.options.join(" ") ?? ""}`, cfg)) ? "review" : "published";
    }
  }

  const id = newId("pst");
  await db.execute({
    sql: `INSERT INTO posts (id, publisher_type, publisher_id, author_id, type, caption, tags_json, language, media_json, video_asset_id, cover_url, poll_json,
            product_ref_type, product_ref_id, access, price_ugx, preview_seconds, min_tier_id, to_channel, to_spotlight, status, scheduled_at, published_at, live_status, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, identity.type, identity.id, user.sub, input.type, cleaned.caption, JSON.stringify(cleaned.tags), input.language?.slice(0, 8) ?? null,
      JSON.stringify(cleaned.media), cleaned.video?.id ?? null, cleaned.coverPath, cleaned.poll ? JSON.stringify(cleaned.poll) : null,
      input.productRef?.type ?? null, input.productRef?.id?.slice(0, 80) ?? null, cleaned.access, cleaned.priceUgx, cleaned.previewSeconds, cleaned.minTierId,
      toChannel ? 1 : 0, toSpotlight ? 1 : 0, status, scheduledAt, status === "published" ? sqlTime(new Date()) : null,
      input.type === "live" ? "scheduled" : null, await getPlatformEnvironment(),
    ],
  });
  return (await getPost(id))!;
}

/** Edits what can safely change after creation. Access level and price can change; the media cannot. */
export async function updatePost(user: { sub: string; role: string }, postId: string, input: Partial<PostInput>): Promise<PostRow> {
  const cfg = await requireChannels();
  const post = await getPost(postId);
  if (!post || post.author_id !== user.sub || post.status === "removed") throw new ChannelsError("not_found", "Post not found.", 404);
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  let needsRecheck = false;
  if (input.caption !== undefined) {
    const caption = input.caption.trim();
    if (caption.length > cfg.publishing.maxCaptionChars) throw new ChannelsError("caption_too_long", `Captions can be up to ${cfg.publishing.maxCaptionChars} characters.`, 400);
    if (post.type === "text" && !caption && !post.poll_json) throw new ChannelsError("text_required", "Write something.", 400);
    sets.push("caption = ?");
    args.push(caption || null);
    needsRecheck = containsBlockedWord(caption, cfg);
  }
  if (input.tags !== undefined) {
    sets.push("tags_json = ?");
    args.push(JSON.stringify(input.tags.map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter((t) => /^[\p{L}\p{N}_]{1,30}$/u.test(t)).slice(0, cfg.publishing.maxTags)));
  }
  if (input.toSpotlight !== undefined || input.toChannel !== undefined) {
    const toSpotlight = input.toSpotlight ?? Number(post.to_spotlight) === 1;
    const toChannel = post.publisher_type === "channel" ? (input.toChannel ?? Number(post.to_channel) === 1) : false;
    if (!toSpotlight && !toChannel) throw new ChannelsError("no_destination", "Choose where to show this post.", 400);
    sets.push("to_spotlight = ?", "to_channel = ?");
    args.push(toSpotlight ? 1 : 0, toChannel ? 1 : 0);
  }
  if (input.access !== undefined || input.priceUgx !== undefined || input.previewSeconds !== undefined || input.minTierId !== undefined) {
    const merged: PostInput = {
      publisherType: post.publisher_type, publisherId: post.publisher_id, type: post.type,
      images: parseJson<{ images?: string[] }>(post.media_json, {}).images, audioPath: parseJson<{ audioPath?: string }>(post.media_json, {}).audioPath,
      liveUrl: parseJson<{ liveUrl?: string }>(post.media_json, {}).liveUrl, videoAssetId: post.video_asset_id, caption: post.caption ?? "",
      poll: post.poll_json ? { question: parseJson<{ question: string }>(post.poll_json, { question: "" }).question, options: parseJson<{ options: string[] }>(post.poll_json, { options: [] }).options } : null,
      access: input.access ?? post.access, priceUgx: input.priceUgx ?? Number(post.price_ugx), previewSeconds: input.previewSeconds ?? Number(post.preview_seconds), minTierId: input.minTierId !== undefined ? input.minTierId : post.min_tier_id,
    };
    const cleaned = await validateContent(user.sub, merged, cfg, post.publisher_type, post.publisher_id);
    sets.push("access = ?", "price_ugx = ?", "preview_seconds = ?", "min_tier_id = ?");
    args.push(cleaned.access, cleaned.priceUgx, cleaned.previewSeconds, cleaned.minTierId);
  }
  if (post.status === "scheduled" && input.scheduledAt !== undefined) {
    const at = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (!at || Number.isNaN(at.getTime())) throw new ChannelsError("invalid_schedule", "That date is not valid.", 400);
    sets.push("scheduled_at = ?");
    args.push(sqlTime(at));
  }
  if (needsRecheck && post.status === "published") sets.push("status = 'review'");
  if (sets.length) await db.execute({ sql: `UPDATE posts SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, args: [...args, postId] });
  return (await getPost(postId))!;
}

/** Publishes a draft (or a scheduled post now). */
export async function publishPost(user: { sub: string; role: string }, postId: string, scheduledAt?: string | null): Promise<PostRow> {
  const cfg = await requireChannels();
  const post = await getPost(postId);
  if (!post || post.author_id !== user.sub) throw new ChannelsError("not_found", "Post not found.", 404);
  if (!["draft", "scheduled"].includes(post.status)) throw new ChannelsError("already_published", "This post is already published.", 409);
  const identity = await resolveIdentity(user, post.publisher_type, post.publisher_id);
  if (!identity) throw new ChannelsError("not_your_identity", "You cannot post as that.", 403);
  if (identity.type === "personal" ? !cfg.publishing.personalPosting : !cfg.publishing.publishers.includes(identity.type)) {
    throw new ChannelsError("publisher_unavailable", "Posting is not available for this yet.", 403);
  }
  if (identity.type === "driver" && cfg.publishing.driverBlockWhileOnJob && (await driverOnJob(user.sub))) {
    throw new ChannelsError("on_a_job", "Finish your current trip or delivery first.", 409);
  }
  if (scheduledAt) {
    const at = new Date(scheduledAt);
    if (Number.isNaN(at.getTime())) throw new ChannelsError("invalid_schedule", "That date is not valid.", 400);
    if (at.getTime() > Date.now() + 60_000) {
      if (!cfg.publishing.schedulingEnabled) throw new ChannelsError("scheduling_off", "Scheduling is not available.", 400);
      await db.execute({ sql: "UPDATE posts SET status = 'scheduled', scheduled_at = ?, updated_at = datetime('now') WHERE id = ?", args: [sqlTime(at), postId] });
      return (await getPost(postId))!;
    }
  }
  if (post.video_asset_id) {
    const asset = await getAsset(post.video_asset_id);
    if (!asset || asset.status !== "ready") throw new ChannelsError("video_not_ready", "Your video is still processing. Try again in a moment.", 409);
  }
  const poll = parseJson<{ options: string[] }>(post.poll_json, { options: [] });
  const status = (await needsReview(post.publisher_type, post.publisher_id, `${post.caption ?? ""} ${poll.options.join(" ")}`, cfg)) ? "review" : "published";
  await db.execute({
    sql: `UPDATE posts SET status = ?, scheduled_at = NULL, published_at = CASE WHEN ? = 'published' THEN datetime('now') ELSE published_at END, updated_at = datetime('now') WHERE id = ?`,
    args: [status, status, postId],
  });
  return (await getPost(postId))!;
}

export async function deletePost(user: { sub: string }, postId: string): Promise<void> {
  const post = await getPost(postId);
  if (!post || post.author_id !== user.sub || post.status === "removed") throw new ChannelsError("not_found", "Post not found.", 404);
  await db.execute({ sql: "UPDATE posts SET status = 'removed', removed_reason = 'Deleted by the author', updated_at = datetime('now') WHERE id = ?", args: [postId] });
}

/** Staff decision on a post waiting in review, or a reported post. */
export async function moderatePost(postId: string, action: "approve" | "remove", reason?: string): Promise<PostRow> {
  const post = await getPost(postId);
  if (!post) throw new ChannelsError("not_found", "Post not found.", 404);
  if (action === "approve") {
    await db.execute({ sql: "UPDATE posts SET status = 'published', published_at = COALESCE(published_at, datetime('now')), removed_reason = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('review', 'removed')", args: [postId] });
  } else {
    await db.execute({ sql: "UPDATE posts SET status = 'removed', removed_reason = ?, updated_at = datetime('now') WHERE id = ?", args: [(reason ?? "Removed by staff").slice(0, 300), postId] });
  }
  return (await getPost(postId))!;
}

/** Publishes scheduled posts whose time has come. Safe to repeat. */
export async function publishDuePosts(): Promise<number> {
  const cfg = await requireChannels().catch(() => null);
  if (!cfg) return 0;
  const due = (await db.execute({ sql: "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= datetime('now') LIMIT 100", args: [] })).rows as unknown as PostRow[];
  let n = 0;
  for (const post of due) {
    const poll = parseJson<{ options: string[] }>(post.poll_json, { options: [] });
    let status = (await needsReview(post.publisher_type, post.publisher_id, `${post.caption ?? ""} ${poll.options.join(" ")}`, cfg)) ? "review" : "published";
    if (post.video_asset_id) {
      const asset = await getAsset(post.video_asset_id);
      if (!asset || asset.status === "failed" || asset.status === "deleted") status = "removed";
      else if (asset.status !== "ready") continue;
    }
    const res = await db.execute({
      sql: `UPDATE posts SET status = ?, published_at = CASE WHEN ? = 'published' THEN datetime('now') ELSE published_at END, removed_reason = CASE WHEN ? = 'removed' THEN 'The video could not be processed' ELSE removed_reason END,
              updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'`,
      args: [status, status, status, post.id],
    });
    n += res.rowsAffected ? 1 : 0;
  }
  return n;
}

// ------------------------------------------------------------------ serialising

type SerializeCtx = {
  origin: string;
  viewerId: string | null;
  cfg: ChannelsConfig;
  publishers: Map<string, PublisherInfo>;
  assets: Map<string, Row>;
  liked: Set<string>;
  votes: Map<string, number>;
  pollTotals: Map<string, number[]>;
  entitlements: Map<string, Entitlement>;
  events: Map<string, EventView>;
  viewerIsAdmin?: boolean;
};

export async function buildContext(posts: PostRow[], origin: string, viewerId: string | null, cfg: ChannelsConfig): Promise<SerializeCtx> {
  const publishers = await describePublishers(posts.map((p) => ({ type: p.publisher_type, id: p.publisher_id })));
  const ids = posts.map((p) => p.id);
  const marks = ids.map(() => "?").join(",");
  const assets = new Map<string, Row>();
  const assetIds = [...new Set(posts.map((p) => p.video_asset_id).filter((v): v is string => !!v))];
  if (assetIds.length) {
    for (const a of (await db.execute({ sql: `SELECT id, duration_seconds, poster_url, visibility, status FROM video_assets WHERE id IN (${assetIds.map(() => "?").join(",")})`, args: assetIds })).rows as Row[]) assets.set(String(a.id), a);
  }
  const liked = new Set<string>();
  const votes = new Map<string, number>();
  const pollTotals = new Map<string, number[]>();
  if (ids.length) {
    if (viewerId) {
      for (const r of (await db.execute({ sql: `SELECT post_id FROM post_reactions WHERE user_id = ? AND post_id IN (${marks})`, args: [viewerId, ...ids] })).rows as Row[]) liked.add(String(r.post_id));
      for (const r of (await db.execute({ sql: `SELECT post_id, option_index FROM post_poll_votes WHERE user_id = ? AND post_id IN (${marks})`, args: [viewerId, ...ids] })).rows as Row[]) votes.set(String(r.post_id), Number(r.option_index));
    }
    const pollIds = posts.filter((p) => p.poll_json).map((p) => p.id);
    if (pollIds.length) {
      for (const r of (await db.execute({ sql: `SELECT post_id, option_index, COUNT(*) AS n FROM post_poll_votes WHERE post_id IN (${pollIds.map(() => "?").join(",")}) GROUP BY post_id, option_index`, args: pollIds })).rows as Row[]) {
        const arr = pollTotals.get(String(r.post_id)) ?? [];
        arr[Number(r.option_index)] = Number(r.n);
        pollTotals.set(String(r.post_id), arr);
      }
    }
  }
  const entitlements = new Map<string, Entitlement>();
  for (const p of posts) entitlements.set(p.id, await entitlement(p as never, viewerId, cfg));
  const events = await loadEventViews(ids, viewerId);
  return { origin, viewerId, cfg, publishers, assets, liked, votes, pollTotals, entitlements, events };
}

export function serializePost(p: PostRow, ctx: SerializeCtx) {
  const ent = ctx.entitlements.get(p.id)!;
  const isAuthor = ctx.viewerId !== null && p.author_id === ctx.viewerId;
  const locked = !ent.allowed;
  const media = parseJson<{ images?: string[]; audioPath?: string; liveUrl?: string }>(p.media_json, {});
  const poll = parseJson<{ question: string; options: string[] } | null>(p.poll_json, null);
  const asset = p.video_asset_id ? ctx.assets.get(p.video_asset_id) : undefined;
  const protectedVideo = asset?.visibility === "protected";
  const publisher = ctx.publishers.get(publisherKey(p.publisher_type, p.publisher_id)) ?? null;
  const tally = ctx.pollTotals.get(p.id) ?? [];
  const caption = p.caption ?? "";
  return {
    id: p.id,
    publisher: publisher ? { ...publisher, avatarUrl: absUrl(ctx.origin, publisher.avatarUrl) } : null,
    type: p.type,
    caption: locked ? caption.slice(0, 80) : caption,
    tags: parseJson<string[]>(p.tags_json, []),
    language: p.language ?? null,
    media: locked
      ? { images: [], audioUrl: null, liveUrl: null, videoAssetId: null, coverUrl: absUrl(ctx.origin, p.cover_url), durationSeconds: asset ? Number(asset.duration_seconds) || null : null }
      : {
          images: (media.images ?? []).map((i) => absUrl(ctx.origin, i)),
          audioUrl: absUrl(ctx.origin, media.audioPath),
          liveUrl: media.liveUrl ?? null,
          videoAssetId: p.video_asset_id,
          coverUrl: absUrl(ctx.origin, p.cover_url) ?? (protectedVideo ? null : ((asset?.poster_url as string) ?? null)),
          durationSeconds: asset ? Number(asset.duration_seconds) || null : null,
        },
    poll: poll && !locked
      ? { question: poll.question, options: poll.options.map((text, i) => ({ text, votes: tally[i] ?? 0 })), total: tally.reduce((a, b) => a + (b ?? 0), 0), myVote: ctx.votes.get(p.id) ?? null }
      : null,
    productRef: p.product_ref_type ? { type: p.product_ref_type, id: p.product_ref_id } : null,
    access: p.access,
    priceUgx: Number(p.price_ugx),
    previewSeconds: Number(p.preview_seconds),
    locked: locked ? { reason: ent.reason, access: p.access, priceUgx: Number(p.price_ugx), previewSeconds: Number(p.preview_seconds), minTierId: p.min_tier_id ?? null } : null,
    status: p.status,
    publishedAt: p.published_at ?? null,
    scheduledAt: isAuthor ? p.scheduled_at ?? null : null,
    // An airing's clock is read when the post is serialised, which can be a moment after the post row was fetched.
    liveStatus: ctx.events.get(p.id) ? ({ scheduled: "scheduled", on_air: "live", ended: "ended" } as const)[ctx.events.get(p.id)!.status] : p.live_status ?? null,
    event: ctx.events.get(p.id) ?? null,
    counts: { views: Number(p.view_count), likes: Number(p.like_count), comments: Number(p.comment_count) },
    liked: ctx.liked.has(p.id),
    toChannel: Number(p.to_channel) === 1,
    toSpotlight: Number(p.to_spotlight) === 1,
    isMine: isAuthor,
    removedReason: isAuthor ? (p.removed_reason as string | null) ?? null : null,
    createdAt: p.created_at as string,
  };
}

export async function serializePosts(posts: PostRow[], origin: string, viewerId: string | null, cfg: ChannelsConfig) {
  const ctx = await buildContext(posts, origin, viewerId, cfg);
  return posts.map((p) => serializePost(p, ctx));
}

// --------------------------------------------------------------------- the feed

export type FeedFilter = "all" | "following" | "video" | "image";

/** Answers, for a post, whether the Services modules behind its publisher and what it tags are on right now. */
export async function postModuleCheck(): Promise<(p: PostRow) => boolean> {
  const live = await liveModules([...Object.values(PUBLISHER_MODULE), ...Object.values(PRODUCT_MODULE)]);
  return (p) => live[PUBLISHER_MODULE[p.publisher_type] ?? ""] !== false && live[PRODUCT_MODULE[String(p.product_ref_type ?? "")] ?? ""] !== false;
}

/** Ranks recent published posts from every publisher and returns one page. */
export async function spotlightFeed(viewerId: string | null, cfg: ChannelsConfig, opts: { filter?: FeedFilter; cursor?: number }): Promise<{ posts: PostRow[]; nextCursor: number | null }> {
  const env = await getPlatformEnvironment();
  const rows = (await db.execute({
    sql: `SELECT p.* FROM posts p LEFT JOIN channels ch ON p.publisher_type = 'channel' AND ch.id = p.publisher_id
          WHERE p.status = 'published' AND p.to_spotlight = 1 AND p.environment = ? AND (p.publisher_type != 'channel' OR ch.status = 'active')
            AND NOT (p.type = 'live' AND COALESCE(p.live_status, '') = 'ended')
          ORDER BY p.published_at DESC LIMIT 300`,
    args: [env],
  })).rows as unknown as PostRow[];

  const moduleOn = await postModuleCheck();
  const allowed = rows.filter((p) => moduleOn(p) && (p.publisher_type === "personal" ? cfg.publishing.personalPosting : cfg.publishing.publishers.includes(p.publisher_type)));
  const following = viewerId ? await followedChannelIds(viewerId) : new Set<string>();
  let pool = allowed;
  if (opts.filter === "following") pool = pool.filter((p) => p.publisher_type === "channel" && following.has(p.publisher_id));
  if (opts.filter === "video") pool = pool.filter((p) => p.type === "video" || p.type === "live");
  if (opts.filter === "image") pool = pool.filter((p) => p.type === "image" || p.type === "carousel");

  const r = cfg.ranking;
  const now = Date.now();
  const scored = pool.map((p) => {
    const ageHours = Math.max(0, (now - new Date(`${String(p.published_at).replace(" ", "T")}Z`).getTime()) / 3_600_000);
    const recency = Math.max(0, 1 - ageHours / r.recencyHours) * r.recencyWeight;
    const eng = Math.min(1, Math.log10(1 + Number(p.like_count) + 2 * Number(p.comment_count) + Number(p.view_count) / 10) / 3) * r.engagementWeight;
    const follow = p.publisher_type === "channel" && following.has(p.publisher_id) ? r.followedBoost : 0;
    const mult = (p.publisher_type === "store" ? r.storeWeight : p.publisher_type === "channel" ? r.channelWeight : r.otherWeight) / 100;
    // A stream that is on right now goes to the top.
    const liveNow = p.live_status === "live" ? 10 : 0;
    return { p, score: (recency + eng + follow + liveNow) * mult };
  });
  scored.sort((a, b) => b.score - a.score || String(b.p.published_at).localeCompare(String(a.p.published_at)));

  const start = Math.max(0, opts.cursor ?? 0);
  const page = scored.slice(start, start + r.pageSize).map((s) => s.p);
  return { posts: page, nextCursor: start + r.pageSize < scored.length ? start + r.pageSize : null };
}

/** A channel's own page of posts, newest first. */
export async function channelPosts(channelId: string, cursor: number, pageSize: number): Promise<{ posts: PostRow[]; nextCursor: number | null }> {
  const rows = (await db.execute({
    sql: `SELECT * FROM posts WHERE publisher_type = 'channel' AND publisher_id = ? AND status = 'published' AND to_channel = 1
            AND NOT (type = 'live' AND COALESCE(live_status, '') = 'ended')
          ORDER BY published_at DESC LIMIT ? OFFSET ?`,
    args: [channelId, pageSize + 1, cursor],
  })).rows as unknown as PostRow[];
  return { posts: rows.slice(0, pageSize), nextCursor: rows.length > pageSize ? cursor + pageSize : null };
}
