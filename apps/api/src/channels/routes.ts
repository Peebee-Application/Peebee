import { patchSchema } from "../lib/patch-schema.js";
import { Hono } from "hono";
import { z } from "zod";
import type { ChannelsConfig } from "@peebee/shared";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { consume } from "../lib/ratelimit.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { getAsset, playbackFor, VideoRequestError } from "../video/service.js";
import { premiereBlocksPlayback } from "./events.js";
import { entitlement } from "./access.js";
import { checkHandle, follow, getChannelByHandle, getChannelById, getMyChannel, handleTaken, normalizeHandle, openChannel, serializeChannel, unfollow, updateChannel, followedChannelIds } from "./channels.js";
import { ChannelsError, fail, requireChannels, type Row } from "./common.js";
import { addComment, deleteComment, listComments, reportPost, toggleLike, votePoll } from "./engagement.js";
import { cancelSubscription, createTier, listTiers, mySubscriptions, sendTip, subscribe, unlockPost, updateTier } from "./money.js";
import { activeSubscription } from "./access.js";
import { channelPosts, createPost, postModuleCheck, deletePost, getPost, publishPost, serializePosts, spotlightFeed, updatePost, type FeedFilter, type PostInput } from "./posts.js";
import { listIdentities } from "./publishers.js";
import { recordView } from "./rewards.js";
import { optionalUser, originOf, viewerKey } from "./viewer.js";
import { liveCauses, serializeCause } from "./causes.js";
import { getAdsConfig } from "../ads/settings.js";
import { getChannelsConfig } from "./settings.js";

/** Channels, posts, the shared Spotlight feed, engagement, memberships and tips. */
export const channelsRoutes = new Hono();

/** What a client needs to know about the current rules (never anything private). */
export function publicConfig(cfg: ChannelsConfig) {
  return {
    enabled: cfg.enabled,
    channelsOpen: cfg.general.channelsOpen,
    ageDeclarationRequired: cfg.general.ageDeclarationRequired,
    minAge: cfg.general.minAge,
    handle: { min: cfg.general.handleMinLength, max: cfg.general.handleMaxLength },
    maxBioChars: cfg.general.maxBioChars,
    maxLinks: cfg.general.maxLinks,
    publishing: {
      personalPosting: cfg.publishing.personalPosting,
      publishers: cfg.publishing.publishers,
      postTypes: cfg.publishing.postTypes,
      maxCaptionChars: cfg.publishing.maxCaptionChars,
      maxCarouselImages: cfg.publishing.maxCarouselImages,
      maxPollOptions: cfg.publishing.maxPollOptions,
      maxTags: cfg.publishing.maxTags,
      maxImageMb: cfg.publishing.maxImageMb,
      maxAudioMb: cfg.publishing.maxAudioMb,
      schedulingEnabled: cfg.publishing.schedulingEnabled,
      commentsEnabled: cfg.publishing.commentsEnabled,
      reactionsEnabled: cfg.publishing.reactionsEnabled,
      maxCommentChars: cfg.publishing.maxCommentChars,
    },
    moderationMode: cfg.moderation.mode,
    live: {
      enabled: cfg.live.enabled, commentsEnabled: cfg.live.commentsEnabled, helperEnabled: cfg.live.helperEnabled, maxMinutes: cfg.live.maxMinutes,
      broadcastsEnabled: cfg.live.broadcastsEnabled, premieresEnabled: cfg.live.premieresEnabled, minLeadMinutes: cfg.live.minLeadMinutes, maxLeadDays: cfg.live.maxLeadDays,
      maxProgramItems: cfg.live.maxProgramItems, maxLoops: cfg.live.maxLoops, remindersEnabled: cfg.live.remindersEnabled,
    },
    monetization: {
      enabled: cfg.monetization.enabled,
      memberships: cfg.monetization.memberships,
      payPerView: cfg.monetization.payPerView,
      tips: cfg.monetization.tips,
      gifts: cfg.monetization.gifts,
      giftOptions: cfg.monetization.giftOptions,
      maxTiers: cfg.monetization.maxTiers,
      minTierPriceUgx: cfg.monetization.minTierPriceUgx,
      maxTierPriceUgx: cfg.monetization.maxTierPriceUgx,
      minPayPerViewUgx: cfg.monetization.minPayPerViewUgx,
      maxPayPerViewUgx: cfg.monetization.maxPayPerViewUgx,
      minTipUgx: cfg.monetization.minTipUgx,
      maxTipUgx: cfg.monetization.maxTipUgx,
      maxPreviewSeconds: cfg.monetization.maxPreviewSeconds,
      earningsToWalletEnabled: cfg.monetization.earningsToWalletEnabled,
    },
    kyc: { required: cfg.kyc.required, withdrawalsEnabled: cfg.kyc.withdrawalsEnabled, minWithdrawUgx: cfg.kyc.minWithdrawUgx, idTypes: cfg.kyc.idTypes, requireSelfie: cfg.kyc.requireSelfie, requireIdBack: cfg.kyc.requireIdBack, minAge: cfg.kyc.minAgeToWithdraw },
    causes: {
      enabled: cfg.causes.enabled, requireApproval: cfg.causes.requireApproval, minGoalUgx: cfg.causes.minGoalUgx, maxGoalUgx: cfg.causes.maxGoalUgx, minDays: cfg.causes.minDays, maxDays: cfg.causes.maxDays,
      allowAllOrNothing: cfg.causes.allowAllOrNothing, defaultFundingMode: cfg.causes.defaultFundingMode, guestDonations: cfg.causes.guestDonations, donorTipEnabled: cfg.causes.donorTipEnabled,
      minDonationUgx: cfg.causes.minDonationUgx, maxDonationUgx: cfg.causes.maxDonationUgx, allowAnonymous: cfg.causes.allowAnonymous, allowWalletPayment: cfg.causes.allowWalletPayment, allowMobileMoney: cfg.causes.allowMobileMoney,
    },
    rewards: { enabled: cfg.rewards.enabled, minCashoutPoints: cfg.rewards.minCashoutPoints },
  };
}

channelsRoutes.get("/channels/config", async (c) => {
  c.header("Cache-Control", "public, max-age=30");
  return c.json(publicConfig(await getChannelsConfig()));
});

// ------------------------------------------------------------------ my channel

/** Everything the "me" screens need in one call. */
channelsRoutes.get("/channels/me", requireAuth, async (c) => {
  try {
    const cfg = await requireChannels();
    const user = c.get("user");
    const channel = await getMyChannel(user.sub);
    return c.json({
      config: publicConfig(cfg),
      channel: channel ? await serializeChannel(channel, originOf(c), user.sub) : null,
      identities: await listIdentities({ sub: user.sub, role: user.role }),
    });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.get("/channels/handle-available", requireAuth, async (c) => {
  try {
    const cfg = await requireChannels();
    const handle = normalizeHandle(c.req.query("handle") ?? "");
    const problem = checkHandle(handle, cfg);
    if (problem) return c.json({ available: false, reason: problem });
    const mine = await getMyChannel(c.get("user").sub);
    return c.json({ available: !(await handleTaken(handle, mine?.id)), reason: null });
  } catch (err) {
    return fail(c, err);
  }
});

const channelSchema = z.object({
  handle: z.string().max(60),
  displayName: z.string().max(80),
  bio: z.string().max(4000).optional(),
  category: z.string().max(40).optional(),
  avatarPath: z.string().max(400).nullable().optional(),
  bannerPath: z.string().max(400).nullable().optional(),
  links: z.array(z.object({ label: z.string().max(40).optional(), url: z.string().max(500) })).max(30).optional(),
  ageConfirmed: z.boolean().optional(),
});

channelsRoutes.post("/channels", requireAuth, async (c) => {
  try {
    const body = channelSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Check the details and try again.", 400);
    const ch = await openChannel(c.get("user").sub, body.data);
    return c.json({ channel: await serializeChannel(ch, originOf(c), c.get("user").sub) }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.patch("/channels/me", requireAuth, async (c) => {
  try {
    const body = patchSchema(channelSchema).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Check the details and try again.", 400);
    const ch = await updateChannel(c.get("user").sub, body.data);
    return c.json({ channel: await serializeChannel(ch, originOf(c), c.get("user").sub) });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.get("/channels/following", requireAuth, async (c) => {
  try {
    await requireChannels();
    const ids = [...(await followedChannelIds(c.get("user").sub))];
    const out = [];
    for (const id of ids.slice(0, 100)) {
      const ch = await getChannelById(id);
      if (ch && ch.status === "active") out.push(await serializeChannel(ch, originOf(c), c.get("user").sub));
    }
    return c.json({ channels: out });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/channels/:id/follow", requireAuth, async (c) => {
  try {
    await follow(c.get("user").sub, c.req.param("id") as string);
    return c.json({ following: true });
  } catch (err) {
    return fail(c, err);
  }
});
channelsRoutes.delete("/channels/:id/follow", requireAuth, async (c) => {
  try {
    await unfollow(c.get("user").sub, c.req.param("id") as string);
    return c.json({ following: false });
  } catch (err) {
    return fail(c, err);
  }
});

// ----------------------------------------------------------------- public channel

channelsRoutes.get("/public/channels/:handle", async (c) => {
  try {
    const cfg = await requireChannels();
    const user = await optionalUser(c);
    const ch = await getChannelByHandle(c.req.param("handle") as string);
    if (!ch || ch.status !== "active" || ch.environment !== (await getPlatformEnvironment())) throw new ChannelsError("not_found", "Channel not found.", 404);
    const origin = originOf(c);
    const tiers = cfg.monetization.enabled && cfg.monetization.memberships ? await listTiers(ch.id) : [];
    const causes = cfg.causes.enabled ? (await liveCauses(50)).filter((x) => x.channel_id === ch.id) : [];
    const sub = user ? await activeSubscription(user.id, ch.id) : null;
    c.header("Cache-Control", user ? "private, no-store" : "public, max-age=30");
    return c.json({
      channel: await serializeChannel(ch, origin, user?.id ?? null),
      tiers: tiers.map((t) => ({ id: String(t.id), name: String(t.name), description: (t.description as string) ?? null, priceUgx: Number(t.price_ugx), periodDays: Number(t.period_days), perks: JSON.parse(String(t.perks_json ?? "[]")), members: Number(t.members) })),
      causes: await Promise.all(causes.map((x) => serializeCause(x, origin))),
      membership: sub ? { id: String(sub.id), tierId: String(sub.tier_id), status: String(sub.status), currentPeriodEnd: String(sub.current_period_end), autoRenew: Number(sub.auto_renew) === 1 } : null,
    });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.get("/public/channels/:handle/posts", async (c) => {
  try {
    const cfg = await requireChannels();
    const user = await optionalUser(c);
    const ch = await getChannelByHandle(c.req.param("handle") as string);
    if (!ch || ch.status !== "active") throw new ChannelsError("not_found", "Channel not found.", 404);
    const { posts, nextCursor } = await channelPosts(ch.id, Math.max(0, Number(c.req.query("cursor")) || 0), cfg.ranking.pageSize);
    c.header("Cache-Control", "private, no-store");
    return c.json({ posts: await serializePosts(posts, originOf(c), user?.id ?? null, cfg), nextCursor });
  } catch (err) {
    return fail(c, err);
  }
});

/** For the sitemap: public channels and live causes. */
channelsRoutes.get("/public/channels-sitemap", async (c) => {
  const cfg = await getChannelsConfig();
  if (!cfg.enabled || !cfg.general.sitemapEnabled) return c.json({ channels: [], causes: [] });
  try {
    const env = await getPlatformEnvironment();
    const channels = (await db.execute({ sql: "SELECT handle, updated_at FROM channels WHERE status = 'active' AND environment = ? ORDER BY updated_at DESC LIMIT 2000", args: [env] })).rows as Row[];
    const causes = cfg.causes.enabled ? ((await db.execute({ sql: "SELECT slug, updated_at FROM causes WHERE status IN ('live', 'ended', 'closed') AND environment = ? ORDER BY updated_at DESC LIMIT 2000", args: [env] })).rows as Row[]) : [];
    c.header("Cache-Control", "public, max-age=900");
    return c.json({ channels: channels.map((r) => ({ handle: String(r.handle), updatedAt: String(r.updated_at) })), causes: causes.map((r) => ({ slug: String(r.slug), updatedAt: String(r.updated_at) })) });
  } catch {
    return c.json({ channels: [], causes: [] });
  }
});

// ------------------------------------------------------------------------ posts

const postSchema = z.object({
  publisherType: z.string().max(20),
  publisherId: z.string().max(80),
  type: z.string().max(20),
  caption: z.string().max(25000).optional(),
  tags: z.array(z.string().max(40)).max(60).optional(),
  language: z.string().max(8).optional(),
  images: z.array(z.string().max(400)).max(40).optional(),
  audioPath: z.string().max(400).nullable().optional(),
  liveUrl: z.string().max(600).nullable().optional(),
  videoAssetId: z.string().max(80).nullable().optional(),
  coverPath: z.string().max(400).nullable().optional(),
  poll: z.object({ question: z.string().max(300).optional(), options: z.array(z.string().max(120)).max(20) }).nullable().optional(),
  productRef: z.object({ type: z.string().max(20), id: z.string().max(80) }).nullable().optional(),
  access: z.enum(["free", "members", "pay_per_view"]).optional(),
  priceUgx: z.number().optional(),
  previewSeconds: z.number().optional(),
  minTierId: z.string().max(80).nullable().optional(),
  toChannel: z.boolean().optional(),
  toSpotlight: z.boolean().optional(),
  publish: z.boolean().optional(),
  scheduledAt: z.string().max(40).nullable().optional(),
});

channelsRoutes.post("/posts", requireAuth, async (c) => {
  try {
    const user = c.get("user");
    const body = postSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Check the post and try again.", 400);
    const post = await createPost({ sub: user.sub, role: user.role }, body.data as PostInput);
    const cfg = await requireChannels();
    return c.json({ post: (await serializePosts([post], originOf(c), user.sub, cfg))[0] }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.patch("/posts/:id", requireAuth, async (c) => {
  try {
    const user = c.get("user");
    const body = patchSchema(postSchema).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Check the post and try again.", 400);
    const post = await updatePost({ sub: user.sub, role: user.role }, c.req.param("id") as string, body.data as Partial<PostInput>);
    return c.json({ post: (await serializePosts([post], originOf(c), user.sub, await requireChannels()))[0] });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/posts/:id/publish", requireAuth, async (c) => {
  try {
    const user = c.get("user");
    const body = z.object({ scheduledAt: z.string().max(40).nullable().optional() }).safeParse(await c.req.json().catch(() => ({})));
    const post = await publishPost({ sub: user.sub, role: user.role }, c.req.param("id") as string, body.success ? body.data.scheduledAt : null);
    return c.json({ post: (await serializePosts([post], originOf(c), user.sub, await requireChannels()))[0] });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.delete("/posts/:id", requireAuth, async (c) => {
  try {
    await deletePost({ sub: c.get("user").sub }, c.req.param("id") as string);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

/** My posts in any state (drafts, scheduled, waiting for review, published, removed). */
channelsRoutes.get("/posts/mine", requireAuth, async (c) => {
  try {
    const cfg = await requireChannels();
    const user = c.get("user");
    const status = c.req.query("status");
    const rows = (await db.execute({
      sql: `SELECT * FROM posts WHERE author_id = ? ${status ? "AND status = ?" : "AND status != 'removed'"} ORDER BY created_at DESC LIMIT 100`,
      args: status ? [user.sub, status] : [user.sub],
    })).rows;
    return c.json({ posts: await serializePosts(rows as never, originOf(c), user.sub, cfg) });
  } catch (err) {
    return fail(c, err);
  }
});

/** One post. Locked content is withheld unless this viewer is entitled to it. */
channelsRoutes.get("/posts/:id", async (c) => {
  try {
    const cfg = await requireChannels();
    const user = await optionalUser(c);
    const post = await getPost(c.req.param("id") as string);
    const visible = post && (post.status === "published" || (user && post.author_id === user.id && post.status !== "removed"));
    if (!post || !visible) throw new ChannelsError("not_found", "Post not found.", 404);
    // A saved link to a post whose Services module is switched off says so instead of showing it.
    if (!(await postModuleCheck())(post)) throw new ChannelsError("module_offline", "Currently Offline", 404);
    c.header("Cache-Control", "private, no-store");
    return c.json({ post: (await serializePosts([post], originOf(c), user?.id ?? null, cfg))[0] });
  } catch (err) {
    return fail(c, err);
  }
});

// ------------------------------------------------------------------------- feed

channelsRoutes.get("/spotlight/feed", async (c) => {
  try {
    const cfg = await requireChannels();
    const user = await optionalUser(c);
    const filter = (["all", "following", "video", "image"].includes(c.req.query("filter") ?? "") ? c.req.query("filter") : "all") as FeedFilter;
    const { posts, nextCursor } = await spotlightFeed(user?.id ?? null, cfg, { filter, cursor: Number(c.req.query("cursor")) || 0 });
    c.header("Cache-Control", "private, no-store");
    return c.json({ posts: await serializePosts(posts, originOf(c), user?.id ?? null, cfg), nextCursor });
  } catch (err) {
    // The old store Spotlight keeps working when this is switched off.
    if (err instanceof ChannelsError && err.code === "channels_unavailable") return c.json({ posts: [], nextCursor: null, unavailable: true });
    return fail(c, err);
  }
});

// ------------------------------------------------------------------- engagement

channelsRoutes.post("/posts/:id/like", requireAuth, async (c) => {
  try {
    return c.json(await toggleLike(c.get("user").sub, c.req.param("id") as string));
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.get("/posts/:id/comments", async (c) => {
  try {
    const user = await optionalUser(c);
    return c.json(await listComments(c.req.param("id") as string, user?.id ?? null, Math.max(0, Number(c.req.query("cursor")) || 0)));
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/posts/:id/comments", requireAuth, async (c) => {
  try {
    const body = z.object({ body: z.string().max(6000) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Write a comment.", 400);
    return c.json(await addComment(c.get("user").sub, c.req.param("id") as string, body.data.body), 201);
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.delete("/comments/:id", requireAuth, async (c) => {
  try {
    await deleteComment(c.get("user").sub, c.req.param("id") as string);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/posts/:id/report", requireAuth, async (c) => {
  try {
    const body = z.object({ reason: z.string().max(80), details: z.string().max(600).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Choose a reason.", 400);
    await reportPost(c.get("user").sub, c.req.param("id") as string, body.data.reason, body.data.details);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/posts/:id/vote", requireAuth, async (c) => {
  try {
    const body = z.object({ option: z.number().int() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Choose an option.", 400);
    await votePoll(c.get("user").sub, c.req.param("id") as string, body.data.option);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

/** The player reports how much of a post was watched. Counts the view and, when long enough, earns the creator points. */
channelsRoutes.post("/posts/:id/view", async (c) => {
  try {
    const user = await optionalUser(c);
    const key = await viewerKey(c, user);
    const limit = await consume(`post-view:${key}`, 600, 3600);
    if (!limit.allowed) return c.body(null, 204);
    const body = z.object({ seconds: z.number().min(0).max(86_400) }).safeParse(await c.req.json().catch(() => ({})));
    const post = await getPost(c.req.param("id") as string);
    if (!post || !body.success) return c.body(null, 204);
    // Only people who can actually see a post count as having watched it.
    const cfg = await requireChannels();
    if (!(await entitlement(post as never, user?.id ?? null, cfg)).allowed) return c.body(null, 204);
    const r = await recordView(post, { key, userId: user?.id ?? null }, body.data.seconds);
    return c.json(r);
  } catch (err) {
    return fail(c, err);
  }
});

// -------------------------------------------------------------------- playback

/**
 * Addresses to play a post's video. A locked video is signed only for someone entitled to it; a
 * viewer who is not gets, at most, a short preview whose address expires soon after the preview ends.
 */
channelsRoutes.get("/posts/:id/playback", async (c) => {
  try {
    const cfg = await requireChannels();
    const user = await optionalUser(c);
    const post = await getPost(c.req.param("id") as string);
    const mine = user && post && post.author_id === user.id;
    if (!post || !post.video_asset_id || (post.status !== "published" && !mine)) throw new ChannelsError("not_found", "Video not found.", 404);
    const asset = await getAsset(post.video_asset_id);
    if (!asset) throw new ChannelsError("not_found", "Video not found.", 404);
    // A premiere cannot be watched before it starts, except by its own author checking it.
    const early = mine ? null : await premiereBlocksPlayback(post.id);
    if (early) throw new ChannelsError("premiere_not_started", "This premieres soon. It cannot be watched yet.", 403, { startsAt: early.startsAt });
    const ent = await entitlement(post as never, user?.id ?? null, cfg);
    c.header("Cache-Control", "private, no-store");
    const adFree = ent.reason === "member" && (await getAdsConfig()).adFreeForMembers;

    if (ent.allowed) {
      return c.json({ playback: await playbackFor(asset, { cleared: true }), preview: false, adFreeForMembers: adFree, access: ent.reason });
    }
    const previewSeconds = Math.min(Number(post.preview_seconds), cfg.monetization.maxPreviewSeconds);
    if (previewSeconds > 0) {
      const key = await viewerKey(c, user);
      const used = (await db.execute({ sql: "SELECT created_at FROM post_previews WHERE post_id = ? AND viewer_key = ?", args: [post.id, key] })).rows[0] as Row | undefined;
      const cooldown = cfg.monetization.previewCooldownMinutes;
      const fresh = !used || (cooldown > 0 && Date.now() - new Date(`${String(used.created_at).replace(" ", "T")}Z`).getTime() > cooldown * 60_000);
      if (fresh) {
        await db.execute({
          sql: `INSERT INTO post_previews (post_id, viewer_key, created_at) VALUES (?, ?, datetime('now')) ON CONFLICT(post_id, viewer_key) DO UPDATE SET created_at = datetime('now')`,
          args: [post.id, key],
        });
        // The address stops working shortly after the preview, so it cannot be watched on past the cut-off.
        return c.json({ playback: await playbackFor(asset, { cleared: true, ttlSeconds: previewSeconds + 20 }), preview: true, previewSeconds, access: ent.reason });
      }
    }
    throw new ChannelsError("locked", "This video is locked.", 403, { locked: { reason: ent.reason, access: post.access, priceUgx: Number(post.price_ugx) } });
  } catch (err) {
    if (err instanceof VideoRequestError) return c.json({ error: err.code, message: err.clientMessage }, err.status);
    return fail(c, err);
  }
});

// -------------------------------------------------- memberships, unlocks, tips

channelsRoutes.get("/creator/tiers", requireAuth, async (c) => {
  try {
    await requireChannels();
    const ch = await getMyChannel(c.get("user").sub);
    return c.json({ tiers: ch ? (await listTiers(ch.id, true)).map((t) => ({ id: String(t.id), name: String(t.name), description: (t.description as string) ?? null, priceUgx: Number(t.price_ugx), periodDays: Number(t.period_days), perks: JSON.parse(String(t.perks_json ?? "[]")), active: Number(t.active) === 1, members: Number(t.members) })) : [] });
  } catch (err) {
    return fail(c, err);
  }
});

const tierSchema = z.object({ name: z.string().max(60), description: z.string().max(400).optional(), priceUgx: z.number(), periodDays: z.number().optional(), perks: z.array(z.string().max(120)).max(12).optional(), active: z.boolean().optional() });

channelsRoutes.post("/creator/tiers", requireAuth, async (c) => {
  try {
    const body = tierSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Check the tier and try again.", 400);
    const t = await createTier(c.get("user").sub, body.data);
    return c.json({ id: String(t.id) }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.patch("/creator/tiers/:id", requireAuth, async (c) => {
  try {
    const body = patchSchema(tierSchema).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Check the tier and try again.", 400);
    await updateTier(c.get("user").sub, c.req.param("id") as string, body.data);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/tiers/:id/subscribe", requireAuth, async (c) => {
  try {
    const sub = await subscribe(c.get("user").sub, c.req.param("id") as string);
    return c.json({ subscription: { id: String(sub.id), currentPeriodEnd: String(sub.current_period_end) } }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.get("/subscriptions/mine", requireAuth, async (c) => {
  try {
    await requireChannels();
    const rows = await mySubscriptions(c.get("user").sub);
    return c.json({ subscriptions: rows.map((r) => ({ id: String(r.id), status: String(r.status), priceUgx: Number(r.price_ugx), currentPeriodEnd: String(r.current_period_end), autoRenew: Number(r.auto_renew) === 1, tierName: String(r.tier_name), channel: { id: String(r.channel_id), handle: String(r.handle), displayName: String(r.display_name) } })) });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.delete("/subscriptions/:id", requireAuth, async (c) => {
  try {
    await cancelSubscription(c.get("user").sub, c.req.param("id") as string);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/posts/:id/unlock", requireAuth, async (c) => {
  try {
    await unlockPost(c.get("user").sub, c.req.param("id") as string);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

channelsRoutes.post("/channels/:id/tip", requireAuth, async (c) => {
  try {
    const body = z.object({ amountUgx: z.number().optional(), postId: z.string().max(80).nullable().optional(), gift: z.string().max(40).nullable().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new ChannelsError("invalid_body", "Check the amount.", 400);
    const r = await sendTip(c.get("user").sub, c.req.param("id") as string, { amountUgx: body.data.amountUgx ?? 0, postId: body.data.postId, gift: body.data.gift });
    return c.json(r, 201);
  } catch (err) {
    return fail(c, err);
  }
});
