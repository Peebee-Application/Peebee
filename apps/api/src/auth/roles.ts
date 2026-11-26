import { db } from "../db/client.js";
import { hasTable } from "../lib/schema.js";

export type PeebeeRole = "customer" | "rider" | "admin";

export async function peebeeRolePredicate(alias: string, role: PeebeeRole): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL table alias");
  if (!(await hasTable("user_roles"))) return `${alias}.role = '${role}'`;
  return `(EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ${alias}.id AND ur.role = '${role}')
    OR (${alias}.role = '${role}' AND NOT EXISTS (SELECT 1 FROM user_roles any_role WHERE any_role.user_id = ${alias}.id)))`;
}

/**
 * A Peebee identity may have more than one app profile. `users.role` remains
 * the legacy/default role until the hand-applied user_roles migration lands;
 * after that, explicit additional profiles live in user_roles.
 */
export async function hasPeebeeRole(userId: string, role: PeebeeRole): Promise<boolean> {
  if (!(await hasTable("user_roles"))) {
    const row = await db.execute({ sql: "SELECT role FROM users WHERE id = ?", args: [userId] });
    return row.rows[0]?.role === role;
  }

  const roles = await db.execute({ sql: "SELECT role FROM user_roles WHERE user_id = ?", args: [userId] });
  if (roles.rows.length) return roles.rows.some((item) => item.role === role);

  // Some older account-creation flows still write only users.role. Keep them
  // compatible while they are migrated to create the membership row too.
  const legacy = await db.execute({ sql: "SELECT role FROM users WHERE id = ?", args: [userId] });
  return legacy.rows[0]?.role === role;
}

export async function addPeebeeRole(userId: string, role: PeebeeRole): Promise<boolean> {
  if (!(await hasTable("user_roles"))) return false;
  const legacy = await db.execute({ sql: "SELECT role FROM users WHERE id = ?", args: [userId] });
  const legacyRole = legacy.rows[0]?.role;
  if (legacyRole === "customer" || legacyRole === "rider" || legacyRole === "admin") {
    await db.execute({ sql: "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)", args: [userId, legacyRole] });
  }
  await db.execute({
    sql: "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)",
    args: [userId, role],
  });
  return true;
}

export async function findActiveUserWithRoleByIdentifier(identifier: string, role: PeebeeRole) {
  const value = identifier.trim();
  if (!value) return null;
  const result = await db.execute({
    sql: "SELECT id, name, phone FROM users WHERE status = 'active' AND (phone = ? OR lower(email) = lower(?)) LIMIT 1",
    args: [value, value],
  });
  const row = result.rows[0];
  if (!row || !(await hasPeebeeRole(String(row.id), role))) return null;
  return row as { id: string; name: string; phone: string | null };
}

export async function findActiveUserWithRoleById(userId: string, role: PeebeeRole) {
  const result = await db.execute({
    sql: "SELECT id, name, phone FROM users WHERE id = ? AND status = 'active' LIMIT 1",
    args: [userId],
  });
  const row = result.rows[0];
  if (!row || !(await hasPeebeeRole(userId, role))) return null;
  return row as { id: string; name: string; phone: string | null };
}

