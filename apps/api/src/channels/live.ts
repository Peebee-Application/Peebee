import { randomInt } from "node:crypto";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { consume } from "../lib/ratelimit.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { endLiveInput, startLiveInput, VideoRequestError } from "../video/service.js";
import { ChannelsError, requireChannels, sqlTime, type Row } from "./common.js";
import { createPost, containsBlockedWord } from "./posts.js";
import { driverOnJob, resolveIdentity } from "./publishers.js";
import { eventsReady, sweepEvents, syncEvent } from "./events.js";
import { endStoreCameraLive } from "../marketplace/store-live-sync.js";
import type { ChannelsConfig } from "@peebee/shared";

/**
 * Going live from a phone. A host opens the camera in the app, Peebee asks the video provider for a live input,
 * the phone sends its camera straight to it, and viewers watch the same stream in the Spotlight. Viewers and the
 * host's helper device poll `liveState` every few seconds for the viewer count and comments; there is no
 * always-open connection to keep. The host's private publish address never reaches a viewer.
 */

/** A camera stream only. Once migration 0144 is in, broadcasts and premieres share the table and are told apart by `kind`. */
const cameraOnly = async (alias = "") => ((await hasColumn("live_sessions", "kind")) ? `AND ${alias}kind = 'camera'` : "");

export type LiveRow = Row & {
  id: string; post_id: string; host_id: string; publisher_type: string; publisher_id: string; title: string | null; provider: string;
  external_id: string | null; publish_url: string | null; hls_url: string | null; status: "ready" | "live" | "ended";
  helper_code: string | null; helper_code_expires_at: string | null; viewer_peak: number; comment_count: number; host_seen_at: string | null;
  started_at: string | null; max_ends_at: string | null; ended_at: string | null; created_at: string;
};

/** A viewer counts while their last heartbeat is this recent. */
const VIEWER_WINDOW_MS = 35_000;
/** A host who stops checking in for this long has lost their connection; the stream is closed. */
const HOST_GONE_SECONDS = 180;
/** A stream that was set up but never went live is cleared after this. */
const READY_EXPIRES_MINUTES = 15;

export async function liveReady(): Promise<boolean> {
  return (await hasTable("live_sessions")) && (await hasTable("live_comments"));
}

export async function requireLive(): Promise<ChannelsConfig> {
  const cfg = await requireChannels();
  if (!cfg.live.enabled || !(await liveReady())) throw new ChannelsError("live_unavailable", "Going live is not available yet.", 503);
  return cfg;
}

/** Chat and helper tools serve camera streams and also broadcasts and premieres, so any of those switches opens them. */
async function requireLiveAny(): Promise<ChannelsConfig> {
  const cfg = await requireChannels();
  if (!(cfg.live.enabled || cfg.live.broadcastsEnabled || cfg.live.premieresEnabled) || !(await liveReady())) throw new ChannelsError("live_unavailable", "Live is not available yet.", 503);
  return cfg;
}

export async function getLive(id: string): Promise<LiveRow | null> {
  const res = await db.execute({ sql: "SELECT * FROM live_sessions WHERE id = ?", args: [id] });
  return (res.rows[0] as unknown as LiveRow | undefined) ?? null;
}

/** A viewer only knows the post they are watching, so a stream can be found by its own id or by its post's id. */
export async function resolveLive(ref: string): Promise<LiveRow | null> {
  const direct = await getLive(ref);
  if (direct) return direct;
  const visible = (await hasColumn("live_sessions", "kind")) ? "(status != 'ready' OR kind != 'camera')" : "status != 'ready'";
  const res = await db.execute({ sql: `SELECT * FROM live_sessions WHERE post_id = ? AND ${visible} ORDER BY created_at DESC LIMIT 1`, args: [ref] });
  return (res.rows[0] as unknown as LiveRow | undefined) ?? null;
}

export type LiveRole = "host" | "helper" | "viewer";

async function roleOf(session: LiveRow, userId: string | null): Promise<LiveRole> {
  if (!userId) return "viewer";
  if (session.host_id === userId) return "host";
  const res = await db.execute({ sql: "SELECT 1 FROM live_helpers WHERE session_id = ? AND user_id = ?", args: [session.id, userId] });
  return res.rows.length ? "helper" : "viewer";
}

/** "Kato Peter Ssebunya" → "Kato S." */
function shortName(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Viewer";
  if (parts.length === 1) return parts[0]!.slice(0, 20);
  return `${parts[0]!.slice(0, 16)} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

const seconds = (value: string | null) => (value ? Math.max(0, Math.round((Date.now() - new Date(`${value.replace(" ", "T")}Z`).getTime()) / 1000)) : 0);

/** What the host's own devices need (never sent to viewers). */
function hostView(s: LiveRow) {
  return {
    id: s.id, postId: s.post_id, status: s.status, title: s.title, provider: s.provider, publishUrl: s.publish_url,
    mock: s.provider === "mock", startedAt: s.started_at, endsAt: s.max_ends_at,
  };
}

/** Starts a stream: asks the provider for a live input and keeps a hidden draft post until the camera is connected. */
export async function startLive(user: { sub: string; role: string }, input: { publisherType: string; publisherId: string; title?: string }) {
  const cfg = await requireLive();
  const identity = await resolveIdentity(user, input.publisherType, input.publisherId);
  if (!identity) throw new ChannelsError("not_your_identity", "You cannot go live as that.", 403);
  if (identity.type === "personal" ? !cfg.publishing.personalPosting : !cfg.publishing.publishers.includes(identity.type)) {
    throw new ChannelsError("publisher_unavailable", "Going live is not available for this yet.", 403);
  }
  if (identity.type === "driver" && cfg.publishing.driverBlockWhileOnJob && (await driverOnJob(user.sub))) {
    throw new ChannelsError("on_a_job", "Finish your current trip or delivery first.", 409);
  }
  if (cfg.live.requireVerifiedPublisher && !identity.verified) throw new ChannelsError("not_verified", "Only verified accounts can go live for now.", 403);
  if (cfg.moderation.mode === "before") throw new ChannelsError("live_needs_review", "Going live is not available while every post needs approval first.", 403);
  if (cfg.live.minFollowers > 0 && identity.type === "channel") {
    const res = await db.execute({ sql: "SELECT COUNT(*) AS n FROM channel_follows WHERE channel_id = ?", args: [identity.id] });
    if (Number((res.rows[0] as Row).n) < cfg.live.minFollowers) {
      throw new ChannelsError("not_enough_followers", `You need ${cfg.live.minFollowers} followers to go live.`, 403);
    }
  }
  const title = (input.title ?? "").trim().slice(0, 140);
  if (title && containsBlockedWord(title, cfg)) throw new ChannelsError("blocked_words", "Please change the title and try again.", 400);

  const today = await db.execute({ sql: `SELECT COUNT(*) AS n FROM live_sessions WHERE publisher_type = ? AND publisher_id = ? AND created_at > datetime('now', '-1 day') ${await cameraOnly()}`, args: [identity.type, identity.id] });
  if (Number((today.rows[0] as Row).n) >= cfg.live.maxPerDay) throw new ChannelsError("daily_live_limit", "You have gone live as many times as allowed today.", 429);

  // A host has one stream at a time: starting again closes the earlier one.
  const open = (await db.execute({ sql: `SELECT id FROM live_sessions WHERE host_id = ? AND status != 'ended' ${await cameraOnly()}`, args: [user.sub] })).rows as unknown as Array<{ id: string }>;
  for (const o of open) await closeLive(o.id, "replaced");

  let provider;
  try {
    provider = await startLiveInput({ title: title || undefined, maxDurationSeconds: cfg.live.maxMinutes * 60 });
  } catch (err) {
    if (err instanceof VideoRequestError) throw new ChannelsError(err.code, err.clientMessage, err.status === 503 ? 503 : 502);
    throw err;
  }

  const post = await createPost(user, {
    publisherType: identity.type, publisherId: identity.id, type: "live", caption: title || "Live now", liveUrl: provider.live.hlsUrl,
    toSpotlight: cfg.live.showInSpotlight, toChannel: identity.type === "channel", publish: false,
  });
  if (provider.live.posterUrl) await db.execute({ sql: "UPDATE posts SET cover_url = ? WHERE id = ?", args: [provider.live.posterUrl, post.id] });

  const id = newId("liv");
  await db.execute({
    sql: `INSERT INTO live_sessions (id, post_id, host_id, publisher_type, publisher_id, title, provider, external_id, publish_url, hls_url, status, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    args: [id, post.id, user.sub, identity.type, identity.id, title || null, provider.provider, provider.live.externalId, provider.live.publishUrl, provider.live.hlsUrl, await getPlatformEnvironment()],
  });
  return hostView((await getLive(id))!);
}

/** The camera is connected: the stream goes public. */
export async function goLive(user: { sub: string }, id: string) {
  const cfg = await requireLive();
  const s = await getLive(id);
  if (!s || s.host_id !== user.sub) throw new ChannelsError("not_found", "That stream was not found.", 404);
  if (s.status === "ended") throw new ChannelsError("live_ended", "This stream has ended.", 409);
  if (s.status === "ready") {
    const endsAt = sqlTime(new Date(Date.now() + cfg.live.maxMinutes * 60_000));
    await db.execute({ sql: "UPDATE live_sessions SET status = 'live', started_at = datetime('now'), host_seen_at = datetime('now'), max_ends_at = ? WHERE id = ?", args: [endsAt, id] });
    await db.execute({
      sql: "UPDATE posts SET status = 'published', published_at = datetime('now'), live_status = 'live', updated_at = datetime('now') WHERE id = ?",
      args: [s.post_id],
    });
  }
  return hostView((await getLive(id))!);
}

/** Ends a stream (the host's choice, the time limit, or a lost connection) and switches the provider's input off. */
async function closeLive(id: string, _why: string): Promise<LiveRow | null> {
  const s = await getLive(id);
  if (!s || s.status === "ended") return s;
  await db.execute({ sql: "UPDATE live_sessions SET status = 'ended', ended_at = datetime('now'), helper_code = NULL WHERE id = ?", args: [id] });
  if (s.status === "ready") {
    // Never went live: the draft post goes with it.
    await db.execute({ sql: "DELETE FROM posts WHERE id = ? AND status = 'draft'", args: [s.post_id] });
  } else {
    await db.execute({ sql: "UPDATE posts SET live_status = 'ended', updated_at = datetime('now') WHERE id = ?", args: [s.post_id] });
  }
  await db.execute({ sql: "DELETE FROM live_viewers WHERE session_id = ?", args: [id] });
  if (s.external_id) await endLiveInput(s.provider, s.external_id);
  // A store's camera live also has a store listing (pinned items, the store's "live" flag) that goes off with it.
  if (s.publisher_type === "store") await endStoreCameraLive(s.id, s.publisher_id).catch((err) => console.error("could not end store live:", err));
  return getLive(id);
}

export async function endLive(user: { sub: string }, id: string) {
  await requireChannels();
  const s = await getLive(id);
  if (!s || s.host_id !== user.sub) throw new ChannelsError("not_found", "That stream was not found.", 404);
  const ended = (await closeLive(id, "host"))!;
  const at = (v: string | null) => (v ? new Date(`${v.replace(" ", "T")}Z`).getTime() : 0);
  const duration = ended.started_at && ended.ended_at ? Math.max(0, Math.round((at(ended.ended_at) - at(ended.started_at)) / 1000)) : 0;
  return { status: "ended" as const, seconds: duration, peakViewers: Number(ended.viewer_peak), comments: Number(ended.comment_count) };
}

/** The host's open stream, so a second device (or a reopened app) can pick it up. */
export async function myOpenLive(userId: string) {
  if (!(await liveReady())) return null;
  const res = await db.execute({ sql: `SELECT * FROM live_sessions WHERE host_id = ? AND status != 'ended' ${await cameraOnly()} ORDER BY created_at DESC LIMIT 1`, args: [userId] });
  const s = res.rows[0] as unknown as LiveRow | undefined;
  return s ? hostView(s) : null;
}

type CommentRow = { id: number; user_id: string; author: string; body: string; by_host: number; pinned: number; hidden: number; created_at: string };
const commentView = (c: CommentRow, withHidden: boolean) => ({
  id: c.id, author: c.author, body: c.body, byHost: !!c.by_host, pinned: !!c.pinned, ...(withHidden ? { hidden: !!c.hidden } : {}), at: c.created_at,
});

/**
 * What a poll returns: the stream's status, the viewer count, and comments since `after`. The host and helpers
 * also see hidden comments; the host's check-in keeps the stream open.
 */
export async function liveState(ref: string, viewer: { userId: string | null; key: string }, opts: { after: number; beat: boolean }) {
  const cfg = await requireChannels();
  let s = await resolveLive(ref);
  // A broadcast or premiere is visible before it starts (its countdown page has a chat room waiting); a camera stream is not.
  const isEvent = !!s && (await eventsReady()) && String((s as Row).kind ?? "camera") !== "camera";
  if (s && isEvent) s = (await syncEvent(s as never)) as unknown as LiveRow;
  if (!s || (s.status === "ready" && !isEvent)) throw new ChannelsError("not_found", "That stream was not found.", 404);
  const id = s.id;
  const role = await roleOf(s, viewer.userId);
  const staff = role !== "viewer";
  const now = Date.now();

  if (s.status === "live") {
    if (role === "host") await db.execute({ sql: "UPDATE live_sessions SET host_seen_at = datetime('now') WHERE id = ?", args: [id] });
    else if (opts.beat) await db.execute({ sql: "INSERT INTO live_viewers (session_id, viewer_key, last_seen) VALUES (?, ?, ?) ON CONFLICT(session_id, viewer_key) DO UPDATE SET last_seen = excluded.last_seen", args: [id, viewer.key, now] });
  }
  const count = s.status === "live" ? Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM live_viewers WHERE session_id = ? AND last_seen > ?", args: [id, now - VIEWER_WINDOW_MS] })).rows[0] as Row).n) : 0;
  let peak = Number(s.viewer_peak);
  if (count > peak) {
    peak = count;
    await db.execute({ sql: "UPDATE live_sessions SET viewer_peak = ? WHERE id = ? AND viewer_peak < ?", args: [count, id, count] });
  }

  const hiddenClause = staff ? "" : "AND hidden = 0";
  let comments: CommentRow[];
  if (opts.after > 0) {
    comments = (await db.execute({ sql: `SELECT * FROM live_comments WHERE session_id = ? AND id > ? ${hiddenClause} ORDER BY id ASC LIMIT 100`, args: [id, opts.after] })).rows as unknown as CommentRow[];
  } else {
    comments = ((await db.execute({ sql: `SELECT * FROM live_comments WHERE session_id = ? ${hiddenClause} ORDER BY id DESC LIMIT 50`, args: [id] })).rows as unknown as CommentRow[]).reverse();
  }
  const hiddenIds = ((await db.execute({ sql: "SELECT id FROM live_comments WHERE session_id = ? AND hidden = 1 ORDER BY id DESC LIMIT 100", args: [id] })).rows as unknown as Array<{ id: number }>).map((r) => Number(r.id));
  const pinnedRow = (await db.execute({ sql: "SELECT * FROM live_comments WHERE session_id = ? AND pinned = 1 AND hidden = 0 ORDER BY id DESC LIMIT 1", args: [id] })).rows[0] as unknown as CommentRow | undefined;

  return {
    id, status: (isEvent && s.status === "ready" ? "scheduled" : s.status) as "scheduled" | "live" | "ended", title: s.title, role,
    viewers: staff || cfg.live.showViewerCount ? count : null,
    peakViewers: staff ? peak : null,
    startedAt: s.started_at, endsAt: s.max_ends_at,
    commentsEnabled: cfg.live.commentsEnabled,
    maxCommentChars: cfg.live.maxCommentChars,
    comments: comments.map((c) => commentView(c, staff)),
    cursor: comments.length ? comments[comments.length - 1]!.id : opts.after,
    hiddenIds,
    pinned: pinnedRow ? commentView(pinnedRow, false) : null,
    canModerate: staff,
  };
}

export async function postLiveComment(user: { sub: string; name: string }, ref: string, rawBody: string) {
  const cfg = await requireLiveAny();
  if (!cfg.live.commentsEnabled) throw new ChannelsError("comments_off", "Comments are off for live streams.", 403);
  const s = await resolveLive(ref);
  if (!s || s.status !== "live") throw new ChannelsError("live_ended", "This stream is not live.", 409);
  const id = s.id;
  const body = rawBody.replace(/\s+/g, " ").trim();
  if (!body) throw new ChannelsError("empty_comment", "Write something first.", 400);
  if (body.length > cfg.live.maxCommentChars) throw new ChannelsError("comment_too_long", `Comments can be up to ${cfg.live.maxCommentChars} characters.`, 400);
  if (containsBlockedWord(body, cfg)) throw new ChannelsError("blocked_words", "That comment cannot be posted.", 400);
  const role = await roleOf(s, user.sub);
  if (role === "viewer" && cfg.live.commentCooldownSeconds > 0) {
    const gate = await consume(`live_comment:${id}:${user.sub}`, 1, cfg.live.commentCooldownSeconds);
    if (!gate.allowed) throw new ChannelsError("slow_down", "Slow down a little.", 429);
  }
  const res = await db.execute({
    sql: "INSERT INTO live_comments (session_id, user_id, author, body, by_host) VALUES (?, ?, ?, ?, ?)",
    args: [id, user.sub, role === "viewer" ? shortName(user.name) : "Host", body, role === "viewer" ? 0 : 1],
  });
  await db.execute({ sql: "UPDATE live_sessions SET comment_count = comment_count + 1 WHERE id = ?", args: [id] });
  return { id: Number(res.lastInsertRowid) };
}

/** Hide or pin a comment. The host and any helper can. */
export async function moderateLiveComment(user: { sub: string }, id: string, commentId: number, action: "hide" | "pin" | "unpin") {
  await requireChannels();
  const s = await getLive(id);
  if (!s || s.status === "ended") throw new ChannelsError("live_ended", "This stream has ended.", 409);
  if ((await roleOf(s, user.sub)) === "viewer") throw new ChannelsError("not_allowed", "Only the host and helpers can do that.", 403);
  const c = (await db.execute({ sql: "SELECT id FROM live_comments WHERE id = ? AND session_id = ?", args: [commentId, id] })).rows[0];
  if (!c) throw new ChannelsError("not_found", "That comment was not found.", 404);
  if (action === "hide") await db.execute({ sql: "UPDATE live_comments SET hidden = 1, pinned = 0 WHERE id = ?", args: [commentId] });
  else if (action === "pin") {
    await db.execute({ sql: "UPDATE live_comments SET pinned = 0 WHERE session_id = ?", args: [id] });
    await db.execute({ sql: "UPDATE live_comments SET pinned = 1 WHERE id = ?", args: [commentId] });
  } else await db.execute({ sql: "UPDATE live_comments SET pinned = 0 WHERE id = ?", args: [commentId] });
  return { ok: true as const };
}

/** A short code the host can read out to someone who should help run the stream from their own phone. */
export async function createHelperCode(user: { sub: string }, id: string) {
  const cfg = await requireLiveAny();
  if (!cfg.live.helperEnabled) throw new ChannelsError("helper_off", "Helper devices are not available.", 403);
  const s = await getLive(id);
  if (!s || s.host_id !== user.sub || s.status === "ended") throw new ChannelsError("not_found", "That stream was not found.", 404);
  let code = "";
  for (let i = 0; i < 8; i++) {
    const candidate = String(randomInt(100000, 1000000));
    const taken = await db.execute({ sql: "SELECT 1 FROM live_sessions WHERE helper_code = ? AND status != 'ended'", args: [candidate] });
    if (!taken.rows.length) { code = candidate; break; }
  }
  if (!code) throw new ChannelsError("try_again", "Try again in a moment.", 503);
  const expires = sqlTime(new Date(Date.now() + cfg.live.helperCodeMinutes * 60_000));
  await db.execute({ sql: "UPDATE live_sessions SET helper_code = ?, helper_code_expires_at = ? WHERE id = ?", args: [code, expires, id] });
  return { code, expiresAt: expires };
}

export async function joinAsHelper(user: { sub: string }, rawCode: string) {
  const cfg = await requireLiveAny();
  if (!cfg.live.helperEnabled) throw new ChannelsError("helper_off", "Helper devices are not available.", 403);
  const code = rawCode.replace(/\D/g, "");
  const gate = await consume(`live_helper:${user.sub}`, 10, 600);
  if (!gate.allowed) throw new ChannelsError("slow_down", "Too many tries. Wait a few minutes.", 429);
  const res = await db.execute({ sql: "SELECT * FROM live_sessions WHERE helper_code = ? AND status = 'live' AND helper_code_expires_at > datetime('now')", args: [code] });
  const s = res.rows[0] as unknown as LiveRow | undefined;
  if (!s || code.length !== 6) throw new ChannelsError("bad_code", "That code is not right, or it has run out.", 404);
  await db.execute({ sql: "INSERT OR IGNORE INTO live_helpers (session_id, user_id) VALUES (?, ?)", args: [s.id, user.sub] });
  return { id: s.id, title: s.title };
}

/** The streams this person can help with: their own, and any they joined. */
export async function helperStreams(userId: string) {
  if (!(await liveReady())) return [];
  const rows = (await db.execute({
    sql: `SELECT s.* FROM live_sessions s WHERE s.status = 'live' AND (s.host_id = ? OR s.id IN (SELECT session_id FROM live_helpers WHERE user_id = ?)) ORDER BY s.started_at DESC`,
    args: [userId, userId],
  })).rows as unknown as LiveRow[];
  return rows.map((s) => ({ id: s.id, title: s.title, mine: s.host_id === userId }));
}

/** Cron: ends streams that ran out of time, lost their host, or were never started. */
export async function sweepLive(): Promise<number> {
  if (!(await liveReady())) return 0;
  const stale = (await db.execute({
    sql: `SELECT id FROM live_sessions WHERE ((status = 'live' AND (max_ends_at < datetime('now') OR host_seen_at < datetime('now', ?)))
             OR (status = 'ready' AND created_at < datetime('now', ?))) ${await cameraOnly()}`,
    args: [`-${HOST_GONE_SECONDS} seconds`, `-${READY_EXPIRES_MINUTES} minutes`],
  })).rows as unknown as Array<{ id: string }>;
  for (const s of stale) await closeLive(s.id, "sweep");
  await db.execute({ sql: "DELETE FROM live_viewers WHERE last_seen < ?", args: [Date.now() - 10 * 60_000] });
  return stale.length + (await sweepEvents());
}
