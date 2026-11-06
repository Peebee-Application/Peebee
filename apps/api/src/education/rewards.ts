import type { LearnSettings } from "@peebee/shared";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";

type Row = Record<string, unknown>;

/**
 * What a learner earns and what is held back: certificates, badges, drip release and prerequisites.
 * All of it lives in tables from migration 0117; until that is applied every function here does nothing.
 */
export const proReady = () => hasTable("edu_certificates");

export const BADGES = [
  { key: "first_step", title: "First step", description: "Finish your first lesson", icon: "🌱" },
  { key: "quiz_ace", title: "Quiz ace", description: "Score 100% on a quiz or exam", icon: "🎯" },
  { key: "live_attendee", title: "Showed up live", description: "Join a live lesson", icon: "📡" },
  { key: "course_complete", title: "Course complete", description: "Finish a whole course", icon: "🏁" },
  { key: "multi_course", title: "Keeps going", description: "Finish several courses", icon: "🏆" },
] as const;

export interface CourseRules {
  sequential: boolean;
  prerequisiteCourseId: string | null;
  certificateEnabled: boolean;
}

export async function courseRules(courseId: string): Promise<CourseRules> {
  const fallback = { sequential: false, prerequisiteCourseId: null, certificateEnabled: true };
  if (!(await proReady())) return fallback;
  const r = ((await db.execute({ sql: "SELECT * FROM edu_course_rules WHERE course_id = ?", args: [courseId] })).rows[0] as Row | undefined) ?? null;
  if (!r) return fallback;
  return { sequential: Number(r.sequential) === 1, prerequisiteCourseId: r.prerequisite_course_id ? String(r.prerequisite_course_id) : null, certificateEnabled: Number(r.certificate_enabled) !== 0 };
}

export async function dripDays(courseId: string): Promise<Map<string, number>> {
  if (!(await proReady())) return new Map();
  const rows = (await db.execute({ sql: "SELECT d.module_id, d.drip_days FROM edu_module_drip d JOIN edu_modules m ON m.id = d.module_id WHERE m.course_id = ?", args: [courseId] })).rows as Row[];
  return new Map(rows.map((r) => [String(r.module_id), Number(r.drip_days)]));
}

export type Lock = { reason: "drip" | "sequence"; opensAt: string | null; message: string };

/** The ids of the items a learner can't open yet, with why. Items are given in course order. */
export async function computeLocks(
  userId: string,
  courseId: string,
  settings: LearnSettings,
  modules: Row[],
  lessons: Row[],
  done: Set<string>,
  now = Date.now(),
): Promise<{ locks: Map<string, Lock>; opens: Map<string, string> }> {
  const locks = new Map<string, Lock>();
  const opens = new Map<string, string>();
  if (!(await proReady())) return { locks, opens };

  // A learner in a cohort starts when the cohort does.
  let cohortStart: number | null = null;
  if (settings.cohortsEnabled && (await hasTable("edu_cohorts"))) {
    const c = ((await db.execute({ sql: "SELECT MAX(h.starts_at) AS at FROM edu_cohort_members m JOIN edu_cohorts h ON h.id = m.cohort_id WHERE m.user_id = ? AND m.course_id = ?", args: [userId, courseId] })).rows[0] as Row | undefined)?.at;
    cohortStart = c ? Date.parse(String(c)) : null;
    if (cohortStart !== null && cohortStart > now) {
      const iso = new Date(cohortStart).toISOString();
      for (const l of lessons) locks.set(String(l.id), { reason: "drip", opensAt: iso, message: `Starts ${new Date(cohortStart).toLocaleDateString("en-UG", { day: "numeric", month: "short" })}` });
      for (const m of modules) opens.set(String(m.id), iso);
      return { locks, opens };
    }
  }

  if (settings.dripEnabled) {
    const days = await dripDays(courseId);
    const enrolled = ((await db.execute({ sql: "SELECT created_at FROM edu_enrollments WHERE course_id = ? AND user_id = ?", args: [courseId, userId] })).rows[0] as Row | undefined)?.created_at;
    let startedAt = enrolled ? String(enrolled) : null;
    if (!startedAt) {
      // Someone on a school pass has no enrolment: their pass is when they began.
      const sub = await db
        .execute({ sql: "SELECT MIN(s.started_at) AS at FROM edu_subscriptions s JOIN edu_courses c ON c.school_id = s.school_id WHERE s.user_id = ? AND c.id = ?", args: [userId, courseId] })
        .catch(() => ({ rows: [] as Row[] }));
      startedAt = ((sub.rows[0] as Row | undefined)?.at as string | null) ?? null;
    }
    const start = cohortStart ?? (startedAt ? Date.parse(`${startedAt.replace(" ", "T")}Z`) : now);
    for (const m of modules) {
      const d = days.get(String(m.id)) ?? 0;
      if (d <= 0) continue;
      const at = start + d * 86_400_000;
      if (at > now) {
        const iso = new Date(at).toISOString();
        opens.set(String(m.id), iso);
        for (const l of lessons.filter((x) => x.module_id === m.id)) {
          locks.set(String(l.id), { reason: "drip", opensAt: iso, message: `Opens ${new Date(at).toLocaleDateString("en-UG", { day: "numeric", month: "short" })}` });
        }
      }
    }
  }

  if (settings.prerequisitesEnabled && (await courseRules(courseId)).sequential) {
    const order = modules.flatMap((m) => lessons.filter((l) => l.module_id === m.id));
    let blocked = false;
    for (const l of order) {
      const id = String(l.id);
      if (blocked && !locks.has(id)) locks.set(id, { reason: "sequence", opensAt: null, message: "Finish the earlier items first" });
      // A live lesson that was missed must not hold everyone back.
      if (!done.has(id) && String(l.content_type) !== "live") blocked = true;
    }
  }
  return { locks, opens };
}

/** Whether a learner has finished every item of a course. */
export async function courseFinished(userId: string, courseId: string): Promise<boolean> {
  if (await hasTable("edu_publication_access") && await hasTable("edu_course_publications")) {
    const pinned=(await db.execute({sql:"SELECT p.body_json FROM edu_publication_access a JOIN edu_course_publications p ON p.id=a.publication_id WHERE a.user_id=? AND a.course_id=?",args:[userId,courseId]})).rows[0];
    if(pinned){
      const draft=JSON.parse(String(pinned.body_json)) as {modules:Array<{lessons:Array<{id:string}>}>};
      const ids=draft.modules.flatMap((m)=>m.lessons.map((l)=>l.id));
      if(!ids.length)return false;
      const progress=(await db.execute({sql:"SELECT lesson_id FROM edu_lesson_progress WHERE user_id=? AND course_id=?",args:[userId,courseId]})).rows;
      const done=new Set(progress.map((r)=>String(r.lesson_id)));
      return ids.every((id)=>done.has(id));
    }
  }
  const total = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM edu_lessons WHERE course_id = ?", args: [courseId] })).rows[0] as Row).n);
  if (total === 0) return false;
  const done = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM edu_lesson_progress WHERE user_id = ? AND course_id = ?", args: [userId, courseId] })).rows[0] as Row).n);
  return done >= total;
}

const code = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

async function award(userId: string, badge: string, courseId: string | null): Promise<void> {
  await db.execute({ sql: "INSERT OR IGNORE INTO edu_badges (user_id, badge, course_id) VALUES (?, ?, ?)", args: [userId, badge, courseId] });
}

/** Called after a learner makes progress: awards badges and, when the course is finished, issues the certificate. */
export async function afterProgress(userId: string, courseId: string, settings: LearnSettings): Promise<void> {
  if (!(await proReady())) return;
  try {
    const done = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM edu_lesson_progress WHERE user_id = ? AND course_id = ?", args: [userId, courseId] })).rows[0] as Row).n);
    const finished = await courseFinished(userId, courseId);

    if (settings.badgesEnabled) {
      if (done >= 1) await award(userId, "first_step", courseId);
      const perfect = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM edu_quiz_attempts WHERE user_id = ? AND score_percent = 100", args: [userId] })).rows[0] as Row).n);
      if (perfect > 0) await award(userId, "quiz_ace", courseId);
      const live = await db.execute({ sql: "SELECT 1 AS y FROM edu_live_attendance WHERE user_id = ? LIMIT 1", args: [userId] }).catch(() => ({ rows: [] }));
      if (live.rows.length) await award(userId, "live_attendee", courseId);
      if (finished) {
        await award(userId, "course_complete", courseId);
        const finishedCourses = Number(
          ((
            await db.execute({
              sql: `SELECT COUNT(*) AS n FROM edu_enrollments e WHERE e.user_id = ? AND e.status = 'active'
                      AND (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = e.course_id) > 0
                      AND (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = e.course_id) <= (SELECT COUNT(*) FROM edu_lesson_progress p WHERE p.user_id = e.user_id AND p.course_id = e.course_id)`,
              args: [userId],
            })
          ).rows[0] as Row).n,
        );
        if (finishedCourses >= settings.badgeCoursesThreshold) await award(userId, "multi_course", courseId);
      }
    }

    if (finished && settings.certificatesEnabled && (await courseRules(courseId)).certificateEnabled) {
      const info = ((
        await db.execute({
          sql: `SELECT c.title AS course_title, s.name AS school_name, u.name AS user_name
                FROM edu_courses c JOIN edu_schools s ON s.id = c.school_id JOIN users u ON u.id = ? WHERE c.id = ?`,
          args: [userId, courseId],
        })
      ).rows[0] as Row | undefined);
      if (info) {
        const avg = ((await db.execute({ sql: "SELECT AVG(best_score_percent) AS a FROM edu_lesson_progress WHERE user_id = ? AND course_id = ? AND best_score_percent IS NOT NULL", args: [userId, courseId] })).rows[0] as Row).a;
        await db.execute({
          sql: `INSERT OR IGNORE INTO edu_certificates (id, code, course_id, user_id, learner_name, course_title, school_name, score_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [newId("crt"), code(), courseId, userId, String(info.user_name ?? "Learner"), String(info.course_title), String(info.school_name), avg === null || avg === undefined ? null : Math.round(Number(avg))],
        });
      }
    }
  } catch {
    // Rewards must never break learning itself.
  }
}
