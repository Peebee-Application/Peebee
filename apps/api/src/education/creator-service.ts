import type { Context } from "hono";
import type { LearningDraft, LearningWorkspace } from "@peebee/shared";
import {
  executeBatch,
  requireChangedRow,
  type DbStatement,
} from "../db/client.js";
import { creatorDb as db } from "./creator-db.js";
import { hasColumn, hasTable, tablesExist } from "../lib/schema.js";
import { getOptions } from "../lib/option-settings.js";
import { getLearnSettings } from "./settings.js";
import { newId } from "../lib/ids.js";
import { one, ownedClass, ownedCourse, ownedSchool } from "./studio.js";
import { storePlan } from "../marketplace/plans.js";
import { LEARN_CREATOR_OPTIONS } from "./creator-options.js";

export class CreatorError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}
export type Row = Record<string, unknown>;
export const creatorReady = async () =>
  (await tablesExist([
    "edu_cohorts",
    "edu_cohort_members",
    "edu_modules",
    "edu_courses",
    "edu_classes",
    "edu_schools",
    "edu_lessons",
    "edu_course_drafts",
    "edu_course_publications",
    "edu_creator_profiles",
    "edu_generation_jobs",
    "edu_creator_permissions",
    "edu_tutor_messages",
    "edu_learning_profiles",
    "edu_course_reviews",
    "edu_course_reviewers",
    "edu_learning_invites",
    "edu_publication_access",
    "edu_creator_resources",
    "edu_objective_evidence",
    "edu_learning_shares",
    "edu_creator_purchases",
    "edu_enrollments",
    "edu_lesson_progress",
    "edu_course_instructors",
    "edu_course_rules",
  ])) && (await hasColumn("edu_lessons", "body"));
export const creatorOptions = () =>
  getOptions(LEARN_CREATOR_OPTIONS.map((s) => s.key));
export const draftLimits = (o: Awaited<ReturnType<typeof creatorOptions>>) => ({
  modules: Number(o.learn_creator_max_modules),
  lessons: Number(o.learn_creator_max_lessons),
  resources: Number(o.learn_creator_max_resources),
  source: Number(o.learn_creator_max_source_chars),
  body: Number(o.learn_creator_max_body_chars),
  questions: Number(o.learn_creator_questions_per_lesson),
});
export const workspace = (r: Row): LearningWorkspace => ({
  courseId: String(r.course_id),
  revision: Number(r.revision),
  context: r.context as LearningWorkspace["context"],
  storeId: r.store_id ? String(r.store_id) : null,
  draft: JSON.parse(String(r.body_json)),
  publishedVersion: r.published_version ? String(r.published_version) : null,
  updatedAt: String(r.updated_at),
});
export const hasCreatorPermission = async (
  user: string,
  permission: string,
  schoolId = "",
) =>
  !!(await one(
    "SELECT 1 AS ok FROM edu_creator_permissions WHERE user_id = ? AND permission = ? AND school_id IN ('', ?) AND active = 1",
    [user, permission, schoolId],
  ));

export async function storeAuthor(userId: string, storeId: string) {
  const r = await one(
    `SELECT s.*, mm.role AS member_role FROM stores s JOIN merchant_members mm ON mm.merchant_id = s.merchant_id WHERE s.id = ? AND mm.user_id = ? AND mm.status = 'active'`,
    [storeId, userId],
  );
  if (!r || r.status !== "active")
    throw new CreatorError(404, "That business wasn't found.");
  const o = await getOptions(["member_roles_manage_digital"]);
  if (
    !(o.member_roles_manage_digital as string[]).includes(String(r.member_role))
  )
    throw new CreatorError(403, "Your business role cannot manage courses.");
  if (!(await storePlan(r)).isElite)
    throw new CreatorError(
      403,
      "Course management for this business requires active Merchant Elite access.",
    );
  const { getMarketplaceSettings } = await import("../lib/settings.js");
  if (!(await getMarketplaceSettings()).eliteLmsSyncEnabled)
    throw new CreatorError(403, "Merchant LMS management is switched off.");
  return r;
}

export async function authorizeDraft(
  userId: string,
  courseId: string,
  reviewer = false,
): Promise<Row> {
  const r = await one(
    "SELECT d.*, c.school_id, c.class_id, c.stream, s.owner_id, s.status AS school_status FROM edu_course_drafts d JOIN edu_courses c ON c.id = d.course_id JOIN edu_schools s ON s.id = c.school_id WHERE d.course_id = ?",
    [courseId],
  );
  if (!r || r.school_status !== "active")
    throw new CreatorError(404, "That course wasn't found.");
  if (
    reviewer &&
    (await hasCreatorPermission(userId, "review", String(r.school_id))) &&
    (await one(
      "SELECT 1 AS ok FROM edu_course_reviewers WHERE course_id = ? AND user_id = ?",
      [courseId, userId],
    ))
  )
    return r;
  if (r.context === "store") {
    await storeAuthor(userId, String(r.store_id));
    return r;
  }
  if (!(await ownedCourse(userId, courseId)))
    throw new CreatorError(404, "That course wasn't found.");
  return r;
}

export async function createPersonalContext(userId: string, name: string) {
  const existing = await one(
    "SELECT * FROM edu_creator_profiles WHERE user_id = ?",
    [userId],
  );
  if (existing)
    return {
      schoolId: String(existing.school_id),
      classId: String(existing.class_id),
    };
  const schoolId = newId("sch"),
    classId = newId("cls");
  // A real independent creator identity, not a publicly claimed school. No user setup wizard needed.
  try {
    await executeBatch([
      {
        sql: "INSERT INTO edu_schools (id,owner_id,name,slug,kind,streams) VALUES (?,?,?,?, 'independent_tutor','skills')",
        args: [schoolId, userId, `${name || "My"} learning`, schoolId],
      },
      {
        sql: "INSERT INTO edu_classes (id,school_id,stream,kind,name) VALUES (?,?,'skills','masterclass','Personal courses and paths')",
        args: [classId, schoolId],
      },
      {
        sql: "INSERT INTO edu_creator_profiles (user_id,school_id,class_id) VALUES (?,?,?)",
        args: [userId, schoolId, classId],
      },
    ]);
  } catch (err) {
    const won = await one(
      "SELECT * FROM edu_creator_profiles WHERE user_id = ?",
      [userId],
    );
    if (won)
      return { schoolId: String(won.school_id), classId: String(won.class_id) };
    throw err;
  }
  return { schoolId, classId };
}

export async function contextFor(
  c: Context,
  input: { classId?: string; courseId?: string; storeId?: string },
) {
  const userId = c.get("user").sub;
  if (input.courseId) {
    let course = await ownedCourse(userId, input.courseId);
    if (input.storeId) {
      await storeAuthor(userId, input.storeId);
      course = await one(
        "SELECT * FROM edu_courses WHERE id = ? AND store_id = ?",
        [input.courseId, input.storeId],
      );
    }
    if (!course) throw new CreatorError(404, "That course wasn't found.");
    if (course.store_id && !input.storeId)
      throw new CreatorError(
        403,
        "Open this course in its selected business workspace.",
      );
    const school = await ownedSchool(userId, String(course.school_id));
    if (
      !input.storeId &&
      !school &&
      !(await ownedCourse(userId, input.courseId))
    )
      throw new CreatorError(403, "Course access required.");
    return {
      course,
      schoolId: String(course.school_id),
      classId: String(course.class_id),
      stream: String(course.stream),
      context: input.storeId ? "store" : "school",
    };
  }
  if (input.storeId) {
    const store = await storeAuthor(userId, input.storeId);
    if (!store.learn_school_id) {
      if (!(await hasColumn("stores", "learn_school_id")))
        throw new CreatorError(
          503,
          "Apply the existing Merchant LMS migration before creating business courses.",
        );
      const owner = await one(
        "SELECT user_id FROM merchant_members WHERE merchant_id=? AND role='owner' AND status='active' ORDER BY user_id LIMIT 1",
        [store.merchant_id],
      );
      if (!owner)
        throw new CreatorError(403, "This business needs an active owner.");
      const schoolId = newId("sch"),
        classId = newId("cls");
      try {
        await executeBatch([
          {
            sql: "INSERT INTO edu_schools(id,owner_id,name,slug,kind,streams) VALUES(?,?,?,?,'training_centre','skills')",
            args: [
              schoolId,
              owner.user_id,
              `${String(store.name)} Academy`,
              schoolId,
            ],
          },
          {
            sql: "INSERT INTO edu_classes(id,school_id,stream,kind,name,teacher_name) VALUES(?,?,'skills','masterclass','Business courses',?)",
            args: [classId, schoolId, String(store.name)],
          },
          {
            sql: "UPDATE stores SET learn_school_id=? WHERE id=? AND learn_school_id IS NULL",
            args: [schoolId, store.id],
          },
          requireChangedRow,
        ]);
        store.learn_school_id = schoolId;
      } catch (err) {
        const linked = await one(
          "SELECT learn_school_id FROM stores WHERE id=?",
          [store.id],
        );
        if (!linked?.learn_school_id) throw err;
        store.learn_school_id = linked.learn_school_id;
      }
    }
    const cls = await one(
      "SELECT id,stream FROM edu_classes WHERE school_id = ? ORDER BY created_at LIMIT 1",
      [store.learn_school_id],
    );
    if (!cls)
      throw new CreatorError(409, "Set up the business academy class first.");
    return {
      course: null,
      schoolId: String(store.learn_school_id),
      classId: String(cls.id),
      stream: String(cls.stream),
      context: "store",
    };
  }
  if (input.classId) {
    const cls = await ownedClass(userId, input.classId);
    if (!cls) throw new CreatorError(404, "That class wasn't found.");
    const school = await ownedSchool(userId, String(cls.school_id));
    if (school?.status !== "active")
      throw new CreatorError(
        403,
        "This school cannot create content right now.",
      );
    return {
      course: null,
      schoolId: String(cls.school_id),
      classId: String(cls.id),
      stream: String(cls.stream),
      context: "school",
    };
  }
  const ctx = await createPersonalContext(userId, c.get("user").name);
  return { ...ctx, course: null, stream: "skills", context: "personal" };
}

export async function snapshotLegacy(course: Row): Promise<LearningDraft> {
  const mods = (
    await db.execute({
      sql: "SELECT * FROM edu_modules WHERE course_id = ? ORDER BY position,created_at",
      args: [String(course.id)],
    })
  ).rows;
  const lessons = (
    await db.execute({
      sql: "SELECT * FROM edu_lessons WHERE course_id = ? ORDER BY position,created_at",
      args: [String(course.id)],
    })
  ).rows;
  let outcomes: string[] = [];
  try {
    outcomes = JSON.parse(String(course.outcomes_json || "[]"));
  } catch {
    /* legacy */
  }
  return {
    title: String(course.title),
    summary: String(course.summary || ""),
    kind: "course",
    language: "English",
    audience: "",
    goal: "",
    curriculum: String(course.framework || ""),
    sourceText: "",
    priceUgx: Number(course.price_ugx || 0),
    visibility: "private",
    references: [],
    objectives: outcomes.map((title, i) => ({
      id: `objective_${i}`,
      title,
      evidence: "",
      source: "",
    })),
    modules: mods.map((m) => ({
      id: String(m.id),
      title: String(m.title),
      description: String(m.description || ""),
      lessons: lessons
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          id: String(l.id),
          title: String(l.title),
          body: String(l.body || l.summary || ""),
          minutes: Number(l.duration_minutes) || 10,
          objectiveIds: [],
          questions: [],
          nativeActivity: l.content_type !== "text",
          resources: l.content_url
            ? [
                {
                  id: newId("res"),
                  title: String(l.title),
                  url: String(l.content_url),
                  kind: l.content_type === "audio" ? "audio" : "video",
                  description: "",
                  transcript: "",
                  tutorAllowed: false,
                },
              ]
            : [],
        })),
    })),
  };
}

export async function persistPublication(
  userId: string,
  row: Row,
  draft: LearningDraft,
  labels: string[],
  privateStudy = false,
) {
  const id = newId("pub"),
    revision = Number(row.revision),
    courseId = String(row.course_id);
  const prior = await one(
    "SELECT id FROM edu_course_publications WHERE course_id = ? AND revision = ? AND purpose=?",
    [courseId, revision, privateStudy ? "private" : "publication"],
  );
  if (prior) {
    const result = await db.execute({
      sql: `UPDATE edu_course_drafts SET ${privateStudy ? "private_version=?" : "published_version=?,private_version=NULL"} WHERE course_id=? AND revision=?`,
      args: [prior.id, courseId, revision],
    });
    if (!result.rowsAffected)
      throw new CreatorError(
        409,
        "The draft changed. Reload before continuing.",
      );
    return String(prior.id);
  }
  const version = Number(
    (
      await one(
        "SELECT COALESCE(MAX(version),0)+1 AS n FROM edu_course_publications WHERE course_id = ?",
        [courseId],
      )
    )?.n,
  );
  const ls = await getLearnSettings();
  if (
    draft.priceUgx > ls.maxCoursePriceUgx ||
    (draft.priceUgx > 0 && !ls.paidCoursesEnabled)
  )
    throw new CreatorError(403, "This price is not allowed by Learn settings.");
  const listedColumn = await hasColumn("edu_courses", "catalog_listed");
  const storeColumn = await hasColumn("edu_courses", "store_id");
  let listed = draft.visibility === "public";
  if (row.context === "store") {
    const { lms_learn_sync_mode: mode } = await getOptions([
      "lms_learn_sync_mode",
    ]);
    listed =
      listed && mode !== "store_only" && mode !== "publish_to_learn_manual";
  }
  const body = JSON.stringify({
    ...draft,
    sourceText: "",
    ...(privateStudy ? { visibility: "private", priceUgx: 0 } : {}),
  });
  const statements: DbStatement[] = [
    {
      sql: `UPDATE edu_course_drafts SET ${privateStudy ? "private_version = ?" : "published_version = ?, private_version = NULL"} WHERE course_id = ? AND revision = ?`,
      args: [id, courseId, revision],
    },
    requireChangedRow,
    {
      sql: "INSERT INTO edu_course_publications(id,course_id,version,revision,body_json,labels_json,published_by,purpose) VALUES (?,?,?,?,?,?,?,?)",
      args: [
        id,
        courseId,
        version,
        revision,
        body,
        JSON.stringify(labels),
        userId,
        privateStudy ? "private" : "publication",
      ],
    },
    {
      sql: privateStudy
        ? "UPDATE edu_courses SET updated_at=updated_at WHERE id=?"
        : `UPDATE edu_courses SET title=?,summary=?,price_ugx=?,outcomes_json=?,status='published',updated_at=datetime('now')${listedColumn ? ",catalog_listed=?" : ""} WHERE id=?`,
      args: privateStudy
        ? [courseId]
        : [
            draft.title,
            draft.summary,
            draft.priceUgx,
            JSON.stringify(draft.objectives.map((o) => o.title)),
            ...(listedColumn ? [listed ? 1 : 0] : []),
            courseId,
          ],
    },
  ];
  if (!privateStudy)
    statements.push({
      sql: "INSERT OR IGNORE INTO edu_publication_access(user_id,course_id,publication_id,source) SELECT user_id,course_id,?,'legacy_enrollment' FROM edu_enrollments WHERE course_id=? AND status='active'",
      args: [id, courseId],
    });
  for (const [mi, m] of draft.modules.entries()) {
    const existing = await one("SELECT course_id FROM edu_modules WHERE id=?", [
      m.id,
    ]);
    if (existing && existing.course_id !== courseId)
      throw new CreatorError(400, "A module belongs to another course.");
    statements.push({
      sql: "INSERT INTO edu_modules(id,course_id,title,description,position) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,position=excluded.position WHERE edu_modules.course_id=excluded.course_id",
      args: [m.id, courseId, m.title, m.description, mi],
    });
    for (const [li, l] of m.lessons.entries()) {
      const existingLesson = await one(
        "SELECT course_id,content_type FROM edu_lessons WHERE id=?",
        [l.id],
      );
      if (existingLesson && existingLesson.course_id !== courseId)
        throw new CreatorError(400, "A lesson belongs to another course.");
      // Preserve existing quizzes, exams, assignments, slides, live events and video-player behavior.
      if (existingLesson && existingLesson.content_type !== "text") continue;
      statements.push({
        sql: "INSERT INTO edu_lessons(id,module_id,course_id,title,content_type,duration_minutes,summary,body,position) VALUES(?,?,?,?,'text',?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,summary=excluded.summary,duration_minutes=excluded.duration_minutes,position=excluded.position WHERE edu_lessons.course_id=excluded.course_id",
        args: [
          l.id,
          m.id,
          courseId,
          l.title,
          l.minutes,
          l.body.slice(0, 1000),
          l.body,
          li,
        ],
      });
    }
  }
  if (await hasTable("edu_course_rules"))
    statements.push({
      sql: "INSERT OR IGNORE INTO edu_course_rules(course_id,certificate_enabled) VALUES(?,0)",
      args: [courseId],
    });
  // The store offer points to the canonical course; it never owns a divergent syllabus.
  if (
    !privateStudy &&
    row.context === "store" &&
    storeColumn &&
    (await hasTable("store_digital_products"))
  )
    statements.push({
      sql: "INSERT INTO store_digital_products(id,store_id,title,kind,description,price_ugx,max_downloads,expiry_days,linked_course_id,status) VALUES(?,?,?,'course',?,?,0,0,?,'published') ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,price_ugx=excluded.price_ugx,status='published' WHERE store_digital_products.store_id=excluded.store_id",
      args: [
        `dig_crs_${courseId}`,
        row.store_id,
        draft.title,
        draft.summary,
        draft.priceUgx,
        courseId,
      ],
    });
  await executeBatch(statements);
  return id;
}

/** Revoked credentials stop appearing as current verification; historical reviews remain stored. */
export async function publicationLabels(publication: Row) {
  const labels = JSON.parse(String(publication.labels_json)) as string[];
  if (!labels.some((l) => l.startsWith("Educator-reviewed"))) return labels;
  const valid = await db.execute({
    sql: "SELECT DISTINCT u.name FROM edu_course_reviews r JOIN users u ON u.id=r.reviewer_id AND u.status='active' JOIN edu_courses c ON c.id=r.course_id JOIN edu_creator_permissions p ON p.user_id=r.reviewer_id AND p.permission='review' AND p.active=1 AND p.school_id IN ('',c.school_id) WHERE r.course_id=? AND r.revision=? AND r.status='approved'",
    args: [publication.course_id, publication.revision],
  });
  const current = new Set(
    valid.rows.map((r) => `Educator-reviewed by ${String(r.name)}`),
  );
  return labels.filter(
    (l) => !l.startsWith("Educator-reviewed") || current.has(l),
  );
}
