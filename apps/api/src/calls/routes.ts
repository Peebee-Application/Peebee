/**
 * Voice calls between any two account holders — customer, rider, or
 * restaurant owner (a restaurant owner is a normal customer-role account,
 * see ../restaurants/routes.ts, so no role check is needed beyond being
 * signed in). Signaling (ring/accept/decline/end) is polled, same pattern
 * as chat threads elsewhere in this app — no separate WebSocket/Durable
 * Object infra. The actual audio path depends on the admin-selected
 * provider (../lib/settings.ts getActiveCallProvider): "mock" runs this
 * entire flow with no real audio (safe default, useful for UI testing),
 * "cloudflare" proxies WebRTC negotiation to Realtime SFU (../calls/
 * cloudflare.ts), "twilio"/"agora" are selectable but not implemented yet.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { notifyUser } from "../lib/webpush.js";
import { isDemoCarDriver, sandboxCarDemoOn } from "../car/sandbox-demo.js";
import { getActiveCallProvider, getPlatformEnvironment } from "../lib/settings.js";
import {
  createCallSession,
  nameLocalAudioTrack,
  pullRemoteAudioTrack,
  renegotiateCallSession,
  CloudflareCallsNotConfiguredError,
  CloudflareCallsApiError,
  type SdpDescription,
} from "./cloudflare.js";
import { resolveP2PIceServers } from "./webrtc-p2p.js";
import { getLearnSettings } from "../education/settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";

export const callRoutes = new Hono();
callRoutes.use("*", requireAuth);

type Row = Record<string, unknown>;

async function loadOwnedCall(id: string, userId: string): Promise<Row | undefined> {
  const res = await db.execute({ sql: "SELECT * FROM calls WHERE id = ?", args: [id] });
  const call = res.rows[0] as Row | undefined;
  if (!call) return undefined;
  if (call.caller_id !== userId && call.callee_id !== userId) return undefined;
  return call;
}

const startSchema = z.object({
  calleeId: z.string().min(1),
  orderId: z.string().optional(),
  restaurantId: z.string().optional(),
  schoolId: z.string().optional(),
});

/** Places a call — creates the ringing row and pushes a notification to
 * the callee. The caller starts polling GET /calls/:id right away for the
 * callee's accept/decline; the callee's app polls GET /calls/incoming to
 * discover it (same shape as chat's unread-thread polling). */
callRoutes.post("/calls", async (c) => {
  const user = c.get("user");
  const parsed = startSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  if (d.calleeId === user.sub) return c.json({ error: "cannot_call_self" }, 400);

  // A call from a school conversation: Admin can switch these off, and it must be between the school's owner and the person
  // who messaged it. Before the school-chat migration is applied the call still rings, it just isn't linked to the school.
  let schoolId: string | null = null;
  if (d.schoolId) {
    if (!(await getLearnSettings()).callsEnabled) return c.json({ error: "calls_off", message: "Calls are switched off right now." }, 503);
    const school = (await db.execute({ sql: "SELECT id, owner_id FROM edu_schools WHERE id = ?", args: [d.schoolId] })).rows[0] as Row | undefined;
    if (!school || (school.owner_id !== user.sub && school.owner_id !== d.calleeId)) return c.json({ error: "not_found" }, 404);
    if ((await hasColumn("calls", "school_id")) && (await hasTable("school_chat_messages"))) schoolId = d.schoolId;
  }
  const environment = await getPlatformEnvironment();
  const id = newId("call");
  // A sandbox demo car driver has no phone to ring: it picks up at once, on a call with no audio.
  if (isDemoCarDriver(d.calleeId) && (await sandboxCarDemoOn())) {
    await db.execute({
      sql: `INSERT INTO calls (id, caller_id, callee_id, order_id, restaurant_id, provider, status, environment, answered_at)
            VALUES (?, ?, ?, ?, ?, 'mock', 'accepted', ?, datetime('now'))`,
      args: [id, user.sub, d.calleeId, d.orderId ?? null, d.restaurantId ?? null, environment],
    });
    return c.json({ call: (await db.execute({ sql: "SELECT * FROM calls WHERE id = ?", args: [id] })).rows[0] }, 201);
  }
  const provider = await getActiveCallProvider();
  await db.execute({
    sql: `INSERT INTO calls (id, caller_id, callee_id, order_id, restaurant_id, provider, status, environment)
          VALUES (?, ?, ?, ?, ?, ?, 'ringing', ?)`,
    args: [id, user.sub, d.calleeId, d.orderId ?? null, d.restaurantId ?? null, provider, environment],
  });
  if (schoolId) await db.execute({ sql: "UPDATE calls SET school_id = ? WHERE id = ?", args: [schoolId, id] });

  await notifyUser(d.calleeId, {
    title: `${user.name ?? "Someone"} is calling`,
    body: "Tap to answer",
    tag: `call-${id}`,
    url: "/",
  }).catch(() => {});

  const res = await db.execute({ sql: "SELECT * FROM calls WHERE id = ?", args: [id] });
  return c.json({ call: res.rows[0] }, 201);
});

/** Any call currently ringing for me — the callee-side poll that surfaces
 * an incoming-call screen. At most one is meaningful at a time; returns
 * the oldest if somehow more than one is ringing. */
callRoutes.get("/calls/incoming", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT c.*, u.name as caller_name FROM calls c JOIN users u ON u.id = c.caller_id
          WHERE c.callee_id = ? AND c.status = 'ringing' ORDER BY c.created_at ASC LIMIT 1`,
    args: [user.sub],
  });
  return c.json({ call: res.rows[0] ?? null });
});

/** The ICE server list any client needs to place/answer a "webrtc_p2p"
 * call — free public STUN always, plus an admin-configured TURN fallback
 * if one's been saved (see ../calls/webrtc-p2p.ts). Not provider-gated:
 * harmless to fetch regardless of the currently active provider. */
callRoutes.get("/calls/ice-servers", async (c) => {
  const iceServers = await resolveP2PIceServers();
  return c.json({ iceServers });
});

callRoutes.get("/calls/:id", async (c) => {
  const user = c.get("user");
  const call = await loadOwnedCall(c.req.param("id"), user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  return c.json({ call });
});

callRoutes.post("/calls/:id/accept", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const call = await loadOwnedCall(id, user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  if (call.callee_id !== user.sub) return c.json({ error: "forbidden" }, 403);
  if (call.status !== "ringing") return c.json({ error: "not_ringing", message: "This call is no longer ringing" }, 409);

  await db.execute({
    sql: "UPDATE calls SET status = 'accepted', answered_at = datetime('now') WHERE id = ?",
    args: [id],
  });
  const res = await db.execute({ sql: "SELECT * FROM calls WHERE id = ?", args: [id] });
  return c.json({ call: res.rows[0] });
});

const endSchema = z.object({
  // "declined": callee rejected while still ringing. "missed": caller gave
  // up waiting. "ended": either side hung up an accepted call.
  reason: z.enum(["declined", "missed", "ended"]),
});

callRoutes.post("/calls/:id/end", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const call = await loadOwnedCall(id, user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  if (call.status === "ended" || call.status === "declined" || call.status === "missed" || call.status === "failed") {
    const res = await db.execute({ sql: "SELECT * FROM calls WHERE id = ?", args: [id] });
    return c.json({ call: res.rows[0] });
  }
  const parsed = endSchema.safeParse(await c.req.json().catch(() => ({})));
  const reason = parsed.success ? parsed.data.reason : "ended";
  const status = call.status === "ringing" ? (reason === "declined" ? "declined" : "missed") : "ended";

  const durationExpr =
    status === "ended"
      ? ", duration_seconds = CAST((julianday('now') - julianday(answered_at)) * 86400 AS INTEGER)"
      : "";
  await db.execute({
    sql: `UPDATE calls SET status = ?, ended_at = datetime('now')${durationExpr} WHERE id = ?`,
    args: [status, id],
  });
  const res = await db.execute({ sql: "SELECT * FROM calls WHERE id = ?", args: [id] });
  const updated = res.rows[0] as Row;
  await logCallToChat(updated, status, updated.duration_seconds as number | null).catch((err) =>
    console.error("Failed to log call to chat:", err),
  );
  return c.json({ call: updated });
});

function formatCallDuration(seconds: number | null): string {
  const s = Math.max(0, seconds ?? 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}

/**
 * Drops a WhatsApp-style call-log entry ("Missed call", "Declined call",
 * "Call · 3m 12s") into whichever chat thread this call's pair maps to —
 * order-based customer<->rider chat, or restaurant<->customer chat — so
 * there's some record of a call in the conversation itself, not just the
 * ephemeral ring UI. See ../db/migrations/0043_call_log_messages.sql for
 * the `type = 'call'` + call_id/call_status/call_duration_seconds columns
 * this writes. Best-effort: a pairing that can't be resolved to a known
 * customer/rider or customer/restaurant-owner (e.g. two admins calling
 * each other) is silently skipped rather than guessing.
 */
async function logCallToChat(call: Row, status: string, durationSeconds: number | null): Promise<void> {
  if (status !== "declined" && status !== "missed" && status !== "ended") return;
  const body =
    status === "declined" ? "Declined call" : status === "missed" ? "Missed call" : `Call · ${formatCallDuration(durationSeconds)}`;

  const callerId = call.caller_id as string;
  const calleeId = call.callee_id as string;
  const messageId = newId("msg");

  const restaurantId = call.restaurant_id as string | null;
  const orderId = call.order_id as string | null;
  const callId = call.id as string;
  const schoolId = (call.school_id as string | null | undefined) ?? null;

  if (schoolId) {
    const school = (await db.execute({ sql: "SELECT owner_id FROM edu_schools WHERE id = ?", args: [schoolId] })).rows[0] as Row | undefined;
    const ownerId = school?.owner_id as string | undefined;
    if (!ownerId) return;
    const customerId = callerId === ownerId ? calleeId : callerId;
    await db.execute({
      sql: `INSERT INTO school_chat_messages (id, school_id, customer_id, sender_role, body, type, call_id, call_status, call_duration_seconds)
            VALUES (?, ?, ?, ?, ?, 'call', ?, ?, ?)`,
      args: [messageId, schoolId, customerId, callerId === ownerId ? "school" : "customer", body, callId, status, durationSeconds],
    });
    return;
  }

  if (restaurantId) {
    const restaurantRes = await db.execute({
      sql: "SELECT owner_id FROM restaurants WHERE id = ?",
      args: [restaurantId],
    });
    const ownerId = (restaurantRes.rows[0] as Row | undefined)?.owner_id as string | undefined;
    if (!ownerId) return;
    const customerId = callerId === ownerId ? calleeId : callerId;
    const senderRole = callerId === ownerId ? "restaurant" : "customer";
    await db.execute({
      sql: `INSERT INTO restaurant_chat_messages (id, restaurant_id, customer_id, sender_role, body, type, call_id, call_status, call_duration_seconds)
            VALUES (?, ?, ?, ?, ?, 'call', ?, ?, ?)`,
      args: [messageId, restaurantId, customerId, senderRole, body, callId, status, durationSeconds],
    });
    return;
  }

  const usersRes = await db.execute({ sql: "SELECT id, role FROM users WHERE id IN (?, ?)", args: [callerId, calleeId] });
  const rolesById = new Map((usersRes.rows as Row[]).map((u) => [u.id as string, u.role as string]));
  const customerId =
    rolesById.get(callerId) === "customer" ? callerId : rolesById.get(calleeId) === "customer" ? calleeId : null;
  const riderId = rolesById.get(callerId) === "rider" ? callerId : rolesById.get(calleeId) === "rider" ? calleeId : null;
  if (!customerId) return;

  await db.execute({
    sql: `INSERT INTO chat_messages (id, order_id, sender_id, sender_role, body, type, customer_id, rider_id, call_id, call_status, call_duration_seconds)
          VALUES (?, ?, ?, ?, ?, 'call', ?, ?, ?, ?, ?)`,
    args: [
      messageId,
      orderId,
      callerId,
      rolesById.get(callerId) ?? "customer",
      body,
      customerId,
      riderId,
      callId,
      status,
      durationSeconds,
    ],
  });
}

// ---------------------------------------------------------------------------
// Cloudflare Realtime negotiation proxy — only meaningful when the active
// provider is "cloudflare"; keeps the App Secret server-side (see
// ../calls/cloudflare.ts). No-ops (with a clear error) for every other
// provider so the client can treat this uniformly and just show a friendly
// message when a provider isn't actually wired up yet.
// ---------------------------------------------------------------------------

function callsProviderError(err: unknown): { error: string; message: string } {
  if (err instanceof CloudflareCallsNotConfiguredError) {
    return { error: "provider_not_configured", message: "Calling isn't set up yet — ask an admin to add call credentials" };
  }
  if (err instanceof CloudflareCallsApiError) {
    return { error: "provider_error", message: "Couldn't connect the call. Please try again." };
  }
  return { error: "provider_error", message: "Couldn't connect the call. Please try again." };
}

const publishSchema = z.object({ sdp: z.string().min(1) });

/** Publishes this participant's mic into a fresh Realtime session and
 * records the session id against whichever side of the call they're on. */
callRoutes.post("/calls/:id/publish", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const call = await loadOwnedCall(id, user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  if (call.provider !== "cloudflare") return c.json({ error: "wrong_provider" }, 400);
  const parsed = publishSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  try {
    const offer: SdpDescription = { type: "offer", sdp: parsed.data.sdp };
    const { sessionId, answer } = await createCallSession(offer);
    // Assume a fresh single-audio-track offer's one m-line is mid "0" —
    // true for the client wiring this ships with (one addTrack call
    // before createOffer); if a future client adds other tracks first,
    // this needs to read the actual mid back out of the offer instead.
    await nameLocalAudioTrack(sessionId, "0").catch(() => {});

    const column = call.caller_id === user.sub ? "caller_session_id" : "callee_session_id";
    await db.execute({ sql: `UPDATE calls SET ${column} = ? WHERE id = ?`, args: [sessionId, id] });

    return c.json({ sessionId, answer });
  } catch (err) {
    return c.json(callsProviderError(err), 502);
  }
});

/** Pulls the other participant's audio into my session — call once both
 * sides have published (poll GET /calls/:id until both *_session_id are
 * set). May come back with a fresh offer that needs answering via
 * /renegotiate below. */
callRoutes.post("/calls/:id/pull-remote", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const call = await loadOwnedCall(id, user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  if (call.provider !== "cloudflare") return c.json({ error: "wrong_provider" }, 400);

  const mySessionId = call.caller_id === user.sub ? call.caller_session_id : call.callee_session_id;
  const theirSessionId = call.caller_id === user.sub ? call.callee_session_id : call.caller_session_id;
  if (!mySessionId || !theirSessionId) {
    return c.json({ error: "not_ready", message: "Both sides need to publish before pulling audio" }, 409);
  }

  try {
    const result = await pullRemoteAudioTrack(mySessionId as string, theirSessionId as string, "audio");
    return c.json(result);
  } catch (err) {
    return c.json(callsProviderError(err), 502);
  }
});

const renegotiateSchema = z.object({ sdp: z.string().min(1) });

callRoutes.post("/calls/:id/renegotiate", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const call = await loadOwnedCall(id, user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  if (call.provider !== "cloudflare") return c.json({ error: "wrong_provider" }, 400);
  const parsed = renegotiateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const mySessionId = call.caller_id === user.sub ? call.caller_session_id : call.callee_session_id;
  if (!mySessionId) return c.json({ error: "not_ready" }, 409);

  try {
    await renegotiateCallSession(mySessionId as string, { type: "answer", sdp: parsed.data.sdp });
    return c.json({ ok: true });
  } catch (err) {
    return c.json(callsProviderError(err), 502);
  }
});

// ---------------------------------------------------------------------------
// "webrtc_p2p" — direct browser-to-browser WebRTC, no media relay. Each
// side does its own ICE gathering locally (non-trickle) and posts the
// finished SDP here; the other side picks it up on its next GET /calls/:id
// poll. No server-side WebRTC involvement at all — this is just two blobs
// of text changing hands. See ../calls/webrtc-p2p.ts and
// packages/shared/src/call-engine.ts.
// ---------------------------------------------------------------------------

const sdpSchema = z.object({ sdp: z.string().min(1) });

/** Caller posts their offer once (after accept isn't needed — the callee
 * only needs it once THEY'VE accepted, but the caller can publish it as
 * soon as the call is placed; the callee simply won't look until they
 * answer the ring). */
callRoutes.post("/calls/:id/offer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const call = await loadOwnedCall(id, user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  if (call.provider !== "webrtc_p2p") return c.json({ error: "wrong_provider" }, 400);
  if (call.caller_id !== user.sub) return c.json({ error: "forbidden" }, 403);
  const parsed = sdpSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  await db.execute({ sql: "UPDATE calls SET offer_sdp = ? WHERE id = ?", args: [parsed.data.sdp, id] });
  return c.json({ ok: true });
});

/** Callee posts their answer once they've accepted and pulled the offer. */
callRoutes.post("/calls/:id/answer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const call = await loadOwnedCall(id, user.sub);
  if (!call) return c.json({ error: "not_found" }, 404);
  if (call.provider !== "webrtc_p2p") return c.json({ error: "wrong_provider" }, 400);
  if (call.callee_id !== user.sub) return c.json({ error: "forbidden" }, 403);
  const parsed = sdpSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  await db.execute({ sql: "UPDATE calls SET answer_sdp = ? WHERE id = ?", args: [parsed.data.sdp, id] });
  return c.json({ ok: true });
});
