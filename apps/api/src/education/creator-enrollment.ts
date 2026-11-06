import { type DbStatement, requireChangedRow } from "../db/client.js";
import type { LearnSettings } from "@peebee/shared";
import { one } from "./studio.js";
import { courseRules, courseFinished } from "./rewards.js";
import { chooseCohort } from "./cohorts.js";
import { CreatorError } from "./creator-service.js";
/** Seat reservation belongs in the same transaction as payment/enrollment, so failure rolls everything back. */
export async function learningEnrollmentStatements(
  userId: string,
  courseId: string,
  settings: LearnSettings,
  cohortId?: string,
): Promise<DbStatement[]> {
  if (!settings.enrolmentsEnabled)
    throw new CreatorError(403, "Enrollments are switched off.");
  const rules = await courseRules(courseId);
  if (
    settings.prerequisitesEnabled &&
    rules.prerequisiteCourseId &&
    !(await courseFinished(userId, rules.prerequisiteCourseId))
  )
    throw new CreatorError(
      409,
      "Complete the prerequisite course before enrolling.",
    );
  const member = await one(
    "SELECT cohort_id FROM edu_cohort_members WHERE user_id=? AND course_id=?",
    [userId, courseId],
  );
  if (member) return [];
  const choice = await chooseCohort(courseId, cohortId, settings);
  if (!choice.ok) throw new CreatorError(409, choice.message);
  const h = choice.cohort;
  if (!h) return [];
  return [
    {
      sql: "INSERT INTO edu_cohort_members(cohort_id,user_id,course_id) SELECT id,?,course_id FROM edu_cohorts WHERE id=? AND (julianday(COALESCE(enrol_until,starts_at))>=julianday('now')) AND (capacity IS NULL OR (SELECT COUNT(*) FROM edu_cohort_members WHERE cohort_id=?)<capacity)",
      args: [userId, h.id, h.id],
    },
    requireChangedRow,
  ];
}
