import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import { db, hasPracticeDatabase } from "../db/client.js";
import { runInPractice } from "../db/practice-context.js";
import { requireAuth } from "../auth/middleware.js";
import { newId } from "../lib/ids.js";
import { randomInt } from "../lib/random.js";
import { clientIp, consume, tooManyRequests } from "../lib/ratelimit.js";
import { hasColumn, tablesExist } from "../lib/schema.js";
import { getLearnSettings } from "./settings.js";
import { syncAutopilot } from "./autopilot.js";
import { tvProRequired } from "./pro.js";
import { learnRoutes, signMediaToken } from "./learning.js";
import { body as readBody, count, fail, isResponse, notFound, one, studioReady } from "./studio.js";
import type { LearnSettings } from "@peebee/shared";

type Row = Record<string, unknown>;

/**
 * Smart-TV screens and live classroom sessions.
 *
 * A TV pairs to an educator's account. The educator runs a session and decides, item by item
 * ("cue"), what goes to the screen and what goes to the students' phones. Correct answers live
 * only in the cue on the server: a phone or the TV never receives them before the tutor reveals.
 */

// ---------------------------------------------------------------------------
// Readiness and small helpers
// ---------------------------------------------------------------------------

let liveCache: { at: number; ok: boolean } | null = null;

export async function liveReady(): Promise<boolean> {
  if (liveCache && (liveCache.ok || Date.now() - liveCache.at < 30_000)) return liveCache.ok;
  let ok = false;
  try {
    ok = await tablesExist(["tv_devices", "edu_live_sessions", "edu_live_cues", "edu_live_members", "edu_live_responses"]);
  } catch {
    ok = false;
  }
  liveCache = { at: Date.now(), ok };
  return ok;
}

export function resetLiveCache(): void {
  liveCache = null;
}

const pending = (c: Context) => c.json({ error: "classroom_upgrade_pending", message: "Live classroom is being set up. Try again shortly." }, 503);

async function ready(): Promise<boolean> {
  return (await studioReady()) && (await liveReady());
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** No 0/O, 1/I/L: a code read off a TV across a room must not be ambiguous. */
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const pairCode = () => Array.from({ length: 6 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join("");
const sessionCode = () => String(100000 + randomInt(900000));

/** The practice classes on offer: slot, the code that opens them, and who teaches. Empty when they are off or not installed. */
async function trialClasses(settings: LearnSettings): Promise<{ slot: "a" | "b"; code: string; title: string; hostName: string; stream: string | null }[]> {
  if (!settings.liveEnabled || !settings.trialClassesEnabled) return [];
  const res = await db
    .execute({
      sql: `SELECT s.id, s.title, u.name AS host_name, k.stream
            FROM edu_live_sessions s JOIN users u ON u.id = s.host_id LEFT JOIN edu_courses k ON k.id = s.course_id
            WHERE s.autopilot = 1 AND s.status = 'live' AND s.id IN ('liv_demo_a', 'liv_demo_b') ORDER BY s.id`,
      args: [],
    })
    .catch(() => ({ rows: [] as Row[] }));
  return (res.rows as Row[]).map((r) => {
    const slot = r.id === "liv_demo_a" ? "a" : "b";
    return { slot, code: slot === "a" ? settings.trialCodeA : settings.trialCodeB, title: String(r.title), hostName: String(r.host_name), stream: r.stream ? String(r.stream) : null };
  });
}

/** A fresh session code that isn't one of the reserved ones (the trial class codes), or null if the draws keep landing on them. */
export function freeSessionCode(reserved: string[], draw: () => string = sessionCode): string | null {
  for (let i = 0; i < 5; i += 1) {
    const code = draw();
    if (!reserved.includes(code)) return code;
  }
  return null;
}

const nowIso = () => new Date().toISOString();
const plusSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const sqlite = (iso: string) => iso.slice(0, 19).replace("T", " ");
const parseTime = (v: unknown): number | null => {
  if (!v) return null;
  const s = String(v);
  const t = Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t : null;
};
const json = <T,>(raw: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(raw ?? "")) as T;
  } catch {
    return fallback;
  }
};

/** "Amina Nakato" → "Amina N." Names on a shared screen are shortened. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || "Student";
}

// ---------------------------------------------------------------------------
// Cue payloads
// ---------------------------------------------------------------------------

type Target = "screen" | "phones" | "both";
const KINDS = ["slide", "lesson", "announcement", "timer", "question", "exam", "attendance"] as const;
type Kind = (typeof KINDS)[number];

/** Where each kind of item makes sense. The educator may choose any of these when pushing. */
const ALLOWED_TARGETS: Record<Kind, Target[]> = {
  slide: ["screen", "both"],
  lesson: ["screen", "phones", "both"],
  announcement: ["screen", "phones", "both"],
  timer: ["screen", "both"],
  question: ["screen", "phones", "both"],
  // On "both" the TV shows only the countdown and how many have handed in; the questions stay on the phones.
  exam: ["phones", "both"],
  attendance: ["phones", "both"],
};
const DEFAULT_TARGET: Record<Kind, Target> = { slide: "screen", lesson: "screen", announcement: "both", timer: "screen", question: "both", exam: "phones", attendance: "phones" };

const text = (max: number, min = 0) =>
  z
    .string()
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().min(min).max(max));
const httpsUrl = z.string().max(500).refine((v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}, "Use a full https:// link");

const questionShape = z
  .object({
    question: text(300, 1),
    options: z.array(text(200, 1)).min(2).max(6),
    /** null makes it a poll: there is no right answer. */
    correctIndex: z.number().int().min(0).nullable().default(null),
    explanation: text(500).default(""),
  })
  .refine((q) => q.correctIndex === null || q.correctIndex < q.options.length, { message: "correctIndex must point at one of the options" });

type Question = z.infer<typeof questionShape>;

function payloadSchema(kind: Kind, settings: LearnSettings) {
  switch (kind) {
    case "slide":
      return z.object({ title: text(120, 1), body: text(2000).default(""), imageUrl: httpsUrl.optional() });
    case "lesson":
      return z.object({ lessonId: text(80, 1) });
    case "announcement":
      return z.object({ text: text(300, 1) });
    case "timer":
      return z.object({ seconds: z.number().int().min(5).max(3600), label: text(80).default("") });
    case "question":
      return questionShape.and(z.object({ timeLimitSeconds: z.number().int().min(5).max(600).optional() }));
    case "exam":
      return z.object({
        title: text(120, 1),
        questions: z.array(questionShape.refine((q) => q.correctIndex !== null, { message: "Every exam question needs a correct answer" })).min(1).max(50),
        minutes: z.number().int().min(1).max(settings.liveMaxExamMinutes),
      });
    case "attendance":
      return z.object({}).default({});
  }
}

const cueBody = z.object({ kind: z.enum(KINDS), target: z.enum(["screen", "phones", "both"]).optional(), payload: z.record(z.string(), z.unknown()).default({}) });

// ---------------------------------------------------------------------------
// TV devices
// ---------------------------------------------------------------------------

export const tvRoutes = new Hono();

type Device = { id: string; owner_id: string | null; name: string; status: string; pair_code: string | null; pair_expires_at: string | null; trial_slot?: string | null };

/** The practice class this TV is showing, if any ("a" or "b"). */
const trialOf = (device: Device): "a" | "b" | null => (device.trial_slot === "a" || device.trial_slot === "b" ? device.trial_slot : null);

async function deviceAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const secret = header.startsWith("Device ") ? header.slice(7).trim() : "";
  if (!secret || secret.length < 32) return c.json({ error: "unauthorized", message: "This screen isn't registered." }, 401);
  const hash = await sha256(secret);
  let row = await one("SELECT * FROM tv_devices WHERE secret_hash = ?", [hash]);
  // The practice TV lives in the practice database (when there is one); its secret is not a signed token, so find it here.
  const practiceTv = !row && hasPracticeDatabase();
  if (practiceTv) row = await runInPractice(() => one("SELECT * FROM tv_devices WHERE secret_hash = ?", [hash]));
  if (!row) return c.json({ error: "unauthorized", message: "This screen isn't registered. Restart the app to pair it again." }, 401);
  c.set("device" as never, row as never);
  const proceed = async () => {
    await db.execute({ sql: "UPDATE tv_devices SET last_seen_at = datetime('now') WHERE id = ?", args: [row!.id as string] });
    await next();
  };
  if (practiceTv) await runInPractice(proceed); else await proceed();
}

const getDevice = (c: Context) => c.get("device" as never) as Device;

/** Where a phone goes to type in (or be sent straight to, from the TV's QR code) the code a TV is showing. */
function linkUrl(code: string): string {
  const base = (process.env.CUSTOMER_APP_URL ?? "").replace(/\/$/, "");
  return `${base}/learn/tv?code=${code}`;
}

tvRoutes.use("*", async (c, next) => {
  if (!(await ready())) return pending(c);
  await next();
});

/** A TV that has just been switched on asks for a code to show. Nothing about it is trusted yet. */
tvRoutes.post("/pair/start", async (c) => {
  const quota = await consume(`tv-pair:${clientIp(c)}`, 20, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many screens are being set up from here. Try again later.");
  const settings = await getLearnSettings();
  const secret = randomHex(32);
  const id = newId("tv");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const code = pairCode();
      await db.execute({
        sql: "INSERT INTO tv_devices (id, secret_hash, pair_code, pair_expires_at, name) VALUES (?, ?, ?, ?, 'TV')",
        args: [id, await sha256(secret), code, sqlite(plusSeconds(settings.screenPairMinutes * 60))],
      });
      return c.json({ ok: true, deviceId: id, secret, code, linkUrl: linkUrl(code), expiresInSeconds: settings.screenPairMinutes * 60, pollSeconds: settings.livePollSeconds }, 201);
    } catch {
      /* a code collision: try another */
    }
  }
  return c.json({ error: "try_again", message: "Couldn't create a pairing code. Try again." }, 503);
});

/** What the TV is, who owns it, and (while unpaired) the code to show. An expired code is replaced here. */
tvRoutes.get("/me", deviceAuth, async (c) => {
  const device = getDevice(c);
  const settings = await getLearnSettings();
  if (device.status === "paired") {
    const owner = await one("SELECT name FROM users WHERE id = ?", [device.owner_id]);
    return c.json({
      ok: true,
      status: "paired",
      name: device.name,
      ownerName: owner ? String(owner.name) : "",
      pollSeconds: settings.livePollSeconds,
      trial: trialOf(device),
      learnEnabled: settings.tvLearnEnabled,
      liveEnabled: settings.liveEnabled,
    });
  }
  let code = device.pair_code;
  let expires = device.pair_expires_at;
  const expired = !expires || (parseTime(expires) ?? 0) < Date.now();
  if (expired || !code) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        code = pairCode();
        expires = sqlite(plusSeconds(settings.screenPairMinutes * 60));
        await db.execute({ sql: "UPDATE tv_devices SET pair_code = ?, pair_expires_at = ? WHERE id = ?", args: [code, expires, device.id] });
        break;
      } catch {
        code = null;
      }
    }
  }
  return c.json({ ok: true, status: "unpaired", code, linkUrl: code ? linkUrl(code) : null, expiresInSeconds: Math.max(0, Math.round(((parseTime(expires) ?? 0) - Date.now()) / 1000)), pollSeconds: settings.livePollSeconds, trial: trialOf(device) });
});

/** The practice classes a TV can show, before it is paired or after. Public: nothing here is private. */
tvRoutes.get("/trial", async (c) => {
  const quota = await consume(`tv-trial-list:${clientIp(c)}`, 60, 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many requests. Try again in a moment.");
  return c.json({ ok: true, classes: await trialClasses(await getLearnSettings()) });
});

/** Put a practice class on this screen. Phones join the very same class with its code. */
tvRoutes.post("/trial", deviceAuth, async (c) => {
  const parsed = await readBody(c, z.object({ slot: z.enum(["a", "b"]) }));
  if (!parsed.ok) return parsed.res;
  if (!(await hasColumn("tv_devices", "trial_slot"))) return c.json({ error: "tv_trial_upgrade_pending", message: "Practice classes on the TV are being set up. Try again shortly." }, 503);
  const classes = await trialClasses(await getLearnSettings());
  if (!classes.some((k) => k.slot === parsed.data.slot)) return fail(c, { status: 404, error: "no_trial", message: "That practice class isn't available right now." });
  await db.execute({ sql: "UPDATE tv_devices SET trial_slot = ? WHERE id = ?", args: [parsed.data.slot, getDevice(c).id] });
  return c.json({ ok: true });
});

/** Stop showing the practice class. */
tvRoutes.delete("/trial", deviceAuth, async (c) => {
  if (await hasColumn("tv_devices", "trial_slot")) await db.execute({ sql: "UPDATE tv_devices SET trial_slot = NULL WHERE id = ?", args: [getDevice(c).id] });
  return c.json({ ok: true });
});

/** A TV that is being handed on or sold removes itself, so nothing of the old owner's stays on it. */
tvRoutes.delete("/me", deviceAuth, async (c) => {
  const device = getDevice(c);
  await db.execute({ sql: "UPDATE edu_live_sessions SET screen_device_id = NULL, screen_cue_id = NULL, version = version + 1 WHERE screen_device_id = ?", args: [device.id] });
  await db.execute({ sql: "DELETE FROM tv_devices WHERE id = ?", args: [device.id] });
  return c.json({ ok: true });
});

/**
 * Learning on the TV. A TV linked to someone's account acts as that person for the learner actions a living-room
 * screen needs: see their courses, open one, play a lesson, take a quiz, tick a lesson off, and enrol in a free
 * course. These are the very same handlers the phone uses, so progress is shared between the two.
 *
 * Anything that moves money (a paid course, school fees) is refused here and done on the phone, and so is
 * everything else. A TV sits in a shared room; it never gets more than it needs.
 */
const tvLearn = new Hono();
tvLearn.use("*", deviceAuth);
tvLearn.use("*", async (c, next) => {
  const device = getDevice(c);
  if (device.status !== "paired" || !device.owner_id) return c.json({ error: "not_linked", message: "Link this TV to your Peebee account first." }, 403);
  const settings = await getLearnSettings();
  if (!settings.tvLearnEnabled) return fail(c, { status: 503, error: "service_disabled", message: "Learning on a TV is switched off right now." });
  const owner = await one("SELECT id, name, role, status FROM users WHERE id = ?", [device.owner_id]);
  if (!owner) return c.json({ error: "unauthorized", message: "This screen isn't registered." }, 401);
  if (owner.status === "suspended") return c.json({ error: "account_suspended", message: "This account has been suspended" }, 403);

  const path = c.req.path.replace(/^.*\/v1\/tv\/learn/, "");
  const method = c.req.method;
  const allowed =
    (method === "GET" && (path === "/enrollments" || /^\/(courses|lessons)\/[^/]+$/.test(path))) ||
    (method === "POST" && (/^\/lessons\/[^/]+\/(media-url|quiz|quiz\/start|quiz\/submit|complete)$/.test(path) || /^\/courses\/[^/]+\/enroll$/.test(path)));
  if (!allowed) return c.json({ error: "not_on_tv", message: "Do this in the Peebee app on your phone." }, 403);
  if (/^\/courses\/[^/]+\/enroll$/.test(path)) {
    const course = await one("SELECT price_ugx FROM edu_courses WHERE id = ?", [path.split("/")[2]]);
    if (course && Number(course.price_ugx) > 0) {
      return c.json({ error: "pay_on_phone", message: "This course isn't free. Enrol in the Peebee app on your phone, then it appears here." }, 403);
    }
  }
  c.set("user", { sub: String(owner.id), role: String(owner.role), name: String(owner.name ?? ""), adminRole: null, forcePasswordChange: false, jti: `tv:${device.id}` } as never);
  await next();
});
tvLearn.route("/", learnRoutes);
tvRoutes.route("/learn", tvLearn);

const userRoutes = new Hono();
userRoutes.use("*", requireAuth);

userRoutes.post("/pair", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  const quota = await consume(`tv-claim:${user.sub}`, 10, 10 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many tries. Wait a few minutes and check the code on the TV.");
  const parsed = await readBody(
    c,
    z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, "Enter the 6-character code shown on the TV"),
      name: text(60).default(""),
      // "learn": a learner linking their TV to study on it. "teach" (the default, what the educator console sends): a classroom screen.
      purpose: z.enum(["learn", "teach"]).default("teach"),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const learning = parsed.data.purpose === "learn";
  if (learning) {
    if (!settings.tvLearnEnabled) return fail(c, { status: 503, error: "service_disabled", message: "Learning on a TV is switched off right now." });
  } else {
    if (!settings.liveEnabled) return fail(c, { status: 503, error: "service_disabled", message: "Live classroom is switched off right now." });
    const needsPro = await tvProRequired(c, user.sub, settings);
    if (needsPro) return needsPro;
  }
  const owned = await count("SELECT COUNT(*) AS n FROM tv_devices WHERE owner_id = ?", [user.sub]);
  if (owned >= settings.maxScreensPerUser) return fail(c, { status: 409, error: "limit_reached", message: `You can pair up to ${settings.maxScreensPerUser} screens. Remove one first.` });

  const device = await one("SELECT * FROM tv_devices WHERE pair_code = ? AND status = 'unpaired'", [parsed.data.code]);
  if (!device || (parseTime(device.pair_expires_at) ?? 0) < Date.now()) {
    return fail(c, { status: 404, error: "bad_code", message: "That code isn't right, or it has expired. Check the code on the TV." });
  }
  const name = parsed.data.name || (learning ? (owned === 0 ? "My TV" : `My TV ${owned + 1}`) : `Classroom screen ${owned + 1}`);
  const claimed = await db.execute({
    sql: "UPDATE tv_devices SET owner_id = ?, name = ?, status = 'paired', pair_code = NULL, pair_expires_at = NULL, paired_at = datetime('now') WHERE id = ? AND status = 'unpaired'",
    args: [user.sub, name, device.id as string],
  });
  // Two people typing the same code at once: only the first claim counts.
  if ((claimed.rowsAffected ?? 0) === 0) return fail(c, { status: 404, error: "bad_code", message: "That code isn't right, or it has expired. Check the code on the TV." });
  return c.json({ ok: true, device: { id: String(device.id), name } }, 201);
});

userRoutes.get("/devices", async (c) => {
  const res = await db.execute({
    sql: `SELECT d.id, d.name, d.last_seen_at, d.paired_at, s.id AS session_id, s.title AS session_title
          FROM tv_devices d LEFT JOIN edu_live_sessions s ON s.screen_device_id = d.id AND s.status = 'live'
          WHERE d.owner_id = ? ORDER BY d.paired_at DESC LIMIT 100`,
    args: [c.get("user").sub],
  });
  return c.json({
    ok: true,
    devices: (res.rows as Row[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      online: (parseTime(r.last_seen_at) ?? 0) > Date.now() - 20_000,
      lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null,
      sessionId: r.session_id ? String(r.session_id) : null,
      sessionTitle: r.session_title ? String(r.session_title) : null,
    })),
  });
});

userRoutes.patch("/devices/:id", async (c) => {
  const parsed = await readBody(c, z.object({ name: text(60, 1) }));
  if (!parsed.ok) return parsed.res;
  const res = await db.execute({ sql: "UPDATE tv_devices SET name = ? WHERE id = ? AND owner_id = ?", args: [parsed.data.name, c.req.param("id"), c.get("user").sub] });
  if ((res.rowsAffected ?? 0) === 0) return notFound(c, "screen");
  return c.json({ ok: true });
});

userRoutes.delete("/devices/:id", async (c) => {
  const id = c.req.param("id");
  const device = await one("SELECT id FROM tv_devices WHERE id = ? AND owner_id = ?", [id, c.get("user").sub]);
  if (!device) return notFound(c, "screen");
  await db.execute({ sql: "UPDATE edu_live_sessions SET screen_device_id = NULL, screen_cue_id = NULL, version = version + 1 WHERE screen_device_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM tv_devices WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Sessions: shared reading helpers
// ---------------------------------------------------------------------------

async function bump(sessionId: string): Promise<void> {
  await db.execute({ sql: "UPDATE edu_live_sessions SET version = version + 1 WHERE id = ?", args: [sessionId] });
}

const cueOf = (id: unknown) => (id ? one("SELECT * FROM edu_live_cues WHERE id = ?", [id]) : Promise.resolve(null));

/** A cue still taking answers: pushed, not closed, not revealed and inside its time limit (with a few seconds' grace for slow phones). */
function isOpen(cue: Row): boolean {
  if (cue.status !== "active" || Number(cue.revealed) === 1) return false;
  const ends = parseTime(cue.ends_at);
  return ends === null || Date.now() <= ends + 3000;
}

function score(question: Question, answer: number | undefined): number {
  return question.correctIndex !== null && answer === question.correctIndex ? 1 : 0;
}

type Standing = { userId: string; name: string; points: number };

/** Running scores for the whole session: one point per correct live answer or exam question. */
async function standings(sessionId: string): Promise<Standing[]> {
  const res = await db.execute({
    sql: `SELECT r.user_id, u.name, SUM(r.score) AS points, MAX(r.created_at) AS last_at
          FROM edu_live_responses r JOIN users u ON u.id = r.user_id
          WHERE r.session_id = ? AND r.out_of > 0 GROUP BY r.user_id ORDER BY points DESC, last_at ASC`,
    args: [sessionId],
  });
  return (res.rows as Row[]).map((r) => ({ userId: String(r.user_id), name: String(r.name), points: Number(r.points) }));
}

async function optionCounts(cueId: string, options: number): Promise<number[]> {
  const counts = new Array<number>(options).fill(0);
  const res = await db.execute({ sql: "SELECT answers_json FROM edu_live_responses WHERE cue_id = ?", args: [cueId] });
  for (const r of res.rows as Row[]) {
    const first = json<number[]>(r.answers_json, [])[0];
    if (Number.isInteger(first) && first >= 0 && first < options) counts[first] += 1;
  }
  return counts;
}

async function memberCount(sessionId: string): Promise<{ total: number; present: number; hands: number }> {
  const r = await one(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN present_at IS NOT NULL THEN 1 ELSE 0 END) AS present, SUM(CASE WHEN hand_raised_at IS NOT NULL THEN 1 ELSE 0 END) AS hands FROM edu_live_members WHERE session_id = ?",
    [sessionId],
  );
  return { total: Number(r?.total ?? 0), present: Number(r?.present ?? 0), hands: Number(r?.hands ?? 0) };
}

async function responseCount(cueId: string): Promise<number> {
  return count("SELECT COUNT(*) AS n FROM edu_live_responses WHERE cue_id = ?", [cueId]);
}

const toQuestion = (p: Row): Question => ({
  question: String(p.question),
  options: (p.options as string[]) ?? [],
  correctIndex: p.correctIndex === null || p.correctIndex === undefined ? null : Number(p.correctIndex),
  explanation: String(p.explanation ?? ""),
});

/** The question and choices, never the answer. */
const stripQuestion = (q: Question) => ({ question: q.question, options: q.options, poll: q.correctIndex === null });

// ---------------------------------------------------------------------------
// What a phone sees
// ---------------------------------------------------------------------------

async function phoneCue(session: Row, userId: string) {
  const cue = await cueOf(session.phones_cue_id);
  if (!cue) return null;
  const p = json<Row>(cue.payload_json, {});
  const mine = await one("SELECT answers_json, score, out_of FROM edu_live_responses WHERE cue_id = ? AND user_id = ?", [cue.id, userId]);
  const base = { id: String(cue.id), kind: String(cue.kind), endsAt: cue.ends_at ? String(cue.ends_at) : null, open: isOpen(cue), revealed: Number(cue.revealed) === 1, answered: Boolean(mine) };
  switch (cue.kind as Kind) {
    case "slide":
      return { ...base, title: String(p.title), body: String(p.body ?? ""), imageUrl: p.imageUrl ? String(p.imageUrl) : null };
    case "lesson": {
      const lesson = await one("SELECT l.id, l.title, l.summary, c.school_id FROM edu_lessons l JOIN edu_courses c ON c.id = l.course_id WHERE l.id = ?", [p.lessonId]);
      // A lesson on the phones plays its video there. Only a lesson from the hosting school, and only through a short-lived link for this student.
      let media: Row | null = null;
      if (lesson && String(lesson.school_id) === String(session.school_id)) {
        const m = await one("SELECT content_type FROM edu_lesson_media WHERE lesson_id = ?", [lesson.id]).catch(() => null);
        if (m) media = { url: `${(process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "")}/v1/education/media/${await signMediaToken(userId, String(lesson.id))}`, contentType: String(m.content_type) };
      }
      return { ...base, title: lesson ? String(lesson.title) : "Lesson", body: lesson ? String(lesson.summary ?? "") : "", media };
    }
    case "announcement":
      return { ...base, text: String(p.text) };
    case "timer":
      return { ...base, label: String(p.label ?? ""), seconds: Number(p.seconds) };
    case "question": {
      const q = toQuestion(p);
      const out: Row = { ...base, ...stripQuestion(q), mine: mine ? json<number[]>(mine.answers_json, [])[0] ?? null : null };
      if (base.revealed) {
        out.reveal = { correctIndex: q.correctIndex, explanation: q.explanation, counts: await optionCounts(String(cue.id), q.options.length), correct: mine ? Number(mine.score) === 1 : null };
      }
      return out;
    }
    case "exam": {
      const questions = (p.questions as Row[]).map(toQuestion);
      const out: Row = { ...base, title: String(p.title), questions: questions.map(stripQuestion) };
      if (mine) out.result = { score: Number(mine.score), outOf: Number(mine.out_of) };
      if (base.revealed) out.review = questions.map((q) => ({ correctIndex: q.correctIndex, explanation: q.explanation }));
      return out;
    }
    case "attendance":
      return { ...base };
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the TV sees
// ---------------------------------------------------------------------------

function joinUrl(code: string): string {
  const base = (process.env.CUSTOMER_APP_URL ?? "").replace(/\/$/, "");
  return `${base}/learn/live?code=${code}`;
}

async function screenView(session: Row, hostId: string) {
  const cue = await cueOf(session.screen_cue_id);
  const members = await memberCount(String(session.id));
  const code = String(session.code);
  const view: Row = {
    version: Number(session.version),
    serverNow: nowIso(),
    session: { id: String(session.id), title: String(session.title), code, joinUrl: joinUrl(code), participants: members.total, present: members.present, hands: members.hands, trial: Number(session.autopilot) === 1 },
    playback: json<Row>(session.playback_json, { playing: true }),
    cue: null,
  };
  if (!cue) return view;

  const p = json<Row>(cue.payload_json, {});
  const base = { id: String(cue.id), kind: String(cue.kind), endsAt: cue.ends_at ? String(cue.ends_at) : null, open: isOpen(cue), revealed: Number(cue.revealed) === 1 };
  switch (cue.kind as Kind) {
    case "slide":
      view.cue = { ...base, title: String(p.title), body: String(p.body ?? ""), imageUrl: p.imageUrl ? String(p.imageUrl) : null };
      break;
    case "lesson": {
      const lesson = await one("SELECT l.id, l.title, l.summary, c.school_id FROM edu_lessons l JOIN edu_courses c ON c.id = l.course_id WHERE l.id = ?", [p.lessonId]);
      let media: Row | null = null;
      if (lesson && String(lesson.school_id) === String(session.school_id)) {
        const m = await one("SELECT content_type FROM edu_lesson_media WHERE lesson_id = ?", [lesson.id]).catch(() => null);
        if (m) media = { url: `${(process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "")}/v1/education/media/${await signMediaToken(hostId, String(lesson.id))}`, contentType: String(m.content_type) };
      }
      view.cue = { ...base, title: lesson ? String(lesson.title) : "Lesson", body: lesson ? String(lesson.summary ?? "") : "", media };
      break;
    }
    case "announcement":
      view.cue = { ...base, text: String(p.text) };
      break;
    case "timer":
      view.cue = { ...base, label: String(p.label ?? ""), seconds: Number(p.seconds) };
      break;
    case "question": {
      const q = toQuestion(p);
      const answered = await responseCount(String(cue.id));
      const poll = q.correctIndex === null;
      const out: Row = { ...base, ...stripQuestion(q), answered, total: members.total };
      // Votes on a quiz stay hidden until reveal so nobody copies the room. A poll has no right answer, so it is live.
      if (poll || base.revealed) out.counts = await optionCounts(String(cue.id), q.options.length);
      if (base.revealed && !poll) {
        out.correctIndex = q.correctIndex;
        out.explanation = q.explanation;
        out.leaders = (await standings(String(session.id))).slice(0, 5).map((s) => ({ name: shortName(s.name), points: s.points }));
      }
      view.cue = out;
      break;
    }
    case "exam": {
      const questions = (p.questions as Row[]).length;
      const out: Row = { ...base, title: String(p.title), questionCount: questions, submitted: await responseCount(String(cue.id)), total: members.total };
      if (base.revealed) {
        const res = await db.execute({ sql: "SELECT r.score, r.out_of, u.name FROM edu_live_responses r JOIN users u ON u.id = r.user_id WHERE r.cue_id = ? ORDER BY r.score DESC, r.created_at ASC", args: [cue.id as string] });
        const rows = res.rows as Row[];
        out.average = rows.length ? Math.round((rows.reduce((n, r) => n + Number(r.score), 0) / rows.reduce((n, r) => n + Number(r.out_of), 0)) * 100) : null;
        out.leaders = rows.slice(0, 5).map((r) => ({ name: shortName(String(r.name)), points: Number(r.score), outOf: Number(r.out_of) }));
      }
      view.cue = out;
      break;
    }
    case "attendance":
      view.cue = { ...base, present: members.present, total: members.total };
      break;
  }
  return view;
}

tvRoutes.get("/screen/state", deviceAuth, async (c) => {
  const device = getDevice(c);
  const settings = await getLearnSettings();

  // A practice class runs itself and needs no pairing: the TV just shows it, and phones join with the code.
  const slot = trialOf(device);
  if (slot && settings.liveEnabled && settings.trialClassesEnabled) {
    const row = await one("SELECT * FROM edu_live_sessions WHERE id = ? AND status = 'live' AND autopilot = 1", [`liv_demo_${slot}`]).catch(() => null);
    if (row) {
      const synced = await syncAutopilot(row);
      const code = slot === "a" ? settings.trialCodeA : settings.trialCodeB;
      return c.json({ ok: true, device: { name: device.name }, pollSeconds: settings.livePollSeconds, ...(await screenView({ ...synced, code }, String(synced.host_id))) });
    }
  }

  if (device.status !== "paired") return c.json({ error: "not_paired", message: "This screen isn't paired yet." }, 409);
  const session = await one("SELECT * FROM edu_live_sessions WHERE screen_device_id = ? AND status = 'live' ORDER BY created_at DESC LIMIT 1", [device.id]);
  if (!session) return c.json({ ok: true, device: { name: device.name }, session: null, pollSeconds: settings.livePollSeconds });
  return c.json({ ok: true, device: { name: device.name }, pollSeconds: settings.livePollSeconds, ...(await screenView(session, String(session.host_id))) });
});

// ---------------------------------------------------------------------------
// Sessions: the educator's side
// ---------------------------------------------------------------------------

export const classroomRoutes = new Hono();

classroomRoutes.use("*", async (c, next) => {
  if (!(await ready())) return pending(c);
  await next();
});

async function ownedSession(userId: string, id: string): Promise<Row | null> {
  return one("SELECT * FROM edu_live_sessions WHERE id = ? AND host_id = ?", [id, userId]);
}

async function enabled(c: Context): Promise<LearnSettings | Response> {
  const settings = await getLearnSettings();
  if (!settings.liveEnabled) return fail(c, { status: 503, error: "service_disabled", message: "Live classroom is switched off right now." });
  return settings;
}

const sessionBody = z.object({
  title: text(120, 2),
  classId: text(80).optional(),
  courseId: text(80).optional(),
  schoolId: text(80).optional(),
  screenDeviceId: text(80).nullable().optional(),
  /** Build the run sheet from the course's lessons and their quizzes. */
  autoCues: z.boolean().default(true),
});

async function newCue(sessionId: string, kind: Kind, target: Target, payload: unknown, position: number): Promise<string> {
  const id = newId("cue");
  await db.execute({ sql: "INSERT INTO edu_live_cues (id, session_id, position, kind, target, payload_json) VALUES (?, ?, ?, ?, ?, ?)", args: [id, sessionId, position, kind, target, JSON.stringify(payload)] });
  return id;
}

classroomRoutes.post("/sessions", async (c) => {
  const settings = await enabled(c);
  if (isResponse(settings)) return settings;
  const user = c.get("user");
  const parsed = await readBody(c, sessionBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // The school comes from the course or class when given, otherwise it is named directly. Either way it must be the host's.
  let schoolId = d.schoolId ?? "";
  let classId = d.classId ?? null;
  let courseId = d.courseId ?? null;
  if (courseId) {
    const course = await one("SELECT school_id, class_id FROM edu_courses WHERE id = ?", [courseId]);
    if (!course) return notFound(c, "course");
    schoolId = String(course.school_id);
    classId = String(course.class_id);
  } else if (classId) {
    const cls = await one("SELECT school_id FROM edu_classes WHERE id = ?", [classId]);
    if (!cls) return notFound(c, "class");
    schoolId = String(cls.school_id);
  }
  const school = schoolId ? await one("SELECT * FROM edu_schools WHERE id = ? AND owner_id = ?", [schoolId, user.sub]) : null;
  if (!school) return notFound(c, "school");
  if (school.status === "suspended") return fail(c, { status: 403, error: "school_suspended", message: "This school has been suspended." });

  let deviceId: string | null = null;
  if (d.screenDeviceId) {
    const needsPro = await tvProRequired(c, user.sub, settings);
    if (needsPro) return needsPro;
    const device = await one("SELECT id FROM tv_devices WHERE id = ? AND owner_id = ? AND status = 'paired'", [d.screenDeviceId, user.sub]);
    if (!device) return notFound(c, "screen");
    if (await one("SELECT id FROM edu_live_sessions WHERE screen_device_id = ? AND status = 'live'", [device.id])) {
      return fail(c, { status: 409, error: "screen_busy", message: "That screen is already showing another live session. End it first." });
    }
    deviceId = String(device.id);
  }

  const id = newId("liv");
  let created = false;
  for (let attempt = 0; attempt < 8 && !created; attempt += 1) {
    // The two trial class codes belong to the trial classes, so a real session never gets them.
    const code = freeSessionCode([settings.trialCodeA, settings.trialCodeB]);
    if (!code) continue;
    try {
      await db.execute({
        sql: `INSERT INTO edu_live_sessions (id, school_id, class_id, course_id, host_id, title, code, screen_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, schoolId, classId, courseId, user.sub, d.title, code, deviceId],
      });
      created = true;
    } catch {
      /* the code is in use by another live session: try another */
    }
  }
  if (!created) return c.json({ error: "try_again", message: "Couldn't start the session. Try again." }, 503);

  // A ready-made run sheet: each lesson on the screen, and each of its quiz questions to everyone.
  if (d.autoCues && courseId) {
    const lessons = (await db.execute({
      sql: `SELECT l.id, l.title, l.quiz_json FROM edu_lessons l JOIN edu_modules m ON m.id = l.module_id WHERE l.course_id = ? ORDER BY m.position ASC, l.position ASC LIMIT 200`,
      args: [courseId],
    })).rows as Row[];
    let position = 0;
    for (const lesson of lessons) {
      if (position >= settings.liveMaxCuesPerSession) break;
      await newCue(id, "lesson", "screen", { lessonId: String(lesson.id) }, position++);
      const quiz = json<{ questions?: { question: string; options: string[]; correctIndex: number; explanation?: string }[] } | null>(lesson.quiz_json, null);
      for (const q of quiz?.questions ?? []) {
        if (position >= settings.liveMaxCuesPerSession) break;
        await newCue(id, "question", "both", { question: q.question, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation ?? "" }, position++);
      }
    }
  }
  const row = await one("SELECT * FROM edu_live_sessions WHERE id = ?", [id]);
  return c.json({ ok: true, session: sessionSummary(row!) }, 201);
});

const sessionSummary = (r: Row) => ({
  id: String(r.id),
  title: String(r.title),
  code: String(r.code),
  status: String(r.status),
  schoolId: String(r.school_id),
  classId: r.class_id ? String(r.class_id) : null,
  courseId: r.course_id ? String(r.course_id) : null,
  screenDeviceId: r.screen_device_id ? String(r.screen_device_id) : null,
  createdAt: String(r.created_at),
});

classroomRoutes.get("/sessions", async (c) => {
  const res = await db.execute({ sql: "SELECT * FROM edu_live_sessions WHERE host_id = ? ORDER BY created_at DESC LIMIT 30", args: [c.get("user").sub] });
  return c.json({ ok: true, sessions: (res.rows as Row[]).map(sessionSummary) });
});

/** Everything the educator's console needs, including the answers. */
classroomRoutes.get("/sessions/:id", async (c) => {
  const session = await ownedSession(c.get("user").sub, c.req.param("id"));
  if (!session) return notFound(c, "session");
  const id = String(session.id);
  const cues = (await db.execute({ sql: "SELECT * FROM edu_live_cues WHERE session_id = ? ORDER BY position ASC, created_at ASC LIMIT 600", args: [id] })).rows as Row[];
  const out = [];
  for (const cue of cues) {
    const p = json<Row>(cue.payload_json, {});
    const entry: Row = {
      id: String(cue.id),
      kind: String(cue.kind),
      target: String(cue.target),
      status: String(cue.status),
      revealed: Number(cue.revealed) === 1,
      endsAt: cue.ends_at ? String(cue.ends_at) : null,
      payload: p,
      responses: await responseCount(String(cue.id)),
      onScreen: session.screen_cue_id === cue.id,
      onPhones: session.phones_cue_id === cue.id,
    };
    if (cue.kind === "question") entry.counts = await optionCounts(String(cue.id), ((p.options as string[]) ?? []).length);
    if (cue.kind === "lesson") {
      const lesson = await one("SELECT title FROM edu_lessons WHERE id = ?", [p.lessonId]);
      entry.lessonTitle = lesson ? String(lesson.title) : "Lesson";
    }
    out.push(entry);
  }
  const members = (await db.execute({
    sql: `SELECT m.user_id, m.present_at, m.hand_raised_at, u.name FROM edu_live_members m JOIN users u ON u.id = m.user_id WHERE m.session_id = ? ORDER BY m.joined_at ASC LIMIT 600`,
    args: [id],
  })).rows as Row[];
  const points = new Map((await standings(id)).map((s) => [s.userId, s.points]));
  const device = session.screen_device_id ? await one("SELECT id, name, last_seen_at FROM tv_devices WHERE id = ?", [session.screen_device_id]) : null;
  return c.json({
    ok: true,
    session: { ...sessionSummary(session), version: Number(session.version), playback: json<Row>(session.playback_json, { playing: true }), joinUrl: joinUrl(String(session.code)) },
    screen: device ? { id: String(device.id), name: String(device.name), online: (parseTime(device.last_seen_at) ?? 0) > Date.now() - 20_000 } : null,
    cues: out,
    members: members.map((m) => ({ userId: String(m.user_id), name: String(m.name), present: Boolean(m.present_at), handRaised: Boolean(m.hand_raised_at), points: points.get(String(m.user_id)) ?? 0 })),
    serverNow: nowIso(),
  });
});

classroomRoutes.patch("/sessions/:id", async (c) => {
  const user = c.get("user");
  const session = await ownedSession(user.sub, c.req.param("id"));
  if (!session) return notFound(c, "session");
  if (session.status !== "live") return fail(c, { status: 409, error: "session_ended", message: "This session has ended." });
  const parsed = await readBody(c, z.object({ title: text(120, 2).optional(), screenDeviceId: text(80).nullable().optional() }));
  if (!parsed.ok) return parsed.res;
  if (parsed.data.title) await db.execute({ sql: "UPDATE edu_live_sessions SET title = ? WHERE id = ?", args: [parsed.data.title, session.id as string] });
  if (parsed.data.screenDeviceId !== undefined) {
    if (parsed.data.screenDeviceId === null) {
      await db.execute({ sql: "UPDATE edu_live_sessions SET screen_device_id = NULL, screen_cue_id = NULL WHERE id = ?", args: [session.id as string] });
    } else {
      const needsPro = await tvProRequired(c, user.sub, await getLearnSettings());
      if (needsPro) return needsPro;
      const device = await one("SELECT id FROM tv_devices WHERE id = ? AND owner_id = ? AND status = 'paired'", [parsed.data.screenDeviceId, user.sub]);
      if (!device) return notFound(c, "screen");
      const busy = await one("SELECT id FROM edu_live_sessions WHERE screen_device_id = ? AND status = 'live' AND id != ?", [device.id, session.id]);
      if (busy) return fail(c, { status: 409, error: "screen_busy", message: "That screen is already showing another live session." });
      await db.execute({ sql: "UPDATE edu_live_sessions SET screen_device_id = ? WHERE id = ?", args: [device.id as string, session.id as string] });
    }
  }
  await bump(String(session.id));
  return c.json({ ok: true });
});

classroomRoutes.post("/sessions/:id/end", async (c) => {
  const session = await ownedSession(c.get("user").sub, c.req.param("id"));
  if (!session) return notFound(c, "session");
  await db.execute({ sql: "UPDATE edu_live_cues SET status = 'closed', closed_at = datetime('now') WHERE session_id = ? AND status = 'active'", args: [session.id as string] });
  await db.execute({
    sql: "UPDATE edu_live_sessions SET status = 'ended', ended_at = datetime('now'), screen_cue_id = NULL, phones_cue_id = NULL, version = version + 1 WHERE id = ?",
    args: [session.id as string],
  });
  return c.json({ ok: true });
});

classroomRoutes.post("/sessions/:id/cues", async (c) => {
  const settings = await enabled(c);
  if (isResponse(settings)) return settings;
  const session = await ownedSession(c.get("user").sub, c.req.param("id"));
  if (!session) return notFound(c, "session");
  if (session.status !== "live") return fail(c, { status: 409, error: "session_ended", message: "This session has ended." });
  const parsed = await readBody(c, cueBody);
  if (!parsed.ok) return parsed.res;
  const { kind } = parsed.data;
  const payload = payloadSchema(kind, settings).safeParse(parsed.data.payload);
  if (!payload.success) {
    const issue = payload.error.issues[0];
    return c.json({ error: "invalid_body", message: `${issue?.path.join(".") ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "Invalid item"}` }, 400);
  }
  const target = parsed.data.target ?? DEFAULT_TARGET[kind];
  if (!ALLOWED_TARGETS[kind].includes(target)) return fail(c, { status: 400, error: "bad_target", message: `A ${kind} can go to: ${ALLOWED_TARGETS[kind].join(", ")}.` });

  if (kind === "lesson") {
    const lesson = await one("SELECT c.school_id FROM edu_lessons l JOIN edu_courses c ON c.id = l.course_id WHERE l.id = ?", [(payload.data as { lessonId: string }).lessonId]);
    if (!lesson || String(lesson.school_id) !== String(session.school_id)) return notFound(c, "lesson");
  }
  const existing = await count("SELECT COUNT(*) AS n FROM edu_live_cues WHERE session_id = ?", [session.id]);
  if (existing >= settings.liveMaxCuesPerSession) return fail(c, { status: 409, error: "limit_reached", message: `A session can have up to ${settings.liveMaxCuesPerSession} items.` });
  const last = await one("SELECT MAX(position) AS p FROM edu_live_cues WHERE session_id = ?", [session.id]);
  const id = await newCue(String(session.id), kind, target, payload.data, Number(last?.p ?? -1) + 1);
  await bump(String(session.id));
  return c.json({ ok: true, cueId: id }, 201);
});

classroomRoutes.delete("/cues/:id", async (c) => {
  const cue = await one("SELECT q.* FROM edu_live_cues q JOIN edu_live_sessions s ON s.id = q.session_id WHERE q.id = ? AND s.host_id = ?", [c.req.param("id"), c.get("user").sub]);
  if (!cue) return notFound(c, "item");
  if (cue.status === "active") return fail(c, { status: 409, error: "cue_active", message: "Take this item off the screen and phones first." });
  await db.execute({ sql: "DELETE FROM edu_live_responses WHERE cue_id = ?", args: [cue.id as string] });
  await db.execute({ sql: "DELETE FROM edu_live_cues WHERE id = ?", args: [cue.id as string] });
  await bump(String(cue.session_id));
  return c.json({ ok: true });
});

/** The heart of it: send this item to the screen, the phones or both. */
classroomRoutes.post("/cues/:id/push", async (c) => {
  const settings = await enabled(c);
  if (isResponse(settings)) return settings;
  const cue = await one("SELECT q.* FROM edu_live_cues q JOIN edu_live_sessions s ON s.id = q.session_id WHERE q.id = ? AND s.host_id = ?", [c.req.param("id"), c.get("user").sub]);
  if (!cue) return notFound(c, "item");
  const session = (await one("SELECT * FROM edu_live_sessions WHERE id = ?", [cue.session_id]))!;
  if (session.status !== "live") return fail(c, { status: 409, error: "session_ended", message: "This session has ended." });
  const parsed = await readBody(c, z.object({ target: z.enum(["screen", "phones", "both"]).optional() }));
  if (!parsed.ok) return parsed.res;
  const kind = cue.kind as Kind;
  const target = (parsed.data.target ?? cue.target) as Target;
  if (!ALLOWED_TARGETS[kind].includes(target)) return fail(c, { status: 400, error: "bad_target", message: `A ${kind} can go to: ${ALLOWED_TARGETS[kind].join(", ")}.` });
  if (target !== "phones") {
    const needsPro = await tvProRequired(c, c.get("user").sub, await getLearnSettings());
    if (needsPro) return needsPro;
  }
  if (target !== "phones" && !session.screen_device_id) return fail(c, { status: 409, error: "no_screen", message: "No TV is connected to this session. Pick a screen first, or send it to phones only." });

  const p = json<Row>(cue.payload_json, {});
  let seconds = 0;
  if (kind === "timer") seconds = Number(p.seconds);
  if (kind === "question") seconds = Number(p.timeLimitSeconds ?? 0);
  if (kind === "exam") seconds = Number(p.minutes) * 60;
  const endsAt = seconds > 0 ? plusSeconds(seconds) : null;

  // Whatever those channels were showing is finished with; anything still open on a channel that keeps it stays open.
  const previous = [target !== "phones" ? session.screen_cue_id : null, target !== "screen" ? session.phones_cue_id : null].filter((v): v is string => typeof v === "string" && v !== cue.id);
  for (const old of new Set(previous)) {
    const stillShown = (target === "screen" ? session.phones_cue_id : target === "phones" ? session.screen_cue_id : null) === old;
    if (!stillShown) await db.execute({ sql: "UPDATE edu_live_cues SET status = 'closed', closed_at = datetime('now') WHERE id = ? AND status = 'active'", args: [old] });
  }
  await db.execute({
    sql: "UPDATE edu_live_cues SET status = 'active', target = ?, activated_at = datetime('now'), ends_at = ?, revealed = 0, closed_at = NULL WHERE id = ?",
    args: [target, endsAt, cue.id as string],
  });
  // A repeat push opens the item afresh, so earlier answers to it are cleared.
  await db.execute({ sql: "DELETE FROM edu_live_responses WHERE cue_id = ?", args: [cue.id as string] });
  await db.execute({
    sql: `UPDATE edu_live_sessions SET
            screen_cue_id = CASE WHEN ? != 'phones' THEN ? ELSE screen_cue_id END,
            phones_cue_id = CASE WHEN ? != 'screen' THEN ? ELSE phones_cue_id END,
            playback_json = CASE WHEN ? = 'lesson' THEN '{"playing":true}' ELSE playback_json END,
            version = version + 1 WHERE id = ?`,
    args: [target, cue.id as string, target, cue.id as string, kind, session.id as string],
  });
  return c.json({ ok: true, target, endsAt });
});

classroomRoutes.post("/cues/:id/reveal", async (c) => {
  const cue = await one("SELECT q.* FROM edu_live_cues q JOIN edu_live_sessions s ON s.id = q.session_id WHERE q.id = ? AND s.host_id = ?", [c.req.param("id"), c.get("user").sub]);
  if (!cue) return notFound(c, "item");
  if (cue.kind !== "question" && cue.kind !== "exam") return fail(c, { status: 400, error: "not_gradable", message: "Only questions and exams have results to reveal." });
  if (cue.status !== "active") return fail(c, { status: 409, error: "not_active", message: "Push the item before revealing its answer." });
  await db.execute({ sql: "UPDATE edu_live_cues SET revealed = 1 WHERE id = ?", args: [cue.id as string] });
  await bump(String(cue.session_id));
  return c.json({ ok: true });
});

classroomRoutes.post("/cues/:id/close", async (c) => {
  const cue = await one("SELECT q.* FROM edu_live_cues q JOIN edu_live_sessions s ON s.id = q.session_id WHERE q.id = ? AND s.host_id = ?", [c.req.param("id"), c.get("user").sub]);
  if (!cue) return notFound(c, "item");
  await db.execute({ sql: "UPDATE edu_live_cues SET status = 'closed', closed_at = datetime('now') WHERE id = ?", args: [cue.id as string] });
  await db.execute({
    sql: `UPDATE edu_live_sessions SET screen_cue_id = CASE WHEN screen_cue_id = ? THEN NULL ELSE screen_cue_id END,
            phones_cue_id = CASE WHEN phones_cue_id = ? THEN NULL ELSE phones_cue_id END, version = version + 1 WHERE id = ?`,
    args: [cue.id as string, cue.id as string, cue.session_id as string],
  });
  return c.json({ ok: true });
});

classroomRoutes.post("/sessions/:id/clear", async (c) => {
  const session = await ownedSession(c.get("user").sub, c.req.param("id"));
  if (!session) return notFound(c, "session");
  const parsed = await readBody(c, z.object({ channel: z.enum(["screen", "phones", "both"]) }));
  if (!parsed.ok) return parsed.res;
  const ch = parsed.data.channel;
  await db.execute({
    sql: `UPDATE edu_live_sessions SET screen_cue_id = CASE WHEN ? != 'phones' THEN NULL ELSE screen_cue_id END,
            phones_cue_id = CASE WHEN ? != 'screen' THEN NULL ELSE phones_cue_id END, version = version + 1 WHERE id = ?`,
    args: [ch, ch, session.id as string],
  });
  return c.json({ ok: true });
});

classroomRoutes.post("/sessions/:id/playback", async (c) => {
  const session = await ownedSession(c.get("user").sub, c.req.param("id"));
  if (!session) return notFound(c, "session");
  const parsed = await readBody(c, z.object({ playing: z.boolean(), at: z.number().min(0).max(86_400).optional() }));
  if (!parsed.ok) return parsed.res;
  await db.execute({
    sql: "UPDATE edu_live_sessions SET playback_json = ?, version = version + 1 WHERE id = ?",
    args: [JSON.stringify({ playing: parsed.data.playing, at: parsed.data.at ?? null, updatedAt: nowIso() }), session.id as string],
  });
  return c.json({ ok: true });
});

classroomRoutes.post("/sessions/:id/hands/:userId/clear", async (c) => {
  const session = await ownedSession(c.get("user").sub, c.req.param("id"));
  if (!session) return notFound(c, "session");
  await db.execute({ sql: "UPDATE edu_live_members SET hand_raised_at = NULL WHERE session_id = ? AND user_id = ?", args: [session.id as string, c.req.param("userId")] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/** The trial classes anyone can try, with the codes that open them. Empty when trial classes are off or not installed. */
classroomRoutes.get("/trial", async (c) => c.json({ ok: true, classes: await trialClasses(await getLearnSettings()) }));

classroomRoutes.post("/join", async (c) => {
  const settings = await enabled(c);
  if (isResponse(settings)) return settings;
  const user = c.get("user");
  const quota = await consume(`live-join:${user.sub}`, 20, 10 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many tries. Check the code on the screen and try again in a few minutes.");
  const parsed = await readBody(c, z.object({ code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits") }));
  if (!parsed.ok) return parsed.res;
  const trialSlot = parsed.data.code === settings.trialCodeA ? "a" : parsed.data.code === settings.trialCodeB ? "b" : null;
  const found = trialSlot
    ? settings.trialClassesEnabled
      ? await one("SELECT * FROM edu_live_sessions WHERE id = ? AND status = 'live' AND autopilot = 1", [`liv_demo_${trialSlot}`]).catch(() => null)
      : null
    : await one("SELECT * FROM edu_live_sessions WHERE code = ? AND status = 'live'", [parsed.data.code]);
  // A trial class is only ever opened by the code in the settings, never by the code it was installed with.
  const session = found && !trialSlot && Number(found.autopilot) === 1 ? null : found;
  if (!session) return fail(c, { status: 404, error: "bad_code", message: "No live class has that code. Check the number on the screen." });
  if (session.host_id === user.sub) return fail(c, { status: 400, error: "own_session", message: "This is your own session. Students join it from their phones." });

  const already = await one("SELECT 1 AS yes FROM edu_live_members WHERE session_id = ? AND user_id = ?", [session.id, user.sub]);
  if (!already) {
    const members = await count("SELECT COUNT(*) AS n FROM edu_live_members WHERE session_id = ?", [session.id]);
    if (members >= settings.liveMaxParticipants) return fail(c, { status: 409, error: "session_full", message: "This class is full." });
    await db.execute({ sql: "INSERT OR IGNORE INTO edu_live_members (session_id, user_id) VALUES (?, ?)", args: [session.id as string, user.sub] });
  }
  const host = await one("SELECT name FROM users WHERE id = ?", [session.host_id]);
  return c.json({ ok: true, session: { id: String(session.id), title: String(session.title), hostName: host ? String(host.name) : "", pollSeconds: settings.livePollSeconds } });
});

async function memberSession(c: Context): Promise<{ session: Row } | Response> {
  const user = c.get("user");
  const session = await one("SELECT * FROM edu_live_sessions WHERE id = ?", [c.req.param("id")]);
  const member = session ? await one("SELECT 1 AS yes FROM edu_live_members WHERE session_id = ? AND user_id = ?", [session.id, user.sub]) : null;
  if (!session || !member) return notFound(c, "class");
  return { session };
}

classroomRoutes.get("/sessions/:id/state", async (c) => {
  const found = await memberSession(c);
  if (found instanceof Response) return found;
  // A trial class runs itself: bring it up to date with the clock before answering.
  const session = await syncAutopilot(found.session);
  const since = Number(c.req.query("since"));
  const version = Number(session.version);
  // The common case, thousands of times a minute: nothing changed.
  if (Number.isFinite(since) && since === version) return c.json({ ok: true, version, changed: false });
  const user = c.get("user");
  const me = await one("SELECT present_at, hand_raised_at FROM edu_live_members WHERE session_id = ? AND user_id = ?", [session.id, user.sub]);
  const host = await one("SELECT name FROM users WHERE id = ?", [session.host_id]);
  return c.json({
    ok: true,
    changed: true,
    version,
    serverNow: nowIso(),
    status: String(session.status),
    session: { title: String(session.title), hostName: host ? String(host.name) : "" },
    present: Boolean(me?.present_at),
    handRaised: Boolean(me?.hand_raised_at),
    cue: session.status === "live" ? await phoneCue(session, user.sub) : null,
  });
});

classroomRoutes.post("/sessions/:id/respond", async (c) => {
  const found = await memberSession(c);
  if (found instanceof Response) return found;
  const { session } = found;
  if (session.status !== "live") return fail(c, { status: 409, error: "session_ended", message: "This class has ended." });
  const user = c.get("user");
  const quota = await consume(`live-respond:${user.sub}`, 120, 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Slow down a little.");
  const parsed = await readBody(c, z.object({ cueId: text(80, 1), answers: z.array(z.number().int().min(-1).max(50)).max(50).default([]) }));
  if (!parsed.ok) return parsed.res;
  const cue = await one("SELECT * FROM edu_live_cues WHERE id = ? AND session_id = ?", [parsed.data.cueId, session.id]);
  // Only the item currently on the phones can be answered.
  if (!cue || cue.id !== session.phones_cue_id) return fail(c, { status: 409, error: "not_current", message: "That item is no longer on your phone." });
  if (!isOpen(cue)) return fail(c, { status: 409, error: "closed", message: "Time's up. That item is closed." });
  const p = json<Row>(cue.payload_json, {});
  const answers = parsed.data.answers;

  let points = 0;
  let outOf = 0;
  if (cue.kind === "question") {
    const q = toQuestion(p);
    if (answers.length !== 1 || answers[0] < 0 || answers[0] >= q.options.length) return fail(c, { status: 400, error: "invalid_body", message: "Choose one of the answers." });
    outOf = q.correctIndex === null ? 0 : 1;
    points = score(q, answers[0]);
  } else if (cue.kind === "exam") {
    const questions = (p.questions as Row[]).map(toQuestion);
    if (answers.length !== questions.length) return fail(c, { status: 400, error: "invalid_body", message: "Answer every question." });
    outOf = questions.length;
    points = questions.reduce((n, q, i) => n + score(q, answers[i]), 0);
  } else if (cue.kind === "attendance") {
    await db.execute({ sql: "UPDATE edu_live_members SET present_at = COALESCE(present_at, datetime('now')) WHERE session_id = ? AND user_id = ?", args: [session.id as string, user.sub] });
  } else {
    return fail(c, { status: 400, error: "not_answerable", message: "There's nothing to answer here." });
  }

  const insert = await db.execute({
    sql: "INSERT OR IGNORE INTO edu_live_responses (id, session_id, cue_id, user_id, answers_json, score, out_of) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [newId("lrs"), session.id as string, cue.id as string, user.sub, JSON.stringify(answers), points, outOf],
  });
  if ((insert.rowsAffected ?? 0) === 0) return fail(c, { status: 409, error: "already_answered", message: "You've already answered this one." });
  // An exam is private until the tutor reveals it; a quiz answer gives nothing away either.
  return c.json({ ok: true, accepted: true });
});

classroomRoutes.post("/sessions/:id/hand", async (c) => {
  const found = await memberSession(c);
  if (found instanceof Response) return found;
  const parsed = await readBody(c, z.object({ raised: z.boolean() }));
  if (!parsed.ok) return parsed.res;
  const quota = await consume(`live-hand:${c.get("user").sub}`, 30, 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Slow down a little.");
  await db.execute({
    sql: `UPDATE edu_live_members SET hand_raised_at = ${parsed.data.raised ? "datetime('now')" : "NULL"} WHERE session_id = ? AND user_id = ?`,
    args: [found.session.id as string, c.get("user").sub],
  });
  return c.json({ ok: true });
});


// Registered last: the sign-in requirement on these routes must not cover the screen's own endpoints above.
tvRoutes.route("/", userRoutes);
