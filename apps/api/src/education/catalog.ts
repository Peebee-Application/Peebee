import { Hono } from "hono";
import { EDUCATION_STREAM_IDS, normaliseContentType, type LearningDraft } from "@peebee/shared";
import { db } from "../db/client.js";
import { clientIp, consume, tooManyRequests } from "../lib/ratelimit.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getLearnSettings } from "./settings.js";
import { courseRules, proReady } from "./rewards.js";
import { offersForCourse } from "./sales.js";
import { openCohorts, ratingOf, reviewsOf } from "./community.js";
import { studioReady } from "./studio.js";

/**
 * What learners can browse: published courses from schools that are in good
 * standing. Public and read-only. Quiz answers and explanations are never
 * included here; they are only ever shown to the educator who wrote them.
 */
export const catalogRoutes = new Hono();

type Row = Record<string, unknown>;

catalogRoutes.use("*", async (c, next) => {
  const quota = await consume(`learn-catalog:${clientIp(c)}`, 120, 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many requests. Try again in a moment.");
  await next();
});

function outcomes(raw: unknown): string[] {
  try {
    const list = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** What the Learn home shows. Public: the same switches for everyone, all set in Admin. */
catalogRoutes.get("/home-config", async (c) => {
  const s = await getLearnSettings();
  return c.json({
    ok: true,
    home: {
      progress: s.homeProgressEnabled && s.badgesEnabled,
      tools: s.homeToolsEnabled,
      freeRail: s.homeFreeRailEnabled,
      railSize: s.homeRailSize,
      tv: s.tvLearnEnabled,
      certificates: s.certificatesEnabled,
      fees: s.feesEnabled,
      live: s.liveEnabled,
      trialClasses: s.trialClassesEnabled,
    },
  });
});

catalogRoutes.get("/courses", async (c) => {
  if (!(await studioReady())) return c.json({ ok: true, courses: [] });
  const stream = c.req.query("stream");
  const limit = Math.max(1, Math.min(50, Number(c.req.query("limit")) || 24));
  const filtered = stream && (EDUCATION_STREAM_IDS as readonly string[]).includes(stream);
  // Demo schools are marked in the database once migration 0113 is applied; until then everything is treated as real.
  const marked = await hasColumn("edu_schools", "is_demo");
  const hideDemo = marked && !(await getLearnSettings()).demoContentVisible;
  // A store can sell a course without listing it here (admin option); the column arrives with migration 0137.
  const listedCol = await hasColumn("edu_courses", "catalog_listed");
  const res = await db.execute({
    sql: `SELECT c.id, c.stream, c.title, c.summary, c.price_ugx, c.framework, c.outcomes_json,
                 ${marked ? "s.is_demo AS is_demo," : ""}
                 s.id AS school_id, s.name AS school_name, s.slug AS school_slug, k.name AS class_name, k.kind AS class_kind, k.level AS class_level,
                 (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = c.id) AS lesson_count
          FROM edu_courses c
          JOIN edu_schools s ON s.id = c.school_id AND s.status = 'active'
          JOIN edu_classes k ON k.id = c.class_id
          WHERE c.status = 'published' ${listedCol ? "AND c.catalog_listed = 1" : ""} ${hideDemo ? "AND s.is_demo = 0" : ""} ${filtered ? "AND c.stream = ?" : ""}
          ORDER BY ${marked ? "s.is_demo ASC, " : ""}c.updated_at DESC LIMIT ?`,
    args: (filtered ? [stream, limit] : [limit]) as never,
  });
  return c.json({
    ok: true,
    courses: (res.rows as Row[]).map((r) => ({
      id: String(r.id),
      stream: String(r.stream),
      title: String(r.title),
      summary: String(r.summary ?? ""),
      priceUgx: Number(r.price_ugx ?? 0),
      framework: String(r.framework),
      outcomes: outcomes(r.outcomes_json),
      schoolId: String(r.school_id),
      schoolName: String(r.school_name),
      schoolSlug: String(r.school_slug),
      className: String(r.class_name),
      classKind: String(r.class_kind),
      classLevel: String(r.class_level ?? ""),
      lessonCount: Number(r.lesson_count ?? 0),
      demo: Number(r.is_demo ?? 0) === 1,
    })),
  });
});

catalogRoutes.get("/courses/:id", async (c) => {
  if (!(await studioReady())) return c.json({ error: "not_found", message: "That course wasn't found." }, 404);
  const course = (
    await db.execute({
      sql: `SELECT c.*, s.name AS school_name, k.name AS class_name
            FROM edu_courses c
            JOIN edu_schools s ON s.id = c.school_id AND s.status = 'active'
            JOIN edu_classes k ON k.id = c.class_id
            WHERE c.id = ? AND c.status = 'published'`,
      args: [c.req.param("id")],
    })
  ).rows[0] as Row | undefined;
  if (!course) return c.json({ error: "not_found", message: "That course wasn't found." }, 404);

  let snapshot:LearningDraft|null=null;
  if(await hasTable("edu_course_drafts") && await hasTable("edu_course_publications")) {
    const r=(await db.execute({sql:"SELECT p.body_json FROM edu_course_drafts d JOIN edu_course_publications p ON p.id=d.published_version WHERE d.course_id=?",args:[String(course.id)]})).rows[0];
    if(r)snapshot=JSON.parse(String(r.body_json)) as LearningDraft;
    if(snapshot?.visibility==="invite"||snapshot?.visibility==="private")return c.json({error:"not_found",message:"That course wasn't found."},404);
  }
  const modules:Row[] = snapshot ? snapshot.modules.map((m)=>({id:m.id,title:m.title,description:m.description})) : (await db.execute({ sql: "SELECT * FROM edu_modules WHERE course_id = ? ORDER BY position ASC LIMIT 500", args: [course.id as string] })).rows as Row[];
  const lessons:Row[] = snapshot ? snapshot.modules.flatMap((m)=>m.lessons.map((l)=>({id:l.id,module_id:m.id,title:l.title,content_type:l.nativeActivity||"text",duration_minutes:l.minutes,summary:""}))) : (await db.execute({ sql: "SELECT * FROM edu_lessons WHERE course_id = ? ORDER BY position ASC LIMIT 5000", args: [course.id as string] })).rows as Row[];
  let prerequisite: { id: string; title: string } | null = null;
  if ((await getLearnSettings()).prerequisitesEnabled) {
    const need = (await courseRules(String(course.id))).prerequisiteCourseId;
    const row = need ? ((await db.execute({ sql: "SELECT id, title FROM edu_courses WHERE id = ?", args: [need] })).rows[0] as Row | undefined) : undefined;
    if (row) prerequisite = { id: String(row.id), title: String(row.title) };
  }
  const offers = await offersForCourse(String(course.id), String(course.school_id));
  return c.json({
    ok: true,
    course: {
      prerequisite,
      bundles: offers.bundles,
      plans: offers.plans,
      rating: await ratingOf(String(course.id)),
      reviews: await reviewsOf(String(course.id), 10),
      cohorts: (await getLearnSettings()).cohortsEnabled ? await openCohorts(String(course.id)) : [],
      id: String(course.id),
      stream: String(course.stream),
      title: String(course.title),
      summary: String(course.summary ?? ""),
      priceUgx: Number(course.price_ugx ?? 0),
      framework: String(course.framework),
      outcomes: outcomes(course.outcomes_json),
      schoolId: String(course.school_id),
      schoolName: String(course.school_name),
      className: String(course.class_name),
      modules: modules.map((m) => ({
        id: String(m.id),
        title: String(m.title),
        description: String(m.description ?? ""),
        lessons: lessons
          .filter((l) => l.module_id === m.id)
          .map((l) => {
            let questionCount = 0;
            try {
              questionCount = JSON.parse(String(l.quiz_json ?? "null"))?.questions?.length ?? 0;
            } catch {
              questionCount = 0;
            }
            return {
              id: String(l.id),
              title: String(l.title),
              contentType: normaliseContentType(String(l.content_type)),
              durationMinutes: Number(l.duration_minutes ?? 0),
              summary: String(l.summary ?? ""),
              questionCount,
            };
          }),
      })),
    },
  });
});

/** Anyone can check a certificate by its code: it says who finished what, and when. */
catalogRoutes.get("/certificates/:code", async (c) => {
  if (!(await proReady())) return c.json({ error: "not_found", message: "No certificate has that code." }, 404);
  const row = (await db.execute({ sql: "SELECT learner_name, course_title, school_name, score_percent, issued_at FROM edu_certificates WHERE code = ?", args: [c.req.param("code").toUpperCase().slice(0, 20)] })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found", message: "No certificate has that code." }, 404);
  return c.json({ ok: true, certificate: { learnerName: String(row.learner_name), courseTitle: String(row.course_title), schoolName: String(row.school_name), scorePercent: row.score_percent === null ? null : Number(row.score_percent), issuedAt: String(row.issued_at) } });
});
