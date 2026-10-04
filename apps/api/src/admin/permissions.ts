/**
 * Hono-side wiring for the role/permission data in @peebee/shared — the
 * frontend uses that same package to hide what a role can't do, but this
 * file is what actually enforces it. Re-exported here so callers in
 * apps/api only need one import for both the data and the middleware.
 */

import type { Context, Next } from "hono";
import { hasPermission, type AdminRole, type Permission } from "@peebee/shared";
import type { RequestUser } from "../auth/middleware.js";

export {
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  ADMIN_ROLE_DESCRIPTIONS,
  isAdminRole,
  hasPermission,
  permissionsFor,
  type AdminRole,
  type Permission,
} from "@peebee/shared";

/** Hono middleware: rejects unless the signed-in staff member's role
 * carries this permission. Mount after requireAuth + requireRole("admin")
 * so `user.adminRole` is already populated. */
export function requirePermission(permission: Permission) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!hasPermission(user?.adminRole as AdminRole | null | undefined, permission)) {
      return c.json(
        { error: "forbidden", message: "Your role doesn't include this action." },
        403,
      );
    }
    await next();
  };
}

/** Only the one role meant to mean "everything, including managing other
 * staff and reverting their mistakes" — kept as its own check rather than
 * a permission so it can never be handed out by editing ROLE_PERMISSIONS. */
export function requireSuperAdmin() {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as RequestUser | undefined;
    if (user?.adminRole !== "super_admin") {
      return c.json({ error: "forbidden", message: "Super Admin only." }, 403);
    }
    await next();
  };
}
