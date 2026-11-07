import { Hono, type Context } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { isAssessment, normaliseContentType, type LearnSettings } from "@peebee/shared";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getPlatformEnvironment, type PlatformEnvironment } from "../lib/settings.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import { creditWallet, debitWallet, resolveCustomerByIdentifier } from "../wallet/service.js";
import { getLearnSettings } from "./settings.js";
import { chargeAndPayOut, splitPayment } from "./payments.js";
import { activeSubscription, quoteCoupon, releaseCoupon, reserveCoupon, salesReady, type Coupon } from "./sales.js";
import { chooseCohort, releaseSeat, reserveSeat, type Cohort } from "./cohorts.js";
import { assignmentOf, assignmentsOfCourse, learnerAssignment, pastDue, submissionsOfUser, type SubmissionRow } from "./assignments.js";
import { BADGES, afterProgress, computeLocks, courseFinished, courseRules, proReady, type Lock } from "./rewards.js";
import { mark, newSeed, parseQuiz, readAttempt, serveQuestions, signAttempt, type Answer, type StoredQuiz } from "./quiz-engine.js";
import {
  body as readBody,
  count,
  fail,
  gate,
  isResponse,
  learningReady,
  notFound,
  one,
  ownedCourse,
  ownedLesson,
  ownedSchool,
  studioReady,
  suspended,
  isCoTeacher,
  throttle,
} from "./studio.js";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const upgradePending = (c: Context) =>
  c.json({ error: "learn_upgrade_pending", message: "This part of Peebee Learn is being set up. Try again shortly." }, 503);

async function ready(): Promise<boolean> {
  return (await studioReady()) && (await learningReady());
}

export { splitPayment };

const money = z.number().int().min(1);

// ---------------------------------------------------------------------------
// Media: signed links so a <video> tag can play a file without a bearer header
// ---------------------------------------------------------------------------

const MEDIA_AUDIENCE = "peebee-learn-media";
const MEDIA_TTL = "2h";
const key = () => new TextEncoder().encode(process.env.JWT_SECRET ?? "");

export async function signMediaToken(userId: string, lessonId: string): Promise<string> {
  return new SignJWT({ lid: lessonId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("peebee-api")
    .setAudience(MEDIA_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(MEDIA_TTL)
    .sign(key());
}

/** Looks at the first bytes: the declared type came from the client, the bytes decide. */
export function sniffMedia(head: Uint8Array): { ext: string; type: string } | null {
  const is = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  const text = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (head.length >= 12 && text(4, 8) === "ftyp") {
    const brand = text(8, 12);
    if (brand === "qt  ") return { ext: "mov", type: "video/quicktime" };
    if (brand === "M4A " || brand === "M4B ") return { ext: "m4a", type: "audio/mp4" };
    return { ext: "mp4", type: "video/mp4" };
  }
  if (is(0x1a, 0x45, 0xdf, 0xa3)) return { ext: "webm", type: "video/webm" };
  if (text(0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return { ext: "mp3", type: "audio/mpeg" };
  return null;
}

async function readHead(stream: ReadableStream<Uint8Array>, want = 16): Promise<Uint8Array> {
  const reader = stream.getReader();
  let head = new Uint8Array(0);
  try {
    while (head.length < want) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const next = new Uint8Array(head.length + value.length);
      next.set(head);
      next.set(value, head.length);
      head = next;
    }
  } finally {
    // Not awaited: a tee'd branch's cancel only settles once the other branch is cancelled too.
    void reader.cancel().catch(() => undefined);
  }
  return head;
}

/** R2 needs a stream of known length; Workers provide FixedLengthStream for exactly that. */
function withKnownLength(stream: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  const Fixed = (globalThis as unknown as { FixedLengthStream?: new (n: number) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).FixedLengthStream;
  if (!Fixed) return stream;
  const { readable, writable } = new Fixed(length);
  void stream.pipeTo(writable).catch(() => undefined);
  return readable;
}

function parseRange(header: string | undefined, size: number): { offset: number; length: number } | "invalid" | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}

/** Public, token-gated. The token says who may watch which lesson and for how long. */
export const mediaRoutes = new Hono();

mediaRoutes.get("/media/:token", async (c) => {
  let lessonId: string;
  try {
    const { payload } = await jwtVerify(c.req.param("token"), key(), { issuer: "peebee-api", audience: MEDIA_AUDIENCE });
    lessonId = String(payload.lid);
  } catch {
    return c.json({ error: "link_expired", message: "This video link has expired. Reload the lesson." }, 401);
  }
  if (!(await ready())) return upgradePending(c);
  const row = await one("SELECT r2_key, content_type, size_bytes FROM edu_lesson_media WHERE lesson_id = ?", [lessonId]);
  if (!row) return c.json({ error: "not_found", message: "This lesson has no video." }, 404);
  const size = Number(row.size_bytes);
  const range = parseRange(c.req.header("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  const object = await getR2Bucket().get(String(row.r2_key), range ? { range } : undefined);
  if (!object) return c.json({ error: "not_found", message: "This video is no longer available." }, 404);
  const headers: Record<string, string> = {
    ...uploadResponseHeaders(String(row.content_type), "application/octet-stream"),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
  };
  if (range) {
    headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
    headers["Content-Length"] = String(range.length);
    return new Response(object.body, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new Response(object.body, { status: 200, headers });
});

// ---------------------------------------------------------------------------
// Educator side: uploads, students, fees
// ---------------------------------------------------------------------------

export const studioLearningRoutes = new Hono();

studioLearningRoutes.use("*", async (c, next) => {
  if (!(await learningReady())) return upgradePending(c);
  await next();
});

studioLearningRoutes.put("/lessons/:id/media", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  if (!g.settings.videoUploadsEnabled) return fail(c, { status: 503, error: "uploads_off", message: "Video uploads are switched off right now." });
  const lesson = await ownedLesson(g.userId, c.req.param("id"));
  if (!lesson) return notFound(c, "lesson");
  const course = await ownedCourse(g.userId, String(lesson.course_id));
  const school = course ? await ownedSchool(g.userId, String(course.school_id)) : null;
  if (school?.status === "suspended") return suspended(c);

  const length = Number(c.req.header("content-length"));
  if (!Number.isFinite(length) || length <= 0) return c.json({ error: "length_required", message: "Send the file with its size." }, 411);
  const limit = g.settings.maxVideoMb * 1024 * 1024;
  if (length > limit) return c.json({ error: "file_too_large", message: `Files can be up to ${g.settings.maxVideoMb} MB.` }, 413);
  const stream = c.req.raw.body;
  if (!stream) return c.json({ error: "missing_file", message: "Choose a video or audio file." }, 400);

  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  // One branch is read for the file's first bytes, the other goes to storage, so the file is never held in memory.
  const [probe, upload] = stream.tee();
  const detected = sniffMedia(await readHead(probe));
  if (!detected) {
    void upload.cancel().catch(() => undefined);
    return c.json({ error: "unsupported_file_type", message: "Use an MP4, MOV, WebM, M4A or MP3 file." }, 400);
  }

  const r2Key = `learn/${lesson.id}/${crypto.randomUUID()}.${detected.ext}`;
  await getR2Bucket().put(r2Key, withKnownLength(upload, length), { httpMetadata: { contentType: detected.type } });

  const previous = await one("SELECT r2_key FROM edu_lesson_media WHERE lesson_id = ?", [lesson.id]);
  await db.execute({
    sql: `INSERT INTO edu_lesson_media (lesson_id, r2_key, content_type, size_bytes, uploaded_by)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(lesson_id) DO UPDATE SET r2_key = excluded.r2_key, content_type = excluded.content_type,
            size_bytes = excluded.size_bytes, uploaded_by = excluded.uploaded_by, created_at = datetime('now')`,
    args: [lesson.id as string, r2Key, detected.type, length, g.userId],
  });
  if (previous?.r2_key) await getR2Bucket().delete(String(previous.r2_key)).catch(() => undefined);
  return c.json({ ok: true, media: { contentType: detected.type, sizeBytes: length } }, 201);
});

studioLearningRoutes.delete("/lessons/:id/media", async (c) => {
  const lesson = await ownedLesson(c.get("user").sub, c.req.param("id"));
  if (!lesson) return notFound(c, "lesson");
  const row = await one("SELECT r2_key FROM edu_lesson_media WHERE lesson_id = ?", [lesson.id]);
  if (row) {
    await db.execute({ sql: "DELETE FROM edu_lesson_media WHERE lesson_id = ?", args: [lesson.id as string] });
    await getR2Bucket().delete(String(row.r2_key)).catch(() => undefined);
  }
  return c.json({ ok: true });
});

/** Whether the first bytes are a JPEG, PNG or WebP picture. The type the browser claims is not trusted. */
export function sniffImage(head: Uint8Array): { ext: string; type: string } | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return { ext: "png", type: "image/png" };
  const tag = (from: number) => String.fromCharCode(...head.slice(from, from + 4));
  if (head.length >= 12 && tag(0) === "RIFF" && tag(8) === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

type CoverTable = "edu_courses" | "edu_schools";

/** Saves or clears the cover picture of a course or school the caller owns. */
async function setCover(c: Context, table: CoverTable, owned: (g: { userId: string; settings: LearnSettings }) => Promise<Row | null>, replace: boolean) {
  const g = await gate(c);
  if (isResponse(g)) return g;
  if (!(await hasColumn(table, "cover_key"))) return upgradePending(c);
  if (replace && g.settings.maxCoverMb <= 0) return fail(c, { status: 503, error: "uploads_off", message: "Cover pictures are switched off right now. A cover is drawn for you instead." });
  const row = await owned(g);
  if (!row) return notFound(c, table === "edu_courses" ? "course" : "school");

  if (!replace) {
    if (row.cover_key) {
      await db.execute({ sql: `UPDATE ${table} SET cover_key = NULL WHERE id = ?`, args: [row.id as string] });
      await getR2Bucket().delete(String(row.cover_key)).catch(() => undefined);
    }
    return c.json({ ok: true });
  }

  const length = Number(c.req.header("content-length"));
  if (!Number.isFinite(length) || length <= 0) return c.json({ error: "length_required", message: "Send the picture with its size." }, 411);
  if (length > g.settings.maxCoverMb * 1024 * 1024) return c.json({ error: "file_too_large", message: `Cover pictures can be up to ${g.settings.maxCoverMb} MB.` }, 413);
  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const detected = sniffImage(bytes);
  if (!detected || bytes.length === 0 || bytes.length > g.settings.maxCoverMb * 1024 * 1024) return c.json({ error: "unsupported_file_type", message: "Use a JPEG, PNG or WebP picture." }, 400);

  const r2Key = `learn/covers/${row.id}/${crypto.randomUUID()}.${detected.ext}`;
  await getR2Bucket().put(r2Key, bytes, { httpMetadata: { contentType: detected.type } });
  await db.execute({ sql: `UPDATE ${table} SET cover_key = ?, updated_at = datetime('now') WHERE id = ?`, args: [r2Key, row.id as string] });
  if (row.cover_key) await getR2Bucket().delete(String(row.cover_key)).catch(() => undefined);
  return c.json({ ok: true }, 201);
}

const ownedCourseRow = async (g: { userId: string }, id: string) => {
  const course = await ownedCourse(g.userId, id);
  if (!course) return null;
  const school = await ownedSchool(g.userId, String(course.school_id));
  return school?.status === "suspended" ? null : course;
};
const ownedSchoolRow = async (g: { userId: string }, id: string) => {
  const school = await ownedSchool(g.userId, id);
  return school?.status === "suspended" ? null : school;
};

studioLearningRoutes.put("/courses/:id/cover", (c) => setCover(c, "edu_courses", (g) => ownedCourseRow(g, c.req.param("id")), true));
studioLearningRoutes.delete("/courses/:id/cover", (c) => setCover(c, "edu_courses", (g) => ownedCourseRow(g, c.req.param("id")), false));
studioLearningRoutes.put("/schools/:id/cover", (c) => setCover(c, "edu_schools", (g) => ownedSchoolRow(g, c.req.param("id")), true));
studioLearningRoutes.delete("/schools/:id/cover", (c) => setCover(c, "edu_schools", (g) => ownedSchoolRow(g, c.req.param("id")), false));

studioLearningRoutes.get("/courses/:id/students", async (c) => {
  const course = await ownedCourse(c.get("user").sub, c.req.param("id"));
  if (!course) return notFound(c, "course");
  const total = await count("SELECT COUNT(*) AS n FROM edu_lessons WHERE course_id = ?", [course.id]);
  const res = await db.execute({
    sql: `SELECT e.id, e.user_id, e.price_paid_ugx, e.created_at, u.name,
                 (SELECT COUNT(*) FROM edu_lesson_progress p WHERE p.user_id = e.user_id AND p.course_id = e.course_id) AS done
          FROM edu_enrollments e JOIN users u ON u.id = e.user_id
          WHERE e.course_id = ? AND e.status = 'active' ORDER BY e.created_at DESC LIMIT 500`,
    args: [course.id as string],
  });
  return c.json({
    ok: true,
    students: (res.rows as Row[]).map((r) => ({
      userId: String(r.user_id),
      name: String(r.name),
      enrolledAt: String(r.created_at),
      paidUgx: Number(r.price_paid_ugx),
      progressPercent: total ? Math.round((Number(r.done) / total) * 100) : 0,
    })),
  });
});

const invoiceBody = z.object({
  student: z.string().trim().min(3).max(120),
  title: z.string().trim().min(2).max(120),
  amountUgx: money,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
});

const invoiceShape = (r: Row) => ({
  id: String(r.id),
  schoolId: String(r.school_id),
  schoolName: r.school_name === undefined ? undefined : String(r.school_name),
  studentId: String(r.student_id),
  studentName: r.student_name === undefined ? undefined : String(r.student_name),
  title: String(r.title),
  amountUgx: Number(r.amount_ugx),
  paidUgx: Number(r.paid_ugx),
  balanceUgx: Number(r.amount_ugx) - Number(r.paid_ugx),
  dueDate: String(r.due_date ?? ""),
  status: String(r.status),
  createdAt: String(r.created_at),
});

studioLearningRoutes.get("/schools/:id/invoices", async (c) => {
  const school = await ownedSchool(c.get("user").sub, c.req.param("id"));
  if (!school) return notFound(c, "school");
  const res = await db.execute({
    sql: `SELECT i.*, u.name AS student_name FROM edu_fee_invoices i JOIN users u ON u.id = i.student_id
          WHERE i.school_id = ? ORDER BY i.created_at DESC LIMIT 500`,
    args: [school.id as string],
  });
  return c.json({ ok: true, invoices: (res.rows as Row[]).map(invoiceShape) });
});

studioLearningRoutes.post("/schools/:id/invoices", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  if (!g.settings.feesEnabled) return fail(c, { status: 503, error: "fees_off", message: "School fees are switched off right now." });
  const school = await ownedSchool(g.userId, c.req.param("id"));
  if (!school) return notFound(c, "school");
  if (school.status === "suspended") return suspended(c);
  const parsed = await readBody(c, invoiceBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  if (d.amountUgx > g.settings.maxCoursePriceUgx * 10) {
    return fail(c, { status: 400, error: "amount_too_high", message: "That amount is higher than Peebee allows for one invoice." });
  }
  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  const student = await resolveCustomerByIdentifier(d.student);
  if (!student) return fail(c, { status: 404, error: "student_not_found", message: "No Peebee account has that phone number or email." });
  if (student.id === g.userId) return fail(c, { status: 400, error: "own_account", message: "You can't invoice your own account." });

  const id = newId("inv");
  await db.execute({
    sql: `INSERT INTO edu_fee_invoices (id, school_id, student_id, title, amount_ugx, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, school.id as string, student.id, d.title, d.amountUgx, d.dueDate, g.userId],
  });
  const row = await one("SELECT i.*, u.name AS student_name FROM edu_fee_invoices i JOIN users u ON u.id = i.student_id WHERE i.id = ?", [id]);
  return c.json({ ok: true, invoice: invoiceShape(row!) }, 201);
});

studioLearningRoutes.post("/invoices/:id/cancel", async (c) => {
  const userId = c.get("user").sub;
  const row = await one(
    `SELECT i.* FROM edu_fee_invoices i JOIN edu_schools s ON s.id = i.school_id WHERE i.id = ? AND s.owner_id = ?`,
    [c.req.param("id"), userId],
  );
  if (!row) return notFound(c, "invoice");
  if (Number(row.paid_ugx) > 0) return fail(c, { status: 409, error: "already_paid", message: "Part of this invoice has been paid, so it can't be cancelled." });
  await db.execute({ sql: "UPDATE edu_fee_invoices SET status = 'cancelled' WHERE id = ? AND paid_ugx = 0", args: [row.id as string] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Learner side
// ---------------------------------------------------------------------------

export const learnRoutes = new Hono();

learnRoutes.use("*", async (c, next) => {
  if (!(await ready())) return upgradePending(c);
  await next();
});

type Access = { course: Row; school: Row; owner: boolean };

/** The course, if this person may study it: the owner, or someone enrolled in a published course from a school in good standing. */
export async function courseAccess(userId: string, courseId: string): Promise<Access | null> {
  const course = await one("SELECT * FROM edu_courses WHERE id = ?", [courseId]);
  if (!course) return null;
  const school = await one("SELECT * FROM edu_schools WHERE id = ?", [course.school_id]);
  if (!school) return null;
  if (school.owner_id === userId || (await isCoTeacher(userId, courseId))) return { course, school, owner: true };
  if (course.status !== "published" || school.status !== "active") return null;
  const enrolled = await one("SELECT 1 AS yes FROM edu_enrollments WHERE course_id = ? AND user_id = ? AND status = 'active'", [courseId, userId]);
  if (enrolled) return { course, school, owner: false };
  // A school pass opens every published course of that school while it lasts.
  return (await activeSubscription(userId, String(school.id))) ? { course, school, owner: false } : null;
}

const quizOf = (raw: unknown): StoredQuiz | null => parseQuiz(raw);

/** How many attempts this paper allows: its own limit, never above the platform's. 0 means unlimited. */
export function attemptsAllowed(quiz: StoredQuiz, kind: "quiz" | "exam", settings: LearnSettings): number {
  const platform = kind === "exam" ? settings.examMaxAttempts : settings.quizMaxAttempts;
  const own = quiz.settings.maxAttempts;
  return platform > 0 && (own === 0 || own > platform) ? platform : own;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type LiveInfo = { startsAt: string; durationMinutes: number; url: string; notes: string };

/** A live lesson's join window: from a little before the start until a short while after it should have ended. */
function liveWindow(live: LiveInfo, settings: LearnSettings, now = Date.now()): { open: boolean; opensAt: number } {
  const start = Date.parse(live.startsAt);
  const opensAt = start - settings.liveLessonEarlyMinutes * 60_000;
  const closesAt = start + (live.durationMinutes + 30) * 60_000;
  return { open: Number.isFinite(start) && now >= opensAt && now <= closesAt, opensAt };
}

type LessonState = { done: Map<string, number | null>; media: Set<string>; attempts: Map<string, { n: number; best: number }>; locks?: Map<string, Lock>; assignments?: Map<string, import("@peebee/shared").StudioAssignment>; submissions?: Map<string, SubmissionRow> };

function lessonView(l: Row, st: LessonState, settings: LearnSettings) {
  const id = String(l.id);
  const kind = normaliseContentType(String(l.content_type));
  const quiz = quizOf(l.quiz_json);
  const live = parseJson<LiveInfo | null>(l.live_json, null);
  const slides = parseJson<unknown[]>(l.slides_json, []);
  const tries = st.attempts.get(id);
  const progressScore = st.done.get(id) ?? null;
  return {
    id,
    title: String(l.title),
    contentType: kind,
    durationMinutes: Number(l.duration_minutes),
    summary: String(l.summary ?? ""),
    contentUrl: String(l.content_url ?? ""),
    hasMedia: st.media.has(id),
    completed: st.done.has(id),
    bestScorePercent: progressScore ?? tries?.best ?? null,
    slideCount: slides.length,
    // The questions and choices are never in the course view; a learner gets them when starting an attempt.
    quiz: quiz
      ? {
          title: quiz.title,
          passingScorePercent: quiz.passingScorePercent,
          questionCount: quiz.settings.questionsPerAttempt > 0 ? Math.min(quiz.settings.questionsPerAttempt, quiz.questions.length) : quiz.questions.length,
          timeLimitMinutes: quiz.settings.timeLimitMinutes,
          attemptsAllowed: attemptsAllowed(quiz, kind === "exam" ? "exam" : "quiz", settings),
          attemptsUsed: tries?.n ?? 0,
        }
      : null,
    locked: st.locks?.get(id) ?? null,
    assignment: kind === "assignment" && st.assignments?.get(id) ? learnerAssignment(st.assignments.get(id)!, st.submissions?.get(id) ?? null) : null,
    // The meeting link is only handed out by /join, inside the join window.
    live: live ? { startsAt: live.startsAt, durationMinutes: live.durationMinutes, joinOpen: liveWindow(live, settings).open, notes: live.notes ?? "" } : null,
  };
}

async function lessonState(userId: string, courseId: string): Promise<LessonState> {
  const progress = (await db.execute({ sql: "SELECT lesson_id, best_score_percent FROM edu_lesson_progress WHERE user_id = ? AND course_id = ?", args: [userId, courseId] })).rows as Row[];
  const media = (await db.execute({ sql: "SELECT m.lesson_id FROM edu_lesson_media m JOIN edu_lessons l ON l.id = m.lesson_id WHERE l.course_id = ?", args: [courseId] })).rows as Row[];
  const tries = (await db.execute({ sql: "SELECT lesson_id, COUNT(*) AS n, MAX(score_percent) AS best FROM edu_quiz_attempts WHERE user_id = ? AND course_id = ? GROUP BY lesson_id", args: [userId, courseId] })).rows as Row[];
  return {
    done: new Map(progress.map((p) => [String(p.lesson_id), p.best_score_percent === null ? null : Number(p.best_score_percent)])),
    media: new Set(media.map((r) => String(r.lesson_id))),
    attempts: new Map(tries.map((r) => [String(r.lesson_id), { n: Number(r.n), best: Number(r.best) }])),
    assignments: await assignmentsOfCourse(courseId),
    submissions: await submissionsOfUser(userId, courseId),
  };
}

/** The locks on a course for one learner. The educator previewing their own course sees nothing locked. */
async function courseLocks(userId: string, access: Access, settings: LearnSettings, st: LessonState): Promise<{ locks: Map<string, Lock>; opens: Map<string, string>; modules: Row[]; lessons: Row[] }> {
  const id = String(access.course.id);
  let modules = (await db.execute({ sql: "SELECT * FROM edu_modules WHERE course_id = ? ORDER BY position ASC, created_at ASC LIMIT 500", args: [id] })).rows as Row[];
  let lessons = (await db.execute({ sql: "SELECT * FROM edu_lessons WHERE course_id = ? ORDER BY position ASC, created_at ASC LIMIT 5000", args: [id] })).rows as Row[];
  if(await hasTable("edu_course_drafts") && await one("SELECT course_id FROM edu_course_drafts WHERE course_id=?",[id])) {
    const {publicationFor}=await import("./creator-study.js");
    const snapshot=(await publicationFor(userId,id)).draft;
    modules=snapshot.modules.map((m)=>({id:m.id,title:m.title,description:m.description}));
    lessons=snapshot.modules.flatMap((m)=>m.lessons.map((l)=>({...lessons.find((old)=>old.id===l.id),id:l.id,module_id:m.id,course_id:id,title:l.title,duration_minutes:l.minutes,summary:"",content_type:l.nativeActivity||"text"})));
  }
  if (access.owner) return { locks: new Map(), opens: new Map(), modules, lessons };
  const { locks, opens } = await computeLocks(userId, id, settings, modules, lessons, new Set(st.done.keys()));
  return { locks, opens, modules, lessons };
}

async function lessonAccess(c: Context, lessonId: string, message: string, opts: { ignoreLock?: boolean } = {}): Promise<{ lesson: Row; access: Access } | Response> {
  const lesson = await one("SELECT * FROM edu_lessons WHERE id = ?", [lessonId]);
  const access = lesson ? await courseAccess(c.get("user").sub, String(lesson.course_id)) : null;
  if (!lesson || !access) return fail(c, { status: 403, error: "not_enrolled", message });
  if (lesson.content_type === "text" && await hasTable("edu_course_drafts") && await one("SELECT course_id FROM edu_course_drafts WHERE course_id=?",[lesson.course_id])) {
    return c.json({error:"versioned_player_required",message:"Open this course in the shared study player to use your enrolled version and practice requirements."},409);
  }
  if (!access.owner && !opts.ignoreLock) {
    const settings = await getLearnSettings();
    const st = await lessonState(c.get("user").sub, String(lesson.course_id));
    const { locks,lessons } = await courseLocks(c.get("user").sub, access, settings, st);
    if(!lessons.some((l)=>l.id===lesson.id))return c.json({error:"versioned_player_required",message:"This lesson is not part of your enrolled course version."},409);
    const lock = locks.get(String(lesson.id));
    if (lock) return fail(c, { status: 403, error: "locked", message: lock.reason === "drip" ? `This isn't open yet. ${lock.message}.` : "Finish the earlier items in this class first." });
  }
  return { lesson, access };
}

learnRoutes.get("/enrollments", async (c) => {
  const res = await db.execute({
    sql: `SELECT e.id, e.course_id, e.created_at, c.title, c.stream, c.status AS course_status, s.name AS school_name,
                 (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = c.id) AS lessons,
                 (SELECT COUNT(*) FROM edu_lesson_progress p WHERE p.user_id = e.user_id AND p.course_id = c.id) AS done
          FROM edu_enrollments e JOIN edu_courses c ON c.id = e.course_id JOIN edu_schools s ON s.id = c.school_id
          WHERE e.user_id = ? AND e.status = 'active' ORDER BY e.created_at DESC LIMIT 200`,
    args: [c.get("user").sub],
  });
  const rows = res.rows as Row[];
  // Courses reached through a school pass appear too, while the pass lasts.
  if (await salesReady()) {
    const have = new Set(rows.map((r) => String(r.course_id)));
    const via = (
      await db.execute({
        sql: `SELECT c.id AS course_id, c.title, c.stream, c.status AS course_status, s.name AS school_name, sub.started_at AS created_at,
                     (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = c.id) AS lessons,
                     (SELECT COUNT(*) FROM edu_lesson_progress p WHERE p.user_id = ? AND p.course_id = c.id) AS done
              FROM edu_subscriptions sub JOIN edu_courses c ON c.school_id = sub.school_id AND c.status = 'published' JOIN edu_schools s ON s.id = c.school_id AND s.status = 'active'
              WHERE sub.user_id = ? AND sub.expires_at > datetime('now') ORDER BY c.title ASC LIMIT 200`,
        args: [c.get("user").sub, c.get("user").sub],
      })
    ).rows as Row[];
    for (const r of via) if (!have.has(String(r.course_id))) { have.add(String(r.course_id)); rows.push({ ...r, id: `pass_${String(r.course_id)}` }); }
  }
  return c.json({
    ok: true,
    enrollments: rows.map((r) => ({
      id: String(r.id),
      courseId: String(r.course_id),
      title: String(r.title),
      stream: String(r.stream),
      schoolName: String(r.school_name),
      enrolledAt: String(r.created_at),
      lessonCount: Number(r.lessons),
      completedLessons: Number(r.done),
      progressPercent: Number(r.lessons) ? Math.round((Number(r.done) / Number(r.lessons)) * 100) : 0,
    })),
  });
});

learnRoutes.post("/courses/:id/enroll", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  if (!settings.enrolmentsEnabled) return fail(c, { status: 503, error: "enrolments_off", message: "Enrolment is switched off right now." });
  const quota = await consume(`learn-enroll:${user.sub}`, 20, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "You're enrolling very quickly. Try again in a little while.");

  const course = await one("SELECT * FROM edu_courses WHERE id = ? AND status = 'published'", [c.req.param("id")]);
  const school = course ? await one("SELECT * FROM edu_schools WHERE id = ? AND status = 'active'", [course.school_id]) : null;
  if (!course || !school) return notFound(c, "course");
  if (await hasTable("edu_course_drafts")) {
    const creator = await one("SELECT published_version FROM edu_course_drafts WHERE course_id=?", [course.id]);
    if (creator) return fail(c, { status: 409, error: "creator_checkout", message: "Open this course's learning page to accept an invitation, enroll or review its current purchase offer." });
  }
  if (school.owner_id === user.sub) return fail(c, { status: 400, error: "own_course", message: "This is your own course. You can already open it." });

  if (settings.prerequisitesEnabled) {
    const rules = await courseRules(String(course.id));
    if (rules.prerequisiteCourseId && !(await courseFinished(user.sub, rules.prerequisiteCourseId))) {
      const need = await one("SELECT title FROM edu_courses WHERE id = ?", [rules.prerequisiteCourseId]);
      return fail(c, { status: 409, error: "prereq_not_met", message: `Finish “${String(need?.title ?? "the earlier course")}” first, then you can join this one.` });
    }
  }

  const listPrice = Number(course.price_ugx);
  if (listPrice > 0 && !settings.paidCoursesEnabled) {
    return fail(c, { status: 503, error: "paid_courses_off", message: "Paid courses aren't available right now." });
  }
  // A school pass already covers this course.
  if (listPrice > 0 && (await activeSubscription(user.sub, String(school.id)))) {
    return c.json({ ok: true, enrolled: true, paidUgx: 0, viaPass: true });
  }
  let coupon: Coupon | null = null;
  let price = listPrice;
  const payload = (await c.req.json().catch(() => null)) as { coupon?: unknown; cohortId?: unknown } | null;
  const asked = payload?.coupon;
  const chosen = await chooseCohort(String(course.id), payload?.cohortId, settings);
  if (!chosen.ok) return fail(c, { status: 409, error: "cohort_needed", message: chosen.message });
  const cohort: Cohort | null = chosen.cohort;
  if (typeof asked === "string" && asked.trim() && listPrice > 0) {
    const q = await quoteCoupon(asked, course, user.sub, listPrice, settings);
    if (!q.ok) return fail(c, { status: 400, error: "coupon_invalid", message: q.message });
    coupon = q.coupon;
    price = listPrice - q.discount;
  }
  const environment = await getPlatformEnvironment();

  // Claim the seat first. The unique (course, learner) pair makes a double tap or a race lose cleanly.
  const claim = await db.execute({
    sql: `INSERT OR IGNORE INTO edu_enrollments (id, course_id, school_id, user_id, status, environment) VALUES (?, ?, ?, ?, 'pending', ?)`,
    args: [newId("enr"), course.id as string, school.id as string, user.sub, environment],
  });
  if ((claim.rowsAffected ?? 0) === 0) {
    const existing = await one("SELECT status FROM edu_enrollments WHERE course_id = ? AND user_id = ?", [course.id, user.sub]);
    if (existing?.status === "active") return fail(c, { status: 409, error: "already_enrolled", message: "You're already enrolled in this course." });
    // Someone (this learner, a moment ago) is already taking the payment. Only a claim that has sat unfinished
    // for a couple of minutes, because that attempt died midway, may be taken over.
    const reclaimed = await db.execute({
      sql: "UPDATE edu_enrollments SET created_at = datetime('now') WHERE course_id = ? AND user_id = ? AND status = 'pending' AND created_at < datetime('now', '-2 minutes')",
      args: [course.id as string, user.sub],
    });
    if ((reclaimed.rowsAffected ?? 0) === 0) {
      return fail(c, { status: 409, error: "in_progress", message: "Your enrolment is already being processed." });
    }
  }

  // A seat is taken the same way: before any money moves.
  if (cohort && !(await reserveSeat(cohort, user.sub))) {
    await db.execute({ sql: "DELETE FROM edu_enrollments WHERE course_id = ? AND user_id = ? AND status = 'pending'", args: [course.id as string, user.sub] });
    return fail(c, { status: 409, error: "cohort_full", message: "That intake just filled up. Choose another." });
  }

  // The coupon is used up before any money moves, so two taps can't use its last place twice.
  if (coupon && !(await reserveCoupon(coupon, user.sub, String(course.id), listPrice - price))) {
    if (cohort) await releaseSeat(cohort, user.sub);
    await db.execute({ sql: "DELETE FROM edu_enrollments WHERE course_id = ? AND user_id = ? AND status = 'pending'", args: [course.id as string, user.sub] });
    return fail(c, { status: 409, error: "coupon_used_up", message: "That coupon was just used up. Try again without it." });
  }

  let commission = 0;
  if (price > 0) {
    const paid = await chargeAndPayOut({
      payerId: user.sub,
      ownerId: String(school.owner_id),
      amount: price,
      commissionPercent: settings.commissionPercent,
      environment,
      note: `Peebee Learn: ${String(course.title)}`,
    }).catch(() => null);
    if (!paid || !paid.ok) {
      if (coupon) await releaseCoupon(coupon, user.sub);
      if (cohort) await releaseSeat(cohort, user.sub);
      await db.execute({ sql: "DELETE FROM edu_enrollments WHERE course_id = ? AND user_id = ? AND status = 'pending'", args: [course.id as string, user.sub] });
      return c.json({ error: "insufficient_wallet", message: `Add UGX ${price.toLocaleString("en-UG")} to your Peebee wallet to enrol.` }, 402);
    }
    commission = paid.commission;
  }
  await db.execute({
    sql: "UPDATE edu_enrollments SET status = 'active', price_paid_ugx = ?, commission_ugx = ? WHERE course_id = ? AND user_id = ?",
    args: [price, commission, course.id as string, user.sub],
  });
  return c.json({ ok: true, enrolled: true, paidUgx: price });
});

learnRoutes.get("/courses/:id", async (c) => {
  const user = c.get("user");
  const access = await courseAccess(user.sub, c.req.param("id"));
  if (!access) return fail(c, { status: 403, error: "not_enrolled", message: "Enrol in this course to open its lessons." });
  const settings = await getLearnSettings();
  const id = String(access.course.id);

  const st = await lessonState(user.sub, id);
  const lock = await courseLocks(user.sub, access, settings, st);
  st.locks = lock.locks;
  const {modules,lessons}=lock;
  const finished = !access.owner && (await proReady()) && (await courseFinished(user.sub, id));
  const certificate = finished
    ? ((await db.execute({ sql: "SELECT id FROM edu_certificates WHERE course_id = ? AND user_id = ?", args: [id, user.sub] })).rows[0] as Row | undefined)
    : undefined;
  return c.json({
    ok: true,
    owner: access.owner,
    course: {
      id,
      certificateId: certificate ? String(certificate.id) : null,
      title: String(access.course.title),
      summary: String(access.course.summary ?? ""),
      stream: String(access.course.stream),
      schoolId: String(access.course.school_id),
      schoolName: String(access.school.name),
      progressPercent: lessons.length ? Math.round((st.done.size / lessons.length) * 100) : 0,
      modules: modules.map((m) => ({
        id: String(m.id),
        title: String(m.title),
        description: String(m.description ?? ""),
        opensAt: lock.opens.get(String(m.id)) ?? null,
        lessons: lessons.filter((l) => l.module_id === m.id).map((l) => lessonView(l, st, settings)),
      })),
    },
  });
});

/** One lesson in full, for the player: the written body and the slides come only from here. */
learnRoutes.get("/lessons/:id", async (c) => {
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to open its lessons.");
  if (isResponse(found)) return found;
  const { lesson } = found;
  const settings = await getLearnSettings();
  const st = await lessonState(c.get("user").sub, String(lesson.course_id));
  return c.json({
    ok: true,
    lesson: {
      ...lessonView(lesson, st, settings),
      body: String(lesson.body ?? ""),
      slides: parseJson<unknown[]>(lesson.slides_json, []),
    },
  });
});

learnRoutes.post("/lessons/:id/media-url", async (c) => {
  const user = c.get("user");
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to watch its lessons.");
  if (isResponse(found)) return found;
  const { lesson } = found;
  const has = await one("SELECT 1 AS yes FROM edu_lesson_media WHERE lesson_id = ?", [lesson.id]);
  if (!has) return notFound(c, "video");
  const base = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
  return c.json({ ok: true, url: `${base}/v1/education/media/${await signMediaToken(user.sub, String(lesson.id))}` });
});

/** Records an attempt and, on a pass, the lesson as done with its best score. The educator previewing their own course records nothing. */
async function recordAttempt(userId: string, lesson: Row, owner: boolean, scorePercent: number, passed: boolean, answers: unknown): Promise<void> {
  if (owner) return;
  await db.execute({
    sql: "INSERT INTO edu_quiz_attempts (id, user_id, lesson_id, course_id, score_percent, passed, answers_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [newId("qza"), userId, lesson.id as string, lesson.course_id as string, scorePercent, passed ? 1 : 0, JSON.stringify(answers)],
  });
  if (passed) {
    await db.execute({
      sql: `INSERT INTO edu_lesson_progress (user_id, lesson_id, course_id, best_score_percent) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, lesson_id) DO UPDATE SET best_score_percent = MAX(COALESCE(best_score_percent, 0), excluded.best_score_percent)`,
      args: [userId, lesson.id as string, lesson.course_id as string, scorePercent],
    });
    await afterProgress(userId, String(lesson.course_id), await getLearnSettings());
  }
}

const kindOf = (lesson: Row): "quiz" | "exam" => (normaliseContentType(String(lesson.content_type)) === "exam" ? "exam" : "quiz");

/** Starts an attempt: the questions without their answers, in this attempt's own order, and a signed token to send back. */
learnRoutes.post("/lessons/:id/quiz/start", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  const quota = await consume(`learn-quiz:${user.sub}`, settings.quizAttemptsPerHour, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "That's a lot of attempts. Take a short break and try again.");
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to take its quizzes.");
  if (isResponse(found)) return found;
  const { lesson, access } = found;
  const quiz = quizOf(lesson.quiz_json);
  if (!quiz) return fail(c, { status: 404, error: "no_quiz", message: "This lesson has no quiz." });

  const allowed = attemptsAllowed(quiz, kindOf(lesson), settings);
  const used = access.owner ? 0 : await count("SELECT COUNT(*) AS n FROM edu_quiz_attempts WHERE user_id = ? AND lesson_id = ?", [user.sub, lesson.id]);
  if (!access.owner && allowed > 0 && used >= allowed) {
    return fail(c, { status: 409, error: "no_attempts_left", message: allowed === 1 ? "You've already taken this." : `You've used all ${allowed} attempts.` });
  }
  const seed = newSeed();
  return c.json({
    ok: true,
    attemptToken: await signAttempt(user.sub, String(lesson.id), seed, quiz.settings.timeLimitMinutes),
    title: quiz.title || String(lesson.title),
    passMark: quiz.passingScorePercent,
    timeLimitMinutes: quiz.settings.timeLimitMinutes,
    attemptsAllowed: allowed,
    attemptsUsed: used,
    questions: serveQuestions(quiz, seed),
  });
});

const answerValue = z.union([z.number().int().min(-1).max(100), z.array(z.number().int().min(-1).max(100)).max(20), z.boolean(), z.string().max(300), z.null()]);

/** Marks an attempt. The order the learner saw is rebuilt from the token, so nothing about the paper is stored per attempt. */
learnRoutes.post("/lessons/:id/quiz/submit", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  const parsed = await readBody(c, z.object({ attemptToken: z.string().max(2000), answers: z.record(z.string().max(60), answerValue) }));
  if (!parsed.ok) return parsed.res;
  const claims = await readAttempt(parsed.data.attemptToken);
  if (!claims || claims.userId !== user.sub || claims.lessonId !== c.req.param("id")) {
    return fail(c, { status: 400, error: "attempt_expired", message: "This attempt has expired. Start it again." });
  }
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to take its quizzes.");
  if (isResponse(found)) return found;
  const { lesson, access } = found;
  const quiz = quizOf(lesson.quiz_json);
  if (!quiz) return fail(c, { status: 404, error: "no_quiz", message: "This lesson has no quiz." });

  const kind = kindOf(lesson);
  const allowed = attemptsAllowed(quiz, kind, settings);
  const used = access.owner ? 0 : await count("SELECT COUNT(*) AS n FROM edu_quiz_attempts WHERE user_id = ? AND lesson_id = ?", [user.sub, lesson.id]);
  if (!access.owner && allowed > 0 && used >= allowed) {
    return fail(c, { status: 409, error: "no_attempts_left", message: "You've used all your attempts." });
  }
  const reveal = kind === "exam" ? settings.revealExamAnswers : settings.revealQuizAnswers;
  const marked = mark(quiz, claims.seed, parsed.data.answers as Record<string, Answer>, reveal);
  await recordAttempt(user.sub, lesson, access.owner, marked.scorePercent, marked.passed, { seed: claims.seed, answers: parsed.data.answers });
  return c.json({
    ok: true,
    scorePercent: marked.scorePercent,
    passed: marked.passed,
    passMark: quiz.passingScorePercent,
    earned: marked.earned,
    total: marked.total,
    attemptsAllowed: allowed,
    attemptsUsed: access.owner ? 0 : used + 1,
    results: marked.results,
  });
});

/**
 * The first version of the quiz endpoint: one pass, single-choice only, answers in the creator's order. Kept so a
 * TV or phone that hasn't picked up the new app yet keeps working.
 */
learnRoutes.post("/lessons/:id/quiz", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  const quota = await consume(`learn-quiz:${user.sub}`, settings.quizAttemptsPerHour, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "That's a lot of attempts. Take a short break and try again.");
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to take its quizzes.");
  if (isResponse(found)) return found;
  const { lesson, access } = found;
  const quiz = quizOf(lesson.quiz_json);
  if (!quiz) return fail(c, { status: 404, error: "no_quiz", message: "This lesson has no quiz." });
  const plain: StoredQuiz = { ...quiz, settings: { ...quiz.settings, shuffleOptions: false, shuffleQuestions: false, questionsPerAttempt: 0 } };

  const parsed = await readBody(c, z.object({ answers: z.array(z.number().int().min(-1).max(20)).length(plain.questions.length) }));
  if (!parsed.ok) return parsed.res;
  const sheet: Record<string, Answer> = {};
  plain.questions.forEach((q, i) => (sheet[q.id] = parsed.data.answers[i]));
  const marked = mark(plain, 0, sheet, true);
  await recordAttempt(user.sub, lesson, access.owner, marked.scorePercent, marked.passed, parsed.data.answers);
  return c.json({
    ok: true,
    scorePercent: marked.scorePercent,
    passed: marked.passed,
    passMark: plain.passingScorePercent,
    results: marked.results.map((r, i) => ({
      correct: r.correct,
      ...(marked.passed ? { correctIndex: plain.questions[i].correctIndex, explanation: plain.questions[i].explanation ?? "" } : {}),
    })),
  });
});

/** Joining a live lesson: inside the join window the learner gets the meeting link and is marked as attending. */
learnRoutes.post("/lessons/:id/join", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to join its live lessons.");
  if (isResponse(found)) return found;
  const { lesson, access } = found;
  const live = parseJson<LiveInfo | null>(lesson.live_json, null);
  if (!live) return fail(c, { status: 404, error: "not_live", message: "This isn't a live lesson." });
  if (!settings.liveLessonsEnabled) return fail(c, { status: 503, error: "live_off", message: "Live video lessons are switched off right now." });
  const win = liveWindow(live, settings);
  if (!win.open) {
    const past = Date.now() > win.opensAt;
    return fail(c, {
      status: 409,
      error: past ? "live_over" : "live_not_open",
      message: past ? "This live lesson has finished." : `You can join from ${new Date(win.opensAt).toISOString()}.`,
    });
  }
  if (!access.owner) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO edu_live_attendance (lesson_id, user_id, course_id) VALUES (?, ?, ?)",
      args: [lesson.id as string, user.sub, lesson.course_id as string],
    });
    await db.execute({
      sql: "INSERT OR IGNORE INTO edu_lesson_progress (user_id, lesson_id, course_id) VALUES (?, ?, ?)",
      args: [user.sub, lesson.id as string, lesson.course_id as string],
    });
    await afterProgress(user.sub, String(lesson.course_id), settings);
  }
  return c.json({ ok: true, url: live.url });
});

learnRoutes.post("/lessons/:id/complete", async (c) => {
  const user = c.get("user");
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to track your progress.");
  if (isResponse(found)) return found;
  const { lesson, access } = found;
  if (isAssessment(normaliseContentType(String(lesson.content_type))) || quizOf(lesson.quiz_json)) {
    return fail(c, { status: 409, error: "pass_quiz_first", message: "Pass the quiz to complete this." });
  }
  if (normaliseContentType(String(lesson.content_type)) === "live") {
    return fail(c, { status: 409, error: "join_first", message: "Join the live lesson to complete it." });
  }
  if (normaliseContentType(String(lesson.content_type)) === "assignment") {
    return fail(c, { status: 409, error: "hand_in_first", message: "Hand in your work. It counts as done once your tutor has marked it." });
  }
  if (!access.owner) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO edu_lesson_progress (user_id, lesson_id, course_id) VALUES (?, ?, ?)",
      args: [user.sub, lesson.id as string, lesson.course_id as string],
    });
    await afterProgress(user.sub, String(lesson.course_id), await getLearnSettings());
  }
  return c.json({ ok: true });
});

// ---- Assignments ------------------------------------------------------------

learnRoutes.post("/lessons/:id/submission", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  if (!settings.assignmentsEnabled) return fail(c, { status: 503, error: "assignments_off", message: "Assignments are switched off right now." });
  const quota = await consume(`learn-submit:${user.sub}`, 60, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "You're handing in a lot of work. Try again in a little while.");
  const found = await lessonAccess(c, c.req.param("id"), "Enrol in this course to hand in work.");
  if (isResponse(found)) return found;
  const { lesson, access } = found;
  const a = await assignmentOf(String(lesson.id));
  if (!a) return fail(c, { status: 404, error: "not_assignment", message: "This isn't an assignment." });
  if (access.owner) return fail(c, { status: 400, error: "own_course", message: "This is your own course, so there's nothing to hand in." });

  const parsed = await readBody(c, z.object({ body: z.string().max(settings.maxSubmissionChars).default(""), link: z.string().max(500).default("") }));
  if (!parsed.ok) return parsed.res;
  const text = (parsed.data.body as string).trim();
  const link = (parsed.data.link as string).trim();
  if (!text && !link) return fail(c, { status: 400, error: "empty", message: "Write your answer or add a link to your work." });
  if (link && !/^https:\/\//i.test(link)) return fail(c, { status: 400, error: "bad_link", message: "Links must start with https://" });
  if (pastDue(a)) return fail(c, { status: 409, error: "past_due", message: "The deadline for this has passed." });

  const existing = ((await db.execute({ sql: "SELECT * FROM edu_submissions WHERE lesson_id = ? AND user_id = ?", args: [lesson.id as string, user.sub] })).rows[0] as Row | undefined) ?? null;
  if (existing) {
    const view = learnerAssignment(a, { body: String(existing.body), link: String(existing.link), status: existing.status === "graded" ? "graded" : "submitted", score: existing.score === null ? null : Number(existing.score), feedback: String(existing.feedback ?? ""), submittedAt: String(existing.submitted_at) });
    if (!view.open) return fail(c, { status: 409, error: "closed", message: a.allowResubmit ? "You've already passed this." : "You've already handed this in." });
    await db.execute({
      sql: "UPDATE edu_submissions SET body = ?, link = ?, status = 'submitted', score = NULL, feedback = '', submitted_at = datetime('now'), graded_at = NULL, graded_by = NULL WHERE id = ?",
      args: [text, link, existing.id as string],
    });
    // A new hand-in is not done until it is marked again.
    await db.execute({ sql: "DELETE FROM edu_lesson_progress WHERE user_id = ? AND lesson_id = ?", args: [user.sub, lesson.id as string] });
  } else {
    await db.execute({
      sql: "INSERT INTO edu_submissions (id, lesson_id, course_id, user_id, body, link) VALUES (?, ?, ?, ?, ?, ?)",
      args: [newId("sub"), lesson.id as string, lesson.course_id as string, user.sub, text, link],
    });
  }
  return c.json({ ok: true });
});

// ---- Certificates and badges ------------------------------------------------

const certShape = (r: Row) => ({
  id: String(r.id),
  code: String(r.code),
  courseId: String(r.course_id),
  courseTitle: String(r.course_title),
  schoolName: String(r.school_name),
  learnerName: String(r.learner_name),
  scorePercent: r.score_percent === null || r.score_percent === undefined ? null : Number(r.score_percent),
  issuedAt: String(r.issued_at),
});

learnRoutes.get("/certificates", async (c) => {
  if (!(await proReady())) return c.json({ ok: true, certificates: [] });
  const rows = (await db.execute({ sql: "SELECT * FROM edu_certificates WHERE user_id = ? ORDER BY issued_at DESC LIMIT 200", args: [c.get("user").sub] })).rows as Row[];
  return c.json({ ok: true, certificates: rows.map(certShape) });
});

learnRoutes.get("/certificates/:id", async (c) => {
  if (!(await proReady())) return notFound(c, "certificate");
  const row = await one("SELECT * FROM edu_certificates WHERE id = ? AND user_id = ?", [c.req.param("id"), c.get("user").sub]);
  return row ? c.json({ ok: true, certificate: certShape(row) }) : notFound(c, "certificate");
});

learnRoutes.get("/badges", async (c) => {
  const settings = await getLearnSettings();
  const earned = (await proReady()) ? ((await db.execute({ sql: "SELECT badge, awarded_at FROM edu_badges WHERE user_id = ?", args: [c.get("user").sub] })).rows as Row[]) : [];
  const got = new Map(earned.map((r) => [String(r.badge), String(r.awarded_at)]));
  return c.json({
    ok: true,
    enabled: settings.badgesEnabled,
    badges: BADGES.map((b) => ({
      key: b.key,
      title: b.title,
      description: b.key === "multi_course" ? `Finish ${settings.badgeCoursesThreshold} courses` : b.description,
      icon: b.icon,
      awardedAt: got.get(b.key) ?? null,
    })),
  });
});

// ---- School fees, paid from the learner's wallet ---------------------------

learnRoutes.get("/invoices", async (c) => {
  const res = await db.execute({
    sql: `SELECT i.*, s.name AS school_name FROM edu_fee_invoices i JOIN edu_schools s ON s.id = i.school_id
          WHERE i.student_id = ? AND i.status != 'cancelled' ORDER BY i.created_at DESC LIMIT 200`,
    args: [c.get("user").sub],
  });
  return c.json({ ok: true, invoices: (res.rows as Row[]).map(invoiceShape) });
});

learnRoutes.post("/invoices/:id/pay", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  if (!settings.feesEnabled) return fail(c, { status: 503, error: "fees_off", message: "School fees are switched off right now." });
  const quota = await consume(`learn-pay:${user.sub}`, 20, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many payments in a short time. Try again later.");
  const parsed = await readBody(c, z.object({ amountUgx: money }));
  if (!parsed.ok) return parsed.res;
  const amount: number = parsed.data.amountUgx;

  const invoice = await one(
    `SELECT i.*, s.owner_id, s.name AS school_name, s.status AS school_status FROM edu_fee_invoices i JOIN edu_schools s ON s.id = i.school_id WHERE i.id = ? AND i.student_id = ?`,
    [c.req.param("id"), user.sub],
  );
  if (!invoice || invoice.status === "cancelled") return notFound(c, "invoice");
  if (invoice.school_status !== "active") return fail(c, { status: 403, error: "school_suspended", message: "This school isn't taking payments right now." });
  if (invoice.status === "paid") return fail(c, { status: 409, error: "already_paid", message: "This invoice is already paid." });
  const environment = await getPlatformEnvironment();

  // Reserve the amount first. The condition stops two taps from paying more than is owed.
  const reserve = await db.execute({
    sql: `UPDATE edu_fee_invoices SET paid_ugx = paid_ugx + ?,
            status = CASE WHEN paid_ugx + ? >= amount_ugx THEN 'paid' ELSE 'partial' END
          WHERE id = ? AND student_id = ? AND status IN ('unpaid', 'partial') AND paid_ugx + ? <= amount_ugx`,
    args: [amount, amount, invoice.id as string, user.sub, amount],
  });
  if ((reserve.rowsAffected ?? 0) === 0) {
    return fail(c, { status: 400, error: "amount_too_high", message: "That's more than the balance on this invoice." });
  }

  const undo = () =>
    db.execute({
      sql: `UPDATE edu_fee_invoices SET paid_ugx = paid_ugx - ?, status = CASE WHEN paid_ugx - ? <= 0 THEN 'unpaid' ELSE 'partial' END WHERE id = ?`,
      args: [amount, amount, invoice.id as string],
    });

  let paid: Awaited<ReturnType<typeof chargeAndPayOut>>;
  try {
    paid = await chargeAndPayOut({
      payerId: user.sub,
      ownerId: String(invoice.owner_id),
      amount,
      commissionPercent: settings.commissionPercent,
      environment,
      note: `School fees: ${String(invoice.title)} (${String(invoice.school_name)})`,
    });
  } catch {
    // The payer was already refunded by chargeAndPayOut; release the reserved amount.
    await undo();
    return c.json({ error: "payment_failed", message: "The payment didn't go through and you haven't been charged. Try again." }, 502);
  }
  if (!paid.ok) {
    await undo();
    return c.json({ error: "insufficient_wallet", message: `Add UGX ${amount.toLocaleString("en-UG")} to your Peebee wallet to pay this.` }, 402);
  }
  const receiptId = newId("rcp");
  await db.execute({
    sql: "INSERT INTO edu_fee_payments (id, invoice_id, payer_id, amount_ugx, commission_ugx, environment) VALUES (?, ?, ?, ?, ?, ?)",
    args: [receiptId, invoice.id as string, user.sub, amount, paid.commission, environment],
  });
  const fresh = await one("SELECT i.*, s.name AS school_name FROM edu_fee_invoices i JOIN edu_schools s ON s.id = i.school_id WHERE i.id = ?", [invoice.id]);
  return c.json({ ok: true, receiptId, invoice: invoiceShape(fresh!) });
});

export type { LearnSettings };
