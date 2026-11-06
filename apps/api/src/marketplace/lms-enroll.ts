import bcrypt from "bcryptjs";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { sendPlainEmail } from "../lib/email-gateway.js";
import { getOptions } from "../lib/option-settings.js";
import { ensureAccountCode } from "../lib/profile-codes.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { normalizePhone } from "../lib/validation.js";

type Row = Record<string, unknown>;

export type StudentResolution =
  | { ok: true; userId: string; created: boolean; invite: "sms" | "email" | null }
  | { ok: false; status: 400 | 404 | 409; error: string; message: string };

/**
 * Who the student is. A Learn seat belongs to a real account: an existing one is used; otherwise admin's
 * `lms_enrollment_identity` decides whether one is created from the phone number (with a setup link texted to them),
 * created from an email invitation, or whether the student must register first.
 */
export async function resolveStudent(input: { name: string; phone: string; email: string }): Promise<StudentResolution> {
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, status: 400, error: "invalid_phone", message: "Enter a valid phone number." };
  const existing = (await db.execute({ sql: "SELECT id, role, status FROM users WHERE phone = ?", args: [phone] })).rows[0] as Row | undefined;
  if (existing) {
    if (existing.role !== "customer") return { ok: false, status: 409, error: "phone_in_use", message: "That number belongs to a Peebee partner account, which can't be enrolled as a student." };
    if (existing.status === "suspended") return { ok: false, status: 409, error: "account_suspended", message: "That account can't be enrolled." };
    return { ok: true, userId: String(existing.id), created: false, invite: null };
  }

  const { lms_enrollment_identity: mode } = await getOptions(["lms_enrollment_identity"]);
  if (mode === "require_existing_account") {
    return { ok: false, status: 404, error: "student_not_registered", message: "That student doesn't have a Peebee account yet. Ask them to register with this phone number first." };
  }
  if (mode === "email_invite") {
    if (!input.email) return { ok: false, status: 400, error: "email_required", message: "Add the student's email address so we can invite them." };
    const taken = (await db.execute({ sql: "SELECT 1 FROM users WHERE email = ?", args: [input.email.toLowerCase()] })).rows.length > 0;
    if (taken) return { ok: false, status: 409, error: "email_in_use", message: "That email already belongs to another account. Use that account's phone number." };
  }
  const userId = crypto.randomUUID();
  const email = input.email ? input.email.toLowerCase() : null;
  const emailTaken = email ? (await db.execute({ sql: "SELECT 1 FROM users WHERE email = ?", args: [email] })).rows.length > 0 : false;
  await db.execute({
    sql: "INSERT INTO users (id, phone, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, 'customer')",
    args: [userId, phone, emailTaken ? null : email, input.name, await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 10)],
  });
  await ensureAccountCode(userId);
  return { ok: true, userId, created: true, invite: mode === "email_invite" ? "email" : "sms" };
}

const appUrl = () => process.env.CUSTOMER_APP_URL ?? ((process.env.ENVIRONMENT ?? "development") !== "development" ? "https://app.peebee.online" : "http://localhost:3000");

/** The words a student is sent. A new account gets a way to set a password; an existing one gets a link to the course. */
export function studentWelcome(input: { name: string; courseTitle: string; storeName: string; courseId: string; created: boolean }): { sms: string; email: { subject: string; text: string } } {
  const portal = `${appUrl()}/learn/course/${input.courseId}`;
  const setup = `${appUrl()}/forgot-password`;
  return {
    sms: `Hi ${input.name}! ${input.storeName} enrolled you in "${input.courseTitle}".${input.created ? ` Set your password to sign in: ${setup}` : ` Open your course: ${portal}`}`,
    email: {
      subject: `You're enrolled in ${input.courseTitle}`,
      text: `Hi ${input.name},\n\n${input.storeName} has enrolled you in "${input.courseTitle}" on Peebee Learn.\n${input.created ? `\nSet your password to sign in: ${setup}\nThen open your course: ${portal}` : `\nOpen your course: ${portal}`}\n`,
    },
  };
}

/** Email the student. Says what happened rather than assuming it worked. */
export async function emailStudent(to: string, welcome: { subject: string; text: string }): Promise<{ status: "sent" | "failed"; error?: string }> {
  try {
    await sendPlainEmail(to, welcome.subject, welcome.text);
    return { status: "sent" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message.slice(0, 160) : "The email could not be sent." };
  }
}

/**
 * Give a real account a seat in a course, once. Both the Learn seat (edu_enrollments, which is what opens the lessons)
 * and the store's own student record are written; doing it again changes nothing.
 */
export async function enrollStudent(input: {
  storeId: string; courseId: string; userId: string; name: string; phone: string; email: string;
  pricePaid: number; commission: number; environment: string;
}): Promise<{ enrollmentId: string; storeRecordId: string | null; created: boolean } | null> {
  if (!(await hasTable("edu_enrollments")) || !(await hasTable("edu_courses"))) return null;
  const course = (await db.execute({ sql: "SELECT id, school_id FROM edu_courses WHERE id = ?", args: [input.courseId] })).rows[0] as Row | undefined;
  if (!course) return null;

  let enrollmentId: string;
  let created = false;
  const existing = (await db.execute({ sql: "SELECT id, status FROM edu_enrollments WHERE course_id = ? AND user_id = ?", args: [input.courseId, input.userId] })).rows[0] as Row | undefined;
  if (existing) {
    enrollmentId = String(existing.id);
    if (existing.status !== "active") {
      await db.execute({ sql: "UPDATE edu_enrollments SET status = 'active' WHERE id = ?", args: [enrollmentId] });
      created = true;
    }
  } else {
    enrollmentId = newId("enr");
    await db.execute({
      sql: `INSERT OR IGNORE INTO edu_enrollments (id, course_id, school_id, user_id, status, price_paid_ugx, commission_ugx, environment)
            VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      args: [enrollmentId, input.courseId, String(course.school_id), input.userId, input.pricePaid, input.commission, input.environment],
    });
    created = true;
  }

  let storeRecordId: string | null = null;
  if (await hasTable("store_lms_enrollments")) {
    const hasUser = await hasColumn("store_lms_enrollments", "user_id");
    const have = hasUser
      ? (await db.execute({ sql: "SELECT id FROM store_lms_enrollments WHERE course_id = ? AND user_id = ?", args: [input.courseId, input.userId] })).rows[0]
      : (await db.execute({ sql: "SELECT id FROM store_lms_enrollments WHERE course_id = ? AND student_phone = ?", args: [input.courseId, input.phone] })).rows[0];
    storeRecordId = have ? String((have as Row).id) : null;
    if (!have) {
      const total = Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM edu_lessons WHERE course_id = ?", args: [input.courseId] })).rows[0]?.n) || 0;
      await db.execute({
        sql: `INSERT INTO store_lms_enrollments (id, store_id, course_id, student_name, student_phone, student_email, total_lessons${hasUser ? ", user_id" : ""})
              VALUES (?, ?, ?, ?, ?, ?, ?${hasUser ? ", ?" : ""})`,
        args: [(storeRecordId = newId("enr")), input.storeId, input.courseId, input.name, input.phone, input.email, total, ...(hasUser ? [input.userId] : [])],
      });
    } else if (hasUser) {
      await db.execute({ sql: "UPDATE store_lms_enrollments SET access_status = 'active' WHERE id = ?", args: [String((have as Row).id)] });
    }
  }
  if (await hasTable("edu_publication_access") && await hasTable("edu_course_drafts")) {
    await db.execute({sql:"INSERT OR IGNORE INTO edu_publication_access(user_id,course_id,publication_id,source) SELECT ?,course_id,published_version,'merchant_enrollment' FROM edu_course_drafts WHERE course_id=? AND published_version IS NOT NULL",args:[input.userId,input.courseId]});
  }
  return { enrollmentId, storeRecordId, created };
}
