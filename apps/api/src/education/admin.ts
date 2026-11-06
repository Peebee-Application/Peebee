import { patchSchema } from "../lib/patch-schema.js";
import { Hono } from "hono";
import { z } from "zod";
import { EDUCATION_STREAM_IDS } from "@peebee/shared";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { clientIp } from "../lib/ratelimit.js";
import { grantPro, listPro, revokePro } from "./pro.js";
import { resolveCustomerByIdentifier } from "../wallet/service.js";
import { DEMO_STEPS, DemoError, demoMissing, demoStatus, installDemoStep, removeDemo } from "./demo.js";
import { getLearnSettings, setLearnSettings } from "./settings.js";
import { studioReady } from "./studio.js";

/** Staff controls for Peebee Learn: the settings, and suspending a school that breaks the rules. Mounted at /v1. */
export const educationAdminRoutes = new Hono();

educationAdminRoutes.use("/admin/learn-settings", requireAuth, requireRole("admin"));
educationAdminRoutes.use("/admin/learn-schools", requireAuth, requireRole("admin"));
educationAdminRoutes.use("/admin/learn-schools/*", requireAuth, requireRole("admin"));
educationAdminRoutes.use("/admin/learn-demo", requireAuth, requireRole("admin"));
educationAdminRoutes.use("/admin/learn-pro", requireAuth, requireRole("admin"));
educationAdminRoutes.use("/admin/learn-pro/*", requireAuth, requireRole("admin"));
educationAdminRoutes.use("/admin/learn-demo/*", requireAuth, requireRole("admin"));

const STREAMS = EDUCATION_STREAM_IDS as readonly [string, ...string[]];

const settingsPatch = patchSchema(z
  .object({
    enabled: z.boolean(),
    streams: z.array(z.enum(STREAMS)),
    masterclassesEnabled: z.boolean(),
    paidCoursesEnabled: z.boolean(),
    maxCoursePriceUgx: z.number().int().min(0).max(1_000_000_000),
    maxSchoolsPerUser: z.number().int().min(1).max(100),
    maxClassesPerSchool: z.number().int().min(1).max(500),
    maxCoursesPerClass: z.number().int().min(1).max(200),
    maxModulesPerCourse: z.number().int().min(1).max(200),
    maxLessonsPerModule: z.number().int().min(1).max(200),
    maxQuizQuestionsPerLesson: z.number().int().min(0).max(100),
    maxLessonMinutes: z.number().int().min(1).max(1440),
    createsPerHour: z.number().int().min(1).max(1000),
    publishByDefault: z.boolean(),
    enrolmentsEnabled: z.boolean(),
    commissionPercent: z.number().int().min(0).max(60),
    videoUploadsEnabled: z.boolean(),
    maxVideoMb: z.number().int().min(1).max(100),
    maxCoverMb: z.number().int().min(0).max(10),
    quizAttemptsPerHour: z.number().int().min(1).max(200),
    feesEnabled: z.boolean(),
    examPassPercent: z.number().int().min(0).max(100),
    liveEnabled: z.boolean(),
    liveMaxParticipants: z.number().int().min(1).max(500),
    livePollSeconds: z.number().int().min(1).max(30),
    liveMaxCuesPerSession: z.number().int().min(5).max(500),
    liveQuestionSeconds: z.number().int().min(5).max(600),
    liveMaxExamMinutes: z.number().int().min(1).max(600),
    maxScreensPerUser: z.number().int().min(1).max(50),
    screenPairMinutes: z.number().int().min(1).max(60),
    trialClassesEnabled: z.boolean(),
    trialCodeA: z.string().regex(/^\d{6}$/, "Use exactly 6 digits"),
    trialCodeB: z.string().regex(/^\d{6}$/, "Use exactly 6 digits"),
    demoContentVisible: z.boolean(),
    tvProRequired: z.boolean(),
    tvLearnEnabled: z.boolean(),
    proPriceUgx: z.number().int().min(0).max(100_000_000),
    proDays: z.number().int().min(1).max(3650),
    maxSlidesPerLesson: z.number().int().min(1).max(100),
    maxLessonBodyChars: z.number().int().min(500).max(100000),
    quizMaxAttempts: z.number().int().min(0).max(50),
    examMaxAttempts: z.number().int().min(0).max(20),
    revealQuizAnswers: z.boolean(),
    revealExamAnswers: z.boolean(),
    liveLessonsEnabled: z.boolean(),
    liveLessonHosts: z.string().max(500),
    liveLessonEarlyMinutes: z.number().int().min(0).max(240),
    certificatesEnabled: z.boolean(),
    badgesEnabled: z.boolean(),
    dripEnabled: z.boolean(),
    prerequisitesEnabled: z.boolean(),
    badgeCoursesThreshold: z.number().int().min(1).max(100),
    assignmentsEnabled: z.boolean(),
    maxSubmissionChars: z.number().int().min(100).max(50000),
    couponsEnabled: z.boolean(),
    maxCouponPercent: z.number().int().min(1).max(100),
    bundlesEnabled: z.boolean(),
    maxBundleCourses: z.number().int().min(2).max(100),
    subscriptionsEnabled: z.boolean(),
    maxPlansPerSchool: z.number().int().min(1).max(50),
    maxPlanDays: z.number().int().min(1).max(3650),
    reviewsEnabled: z.boolean(),
    reviewMinProgressPercent: z.number().int().min(0).max(100),
    qaEnabled: z.boolean(),
    maxQaChars: z.number().int().min(100).max(10000),
    qaPostsPerHour: z.number().int().min(1).max(500),
    messagingEnabled: z.boolean(),
    callsEnabled: z.boolean(),
    maxMessageChars: z.number().int().min(50).max(5000),
    messagesPerHour: z.number().int().min(1).max(2000),
    announcementsEnabled: z.boolean(),
    cohortsEnabled: z.boolean(),
    instructorsEnabled: z.boolean(),
    maxInstructorsPerCourse: z.number().int().min(1).max(50),
    homeProgressEnabled: z.boolean(),
    homeToolsEnabled: z.boolean(),
    homeFreeRailEnabled: z.boolean(),
    homeRailSize: z.number().int().min(3).max(20),
  }));

educationAdminRoutes.get("/admin/learn-settings", requirePermission("settings.view"), async (c) => {
  return c.json({ learn: await getLearnSettings() });
});

educationAdminRoutes.patch("/admin/learn-settings", requirePermission("settings.manage"), async (c) => {
  const parsed = settingsPatch.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const before = await getLearnSettings();
  const codeA = parsed.data.trialCodeA ?? before.trialCodeA;
  const codeB = parsed.data.trialCodeB ?? before.trialCodeB;
  if (codeA === codeB) return c.json({ error: "invalid_body", message: "The two trial class codes must be different." }, 400);
  await setLearnSettings(parsed.data as never);
  const after = await getLearnSettings();
  await logActivity({
    actor: c.get("user"),
    action: "settings.update",
    entityType: "settings",
    summary: "Updated Peebee Learn settings",
    before: { learn: before },
    after: { learn: after },
    ip: clientIp(c),
  });
  return c.json({ learn: after });
});

educationAdminRoutes.get("/admin/learn-schools", requirePermission("settings.view"), async (c) => {
  if (!(await studioReady())) return c.json({ ok: true, schools: [] });
  const res = await db.execute({
    sql: `SELECT s.*, u.name AS owner_name,
                 (SELECT COUNT(*) FROM edu_classes c WHERE c.school_id = s.id) AS class_count,
                 (SELECT COUNT(*) FROM edu_courses c WHERE c.school_id = s.id) AS course_count
          FROM edu_schools s JOIN users u ON u.id = s.owner_id
          ORDER BY s.created_at DESC LIMIT 200`,
    args: [],
  });
  return c.json({
    ok: true,
    schools: (res.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      ownerId: String(r.owner_id),
      ownerName: String(r.owner_name),
      name: String(r.name),
      slug: String(r.slug),
      kind: String(r.kind),
      streams: String(r.streams).split(",").filter(Boolean),
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
      publishedCourseCount: 0,
      lessonCount: 0,
    })),
  });
});

educationAdminRoutes.post("/admin/learn-schools/:id/status", requirePermission("settings.manage"), async (c) => {
  const parsed = z.object({ status: z.enum(["active", "suspended"]) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (!(await studioReady())) return c.json({ error: "learn_upgrade_pending", message: "Peebee Learn Studio is being set up." }, 503);

  const id = c.req.param("id") ?? "";
  const school = (await db.execute({ sql: "SELECT id, name, status FROM edu_schools WHERE id = ?", args: [id] })).rows[0] as Record<string, unknown> | undefined;
  if (!school) return c.json({ error: "not_found", message: "That school wasn't found." }, 404);

  await db.execute({ sql: "UPDATE edu_schools SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [parsed.data.status, id] });
  await logActivity({
    actor: c.get("user"),
    action: parsed.data.status === "suspended" ? "learn.school_suspend" : "learn.school_restore",
    entityType: "learn_school",
    entityId: id,
    summary: `${parsed.data.status === "suspended" ? "Suspended" : "Restored"} school “${String(school.name)}”`,
    before: { status: school.status },
    after: { status: parsed.data.status },
    ip: clientIp(c),
  });
  return c.json({ ok: true, status: parsed.data.status });
});

// ---------------------------------------------------------------------------
// Demo content: eight educators, five streams and two trial live classes, installed and removed as a set.
// ---------------------------------------------------------------------------

educationAdminRoutes.get("/admin/learn-demo", requirePermission("settings.view"), async (c) => {
  return c.json({ ok: true, steps: DEMO_STEPS, ...(await demoStatus()) });
});

const installBody = z.object({
  step: z.number().int().min(0).max(DEMO_STEPS - 1).default(0),
  /** Optional. When set, the demo educators can sign in with their demo email and this password. */
  password: z.string().min(8).max(100).optional(),
});

educationAdminRoutes.post("/admin/learn-demo/install", requirePermission("settings.manage"), async (c) => {
  const parsed = installBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Check the request.", issues: parsed.error.issues }, 400);
  const missing = await demoMissing();
  if (missing.length > 0) {
    return c.json({ error: "upgrade_pending", message: `Apply these migrations to the database first, in order: ${missing.join(", ")}.`, missing }, 503);
  }
  try {
    const result = await installDemoStep(parsed.data.step, parsed.data.password);
    if (result.done) {
      await logActivity({
        actor: c.get("user"),
        action: "learn.demo.install",
        entityType: "settings",
        summary: "Installed the Peebee Learn demo content",
        after: { passwordSet: Boolean(parsed.data.password) },
        ip: clientIp(c),
      });
    }
    return c.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof DemoError) return c.json({ error: err.code, message: err.message }, 409);
    throw err;
  }
});

educationAdminRoutes.delete("/admin/learn-demo", requirePermission("settings.manage"), async (c) => {
  const missing = await demoMissing();
  if (missing.length > 0) return c.json({ error: "upgrade_pending", message: `Apply these migrations to the database first, in order: ${missing.join(", ")}.`, missing }, 503);
  try {
    const result = await removeDemo();
    await logActivity({
      actor: c.get("user"),
      action: "learn.demo.remove",
      entityType: "settings",
      summary: "Removed the Peebee Learn demo content",
      after: result as never,
      ip: clientIp(c),
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof DemoError) return c.json({ error: err.code, message: err.message }, 409);
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Learn Pro: who has it. Staff can grant and revoke; educators can also buy it from their wallet.
// ---------------------------------------------------------------------------

educationAdminRoutes.get("/admin/learn-pro", requirePermission("settings.view"), async (c) => {
  return c.json({ ok: true, educators: await listPro() });
});

const grantBody = z.object({
  /** The educator's phone number or email. */
  identifier: z.string().trim().min(3).max(120),
  /** How many days; leave out for no end date. */
  days: z.number().int().min(1).max(3650).nullable().optional(),
  note: z.string().trim().max(200).optional(),
});

educationAdminRoutes.post("/admin/learn-pro/grant", requirePermission("settings.manage"), async (c) => {
  const parsed = grantBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Check the request.", issues: parsed.error.issues }, 400);
  const person = await resolveCustomerByIdentifier(parsed.data.identifier);
  if (!person) return c.json({ error: "not_found", message: "No active customer account has that phone number or email." }, 404);
  const days = parsed.data.days ?? null;
  const result = await grantPro({ userId: person.id, days, grantedBy: c.get("user").sub, note: parsed.data.note });
  await logActivity({
    actor: c.get("user"),
    action: "learn.pro.grant",
    entityType: "user",
    entityId: person.id,
    summary: `Granted Learn Pro to ${person.name}${days ? ` for ${days} days` : " with no end date"}`,
    after: { expiresAt: result.expiresAt },
    ip: clientIp(c),
  });
  return c.json({ ok: true, userId: person.id, name: person.name, expiresAt: result.expiresAt });
});

educationAdminRoutes.delete("/admin/learn-pro/:userId", requirePermission("settings.manage"), async (c) => {
  const userId = c.req.param("userId") ?? "";
  const removed = await revokePro(userId);
  if (!removed) return c.json({ error: "not_found", message: "That educator doesn't have Pro." }, 404);
  await logActivity({ actor: c.get("user"), action: "learn.pro.revoke", entityType: "user", entityId: userId, summary: "Revoked Learn Pro", ip: clientIp(c) });
  return c.json({ ok: true });
});
