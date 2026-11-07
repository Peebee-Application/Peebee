import { patchSchema } from "../lib/patch-schema.js";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  CURRICULUM_FRAMEWORKS,
  EDUCATION_STREAM_IDS,
  SCHOOL_KINDS,
  isAssessment,
  normaliseContentType,
  STUDIO_TEXT_LIMITS,
  type EducationStream,
  type LearnSettings,
  type StudioClass,
  type StudioCourse,
  type StudioCourseDetail,
  type StudioLesson,
  type StudioModule,
  type StudioQuiz,
  type StudioSchool,
} from "@peebee/shared";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getR2Bucket } from "../storage/r2.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import { hasColumn, hasTable, tablesExist } from "../lib/schema.js";
import { getLearnSettings } from "./settings.js";
import { normaliseQuestion, parseQuiz as readQuiz } from "./quiz-engine.js";
import { afterProgress, courseRules, dripDays, proReady } from "./rewards.js";
import { assignmentOf, assignmentsOfCourse, assignmentsReady, saveAssignment } from "./assignments.js";

/**
 * The Learn Studio: school → class (or masterclass) → course → module → lesson.
 * Everything here belongs to the signed-in educator; every lookup goes through
 * the owner so one educator can never read or change another's work. Limits and
 * switches come from Admin (LearnSettings), not from constants in this file.
 */
export const studioRoutes = new Hono();

type Row = Record<string, unknown>;
type Fail = { status: 400 | 403 | 404 | 409 | 429 | 503; error: string; message: string };

const L = STUDIO_TEXT_LIMITS;
const STREAMS = EDUCATION_STREAM_IDS as readonly [string, ...string[]];
const FRAMEWORKS = CURRICULUM_FRAMEWORKS.map((f) => f.id) as [string, ...string[]];
const SCHOOL_KIND_IDS = SCHOOL_KINDS.map((k) => k.id) as [string, ...string[]];

// ---------------------------------------------------------------------------
// Readiness: the tables come from migration 0109, which is applied by hand.
// ---------------------------------------------------------------------------

let readyCache: { at: number; ok: boolean } | null = null;

export async function studioReady(): Promise<boolean> {
  if (readyCache && (readyCache.ok || Date.now() - readyCache.at < 30_000)) return readyCache.ok;
  let ok = false;
  try {
    ok = await tablesExist(["edu_schools", "edu_classes", "edu_courses", "edu_modules", "edu_lessons"]);
  } catch {
    ok = false;
  }
  readyCache = { at: Date.now(), ok };
  return ok;
}

export function resetStudioCache(): void {
  readyCache = null;
  learningCache = null;
}

let learningCache: { at: number; ok: boolean } | null = null;

/** Migration 0111 (media, enrolment, grading, fees). Those features answer "upgrade pending" until it is applied. */
export async function learningReady(): Promise<boolean> {
  if (learningCache && (learningCache.ok || Date.now() - learningCache.at < 30_000)) return learningCache.ok;
  let ok = false;
  try {
    ok = await tablesExist(["edu_lesson_media", "edu_enrollments", "edu_lesson_progress", "edu_quiz_attempts", "edu_exam_submissions", "edu_fee_invoices", "edu_fee_payments"]);
  } catch {
    ok = false;
  }
  learningCache = { at: Date.now(), ok };
  return ok;
}

/** The uploaded file for each lesson, when the table exists. */
export async function mediaByLesson(courseId: string): Promise<Map<string, NonNullable<StudioLesson["media"]>>> {
  const map = new Map<string, NonNullable<StudioLesson["media"]>>();
  if (!(await learningReady())) return map;
  const res = await db.execute({
    sql: "SELECT m.lesson_id, m.content_type, m.size_bytes FROM edu_lesson_media m JOIN edu_lessons l ON l.id = m.lesson_id WHERE l.course_id = ?",
    args: [courseId],
  });
  for (const r of res.rows as Row[]) map.set(String(r.lesson_id), { contentType: String(r.content_type), sizeBytes: Number(r.size_bytes) });
  return map;
}

studioRoutes.use("*", async (c, next) => {
  if (!(await studioReady())) {
    return c.json({ error: "learn_upgrade_pending", message: "Peebee Learn Studio is being set up. Try again shortly." }, 503);
  }
  // Once adopted by shared authoring, mutate the draft/version contract rather than older partial lesson payloads.
  if (!["GET", "HEAD"].includes(c.req.method) && await hasTable("edu_course_drafts")) {
    const path = c.req.path;
    if(c.req.method === "DELETE") {
      const parent=/\/(schools|classes)\/([^/]+)$/.exec(path);
      if(parent && await one(`SELECT d.course_id FROM edu_course_drafts d JOIN edu_courses c ON c.id=d.course_id WHERE c.${parent[1]==="schools"?"school_id":"class_id"}=? LIMIT 1`,[parent[2]])) {
        return c.json({error:"version_history_exists",message:"This contains versioned learning content. Keep it to preserve learner access and review history."},409);
      }
    }
    const courseMatch = /\/courses\/([^/]+)(?:\/(modules|order))?$/.exec(path);
    const moduleMatch = /\/modules\/([^/]+)(?:\/lessons)?$/.exec(path);
    const lessonMatch = /\/lessons\/([^/]+)(?:\/media)?$/.exec(path);
    let courseId = courseMatch?.[1];
    if (moduleMatch) courseId = String((await one("SELECT course_id FROM edu_modules WHERE id=?", [moduleMatch[1]]))?.course_id || "");
    if (lessonMatch) courseId = String((await one("SELECT course_id FROM edu_lessons WHERE id=?", [lessonMatch[1]]))?.course_id || "");
    if (courseId && await one("SELECT course_id FROM edu_course_drafts WHERE course_id=?", [courseId]) && await ownedCourse(c.get("user").sub, courseId)) {
      return c.json({ error: "creator_editor_required", message: "Open shared course authoring to edit this versioned course without losing rich content or review history." }, 409);
    }
  }
  await next();
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Plain text only: trims, drops control characters and collapses runaway whitespace. React escapes output, this keeps stored text clean. */
const text = (max: number, min = 0) =>
  z
    .string()
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().min(min).max(max));

const httpsUrl = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .max(L.url)
      .refine((v) => {
        if (v === "") return true;
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      }, "Use a full https:// link"),
  );

const quizSchema = z
  .object({
    title: text(L.name, 1),
    passingScorePercent: z.number().int().min(0).max(100),
    questions: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    settings: patchSchema(z
      .object({
        timeLimitMinutes: z.number().int().min(0).max(600),
        maxAttempts: z.number().int().min(0).max(50),
        shuffleQuestions: z.boolean(),
        shuffleOptions: z.boolean(),
        questionsPerAttempt: z.number().int().min(0).max(200),
      }))
      .optional(),
  })
  .superRefine((q, ctx) => {
    q.questions.forEach((x, i) => {
      if (!normaliseQuestion(x, i)) ctx.addIssue({ code: "custom", path: ["questions", i], message: `Question ${i + 1} is incomplete, or its right answer isn't set` });
    });
  })
  .transform((q) => readQuiz(q)!)
  .nullable();

const schoolBody = z.object({
  name: text(L.name, 2),
  kind: z.enum(SCHOOL_KIND_IDS),
  streams: z.array(z.enum(STREAMS)).min(1).max(STREAMS.length),
  tagline: text(L.short).default(""),
  bio: text(L.long).default(""),
  location: text(L.short).default(""),
  motto: text(L.short).default(""),
  badge: text(L.name).default(""),
  contactEmail: text(L.name).pipe(z.union([z.literal(""), z.string().email()])).default(""),
  contactPhone: text(40).default(""),
});

const classBody = z.object({
  stream: z.enum(STREAMS),
  kind: z.enum(["class", "masterclass"]).default("class"),
  name: text(L.name, 2),
  level: text(L.name).default(""),
  framework: z.enum(FRAMEWORKS).default("open_syllabus"),
  academicYear: text(40).default(""),
  term: text(60).default(""),
  teacherName: text(L.name).default(""),
  capacity: z.number().int().min(1).max(100_000).default(40),
  summary: text(L.long).default(""),
});

const courseBody = z.object({
  title: text(L.name, 2),
  summary: text(L.long).default(""),
  priceUgx: z.number().int().min(0).default(0),
  framework: z.enum(FRAMEWORKS).optional(),
  outcomes: z.array(text(L.short, 1)).max(12).default([]),
});

const moduleBody = z.object({ title: text(L.name, 2), description: text(L.long).default("") });

const slideSchema = z.object({ title: text(L.name), body: text(4000).default(""), imageUrl: httpsUrl.default("") });

const liveSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(1440),
  url: httpsUrl.pipe(z.string().min(1, "Add the meeting link")),
  notes: text(L.long).default(""),
});

const assignmentSchema = z.object({
  maxPoints: z.number().int().min(1).max(1000).default(100),
  passPercent: z.number().int().min(0).max(100).default(50),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  allowResubmit: z.boolean().default(true),
});

const lessonBody = z.object({
  title: text(L.name, 2),
  // Older clients still send the earlier type names; they're read as the current ones.
  contentType: z.string().max(40).transform(normaliseContentType).default("video"),
  durationMinutes: z.number().int().min(1).default(10),
  summary: text(L.long).default(""),
  contentUrl: httpsUrl.default(""),
  body: z.string().max(100_000).default(""),
  slides: z.array(slideSchema).max(100).default([]),
  live: liveSchema.nullable().optional(),
  assignment: assignmentSchema.nullable().optional(),
  quiz: quizSchema.optional(),
});

export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, res: c.json({ error: "invalid_body", message: `${where}${issue?.message ?? "Invalid request"}`, issues: parsed.error.issues }, 400) };
}

export const fail = (c: Context, f: Fail) => c.json({ error: f.error, message: f.message }, f.status);

/** Stops one educator creating things faster than Admin allows (all create endpoints share one budget). */
export async function throttle(c: Context, userId: string, settings: LearnSettings): Promise<Response | null> {
  const quota = await consume(`learn-create:${userId}`, settings.createsPerHour, 60 * 60);
  return quota.allowed ? null : tooManyRequests(c, quota, "You're creating things very quickly. Take a short break and try again.");
}

export async function gate(c: Context): Promise<{ settings: LearnSettings; userId: string } | Response> {
  const settings = await getLearnSettings();
  if (!settings.enabled) {
    return fail(c, { status: 503, error: "service_disabled", message: "Peebee Learn Studio is switched off right now." });
  }
  return { settings, userId: c.get("user").sub };
}

export const isResponse = (v: unknown): v is Response => v instanceof Response;

// ---------------------------------------------------------------------------
// Ownership. Every id from the URL is resolved *through* the signed-in owner.
// A row that exists but belongs to someone else is reported as 404, not 403.
// ---------------------------------------------------------------------------

export async function one(sql: string, args: unknown[]): Promise<Row | null> {
  return ((await db.execute({ sql, args: args as never })).rows[0] as Row | undefined) ?? null;
}

export const ownedSchool = (userId: string, id: string) => one("SELECT * FROM edu_schools WHERE id = ? AND owner_id = ?", [id, userId]);
export const ownedClass = (userId: string, id: string) =>
  one("SELECT c.* FROM edu_classes c JOIN edu_schools s ON s.id = c.school_id WHERE c.id = ? AND s.owner_id = ?", [id, userId]);
/**
 * A course, its sections and its items are open to the school owner and to the teachers added to the course.
 * The extra-teacher lookup waits for migration 0120; until then only the owner has access.
 */
const coTeaching = async (userId: string, courseId: string) =>
  (await hasTable("edu_course_instructors")) && !!(await one("SELECT 1 AS y FROM edu_course_instructors WHERE course_id = ? AND user_id = ?", [courseId, userId]));

export const isCoTeacher = coTeaching;

export async function ownedCourse(userId: string, id: string): Promise<Row | null> {
  const owned = await one("SELECT c.* FROM edu_courses c JOIN edu_schools s ON s.id = c.school_id WHERE c.id = ? AND s.owner_id = ?", [id, userId]);
  if (owned) return owned;
  return (await coTeaching(userId, id)) ? one("SELECT * FROM edu_courses WHERE id = ?", [id]) : null;
}

export async function ownedModule(userId: string, id: string): Promise<Row | null> {
  const owned = await one(`SELECT m.* FROM edu_modules m JOIN edu_courses c ON c.id = m.course_id JOIN edu_schools s ON s.id = c.school_id WHERE m.id = ? AND s.owner_id = ?`, [id, userId]);
  if (owned) return owned;
  const mod = await one("SELECT * FROM edu_modules WHERE id = ?", [id]);
  return mod && (await coTeaching(userId, String(mod.course_id))) ? mod : null;
}

export async function ownedLesson(userId: string, id: string): Promise<Row | null> {
  const owned = await one(`SELECT l.* FROM edu_lessons l JOIN edu_courses c ON c.id = l.course_id JOIN edu_schools s ON s.id = c.school_id WHERE l.id = ? AND s.owner_id = ?`, [id, userId]);
  if (owned) return owned;
  const lesson = await one("SELECT * FROM edu_lessons WHERE id = ?", [id]);
  return lesson && (await coTeaching(userId, String(lesson.course_id))) ? lesson : null;
}

export const notFound = (c: Context, what: string) => fail(c, { status: 404, error: "not_found", message: `That ${what} wasn't found.` });
export const suspended = (c: Context) =>
  fail(c, { status: 403, error: "school_suspended", message: "This school has been suspended. Contact Peebee support to have it restored." });

export async function count(sql: string, args: unknown[]): Promise<number> {
  return Number(((await one(sql, args)) ?? { n: 0 }).n);
}


// ---------------------------------------------------------------------------
// Deleting content that learners may already use
// ---------------------------------------------------------------------------

/** Active learners in the courses selected by `courseIds` (a SELECT of course ids). Deleting would take away what they paid for. */
async function learnersIn(courseIds: string, args: unknown[]): Promise<number> {
  if (!(await learningReady())) return 0;
  return count(`SELECT COUNT(*) AS n FROM edu_enrollments WHERE status = 'active' AND course_id IN (${courseIds})`, args);
}

const hasLearnersResponse = (c: Context) =>
  fail(c, { status: 409, error: "has_learners", message: "Learners are enrolled here, so it can't be deleted. Unpublish the course instead and it will stop appearing in the catalogue." });

/** Removes lesson media, progress, attempts and leftover claims for the given lessons (a SELECT of lesson ids), and the stored files. */
async function purgeLessonData(lessonIds: string, args: unknown[]): Promise<void> {
  if (!(await learningReady())) return;
  const keys = ((await db.execute({ sql: `SELECT r2_key FROM edu_lesson_media WHERE lesson_id IN (${lessonIds})`, args: args as never })).rows as Row[]).map((r) => String(r.r2_key));
  await db.execute({ sql: `DELETE FROM edu_lesson_media WHERE lesson_id IN (${lessonIds})`, args: args as never });
  await db.execute({ sql: `DELETE FROM edu_lesson_progress WHERE lesson_id IN (${lessonIds})`, args: args as never });
  await db.execute({ sql: `DELETE FROM edu_quiz_attempts WHERE lesson_id IN (${lessonIds})`, args: args as never });
  // Assignments come with migration 0118.
  for (const table of ["edu_submissions", "edu_assignments"]) {
    await db.execute({ sql: `DELETE FROM ${table} WHERE lesson_id IN (${lessonIds})`, args: args as never }).catch((err) => {
      if (!/no such table/i.test(String(err))) throw err;
    });
  }
  // Live attendance comes with migration 0116.
  await db.execute({ sql: `DELETE FROM edu_live_attendance WHERE lesson_id IN (${lessonIds})`, args: args as never }).catch((err) => {
    if (!/no such table/i.test(String(err))) throw err;
  });
  for (const key of keys) await getR2Bucket().delete(key).catch(() => undefined);
}

/** Removes live classroom sessions (and their cues, members and answers) that point at the given rows; a no-op until migration 0112 is applied. */
async function purgeLiveSessions(column: "school_id" | "class_id" | "course_id", values: string, args: unknown[]): Promise<void> {
  const sessions = `SELECT id FROM edu_live_sessions WHERE ${column} IN (${values})`;
  try {
    for (const table of ["edu_live_responses", "edu_live_members", "edu_live_cues"]) {
      await db.execute({ sql: `DELETE FROM ${table} WHERE session_id IN (${sessions})`, args: args as never });
    }
    await db.execute({ sql: `DELETE FROM edu_live_sessions WHERE ${column} IN (${values})`, args: args as never });
  } catch (err) {
    if (!/no such table/i.test(String(err))) throw err;
  }
}

/** Same for whole courses: everything of the lessons, plus unfinished enrolment claims. */
async function purgeCourseData(courseIds: string, args: unknown[]): Promise<void> {
  // Rules, drip and certificates come with migration 0117.
  const tolerate = (err: unknown) => {
    if (!/no such table/i.test(String(err))) throw err;
  };
  await db.execute({ sql: `DELETE FROM edu_module_drip WHERE module_id IN (SELECT id FROM edu_modules WHERE course_id IN (${courseIds}))`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `UPDATE edu_course_rules SET prerequisite_course_id = NULL WHERE prerequisite_course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_course_rules WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_certificates WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_answers WHERE question_id IN (SELECT id FROM edu_questions WHERE course_id IN (${courseIds}))`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_questions WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_reviews WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_announcements WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_cohort_members WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_cohorts WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_course_instructors WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_bundle_courses WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_coupon_redemptions WHERE coupon_id IN (SELECT id FROM edu_coupons WHERE course_id IN (${courseIds}))`, args: args as never }).catch(tolerate);
  await db.execute({ sql: `DELETE FROM edu_coupons WHERE course_id IN (${courseIds})`, args: args as never }).catch(tolerate);
  await purgeLessonData(`SELECT id FROM edu_lessons WHERE course_id IN (${courseIds})`, args);
  if (await learningReady()) await db.execute({ sql: `DELETE FROM edu_enrollments WHERE course_id IN (${courseIds})`, args: args as never });
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function streamList(raw: unknown): StudioSchool["streams"] {
  const wanted = new Set(String(raw ?? "").split(","));
  return EDUCATION_STREAM_IDS.filter((s) => wanted.has(s));
}

function parseQuiz(raw: unknown): StudioQuiz | null {
  return typeof raw === "string" && raw ? (readQuiz(raw) as StudioQuiz | null) : null;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseOutcomes(raw: unknown): string[] {
  try {
    const list = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const schoolShape = (r: Row): StudioSchool => ({
  id: String(r.id),
  name: String(r.name),
  slug: String(r.slug),
  kind: String(r.kind) as StudioSchool["kind"],
  streams: streamList(r.streams),
  tagline: String(r.tagline ?? ""),
  bio: String(r.bio ?? ""),
  location: String(r.location ?? ""),
  motto: String(r.motto ?? ""),
  badge: String(r.badge ?? ""),
  contactEmail: String(r.contact_email ?? ""),
  contactPhone: String(r.contact_phone ?? ""),
  status: r.status === "suspended" ? "suspended" : "active",
  createdAt: String(r.created_at),
  classCount: Number(r.class_count ?? 0),
  courseCount: Number(r.course_count ?? 0),
  publishedCourseCount: Number(r.published_count ?? 0),
  lessonCount: Number(r.lesson_count ?? 0),
});

const classShape = (r: Row): StudioClass => ({
  id: String(r.id),
  schoolId: String(r.school_id),
  stream: String(r.stream) as StudioClass["stream"],
  kind: r.kind === "masterclass" ? "masterclass" : "class",
  name: String(r.name),
  level: String(r.level ?? ""),
  framework: String(r.framework) as StudioClass["framework"],
  academicYear: String(r.academic_year ?? ""),
  term: String(r.term ?? ""),
  teacherName: String(r.teacher_name ?? ""),
  capacity: Number(r.capacity ?? 0),
  summary: String(r.summary ?? ""),
  status: r.status === "published" ? "published" : "draft",
  courseCount: Number(r.course_count ?? 0),
});

const courseShape = (r: Row): StudioCourse => ({
  id: String(r.id),
  schoolId: String(r.school_id),
  classId: String(r.class_id),
  stream: String(r.stream) as StudioCourse["stream"],
  title: String(r.title),
  summary: String(r.summary ?? ""),
  priceUgx: Number(r.price_ugx ?? 0),
  framework: String(r.framework) as StudioCourse["framework"],
  outcomes: parseOutcomes(r.outcomes_json),
  status: r.status === "published" ? "published" : "draft",
  moduleCount: Number(r.module_count ?? 0),
  lessonCount: Number(r.lesson_count ?? 0),
  createdAt: String(r.created_at),
});

const lessonShape = (r: Row, media: StudioLesson["media"] = null): StudioLesson => ({
  id: String(r.id),
  moduleId: String(r.module_id),
  courseId: String(r.course_id),
  title: String(r.title),
  contentType: normaliseContentType(String(r.content_type)),
  durationMinutes: Number(r.duration_minutes ?? 0),
  summary: String(r.summary ?? ""),
  contentUrl: String(r.content_url ?? ""),
  position: Number(r.position ?? 0),
  body: String(r.body ?? ""),
  slides: parseJson<StudioLesson["slides"]>(r.slides_json, []),
  live: parseJson<StudioLesson["live"]>(r.live_json, null),
  quiz: parseQuiz(r.quiz_json),
  media,
});

const moduleShape = (r: Row, lessons: StudioLesson[] = []): StudioModule => ({
  id: String(r.id),
  courseId: String(r.course_id),
  title: String(r.title),
  description: String(r.description ?? ""),
  position: Number(r.position ?? 0),
  lessons,
});

const SCHOOL_COUNTS = `(SELECT COUNT(*) FROM edu_classes c WHERE c.school_id = s.id) AS class_count,
                       (SELECT COUNT(*) FROM edu_courses c WHERE c.school_id = s.id) AS course_count,
                       (SELECT COUNT(*) FROM edu_courses c WHERE c.school_id = s.id AND c.status = 'published') AS published_count,
                       (SELECT COUNT(*) FROM edu_lessons l JOIN edu_courses c ON c.id = l.course_id WHERE c.school_id = s.id) AS lesson_count`;

const COURSE_COUNTS = `(SELECT COUNT(*) FROM edu_modules m WHERE m.course_id = c.id) AS module_count,
                       (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = c.id) AS lesson_count`;

async function loadCourse(courseId: string): Promise<StudioCourse | null> {
  const row = await one(`SELECT c.*, ${COURSE_COUNTS} FROM edu_courses c WHERE c.id = ?`, [courseId]);
  return row ? courseShape(row) : null;
}

async function loadSchool(schoolId: string): Promise<StudioSchool | null> {
  const row = await one(
    `SELECT s.*, ${SCHOOL_COUNTS} FROM edu_schools s WHERE s.id = ?`,
    [schoolId],
  );
  return row ? schoolShape(row) : null;
}

async function loadClass(classId: string): Promise<StudioClass | null> {
  const row = await one(`SELECT c.*, (SELECT COUNT(*) FROM edu_courses x WHERE x.class_id = c.id) AS course_count FROM edu_classes c WHERE c.id = ?`, [classId]);
  return row ? classShape(row) : null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "school"}-${crypto.randomUUID().slice(0, 6)}`;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

studioRoutes.get("/config", async (c) => {
  const settings = await getLearnSettings();
  const schools = await count("SELECT COUNT(*) AS n FROM edu_schools WHERE owner_id = ?", [c.get("user").sub]);
  return c.json({ ok: true, settings, usage: { schools } });
});

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------

studioRoutes.get("/schools", async (c) => {
  const res = await db.execute({
    sql: `SELECT s.*, ${SCHOOL_COUNTS} FROM edu_schools s WHERE s.owner_id = ? ORDER BY s.created_at DESC LIMIT 100`,
    args: [c.get("user").sub],
  });
  return c.json({ ok: true, schools: (res.rows as Row[]).map(schoolShape) });
});

studioRoutes.get("/schools/:id", async (c) => {
  const school = await ownedSchool(c.get("user").sub, c.req.param("id"));
  if (!school) return notFound(c, "school");
  return c.json({ ok: true, school: await loadSchool(String(school.id)) });
});

studioRoutes.post("/schools", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const parsed = await body(c, schoolBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const closed = d.streams.filter((s: string) => !g.settings.streams.includes(s as never));
  if (closed.length) return fail(c, { status: 400, error: "stream_closed", message: `Content for ${closed.join(", ")} isn't open right now.` });
  const owned = await count("SELECT COUNT(*) AS n FROM edu_schools WHERE owner_id = ?", [g.userId]);
  if (owned >= g.settings.maxSchoolsPerUser) {
    return fail(c, { status: 409, error: "limit_reached", message: `You can run up to ${g.settings.maxSchoolsPerUser} school${g.settings.maxSchoolsPerUser === 1 ? "" : "s"} on Peebee Learn.` });
  }
  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  const id = newId("sch");
  await db.execute({
    sql: `INSERT INTO edu_schools (id, owner_id, name, slug, kind, streams, tagline, bio, location, motto, badge, contact_email, contact_phone)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, g.userId, d.name, slugify(d.name), d.kind, [...new Set(d.streams)].join(","), d.tagline, d.bio, d.location, d.motto, d.badge, d.contactEmail, d.contactPhone],
  });
  return c.json({ ok: true, school: await loadSchool(id) }, 201);
});

studioRoutes.patch("/schools/:id", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const school = await ownedSchool(g.userId, c.req.param("id"));
  if (!school) return notFound(c, "school");
  if (school.status === "suspended") return suspended(c);
  const parsed = await body(c, patchSchema(schoolBody));
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as Partial<z.infer<typeof schoolBody>>;

  if (d.streams) {
    const closed = d.streams.filter((s) => !g.settings.streams.includes(s as never));
    if (closed.length) return fail(c, { status: 400, error: "stream_closed", message: `Content for ${closed.join(", ")} isn't open right now.` });
    // Taking a stream away would orphan classes already built in it.
    const inUse = (await db.execute({ sql: "SELECT DISTINCT stream FROM edu_classes WHERE school_id = ?", args: [school.id as string] })).rows.map((r) => String((r as Row).stream));
    const dropped = inUse.filter((s) => !d.streams!.includes(s as never));
    if (dropped.length) return fail(c, { status: 409, error: "stream_in_use", message: `Remove the ${dropped.join(", ")} classes before taking that stream off this school.` });
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    args.push(value);
  };
  if (d.name !== undefined) put("name", d.name);
  if (d.kind !== undefined) put("kind", d.kind);
  if (d.streams !== undefined) put("streams", [...new Set(d.streams)].join(","));
  if (d.tagline !== undefined) put("tagline", d.tagline);
  if (d.bio !== undefined) put("bio", d.bio);
  if (d.location !== undefined) put("location", d.location);
  if (d.motto !== undefined) put("motto", d.motto);
  if (d.badge !== undefined) put("badge", d.badge);
  if (d.contactEmail !== undefined) put("contact_email", d.contactEmail);
  if (d.contactPhone !== undefined) put("contact_phone", d.contactPhone);
  if (sets.length) {
    await db.execute({ sql: `UPDATE edu_schools SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`, args: [...args, school.id, g.userId] as never });
  }
  return c.json({ ok: true, school: await loadSchool(String(school.id)) });
});

/** Removes a school and everything built under it, children first so nothing is orphaned. */
studioRoutes.delete("/schools/:id", async (c) => {
  const userId = c.get("user").sub;
  const school = await ownedSchool(userId, c.req.param("id"));
  if (!school) return notFound(c, "school");
  const id = String(school.id);
  const courses = "SELECT id FROM edu_courses WHERE school_id = ?";
  if ((await learnersIn(courses, [id])) > 0) return hasLearnersResponse(c);
  if ((await learningReady()) && (await count("SELECT COUNT(*) AS n FROM edu_fee_invoices WHERE school_id = ? AND status != 'cancelled'", [id])) > 0) {
    return fail(c, { status: 409, error: "has_invoices", message: "This school has fee invoices. Cancel the unpaid ones; a school with payments can't be deleted." });
  }
  if (await hasTable("edu_coupons")) {
    const paid = await count("SELECT COUNT(*) AS n FROM edu_subscriptions WHERE school_id = ?", [id]);
    const bought = await count("SELECT COUNT(*) AS n FROM edu_bundle_purchases WHERE bundle_id IN (SELECT id FROM edu_bundles WHERE school_id = ?)", [id]);
    if (paid + bought > 0) return fail(c, { status: 409, error: "has_sales", message: "Learners have bought a bundle or pass from this school, so it can't be deleted. Unpublish its courses instead." });
    await db.execute({ sql: "DELETE FROM edu_coupon_redemptions WHERE coupon_id IN (SELECT id FROM edu_coupons WHERE school_id = ?)", args: [id] });
    await db.execute({ sql: "DELETE FROM edu_coupons WHERE school_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM edu_bundle_courses WHERE bundle_id IN (SELECT id FROM edu_bundles WHERE school_id = ?)", args: [id] });
    await db.execute({ sql: "DELETE FROM edu_bundles WHERE school_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM edu_plans WHERE school_id = ?", args: [id] });
  }
  await purgeLiveSessions("school_id", "?", [id]);
  await purgeCourseData(courses, [id]);
  if (await learningReady()) await db.execute({ sql: "DELETE FROM edu_fee_invoices WHERE school_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_lessons WHERE course_id IN (SELECT id FROM edu_courses WHERE school_id = ?)", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_modules WHERE course_id IN (SELECT id FROM edu_courses WHERE school_id = ?)", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_courses WHERE school_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_classes WHERE school_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_schools WHERE id = ? AND owner_id = ?", args: [id, userId] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

studioRoutes.get("/schools/:id/classes", async (c) => {
  const school = await ownedSchool(c.get("user").sub, c.req.param("id"));
  if (!school) return notFound(c, "school");
  const res = await db.execute({
    sql: `SELECT c.*, (SELECT COUNT(*) FROM edu_courses x WHERE x.class_id = c.id) AS course_count
          FROM edu_classes c WHERE c.school_id = ? ORDER BY c.created_at ASC LIMIT 500`,
    args: [school.id as string],
  });
  return c.json({ ok: true, classes: (res.rows as Row[]).map(classShape) });
});

studioRoutes.post("/schools/:id/classes", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const school = await ownedSchool(g.userId, c.req.param("id"));
  if (!school) return notFound(c, "school");
  if (school.status === "suspended") return suspended(c);
  const parsed = await body(c, classBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  const stream = d.stream as EducationStream;

  if (!g.settings.streams.includes(stream)) return fail(c, { status: 400, error: "stream_closed", message: "That stream isn't open right now." });
  if (!streamList(school.streams).includes(stream)) {
    return fail(c, { status: 400, error: "stream_not_offered", message: "Add that stream to your school before creating a class in it." });
  }
  if (d.kind === "masterclass" && !g.settings.masterclassesEnabled) {
    return fail(c, { status: 400, error: "masterclasses_off", message: "Masterclasses aren't available right now." });
  }
  const framework = CURRICULUM_FRAMEWORKS.find((f) => f.id === d.framework);
  if (!framework || (!framework.streams.includes(stream) && d.framework !== "open_syllabus")) {
    return fail(c, { status: 400, error: "framework_mismatch", message: "That syllabus isn't used in this stream. Pick one from the list or use your own syllabus." });
  }
  const existing = await count("SELECT COUNT(*) AS n FROM edu_classes WHERE school_id = ?", [school.id]);
  if (existing >= g.settings.maxClassesPerSchool) {
    return fail(c, { status: 409, error: "limit_reached", message: `A school can have up to ${g.settings.maxClassesPerSchool} classes.` });
  }
  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  const id = newId("cls");
  await db.execute({
    sql: `INSERT INTO edu_classes (id, school_id, stream, kind, name, level, framework, academic_year, term, teacher_name, capacity, summary, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
    args: [id, school.id, d.stream, d.kind, d.name, d.level, d.framework, d.academicYear, d.term, d.teacherName, d.capacity, d.summary] as never,
  });
  return c.json({ ok: true, class: await loadClass(id) }, 201);
});

studioRoutes.get("/classes/:id", async (c) => {
  const cls = await ownedClass(c.get("user").sub, c.req.param("id"));
  if (!cls) return notFound(c, "class");
  return c.json({ ok: true, class: await loadClass(String(cls.id)) });
});

studioRoutes.patch("/classes/:id", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const cls = await ownedClass(g.userId, c.req.param("id"));
  if (!cls) return notFound(c, "class");
  const school = await ownedSchool(g.userId, String(cls.school_id));
  if (school?.status === "suspended") return suspended(c);
  // The stream, and therefore the course catalogue it belongs to, is fixed once the class exists.
  const parsed = await body(c, patchSchema(classBody.omit({ stream: true })));
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as Partial<Omit<z.infer<typeof classBody>, "stream">>;

  if (d.kind === "masterclass" && cls.kind !== "masterclass" && !g.settings.masterclassesEnabled) {
    return fail(c, { status: 400, error: "masterclasses_off", message: "Masterclasses aren't available right now." });
  }
  if (d.framework) {
    const fw = CURRICULUM_FRAMEWORKS.find((f) => f.id === d.framework);
    if (!fw || (!fw.streams.includes(String(cls.stream) as never) && d.framework !== "open_syllabus")) {
      return fail(c, { status: 400, error: "framework_mismatch", message: "That syllabus isn't used in this stream." });
    }
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    args.push(value);
  };
  if (d.kind !== undefined) put("kind", d.kind);
  if (d.name !== undefined) put("name", d.name);
  if (d.level !== undefined) put("level", d.level);
  if (d.framework !== undefined) put("framework", d.framework);
  if (d.academicYear !== undefined) put("academic_year", d.academicYear);
  if (d.term !== undefined) put("term", d.term);
  if (d.teacherName !== undefined) put("teacher_name", d.teacherName);
  if (d.capacity !== undefined) put("capacity", d.capacity);
  if (d.summary !== undefined) put("summary", d.summary);
  if (sets.length) await db.execute({ sql: `UPDATE edu_classes SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, args: [...args, cls.id] as never });
  return c.json({ ok: true, class: await loadClass(String(cls.id)) });
});

studioRoutes.delete("/classes/:id", async (c) => {
  const cls = await ownedClass(c.get("user").sub, c.req.param("id"));
  if (!cls) return notFound(c, "class");
  const id = String(cls.id);
  const courses = "SELECT id FROM edu_courses WHERE class_id = ?";
  if ((await learnersIn(courses, [id])) > 0) return hasLearnersResponse(c);
  await purgeLiveSessions("class_id", "?", [id]);
  await purgeLiveSessions("course_id", courses, [id]);
  await purgeCourseData(courses, [id]);
  await db.execute({ sql: "DELETE FROM edu_lessons WHERE course_id IN (SELECT id FROM edu_courses WHERE class_id = ?)", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_modules WHERE course_id IN (SELECT id FROM edu_courses WHERE class_id = ?)", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_courses WHERE class_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_classes WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

function priceProblem(settings: LearnSettings, priceUgx: number): Fail | null {
  if (priceUgx > 0 && !settings.paidCoursesEnabled) {
    return { status: 400, error: "paid_courses_off", message: "Paid courses aren't available right now. Set the price to 0 to publish a free course." };
  }
  if (priceUgx > settings.maxCoursePriceUgx) {
    return { status: 400, error: "price_too_high", message: `A course can cost up to UGX ${settings.maxCoursePriceUgx.toLocaleString("en-UG")}.` };
  }
  return null;
}

studioRoutes.get("/classes/:id/courses", async (c) => {
  const cls = await ownedClass(c.get("user").sub, c.req.param("id"));
  if (!cls) return notFound(c, "class");
  const res = await db.execute({
    sql: `SELECT c.*, ${COURSE_COUNTS} FROM edu_courses c WHERE c.class_id = ? ORDER BY c.created_at ASC LIMIT 200`,
    args: [cls.id as string],
  });
  return c.json({ ok: true, courses: (res.rows as Row[]).map(courseShape) });
});

studioRoutes.post("/classes/:id/courses", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const cls = await ownedClass(g.userId, c.req.param("id"));
  if (!cls) return notFound(c, "class");
  const school = await ownedSchool(g.userId, String(cls.school_id));
  if (school?.status === "suspended") return suspended(c);
  const parsed = await body(c, courseBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const priceBad = priceProblem(g.settings, d.priceUgx);
  if (priceBad) return fail(c, priceBad);
  const existing = await count("SELECT COUNT(*) AS n FROM edu_courses WHERE class_id = ?", [cls.id]);
  if (existing >= g.settings.maxCoursesPerClass) {
    return fail(c, { status: 409, error: "limit_reached", message: `A class can have up to ${g.settings.maxCoursesPerClass} courses.` });
  }
  const framework = d.framework ?? String(cls.framework);
  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  const id = newId("crs");
  await db.execute({
    sql: `INSERT INTO edu_courses (id, school_id, class_id, stream, title, summary, price_ugx, framework, outcomes_json, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    args: [id, cls.school_id, cls.id, cls.stream, d.title, d.summary, d.priceUgx, framework, JSON.stringify(d.outcomes)] as never,
  });
  return c.json({ ok: true, course: await loadCourse(id) }, 201);
});

studioRoutes.get("/courses/:id", async (c) => {
  const course = await ownedCourse(c.get("user").sub, c.req.param("id"));
  if (!course) return notFound(c, "course");
  const id = String(course.id);
  const modules = (await db.execute({ sql: "SELECT * FROM edu_modules WHERE course_id = ? ORDER BY position ASC, created_at ASC LIMIT 500", args: [id] })).rows as Row[];
  const lessons = (await db.execute({ sql: "SELECT * FROM edu_lessons WHERE course_id = ? ORDER BY position ASC, created_at ASC LIMIT 5000", args: [id] })).rows as Row[];
  const media = await mediaByLesson(id);
  const drip = await dripDays(id);
  const assignments = await assignmentsOfCourse(id);
  const siblings = (await db.execute({ sql: "SELECT id, title FROM edu_courses WHERE school_id = ? AND id != ? ORDER BY title ASC LIMIT 200", args: [course.school_id as string, id] })).rows as Row[];
  const detail: StudioCourseDetail = {
    ...(await loadCourse(id))!,
    modules: modules.map((m) => ({ ...moduleShape(m, lessons.filter((l) => l.module_id === m.id).map((l) => ({ ...lessonShape(l, media.get(String(l.id)) ?? null), assignment: assignments.get(String(l.id)) ?? null }))), dripDays: drip.get(String(m.id)) ?? 0 })),
    rules: await courseRules(id),
    prerequisiteOptions: siblings.map((r) => ({ id: String(r.id), title: String(r.title) })),
  };
  return c.json({ ok: true, course: detail });
});

const coursePatch = patchSchema(courseBody).extend({ status: z.enum(["draft", "published"]).optional() });

studioRoutes.patch("/courses/:id", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const course = await ownedCourse(g.userId, c.req.param("id"));
  if (!course) return notFound(c, "course");
  const school = await ownedSchool(g.userId, String(course.school_id));
  if (school?.status === "suspended") return suspended(c);
  const parsed = await body(c, coursePatch);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof coursePatch>;

  if (d.priceUgx !== undefined && d.priceUgx !== Number(course.price_ugx) && !(await ownedSchool(g.userId, String(course.school_id)))) {
    return fail(c, { status: 403, error: "owner_only", message: "Only the school owner can change the price." });
  }
  if (d.priceUgx !== undefined) {
    const priceBad = priceProblem(g.settings, d.priceUgx);
    if (priceBad) return fail(c, priceBad);
  }
  if (d.status === "published" && course.status !== "published") {
    const lessons = await count("SELECT COUNT(*) AS n FROM edu_lessons WHERE course_id = ?", [course.id]);
    if (lessons < 1) return fail(c, { status: 409, error: "course_empty", message: "Add at least one lesson before publishing this course." });
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    args.push(value);
  };
  if (d.title !== undefined) put("title", d.title);
  if (d.summary !== undefined) put("summary", d.summary);
  if (d.priceUgx !== undefined) put("price_ugx", d.priceUgx);
  if (d.framework !== undefined) put("framework", d.framework);
  if (d.outcomes !== undefined) put("outcomes_json", JSON.stringify(d.outcomes));
  if (d.status !== undefined) put("status", d.status);
  if (sets.length) await db.execute({ sql: `UPDATE edu_courses SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, args: [...args, course.id] as never });
  return c.json({ ok: true, course: await loadCourse(String(course.id)) });
});

studioRoutes.delete("/courses/:id", async (c) => {
  const course = await ownedCourse(c.get("user").sub, c.req.param("id"));
  if (!course) return notFound(c, "course");
  // Deleting a course is the school owner's call, not an extra teacher's.
  if (!(await ownedSchool(c.get("user").sub, String(course.school_id)))) return fail(c, { status: 403, error: "owner_only", message: "Only the school owner can delete a course." });
  const id = String(course.id);
  const ids = "SELECT id FROM edu_courses WHERE id = ?";
  if ((await learnersIn(ids, [id])) > 0) return hasLearnersResponse(c);
  await purgeLiveSessions("course_id", ids, [id]);
  await purgeCourseData(ids, [id]);
  await db.execute({ sql: "DELETE FROM edu_lessons WHERE course_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_modules WHERE course_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM edu_courses WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

studioRoutes.post("/courses/:id/modules", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const course = await ownedCourse(g.userId, c.req.param("id"));
  if (!course) return notFound(c, "course");
  const school = await ownedSchool(g.userId, String(course.school_id));
  if (school?.status === "suspended") return suspended(c);
  const parsed = await body(c, moduleBody);
  if (!parsed.ok) return parsed.res;

  const existing = await count("SELECT COUNT(*) AS n FROM edu_modules WHERE course_id = ?", [course.id]);
  if (existing >= g.settings.maxModulesPerCourse) {
    return fail(c, { status: 409, error: "limit_reached", message: `A course can have up to ${g.settings.maxModulesPerCourse} modules.` });
  }
  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  const id = newId("mod");
  await db.execute({
    sql: "INSERT INTO edu_modules (id, course_id, title, description, position) VALUES (?, ?, ?, ?, ?)",
    args: [id, course.id, parsed.data.title, parsed.data.description, existing + 1] as never,
  });
  const row = await one("SELECT * FROM edu_modules WHERE id = ?", [id]);
  return c.json({ ok: true, module: moduleShape(row!) }, 201);
});

studioRoutes.patch("/modules/:id", async (c) => {
  const mod = await ownedModule(c.get("user").sub, c.req.param("id"));
  if (!mod) return notFound(c, "module");
  const parsed = await body(c, patchSchema(moduleBody));
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as Partial<z.infer<typeof moduleBody>>;
  if (d.title !== undefined) await db.execute({ sql: "UPDATE edu_modules SET title = ? WHERE id = ?", args: [d.title, mod.id as string] });
  if (d.description !== undefined) await db.execute({ sql: "UPDATE edu_modules SET description = ? WHERE id = ?", args: [d.description, mod.id as string] });
  const row = await one("SELECT * FROM edu_modules WHERE id = ?", [mod.id]);
  return c.json({ ok: true, module: moduleShape(row!) });
});

studioRoutes.delete("/modules/:id", async (c) => {
  const mod = await ownedModule(c.get("user").sub, c.req.param("id"));
  if (!mod) return notFound(c, "module");
  await db.execute({ sql: "DELETE FROM edu_module_drip WHERE module_id = ?", args: [mod.id as string] }).catch((err) => {
    if (!/no such table/i.test(String(err))) throw err;
  });
  await purgeLessonData("SELECT id FROM edu_lessons WHERE module_id = ?", [mod.id]);
  await db.execute({ sql: "DELETE FROM edu_lessons WHERE module_id = ?", args: [mod.id as string] });
  await db.execute({ sql: "DELETE FROM edu_modules WHERE id = ?", args: [mod.id as string] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

type LessonDraft = {
  contentType?: StudioLesson["contentType"];
  durationMinutes?: number;
  body?: string;
  slides?: unknown[];
  live?: { url: string } | null;
  assignment?: unknown;
  quiz?: StudioQuiz | null;
};

/** Checks a lesson against the Admin limits. `kind` is the type it will have once saved. */
function lessonProblem(settings: LearnSettings, d: LessonDraft, kind: StudioLesson["contentType"], creating: boolean): Fail | null {
  if (d.durationMinutes !== undefined && d.durationMinutes > settings.maxLessonMinutes) {
    return { status: 400, error: "lesson_too_long", message: `A lesson can run up to ${settings.maxLessonMinutes} minutes.` };
  }
  if (d.quiz && d.quiz.questions.length > settings.maxQuizQuestionsPerLesson) {
    return { status: 400, error: "quiz_too_long", message: `A quiz can have up to ${settings.maxQuizQuestionsPerLesson} questions.` };
  }
  if (d.body !== undefined && d.body.length > settings.maxLessonBodyChars) {
    return { status: 400, error: "body_too_long", message: `A text lesson can have up to ${settings.maxLessonBodyChars.toLocaleString("en-UG")} characters.` };
  }
  if (d.slides && d.slides.length > settings.maxSlidesPerLesson) {
    return { status: 400, error: "too_many_slides", message: `A slide lesson can have up to ${settings.maxSlidesPerLesson} slides.` };
  }
  if (kind === "assignment" && !settings.assignmentsEnabled) {
    return { status: 403, error: "assignments_off", message: "Assignments are switched off right now." };
  }
  if (isAssessment(kind) && creating && !d.quiz) {
    return { status: 400, error: "quiz_needed", message: `Add at least one question to this ${kind}.` };
  }
  if (kind === "live" && (creating || d.live)) {
    if (!settings.liveLessonsEnabled) return { status: 403, error: "live_off", message: "Live video lessons are switched off right now." };
    if (!d.live) return { status: 400, error: "live_needed", message: "Set when the live lesson starts and add its meeting link." };
    if (!liveHostAllowed(d.live.url, settings.liveLessonHosts)) {
      return { status: 400, error: "live_host", message: `Use a meeting link from one of: ${settings.liveLessonHosts.split(",").join(", ")}.` };
    }
  }
  return null;
}

/** A live lesson link must be https and point at an allowed meeting host (or one of its subdomains). */
export function liveHostAllowed(url: string, hostsCsv: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return hostsCsv.split(",").map((h) => h.trim()).filter(Boolean).some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Items that need columns from migration 0116 can't be saved before it is applied. */
async function needsUpgrade(c: Context, d: LessonDraft & { slides?: unknown[] }, kind: StudioLesson["contentType"]): Promise<Response | null> {
  if (kind === "assignment" && !(await assignmentsReady())) {
    return fail(c, { status: 503, error: "upgrade_pending", message: "Assignments need a platform update that hasn't finished yet. Try again shortly." });
  }
  const wide = kind === "text" || kind === "slides" || kind === "live" || !!d.body || !!d.slides?.length || !!d.live;
  if (!wide || (await hasColumn("edu_lessons", "body"))) return null;
  return fail(c, { status: 503, error: "upgrade_pending", message: "Text, slide and live lessons need a platform update that hasn't finished yet. Try again shortly." });
}

studioRoutes.post("/modules/:id/lessons", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const mod = await ownedModule(g.userId, c.req.param("id"));
  if (!mod) return notFound(c, "module");
  const course = await ownedCourse(g.userId, String(mod.course_id));
  const school = course ? await one("SELECT * FROM edu_schools WHERE id = ?", [course.school_id]) : null;
  if (!course || !school) return notFound(c, "module");
  if (school.status === "suspended") return suspended(c);
  const parsed = await body(c, lessonBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const bad = lessonProblem(g.settings, d, d.contentType, true);
  if (bad) return fail(c, bad);
  const stale = await needsUpgrade(c, d, d.contentType);
  if (stale) return stale;
  const wide = await hasColumn("edu_lessons", "body");
  const existing = await count("SELECT COUNT(*) AS n FROM edu_lessons WHERE module_id = ?", [mod.id]);
  if (existing >= g.settings.maxLessonsPerModule) {
    return fail(c, { status: 409, error: "limit_reached", message: `A module can have up to ${g.settings.maxLessonsPerModule} lessons.` });
  }
  const slow = await throttle(c, g.userId, g.settings);
  if (slow) return slow;

  const id = newId("les");
  const quizJson = d.quiz ? JSON.stringify(d.quiz) : null;
  await db.execute(
    wide
      ? {
          sql: `INSERT INTO edu_lessons (id, module_id, course_id, title, content_type, duration_minutes, summary, content_url, position, quiz_json, body, slides_json, live_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, mod.id, mod.course_id, d.title, d.contentType, d.durationMinutes, d.summary, d.contentUrl, existing + 1, quizJson, d.body, d.slides.length ? JSON.stringify(d.slides) : null, d.live ? JSON.stringify(d.live) : null] as never,
        }
      : {
          sql: `INSERT INTO edu_lessons (id, module_id, course_id, title, content_type, duration_minutes, summary, content_url, position, quiz_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, mod.id, mod.course_id, d.title, d.contentType, d.durationMinutes, d.summary, d.contentUrl, existing + 1, quizJson] as never,
        },
  );
  if (d.contentType === "assignment") await saveAssignment(id, { maxPoints: d.assignment?.maxPoints ?? 100, passPercent: d.assignment?.passPercent ?? 50, dueAt: d.assignment?.dueAt ?? null, allowResubmit: d.assignment?.allowResubmit ?? true });
  // With "publish by default" on, a course goes live as soon as it has something to teach.
  if (g.settings.publishByDefault && course.status !== "published") {
    await db.execute({ sql: "UPDATE edu_courses SET status = 'published', updated_at = datetime('now') WHERE id = ?", args: [course.id as string] });
  }
  const row = await one("SELECT * FROM edu_lessons WHERE id = ?", [id]);
  return c.json({ ok: true, lesson: { ...lessonShape(row!), assignment: await assignmentOf(id) } }, 201);
});

// A patch only changes what it mentions, so none of the defaults may fill in the rest.
const lessonPatch = z.object({
  title: lessonBody.shape.title.optional(),
  contentType: z.string().max(40).transform(normaliseContentType).optional(),
  durationMinutes: z.number().int().min(1).optional(),
  summary: lessonBody.shape.summary.removeDefault().optional(),
  contentUrl: lessonBody.shape.contentUrl.removeDefault().optional(),
  body: z.string().max(100_000).optional(),
  slides: z.array(slideSchema).max(100).optional(),
  live: liveSchema.nullable().optional(),
  assignment: assignmentSchema.nullable().optional(),
  quiz: quizSchema.optional(),
});

studioRoutes.patch("/lessons/:id", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const lesson = await ownedLesson(g.userId, c.req.param("id"));
  if (!lesson) return notFound(c, "lesson");
  const course = await ownedCourse(g.userId, String(lesson.course_id));
  const school = course ? await ownedSchool(g.userId, String(course.school_id)) : null;
  if (school?.status === "suspended") return suspended(c);
  const parsed = await body(c, lessonPatch);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof lessonPatch>;

  const kind = d.contentType ?? normaliseContentType(String(lesson.content_type));
  const bad = lessonProblem(g.settings, d, kind, false);
  if (bad) return fail(c, bad);
  const stale = await needsUpgrade(c, d, kind);
  if (stale) return stale;

  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    args.push(value);
  };
  if (d.title !== undefined) put("title", d.title);
  if (d.contentType !== undefined) put("content_type", d.contentType);
  if (d.durationMinutes !== undefined) put("duration_minutes", d.durationMinutes);
  if (d.summary !== undefined) put("summary", d.summary);
  if (d.contentUrl !== undefined) put("content_url", d.contentUrl);
  if (d.quiz !== undefined) put("quiz_json", d.quiz ? JSON.stringify(d.quiz) : null);
  if (d.body !== undefined) put("body", d.body);
  if (d.slides !== undefined) put("slides_json", d.slides.length ? JSON.stringify(d.slides) : null);
  if (d.live !== undefined) put("live_json", d.live ? JSON.stringify(d.live) : null);
  if (sets.length) await db.execute({ sql: `UPDATE edu_lessons SET ${sets.join(", ")} WHERE id = ?`, args: [...args, lesson.id] as never });
  if (kind === "assignment" && d.assignment) {
    const current = await assignmentOf(String(lesson.id));
    await saveAssignment(String(lesson.id), { maxPoints: d.assignment.maxPoints ?? current?.maxPoints ?? 100, passPercent: d.assignment.passPercent ?? current?.passPercent ?? 50, dueAt: d.assignment.dueAt ?? null, allowResubmit: d.assignment.allowResubmit ?? current?.allowResubmit ?? true });
  }
  const row = await one("SELECT * FROM edu_lessons WHERE id = ?", [lesson.id]);
  return c.json({ ok: true, lesson: { ...lessonShape(row!), assignment: await assignmentOf(String(lesson.id)) } });
});

studioRoutes.delete("/lessons/:id", async (c) => {
  const lesson = await ownedLesson(c.get("user").sub, c.req.param("id"));
  if (!lesson) return notFound(c, "lesson");
  await purgeLessonData("SELECT ?", [lesson.id]);
  await db.execute({ sql: "DELETE FROM edu_lessons WHERE id = ?", args: [lesson.id as string] });
  // A published course with nothing left to teach goes back to draft.
  const left = await count("SELECT COUNT(*) AS n FROM edu_lessons WHERE course_id = ?", [lesson.course_id]);
  if (left === 0) await db.execute({ sql: "UPDATE edu_courses SET status = 'draft' WHERE id = ?", args: [lesson.course_id as string] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Order: sections and the items inside them, moved in one go
// ---------------------------------------------------------------------------

const orderBody = z.object({
  modules: z.array(z.string().max(80)).max(500),
  lessons: z.record(z.string().max(80), z.array(z.string().max(80)).max(500)),
});

/** Saves the whole running order of a course: section order, and which items sit in which section and in what order. */
studioRoutes.post("/courses/:id/order", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const course = await ownedCourse(g.userId, c.req.param("id"));
  if (!course) return notFound(c, "course");
  const school = await ownedSchool(g.userId, String(course.school_id));
  if (school?.status === "suspended") return suspended(c);
  const parsed = await body(c, orderBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof orderBody>;

  const moduleIds = ((await db.execute({ sql: "SELECT id FROM edu_modules WHERE course_id = ?", args: [course.id as string] })).rows as Row[]).map((r) => String(r.id));
  const lessonIds = ((await db.execute({ sql: "SELECT id FROM edu_lessons WHERE course_id = ?", args: [course.id as string] })).rows as Row[]).map((r) => String(r.id));
  const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));
  const listed = Object.values(d.lessons).flat();
  const bad =
    !sameSet(d.modules, moduleIds) ||
    !sameSet(listed, lessonIds) ||
    Object.keys(d.lessons).some((m) => !moduleIds.includes(m)) ||
    d.modules.some((m) => !d.lessons[m]);
  if (bad) {
    return fail(c, { status: 409, error: "order_stale", message: "This course changed while you were arranging it. Reload and try again." });
  }
  if (Object.values(d.lessons).some((list) => list.length > g.settings.maxLessonsPerModule)) {
    return fail(c, { status: 409, error: "limit_reached", message: `A section can have up to ${g.settings.maxLessonsPerModule} items.` });
  }
  for (const [i, id] of d.modules.entries()) {
    await db.execute({ sql: "UPDATE edu_modules SET position = ? WHERE id = ? AND course_id = ?", args: [i + 1, id, course.id as string] });
    for (const [j, lid] of d.lessons[id].entries()) {
      await db.execute({ sql: "UPDATE edu_lessons SET module_id = ?, position = ? WHERE id = ? AND course_id = ?", args: [id, j + 1, lid, course.id as string] });
    }
  }
  return c.json({ ok: true });
});

/** Who joined a live lesson. */
studioRoutes.get("/lessons/:id/attendance", async (c) => {
  const lesson = await ownedLesson(c.get("user").sub, c.req.param("id"));
  if (!lesson) return notFound(c, "lesson");
  let rows: Row[] = [];
  try {
    rows = (
      await db.execute({
        sql: `SELECT a.user_id, a.joined_at, u.name FROM edu_live_attendance a JOIN users u ON u.id = a.user_id WHERE a.lesson_id = ? ORDER BY a.joined_at ASC LIMIT 1000`,
        args: [lesson.id as string],
      })
    ).rows as Row[];
  } catch (err) {
    if (!/no such table/i.test(String(err))) throw err;
  }
  const enrolled = await count("SELECT COUNT(*) AS n FROM edu_enrollments WHERE course_id = ? AND status = 'active'", [lesson.course_id]).catch(() => 0);
  return c.json({ ok: true, enrolled, attendees: rows.map((r) => ({ userId: String(r.user_id), name: String(r.name ?? ""), joinedAt: String(r.joined_at) })) });
});

// ---------------------------------------------------------------------------
// Rules: order, prerequisite, certificate, and drip release
// ---------------------------------------------------------------------------

const rulesBody = z.object({
  sequential: z.boolean(),
  prerequisiteCourseId: z.string().max(80).nullable(),
  certificateEnabled: z.boolean(),
});

studioRoutes.put("/courses/:id/rules", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const course = await ownedCourse(g.userId, c.req.param("id"));
  if (!course) return notFound(c, "course");
  if (!(await proReady())) return fail(c, { status: 503, error: "upgrade_pending", message: "Course rules need a platform update that hasn't finished yet. Try again shortly." });
  const parsed = await body(c, rulesBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof rulesBody>;
  if ((d.sequential || d.prerequisiteCourseId) && !g.settings.prerequisitesEnabled) {
    return fail(c, { status: 403, error: "prerequisites_off", message: "Prerequisites are switched off right now." });
  }
  if (d.prerequisiteCourseId) {
    const need = await one("SELECT id FROM edu_courses WHERE id = ? AND school_id = ? AND id != ?", [d.prerequisiteCourseId, course.school_id, course.id]);
    if (!need) return fail(c, { status: 400, error: "bad_prerequisite", message: "Choose another course from this school." });
    // A course can't be needed by something that needs it back, however far round.
    let cursor: string | null = d.prerequisiteCourseId;
    for (let hops = 0; cursor && hops < 50; hops++) {
      if (cursor === String(course.id)) return fail(c, { status: 400, error: "prerequisite_loop", message: "That course already requires this one." });
      cursor = (await courseRules(cursor)).prerequisiteCourseId;
    }
  }
  await db.execute({
    sql: `INSERT INTO edu_course_rules (course_id, sequential, prerequisite_course_id, certificate_enabled) VALUES (?, ?, ?, ?)
          ON CONFLICT(course_id) DO UPDATE SET sequential = excluded.sequential, prerequisite_course_id = excluded.prerequisite_course_id,
            certificate_enabled = excluded.certificate_enabled, updated_at = datetime('now')`,
    args: [course.id as string, d.sequential ? 1 : 0, d.prerequisiteCourseId, d.certificateEnabled ? 1 : 0],
  });
  return c.json({ ok: true, rules: await courseRules(String(course.id)) });
});

studioRoutes.put("/modules/:id/drip", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const mod = await ownedModule(g.userId, c.req.param("id"));
  if (!mod) return notFound(c, "section");
  if (!(await proReady())) return fail(c, { status: 503, error: "upgrade_pending", message: "Drip release needs a platform update that hasn't finished yet. Try again shortly." });
  const parsed = await body(c, z.object({ days: z.number().int().min(0).max(730) }));
  if (!parsed.ok) return parsed.res;
  const days = (parsed.data as { days: number }).days;
  if (days > 0 && !g.settings.dripEnabled) return fail(c, { status: 403, error: "drip_off", message: "Drip release is switched off right now." });
  await db.execute({ sql: "INSERT INTO edu_module_drip (module_id, drip_days) VALUES (?, ?) ON CONFLICT(module_id) DO UPDATE SET drip_days = excluded.drip_days", args: [mod.id as string, days] });
  return c.json({ ok: true, days });
});

// ---------------------------------------------------------------------------
// Assignments: what was handed in, marking, and the gradebook
// ---------------------------------------------------------------------------

studioRoutes.get("/lessons/:id/submissions", async (c) => {
  const lesson = await ownedLesson(c.get("user").sub, c.req.param("id"));
  if (!lesson) return notFound(c, "assignment");
  if (!(await assignmentsReady())) return c.json({ ok: true, assignment: null, submissions: [] });
  const rows = (
    await db.execute({
      sql: `SELECT s.*, u.name FROM edu_submissions s JOIN users u ON u.id = s.user_id WHERE s.lesson_id = ? ORDER BY CASE s.status WHEN 'submitted' THEN 0 ELSE 1 END, s.submitted_at ASC LIMIT 1000`,
      args: [lesson.id as string],
    })
  ).rows as Row[];
  return c.json({
    ok: true,
    assignment: await assignmentOf(String(lesson.id)),
    submissions: rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      learnerName: String(r.name ?? "Learner"),
      body: String(r.body ?? ""),
      link: String(r.link ?? ""),
      status: r.status === "graded" ? "graded" : "submitted",
      score: r.score === null ? null : Number(r.score),
      feedback: String(r.feedback ?? ""),
      submittedAt: String(r.submitted_at),
      gradedAt: r.graded_at ? String(r.graded_at) : null,
    })),
  });
});

studioRoutes.put("/submissions/:id/grade", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  if (!(await assignmentsReady())) return fail(c, { status: 503, error: "upgrade_pending", message: "Assignments need a platform update that hasn't finished yet. Try again shortly." });
  const sub = await one("SELECT * FROM edu_submissions WHERE id = ?", [c.req.param("id")]);
  if (!sub || !(await ownedCourse(g.userId, String(sub.course_id)))) return notFound(c, "submission");
  const a = await assignmentOf(String(sub.lesson_id));
  if (!a) return notFound(c, "assignment");
  const parsed = await body(c, z.object({ score: z.number().int().min(0).max(1000), feedback: text(2000).default("") }));
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as { score: number; feedback: string };
  if (d.score > a.maxPoints) return fail(c, { status: 400, error: "score_too_high", message: `The most you can give is ${a.maxPoints}.` });

  await db.execute({
    sql: "UPDATE edu_submissions SET status = 'graded', score = ?, feedback = ?, graded_at = datetime('now'), graded_by = ? WHERE id = ?",
    args: [d.score, d.feedback, g.userId, sub.id as string],
  });
  const percent = Math.round((d.score / a.maxPoints) * 100);
  const passed = percent >= a.passPercent;
  if (passed) {
    await db.execute({
      sql: `INSERT INTO edu_lesson_progress (user_id, lesson_id, course_id, best_score_percent) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, lesson_id) DO UPDATE SET best_score_percent = excluded.best_score_percent`,
      args: [sub.user_id as string, sub.lesson_id as string, sub.course_id as string, percent],
    });
    await afterProgress(String(sub.user_id), String(sub.course_id), g.settings);
  } else {
    await db.execute({ sql: "DELETE FROM edu_lesson_progress WHERE user_id = ? AND lesson_id = ?", args: [sub.user_id as string, sub.lesson_id as string] });
  }
  return c.json({ ok: true, percent, passed });
});

studioRoutes.get("/courses/:id/gradebook", async (c) => {
  const course = await ownedCourse(c.get("user").sub, c.req.param("id"));
  if (!course) return notFound(c, "course");
  const id = String(course.id);
  if (!(await learningReady())) return c.json({ ok: true, gradebook: { items: [], rows: [] } });
  const modules = (await db.execute({ sql: "SELECT id FROM edu_modules WHERE course_id = ? ORDER BY position ASC, created_at ASC", args: [id] })).rows as Row[];
  const lessons = (await db.execute({ sql: "SELECT id, title, content_type, module_id FROM edu_lessons WHERE course_id = ? ORDER BY position ASC, created_at ASC", args: [id] })).rows as Row[];
  const items = modules.flatMap((m) => lessons.filter((l) => l.module_id === m.id)).map((l) => ({ lessonId: String(l.id), title: String(l.title), contentType: normaliseContentType(String(l.content_type)) }));
  const learners = (await db.execute({ sql: "SELECT e.user_id, u.name FROM edu_enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ? AND e.status = 'active' ORDER BY u.name ASC LIMIT 1000", args: [id] })).rows as Row[];
  const progress = (await db.execute({ sql: "SELECT user_id, lesson_id, best_score_percent FROM edu_lesson_progress WHERE course_id = ?", args: [id] })).rows as Row[];
  const attempts = (await db.execute({ sql: "SELECT user_id, lesson_id, MAX(score_percent) AS best FROM edu_quiz_attempts WHERE course_id = ? GROUP BY user_id, lesson_id", args: [id] })).rows as Row[];
  const subs = (await assignmentsReady()) ? ((await db.execute({ sql: "SELECT user_id, lesson_id, status, score FROM edu_submissions WHERE course_id = ?", args: [id] })).rows as Row[]) : [];
  const assignments = await assignmentsOfCourse(id);
  const key = (u: unknown, l: unknown) => `${String(u)}|${String(l)}`;
  const done = new Map(progress.map((r) => [key(r.user_id, r.lesson_id), r.best_score_percent === null ? null : Number(r.best_score_percent)]));
  const best = new Map(attempts.map((r) => [key(r.user_id, r.lesson_id), Number(r.best)]));
  const handed = new Map(subs.map((r) => [key(r.user_id, r.lesson_id), r]));

  const rows = learners.map((u) => {
    const cells = items.map((it) => {
      const k = key(u.user_id, it.lessonId);
      const sub = handed.get(k);
      const a = assignments.get(it.lessonId);
      let score: number | null = done.get(k) ?? best.get(k) ?? null;
      if (it.contentType === "assignment" && sub?.status === "graded" && sub.score !== null && a) score = Math.round((Number(sub.score) / a.maxPoints) * 100);
      return { lessonId: it.lessonId, done: done.has(k), scorePercent: score, ...(sub && sub.status === "submitted" ? { needsMarking: true } : {}) };
    });
    const scored = cells.filter((x) => x.scorePercent !== null).map((x) => x.scorePercent as number);
    return {
      userId: String(u.user_id),
      name: String(u.name ?? "Learner"),
      progressPercent: items.length ? Math.round((cells.filter((x) => x.done).length / items.length) * 100) : 0,
      averagePercent: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
      cells,
    };
  });
  return c.json({ ok: true, gradebook: { items, rows } });
});
