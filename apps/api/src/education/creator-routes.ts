import { Hono } from "hono";
import { z } from "zod";
import { emptyLearningDraft, type LearningDraft } from "@peebee/shared";
import { executeBatch, requireChangedRow } from "../db/client.js";
import { creatorDb as db } from "./creator-db.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { consume, clientIp } from "../lib/ratelimit.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { requireRole } from "../auth/middleware.js";
import { requirePermission } from "../admin/permissions.js";
import { logActivity } from "../admin/activity.js";
import { sha256Hex } from "../marketplace/digital-sales.js";
import { one, body as readBody, ownedCourse } from "./studio.js";
import { getLearnSettings } from "./settings.js";
import {
  creatorReady,
  creatorOptions,
  draftLimits,
  workspace,
  contextFor,
  authorizeDraft,
  CreatorError,
  hasCreatorPermission,
  persistPublication,
  snapshotLegacy,
  type Row,
} from "./creator-service.js";
import { learningEnrollmentStatements } from "./creator-enrollment.js";
import { chooseCohort } from "./cohorts.js";
import { openCohorts } from "./community.js";
import { validateDraft } from "./creator-model.js";
import { runLearningJob, jobView } from "./creator-ai.js";

export const creatorRoutes = new Hono();
creatorRoutes.onError((err, c) => {
  if (err instanceof CreatorError)
    return c.json(
      { error: "creator_request", message: err.message },
      err.status,
    );
  if (err instanceof z.ZodError)
    return c.json(
      {
        error: "invalid_body",
        message: err.issues[0]?.message ?? "Check the content.",
      },
      400,
    );
  console.error("Learn authoring failed", err);
  return c.json(
    {
      error: "authoring_failed",
      message:
        "We couldn't save this change. Your existing work is safe; try again.",
    },
    503,
  );
});

creatorRoutes.get("/config", async (c) => {
  const o = await creatorOptions();
  return c.json({
    enabled: Boolean(o.learn_creator_enabled),
    ready: await creatorReady(),
    aiEnabled: Boolean(o.learn_creator_ai_enabled),
    tutoringEnabled: Boolean(o.learn_creator_tutor_enabled),
    publishingEnabled: Boolean(o.learn_creator_publishing_enabled),
    sellingEnabled: Boolean(o.learn_creator_selling_enabled),
    uploadsEnabled: Boolean(o.learn_creator_uploads_enabled),
    maxUploadMb: Number(o.learn_creator_max_upload_mb),
    maxModules: Number(o.learn_creator_max_modules),
    maxLessons: Number(o.learn_creator_max_lessons),
    maxResources: Number(o.learn_creator_max_resources),
    reviewRequired: Boolean(o.learn_creator_review_required),
  });
});

creatorRoutes.use("*", async (c, next) => {
  if (!(await creatorReady()))
    return c.json(
      {
        error: "migration_pending",
        message:
          "The learning creator is being set up. Apply 0158_learn_creator.sql after the existing Learn migrations.",
      },
      503,
    );
  if (!(await getLearnSettings()).enabled)
    return c.json(
      { error: "learn_disabled", message: "Learn is currently unavailable." },
      503,
    );
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const o = await creatorOptions();
    const budget = await consume(
      `creator-write:${c.get("user").sub}`,
      Number(o.learn_creator_writes_hour),
      3600,
    );
    if (!budget.allowed)
      return c.json(
        {
          error: "rate_limited",
          message: "Too many changes. Please try again later.",
        },
        429,
      );
  }
  await next();
});

async function authoringOn() {
  const o = await creatorOptions();
  if (!o.learn_creator_enabled)
    throw new CreatorError(
      503,
      "Course creation is switched off. Published courses remain available.",
    );
  return o;
}

creatorRoutes.get("/profile", async (c) => {
  const row = await one("SELECT * FROM edu_learning_profiles WHERE user_id=?", [
    c.get("user").sub,
  ]);
  return c.json({
    profile: {
      goals: String(row?.goals ?? ""),
      level: String(row?.level ?? ""),
      language: String(row?.language ?? "English"),
      minutesPerDay: Number(row?.minutes_per_day ?? 20),
    },
  });
});
creatorRoutes.put("/profile", async (c) => {
  await authoringOn();
  const parsed = await readBody(
    c,
    z.object({
      goals: z.string().max(4000),
      level: z.string().max(200),
      language: z.string().min(1).max(80),
      minutesPerDay: z.number().int().min(1).max(1440),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const p = parsed.data;
  await db.execute({
    sql: "INSERT INTO edu_learning_profiles(user_id,goals,level,language,minutes_per_day) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET goals=excluded.goals,level=excluded.level,language=excluded.language,minutes_per_day=excluded.minutes_per_day",
    args: [c.get("user").sub, p.goals, p.level, p.language, p.minutesPerDay],
  });
  return c.json({ ok: true });
});

creatorRoutes.get("/courses", async (c) => {
  const userId = c.get("user").sub;
  const rows = await db.execute({
    sql: `SELECT d.* FROM edu_course_drafts d JOIN edu_courses c ON c.id=d.course_id JOIN edu_schools s ON s.id=c.school_id WHERE s.owner_id=? OR EXISTS(SELECT 1 FROM edu_course_instructors i WHERE i.course_id=c.id AND i.user_id=?) OR EXISTS(SELECT 1 FROM stores st JOIN merchant_members mm ON mm.merchant_id=st.merchant_id WHERE st.id=d.store_id AND mm.user_id=? AND mm.status='active') ORDER BY d.updated_at DESC LIMIT 200`,
    args: [userId, userId, userId],
  });
  const allowed = [];
  for (const row of rows.rows) {
    try {
      await authorizeDraft(userId, String(row.course_id));
      allowed.push(workspace(row));
    } catch (err) {
      if (!(err instanceof CreatorError)) throw err;
    }
  }
  return c.json({ workspaces: allowed });
});

creatorRoutes.post("/courses", async (c) => {
  const o = await authoringOn();
  const parsed = await readBody(
    c,
    z.object({
      title: z.string().trim().min(2).max(200),
      classId: z.string().max(100).optional(),
      courseId: z.string().max(100).optional(),
      storeId: z.string().max(100).optional(),
      kind: z.enum(["course", "path"]).default("course"),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const ctx = await contextFor(c, parsed.data),
    courseId = ctx.course ? String(ctx.course.id) : newId("crs");
  const old = await one("SELECT * FROM edu_course_drafts WHERE course_id=?", [
    courseId,
  ]);
  if (old)
    return c.json({
      workspace: workspace(await authorizeDraft(c.get("user").sub, courseId)),
    });
  const count = await one(
    "SELECT COUNT(*) AS n FROM edu_course_drafts d JOIN edu_courses c ON c.id=d.course_id JOIN edu_schools s ON s.id=c.school_id WHERE s.owner_id=?",
    [c.get("user").sub],
  );
  if (Number(count?.n) >= Number(o.learn_creator_max_courses))
    throw new CreatorError(
      403,
      "Your creator workspace has reached its course limit.",
    );
  const profile = await one(
    "SELECT * FROM edu_learning_profiles WHERE user_id=?",
    [c.get("user").sub],
  );
  const draft: LearningDraft = ctx.course
    ? await snapshotLegacy(ctx.course)
    : {
        ...emptyLearningDraft(),
        title: parsed.data.title,
        kind: parsed.data.kind,
        goal: String(profile?.goals || ""),
        timeBudget: `${Number(profile?.minutes_per_day || 20)} minutes per day`,
        language: String(profile?.language || "English"),
        audience: String(profile?.level || ""),
      };
  const storeCol = await hasColumn("edu_courses", "store_id");
  const statements = [];
  if (!ctx.course)
    statements.push({
      sql: `INSERT INTO edu_courses(id,school_id,class_id,stream,title,status${storeCol ? ",store_id" : ""}) VALUES(?,?,?,?,?,'draft'${storeCol ? ",?" : ""})`,
      args: [
        courseId,
        ctx.schoolId,
        ctx.classId,
        ctx.stream,
        draft.title,
        ...(storeCol ? [parsed.data.storeId || null] : []),
      ],
    });
  statements.push({
    sql: "INSERT INTO edu_course_drafts(course_id,context,store_id,body_json,created_by,last_edited_by) VALUES(?,?,?,?,?,?)",
    args: [
      courseId,
      ctx.context,
      parsed.data.storeId || null,
      JSON.stringify(draft),
      c.get("user").sub,
      c.get("user").sub,
    ],
  });
  await executeBatch(statements);
  return c.json(
    {
      workspace: workspace(
        (await one("SELECT * FROM edu_course_drafts WHERE course_id=?", [
          courseId,
        ]))!,
      ),
    },
    201,
  );
});

creatorRoutes.get("/courses/:id", async (c) => {
  const r = await authorizeDraft(c.get("user").sub, c.req.param("id"), true);
  let canEdit = true;
  try {
    await authorizeDraft(c.get("user").sub, c.req.param("id"));
  } catch (err) {
    if (err instanceof CreatorError) canEdit = false;
    else throw err;
  }
  const reviews = await db.execute({
    sql: "SELECT r.*,u.name FROM edu_course_reviews r JOIN users u ON u.id=r.reviewer_id WHERE course_id=? ORDER BY created_at DESC",
    args: [c.req.param("id")],
  });
  return c.json({
    workspace: { ...workspace(r), canEdit },
    reviews: reviews.rows.map((review) => ({
      id: String(review.id),
      reviewerId: String(review.reviewer_id),
      reviewerName: String(review.name),
      revision: Number(review.revision),
      status: String(review.status),
      comments: String(review.comments),
      independent:
        review.reviewer_id !== r.last_edited_by &&
        review.reviewer_id !== r.owner_id,
    })),
  });
});

creatorRoutes.put("/courses/:id", async (c) => {
  const o = await authoringOn(),
    r = await authorizeDraft(c.get("user").sub, c.req.param("id"));
  const body = await c.req.json();
  const revision = z.number().int().min(1).parse(body.revision);
  let draft: LearningDraft;
  try {
    draft = validateDraft(body.draft, draftLimits(o));
  } catch (err) {
    throw new CreatorError(
      400,
      err instanceof Error ? err.message : "Invalid draft.",
    );
  }
  for (const m of draft.modules)
    for (const l of m.lessons) {
      const native = await one(
        "SELECT content_type FROM edu_lessons WHERE id=? AND course_id=?",
        [l.id, r.course_id],
      );
      l.nativeActivity = !!native && native.content_type !== "text";
      for (const resource of l.resources)
        if (resource.url.startsWith("resource:")) {
          const own = await one(
            "SELECT id FROM edu_creator_resources WHERE id=? AND course_id=?",
            [resource.url.slice(9), r.course_id],
          );
          if (!own)
            throw new CreatorError(
              400,
              "A resource belongs to another course.",
            );
        }
    }
  const updated = await db.execute({
    sql: "UPDATE edu_course_drafts SET body_json=?,last_edited_by=?,revision=revision+1,updated_at=datetime('now') WHERE course_id=? AND revision=?",
    args: [JSON.stringify(draft), c.get("user").sub, r.course_id, revision],
  });
  if (!updated.rowsAffected)
    throw new CreatorError(
      409,
      "This draft changed elsewhere. Reload before saving; your changes were not overwritten.",
    );
  return c.json({
    workspace: workspace(
      (await one("SELECT * FROM edu_course_drafts WHERE course_id=?", [
        r.course_id,
      ]))!,
    ),
  });
});

creatorRoutes.post("/courses/:id/jobs", async (c) => {
  const o = await authoringOn();
  if (!o.learn_creator_ai_enabled)
    throw new CreatorError(
      503,
      "AI generation is switched off. You can continue editing manually.",
    );
  const r = await authorizeDraft(c.get("user").sub, c.req.param("id"));
  const parsed = await readBody(
    c,
    z.object({
      revision: z.number().int(),
      stage: z.enum(["outline", "lessons", "source"]),
      resourceId: z.string().max(100).optional(),
      requestId: z.string().min(8).max(100),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const existing = await one(
    "SELECT * FROM edu_generation_jobs WHERE user_id=? AND request_id=?",
    [c.get("user").sub, parsed.data.requestId],
  );
  if (existing) {
    if (existing.course_id !== r.course_id)
      throw new CreatorError(409, "That request identifier is already in use.");
    return c.json({ job: jobView(existing) });
  }
  if (parsed.data.revision !== Number(r.revision))
    throw new CreatorError(
      409,
      "Save/reload the latest draft before generating.",
    );
  const id = newId("gen"),
    userId = c.get("user").sub;
  if (
    parsed.data.stage === "source" &&
    (!parsed.data.resourceId ||
      !(await one(
        "SELECT id FROM edu_creator_resources WHERE id=? AND course_id=?",
        [parsed.data.resourceId, r.course_id],
      )))
  )
    throw new CreatorError(
      400,
      "Choose an uploaded source belonging to this course.",
    );
  const result = await db.execute({
    sql: `INSERT INTO edu_generation_jobs(id,course_id,user_id,request_id,stage,base_revision,input_json,resource_id) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM edu_generation_jobs WHERE user_id=? AND created_at >= datetime('now','-1 day')) < ? ${r.store_id ? "AND (SELECT COUNT(*) FROM edu_generation_jobs j JOIN edu_course_drafts d ON d.course_id=j.course_id WHERE d.store_id=? AND j.created_at>=datetime('now','-1 day')) < ?" : ""}`,
    args: [
      id,
      r.course_id,
      userId,
      parsed.data.requestId,
      parsed.data.stage,
      r.revision,
      r.body_json,
      parsed.data.resourceId || null,
      userId,
      Number(o.learn_creator_generations_day),
      ...(r.store_id
        ? [r.store_id, Number(o.learn_creator_store_generations_day)]
        : []),
    ],
  });
  if (!result.rowsAffected)
    throw new CreatorError(
      429,
      "The generation allowance is used up. Your draft is saved; try later or ask Admin about your allowance.",
    );
  const promise = runLearningJob(id);
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise.catch((err) => console.error("Learning job", err));
  }
  return c.json(
    {
      job: jobView(
        (await one("SELECT * FROM edu_generation_jobs WHERE id=?", [id]))!,
      ),
    },
    202,
  );
});
creatorRoutes.get("/jobs/:id", async (c) => {
  const r = await one(
    "SELECT * FROM edu_generation_jobs WHERE id=? AND user_id=?",
    [c.req.param("id"), c.get("user").sub],
  );
  if (!r) throw new CreatorError(404, "That generation wasn't found.");
  await authorizeDraft(c.get("user").sub, String(r.course_id));
  return c.json({ job: jobView(r) });
});
creatorRoutes.post("/jobs/:id/cancel", async (c) => {
  await db.execute({
    sql: "UPDATE edu_generation_jobs SET status='cancelled',updated_at=datetime('now') WHERE id=? AND user_id=? AND status IN ('queued','running')",
    args: [c.req.param("id"), c.get("user").sub],
  });
  return c.json({ ok: true });
});

creatorRoutes.post("/courses/:id/reviewers", async (c) => {
  await authoringOn();
  const r = await authorizeDraft(c.get("user").sub, c.req.param("id"));
  const parsed = await readBody(
    c,
    z.object({ reviewerId: z.string().min(1).max(100) }),
  );
  if (!parsed.ok) return parsed.res;
  if (
    !(await hasCreatorPermission(
      parsed.data.reviewerId,
      "review",
      String(r.school_id),
    ))
  )
    throw new CreatorError(
      403,
      "That person must be verified as an educator reviewer by Admin first.",
    );
  await db.execute({
    sql: "INSERT OR IGNORE INTO edu_course_reviewers(course_id,user_id,invited_by) VALUES(?,?,?)",
    args: [r.course_id, parsed.data.reviewerId, c.get("user").sub],
  });
  return c.json({ ok: true });
});
creatorRoutes.get("/reviews", async (c) => {
  const res = await db.execute({
    sql: "SELECT d.course_id,d.revision,d.body_json FROM edu_course_reviewers r JOIN edu_course_drafts d ON d.course_id=r.course_id WHERE r.user_id=?",
    args: [c.get("user").sub],
  });
  return c.json({
    invitations: res.rows.map((r) => ({
      courseId: String(r.course_id),
      revision: Number(r.revision),
      title: JSON.parse(String(r.body_json)).title,
    })),
  });
});
creatorRoutes.post("/courses/:id/reviews", async (c) => {
  const r = await authorizeDraft(c.get("user").sub, c.req.param("id"), true),
    userId = c.get("user").sub;
  if (!(await hasCreatorPermission(userId, "review", String(r.school_id))))
    throw new CreatorError(
      403,
      "A verified educator-review permission is required.",
    );
  const parsed = await readBody(
    c,
    z.object({
      revision: z.number().int(),
      status: z.enum(["approved", "changes_requested"]),
      comments: z.string().trim().min(1).max(10000),
    }),
  );
  if (!parsed.ok) return parsed.res;
  if (parsed.data.revision !== Number(r.revision))
    throw new CreatorError(
      409,
      "This draft changed. Review the current revision.",
    );
  await executeBatch([
    {
      sql: "UPDATE edu_course_drafts SET updated_at=updated_at WHERE course_id=? AND revision=?",
      args: [r.course_id, parsed.data.revision],
    },
    requireChangedRow,
    {
      sql: "INSERT INTO edu_course_reviews(id,course_id,reviewer_id,revision,status,comments) VALUES(?,?,?,?,?,?) ON CONFLICT(course_id,reviewer_id,revision) DO UPDATE SET status=excluded.status,comments=excluded.comments,created_at=datetime('now')",
      args: [
        newId("review"),
        r.course_id,
        userId,
        parsed.data.revision,
        parsed.data.status,
        parsed.data.comments,
      ],
    },
  ]);
  return c.json({ ok: true });
});

creatorRoutes.post("/courses/:id/study", async (c) => {
  const o = await authoringOn(),
    r = await authorizeDraft(c.get("user").sub, c.req.param("id"));
  const parsed = await readBody(c, z.object({ revision: z.number().int() }));
  if (!parsed.ok) return parsed.res;
  if (parsed.data.revision !== Number(r.revision))
    throw new CreatorError(409, "Save the current draft before studying it.");
  const draft = validateDraft(JSON.parse(String(r.body_json)), draftLimits(o));
  if (
    !draft.modules.some((m) =>
      m.lessons.some(
        (l) => l.body.trim() || l.resources.length || l.nativeActivity,
      ),
    )
  )
    throw new CreatorError(400, "Add a lesson or teaching material first.");
  const publicationId = await persistPublication(
    c.get("user").sub,
    r,
    draft,
    ["Private study version"],
    true,
  );
  return c.json({ publicationId });
});

creatorRoutes.post("/courses/:id/publish", async (c) => {
  const o = await authoringOn(),
    r = await authorizeDraft(c.get("user").sub, c.req.param("id"));
  if (!o.learn_creator_publishing_enabled)
    throw new CreatorError(403, "Publication is switched off.");
  const parsed = await readBody(c, z.object({ revision: z.number().int() }));
  if (!parsed.ok) return parsed.res;
  if (parsed.data.revision !== Number(r.revision))
    throw new CreatorError(
      409,
      "Reload the latest revision before publication.",
    );
  const userId = c.get("user").sub,
    schoolId = String(r.school_id);
  if (!(await hasCreatorPermission(userId, "publish", schoolId)))
    throw new CreatorError(
      403,
      "Complete creator eligibility checks with Admin before publishing.",
    );
  const d = validateDraft(JSON.parse(String(r.body_json)), draftLimits(o));
  if (
    d.visibility === "private" ||
    !d.objectives.length ||
    !d.modules.length ||
    d.modules.some(
      (m) =>
        !m.lessons.length ||
        m.lessons.some(
          (l) => !l.body.trim() && !l.resources.length && !l.nativeActivity,
        ),
    )
  )
    throw new CreatorError(
      400,
      "Choose a sharing visibility and add objectives, modules and lesson content before publishing.",
    );
  if (d.priceUgx > 0 && d.visibility === "invite")
    throw new CreatorError(
      400,
      "Use an unlisted or public purchase link for a paid course. Recipient access invitations are for free courses.",
    );
  if (
    d.priceUgx > 0 &&
    (!o.learn_creator_selling_enabled ||
      !(await hasCreatorPermission(userId, "sell", schoolId)))
  )
    throw new CreatorError(
      403,
      "Seller approval and enabled sales are required for a paid course.",
    );
  const reviews = await db.execute({
    sql: "SELECT DISTINCT r.reviewer_id,u.name FROM edu_course_reviews r JOIN users u ON u.id=r.reviewer_id AND u.status='active' JOIN edu_creator_permissions p ON p.user_id=r.reviewer_id AND p.permission='review' AND p.active=1 AND p.school_id IN ('',?) WHERE r.course_id=? AND r.revision=? AND r.status='approved' AND r.reviewer_id NOT IN (?,?,?)",
    args: [
      schoolId,
      r.course_id,
      r.revision,
      r.owner_id,
      r.last_edited_by,
      userId,
    ],
  });
  if (o.learn_creator_review_required && !reviews.rows.length)
    throw new CreatorError(
      403,
      "A verified independent educator must approve this exact revision before publication.",
    );
  if (
    r.context === "school" &&
    r.owner_id !== userId &&
    !(await hasCreatorPermission(userId, "school_approve", schoolId))
  )
    throw new CreatorError(
      403,
      "The school owner or authorized school publisher must approve publication.",
    );
  const aiAssisted = await one(
    "SELECT id FROM edu_generation_jobs WHERE course_id=? AND status='completed' LIMIT 1",
    [r.course_id],
  );
  const labels = [
    aiAssisted ? "AI-assisted, creator-edited" : "Creator-authored",
    ...reviews.rows.map((r) => `Educator-reviewed by ${String(r.name)}`),
  ];
  if (
    r.context === "school" &&
    (r.owner_id === userId ||
      (await hasCreatorPermission(userId, "school_approve", schoolId)))
  )
    labels.push("School-approved");
  const publicationId = await persistPublication(userId, r, d, labels);
  await logActivity({
    actor: c.get("user"),
    action: "learn.course.publish",
    entityType: "course",
    entityId: String(r.course_id),
    summary: `Published ${d.title}`,
    after: { publicationId, revision: r.revision, priceUgx: d.priceUgx },
    ip: clientIp(c),
  });
  return c.json({ publicationId });
});

creatorRoutes.get("/courses/:id/cohorts", async (c) => {
  await authorizeDraft(c.get("user").sub, c.req.param("id"));
  return c.json({
    cohorts: (await getLearnSettings()).cohortsEnabled
      ? await openCohorts(c.req.param("id"))
      : [],
  });
});
creatorRoutes.post("/courses/:id/invites", async (c) => {
  const o = await creatorOptions();
  if (!o.learn_creator_sharing_enabled)
    throw new CreatorError(403, "Learning invitations are switched off.");
  const r = await authorizeDraft(c.get("user").sub, c.req.param("id"));
  const pub = r.published_version
    ? await one("SELECT * FROM edu_course_publications WHERE id=?", [
        r.published_version,
      ])
    : null;
  if (!pub)
    throw new CreatorError(409, "Publish a version before inviting learners.");
  const d = JSON.parse(String(pub.body_json)) as LearningDraft;
  if (d.priceUgx > 0)
    throw new CreatorError(
      403,
      "Share the purchase link for a paid course. Invitations cannot bypass payment.",
    );
  const parsed = await readBody(
    c,
    z.object({
      recipientId: z.string().min(1).max(100),
      cohortId: z.string().max(100).optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  if (
    !(await one("SELECT id FROM users WHERE id=? AND status='active'", [
      parsed.data.recipientId,
    ]))
  )
    throw new CreatorError(404, "That learner account wasn't found.");
  const chosen = await chooseCohort(
    String(r.course_id),
    parsed.data.cohortId,
    await getLearnSettings(),
  );
  if (!chosen.ok) throw new CreatorError(409, chosen.message);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO edu_learning_invites(token_hash,course_id,publication_id,recipient_id,created_by,expires_at,cohort_id) VALUES(?,?,?,?,?,datetime('now',?),?)",
    args: [
      await sha256Hex(token),
      r.course_id,
      pub.id,
      parsed.data.recipientId,
      c.get("user").sub,
      `+${Number(o.learn_creator_invite_days)} days`,
      chosen.cohort?.id || null,
    ],
  });
  return c.json({ token });
});
creatorRoutes.post("/invites/accept", async (c) => {
  const parsed = await readBody(
    c,
    z.object({ token: z.string().min(20).max(200) }),
  );
  if (!parsed.ok) return parsed.res;
  const tokenHash = await sha256Hex(parsed.data.token),
    userId = c.get("user").sub;
  const r = await one(
    "SELECT * FROM edu_learning_invites WHERE token_hash=? AND recipient_id=? AND revoked=0 AND expires_at>datetime('now')",
    [tokenHash, userId],
  );
  if (!r)
    throw new CreatorError(
      404,
      "That invitation is invalid, expired or addressed to another learner.",
    );
  const environment = await getPlatformEnvironment();
  const course = await one(
    "SELECT c.*,s.status AS school_status FROM edu_courses c JOIN edu_schools s ON s.id=c.school_id WHERE c.id=? AND c.status='published'",
    [r.course_id],
  );
  if (!course || course.school_status !== "active")
    throw new CreatorError(403, "That course isn't available.");
  const hadSeat = await one(
    "SELECT id FROM edu_enrollments WHERE user_id=? AND course_id=? AND status='active'",
    [userId, r.course_id],
  );
  await executeBatch([
    ...(await learningEnrollmentStatements(
      userId,
      String(r.course_id),
      await getLearnSettings(),
      r.cohort_id ? String(r.cohort_id) : undefined,
    )),
    {
      sql: "UPDATE edu_learning_invites SET accepted_at=datetime('now') WHERE token_hash=? AND recipient_id=? AND revoked=0 AND expires_at>datetime('now')",
      args: [tokenHash, userId],
    },
    requireChangedRow,
    {
      sql: "INSERT OR IGNORE INTO edu_enrollments(id,course_id,school_id,user_id,status,environment) VALUES(?,?,?,?,'active',?) ON CONFLICT(course_id,user_id) DO UPDATE SET status='active',environment=excluded.environment",
      args: [newId("enr"), r.course_id, course.school_id, userId, environment],
    },
    {
      sql: "INSERT INTO edu_publication_access(user_id,course_id,publication_id,source) VALUES(?,?,?,'invite') ON CONFLICT(user_id,course_id) DO UPDATE SET publication_id=excluded.publication_id,source=excluded.source WHERE ?=0",
      args: [userId, r.course_id, r.publication_id, hadSeat ? 1 : 0],
    },
  ]);
  return c.json({ courseId: r.course_id });
});

creatorRoutes.get(
  "/permissions",
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    return c.json({
      permissions: (
        await db.execute(
          "SELECT p.*,u.name FROM edu_creator_permissions p JOIN users u ON u.id=p.user_id ORDER BY u.name",
        )
      ).rows,
    });
  },
);
creatorRoutes.post(
  "/permissions",
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const parsed = await readBody(
      c,
      z.object({
        userId: z.string().min(1).max(100),
        permission: z.enum(["publish", "sell", "review", "school_approve"]),
        schoolId: z.string().max(100).default(""),
        active: z.boolean(),
        evidence: z.string().trim().min(5).max(4000),
      }),
    );
    if (!parsed.ok) return parsed.res;
    const p = parsed.data;
    if (!(await one("SELECT id FROM users WHERE id=?", [p.userId])))
      throw new CreatorError(404, "That account wasn't found.");
    if (
      p.schoolId &&
      !(await one("SELECT id FROM edu_schools WHERE id=?", [p.schoolId]))
    )
      throw new CreatorError(404, "That school wasn't found.");
    await db.execute({
      sql: "INSERT INTO edu_creator_permissions(user_id,permission,school_id,granted_by,active,evidence) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,permission,school_id) DO UPDATE SET active=excluded.active,granted_by=excluded.granted_by,evidence=excluded.evidence",
      args: [
        p.userId,
        p.permission,
        p.schoolId,
        c.get("user").sub,
        p.active ? 1 : 0,
        p.evidence,
      ],
    });
    await logActivity({
      actor: c.get("user"),
      action: "learn.creator.permission",
      entityType: "user",
      entityId: p.userId,
      summary: `${p.active ? "Granted" : "Revoked"} ${p.permission}`,
      after: p,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  },
);
