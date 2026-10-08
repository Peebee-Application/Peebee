/**
 * Staff account management — inviting, listing, changing role/status, and
 * resetting a forgotten password. Route wiring lives in admin/routes.ts;
 * this is the part that touches the database and sends the invite email.
 */

import bcrypt from "bcryptjs";
import { db } from "../db/client.js";
import { randomToken } from "../lib/random.js";
import { sendStaffInviteEmail } from "../verify/email.js";
import { appBaseUrl } from "../verify/service.js";
import { ensureAccountCode } from "../lib/profile-codes.js";
import { ADMIN_ROLE_LABELS, type AdminRole } from "./permissions.js";

type Row = Record<string, unknown>;

export async function listStaff(): Promise<Row[]> {
  const res = await db.execute(
    `SELECT u.id, u.name, u.phone, u.email, u.status, u.admin_role, u.force_password_change,
            u.invited_at, u.last_login_at, inviter.name as invited_by_name
     FROM users u
     LEFT JOIN users inviter ON inviter.id = u.invited_by
     WHERE u.role = 'admin'
     ORDER BY u.created_at ASC`,
  );
  return res.rows as Row[];
}

export async function countSuperAdmins(excludingId?: string): Promise<number> {
  const res = await db.execute({
    sql: `SELECT COUNT(*) as n FROM users WHERE role = 'admin' AND admin_role = 'super_admin' AND status = 'active' AND id != ?`,
    args: [excludingId ?? ""],
  });
  return Number((res.rows[0] as Row)?.n ?? 0);
}

export type InviteStaffResult =
  | { ok: true; user: Row }
  | { ok: false; error: "email_taken" | "phone_taken" | "send_failed"; message?: string };

/**
 * Creates the account with a random temporary password and
 * force_password_change set, then emails the credential. If the email
 * fails to send the account still exists — the caller can retry via
 * reset-password, which generates a fresh temporary password rather than
 * trying to recover the one that was never delivered.
 */
export async function inviteStaff(input: {
  name: string;
  email: string;
  phone?: string;
  adminRole: AdminRole;
  invitedBy: string;
}): Promise<InviteStaffResult> {
  const clash = await db.execute({
    sql: "SELECT id FROM users WHERE email = ? OR (? IS NOT NULL AND phone = ?)",
    args: [input.email, input.phone ?? null, input.phone ?? null],
  });
  if (clash.rows.length > 0) return { ok: false, error: "email_taken" };

  const tempPassword = randomToken(15);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const id = crypto.randomUUID();

  await db.execute({
    sql: `INSERT INTO users (id, name, email, phone, password_hash, role, admin_role, force_password_change,
                              invited_by, invited_at, email_verified_at)
          VALUES (?, ?, ?, ?, ?, 'admin', ?, 1, ?, datetime('now'), datetime('now'))`,
    args: [id, input.name, input.email, input.phone ?? null, passwordHash, input.adminRole, input.invitedBy],
  });
  await ensureAccountCode(id);

  try {
    await sendStaffInviteEmail(
      input.email,
      input.name,
      ADMIN_ROLE_LABELS[input.adminRole],
      tempPassword,
      `${appBaseUrl("admin")}/login`,
    );
  } catch (err) {
    console.error("Failed to send staff invite email:", err);
    // The account exists either way — surfacing the temp password back to
    // the inviting Super Admin so they can hand it over another way beats
    // leaving a staff member who can never receive their own credential.
    const res = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
    return { ok: true, user: { ...(res.rows[0] as Row), _emailFailed: true, _tempPassword: tempPassword } };
  }

  const res = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return { ok: true, user: res.rows[0] as Row };
}

export type ResetStaffPasswordResult =
  | { ok: true; tempPassword: string; emailed: boolean }
  | { ok: false; error: "not_found" };

export async function resetStaffPassword(userId: string): Promise<ResetStaffPasswordResult> {
  const res = await db.execute({
    sql: "SELECT id, name, email, admin_role FROM users WHERE id = ? AND role = 'admin'",
    args: [userId],
  });
  const row = res.rows[0] as Row | undefined;
  if (!row) return { ok: false, error: "not_found" };

  const tempPassword = randomToken(15);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, force_password_change = 1,
                 sessions_valid_from = datetime('now'), updated_at = datetime('now')
          WHERE id = ?`,
    args: [passwordHash, userId],
  });

  let emailed = false;
  if (row.email) {
    try {
      await sendStaffInviteEmail(
        row.email as string,
        row.name as string,
        ADMIN_ROLE_LABELS[row.admin_role as AdminRole],
        tempPassword,
        `${appBaseUrl("admin")}/login`,
      );
      emailed = true;
    } catch (err) {
      console.error("Failed to send staff password-reset email:", err);
    }
  }

  return { ok: true, tempPassword, emailed };
}
