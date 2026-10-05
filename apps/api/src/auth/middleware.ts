import type { Context, Next } from "hono";
import { db } from "../db/client.js";
import { isAdminRole, type AdminRole } from "../admin/permissions.js";
import { verifyToken, type AuthTokenPayload } from "./jwt.js";
import { isAwaitingActivation } from "../onboarding/state.js";

/** What every route handler actually gets from `c.get("user")` — the JWT's
 * own claims plus a few things that can change between logins and so are
 * read fresh from the users row on every request (the same lookup
 * requireAuth already does for session validity), never trusted from the
 * token itself. */
export type RequestUser = AuthTokenPayload & {
  name: string;
  /** Non-null only for role === "admin". */
  adminRole: AdminRole | null;
  /** True right after a staff account is invited or reset by another
   * admin; requireAuth blocks nearly everything else until it's cleared by
   * a successful password change. */
  forcePasswordChange: boolean;
};

declare module "hono" {
  interface ContextVariableMap {
    user: RequestUser;
  }
}

/** SQLite's `datetime('now')` yields "YYYY-MM-DD HH:MM:SS" — UTC, but with a
 * space instead of "T" and no trailing "Z", so `Date` won't parse it as-is. */
function sqliteSeconds(value: string): number {
  return Math.floor(new Date(`${value.replace(" ", "T")}Z`).getTime() / 1000);
}

/** Reachable by a staff account even while forcePasswordChange is set —
 * otherwise there'd be no way to actually clear it. Exact request paths,
 * matched against `c.req.path` (which already includes the /v1 prefix). */
const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED = new Set([
  "/v1/auth/password/change",
  "/v1/auth/me",
  "/v1/auth/logout",
]);

/**
 * Verifying the signature only tells us the token was minted by us at some
 * point — not that the account still exists, is still allowed in, or that the
 * session wasn't signed out. One indexed lookup per request buys all that,
 * plus the fresh per-request fields on RequestUser:
 *
 *  - deleted user            → the row is gone, reject
 *  - suspended user          → reject, so suspending someone actually kicks them out
 *  - password reset          → sessions_valid_from moves forward, older tokens die
 *  - explicit sign-out       → the token's jti lands in revoked_sessions
 *  - staff role changed      → adminRole is re-read every request, not cached in the token
 *  - temporary staff password → forcePasswordChange blocks everything but changing it
 */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return c.json({ error: "unauthorized", message: "Missing bearer token" }, 401);
  }

  let payload: AuthTokenPayload;
  try {
    payload = await verifyToken(token);
  } catch {
    return c.json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }

  const res = await db.execute({
    sql: `SELECT u.name, u.status, u.sessions_valid_from, u.admin_role, u.force_password_change,
                 (SELECT 1 FROM revoked_sessions r WHERE r.jti = ?) AS revoked
          FROM users u WHERE u.id = ?`,
    args: [payload.jti, payload.sub],
  });
  const row = res.rows[0] as
    | {
        name?: string;
        status?: string;
        sessions_valid_from?: string | null;
        admin_role?: string | null;
        force_password_change?: number | null;
        revoked?: number | null;
      }
    | undefined;

  if (!row) {
    return c.json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }
  if (row.revoked) {
    return c.json({ error: "session_ended", message: "You've been signed out. Please log in again." }, 401);
  }
  if (row.status === "suspended") {
    return c.json({ error: "account_suspended", message: "This account has been suspended" }, 403);
  }
  if (await isAwaitingActivation(payload.sub)) {
    return c.json({ error: "activation_required", message: "Activate your account using the link sent by your sales agent." }, 403);
  }
  if (row.sessions_valid_from) {
    // Both sides are whole seconds, and a token issued by the same request
    // that moved the cutoff shares its second — so equal has to pass.
    if (payload.iat < sqliteSeconds(row.sessions_valid_from)) {
      return c.json({ error: "session_ended", message: "Please log in again." }, 401);
    }
  }

  const forcePasswordChange = !!row.force_password_change;
  if (forcePasswordChange && !ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.has(c.req.path)) {
    return c.json(
      {
        error: "password_change_required",
        message: "Set a password before continuing.",
      },
      403,
    );
  }

  c.set("user", {
    ...payload,
    name: row.name ?? "",
    adminRole: isAdminRole(row.admin_role) ? row.admin_role : null,
    forcePasswordChange,
  });
  await next();
}

export function requireRole(...roles: AuthTokenPayload["role"][]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: "forbidden", message: `Requires role: ${roles.join(" or ")}` }, 403);
    }
    await next();
  };
}
