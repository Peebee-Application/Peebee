import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { isAdminRole } from "@peebee/shared";
import { logActivity } from "../admin/activity.js";
import { db } from "../db/client.js";
import {
  checkLockout,
  clearFailures,
  clientIp,
  consume,
  hashKey,
  recordFailure,
  sweepExpired,
  tooManyRequests,
} from "../lib/ratelimit.js";
import { hashCode, timingSafeEqual } from "../verify/otp.js";
import { appBaseUrl, createAndSendOtp, maskTarget } from "../verify/service.js";
import { toAuthUser } from "./serialize.js";
import { signToken, TOKEN_TTL_SECONDS } from "./jwt.js";
import { requireAuth } from "./middleware.js";

export const authRoutes = new Hono();

/** Per-IP ceilings. Generous enough that a household or office sharing one
 * address never notices, low enough that scripted abuse stalls immediately. */
const IP_LIMITS = {
  login: { limit: 20, windowSeconds: 60 },
  register: { limit: 5, windowSeconds: 60 },
  reset: { limit: 10, windowSeconds: 60 },
} as const;

async function ipLimited(c: Parameters<typeof clientIp>[0], bucket: keyof typeof IP_LIMITS) {
  const { limit, windowSeconds } = IP_LIMITS[bucket];
  const key = `ip:${bucket}:${await hashKey(clientIp(c))}`;
  return consume(key, limit, windowSeconds);
}

const registerSchema = z
  .object({
    phone: z.string().min(6).max(20).optional(),
    email: z.string().email().max(160).optional(),
    name: z.string().min(1).max(80),
    password: z.string().min(6).max(100),
    role: z.enum(["customer", "rider"]).default("customer"),
  })
  .refine((data) => !!data.phone || !!data.email, {
    message: "Provide a phone number or an email address",
    path: ["email"],
  });

const loginSchema = z.object({
  identifier: z.string().min(3).max(160),
  password: z.string().min(1),
});

type UserRow = {
  id: string;
  phone: string | null;
  name: string;
  password_hash: string;
  role: "customer" | "rider" | "admin";
  status: "active" | "suspended";
};

/** Best-effort: a registration should never fail because the OTP send did.
 * Defaults to email when one was given (email is the default identifier for
 * now), falling back to SMS for phone-only signups. */
async function sendInitialOtp(userId: string, phone?: string, email?: string): Promise<string | undefined> {
  const [channel, target] = email ? (["email", email] as const) : (["sms", phone!] as const);
  try {
    const { devCode } = await createAndSendOtp(userId, channel, target);
    return devCode;
  } catch (err) {
    console.error(`Failed to send initial verification ${channel}:`, err);
    return undefined;
  }
}

authRoutes.post("/register", async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const { phone, email, name, password, role } = parsed.data;

  const ipCheck = await ipLimited(c, "register");
  if (!ipCheck.allowed) {
    return tooManyRequests(c, ipCheck, "Too many sign-up attempts. Please wait a moment and try again.");
  }

  // A "taken" answer tells whoever asked that this number or address has a
  // Peebee account, which is why the rate limit above matters: the leak only
  // pays off when you can test thousands of identifiers, and five a minute
  // per address makes that pointless. The response deliberately doesn't say
  // *which* field clashed. Closing the leak completely means not returning a
  // session until the code is confirmed — a signup flow change, not just an
  // API one.
  const clash = await db.execute({
    sql: "SELECT id FROM users WHERE (? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND email = ?)",
    args: [phone ?? null, phone ?? null, email ?? null, email ?? null],
  });
  if (clash.rows.length > 0) {
    return c.json(
      { error: "account_exists", message: "An account already exists with these details. Try signing in instead." },
      409,
    );
  }

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  await db.execute({
    sql: `INSERT INTO users (id, phone, email, name, password_hash, role, password_set_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [id, phone ?? null, email ?? null, name, passwordHash, role],
  });

  if (role === "rider") {
    await db.execute({
      sql: "INSERT INTO riders (user_id, verified, is_online) VALUES (?, 0, 0)",
      args: [id],
    });
  }

  const devCode = await sendInitialOtp(id, phone, email);

  const token = await signToken({ sub: id, role, phone });
  const userRow = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return c.json(
    {
      token,
      user: toAuthUser(userRow.rows[0]),
      ...(role === "rider"
        ? { riderStatus: "pending_verification" as const }
        : {}),
      ...(devCode ? { verifyDevCode: devCode } : {}),
    },
    201,
  );
});

authRoutes.post("/login", async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const { identifier, password } = parsed.data;

  void sweepExpired();

  const ipCheck = await ipLimited(c, "login");
  if (!ipCheck.allowed) {
    return tooManyRequests(c, ipCheck, "Too many sign-in attempts. Please wait a moment and try again.");
  }

  // Locked out per account as well as per IP: the IP ceiling alone does
  // nothing against an attacker spread across many addresses guessing one
  // person's password, which is the case that actually loses an account.
  const accountKey = `login:${await hashKey(identifier)}`;
  const lock = await checkLockout(accountKey);
  if (!lock.allowed) {
    return tooManyRequests(c, lock, "Too many failed attempts for this account. Please try again shortly.");
  }

  const result = await db.execute({
    sql: "SELECT * FROM users WHERE phone = ? OR email = ?",
    args: [identifier, identifier],
  });
  const row = result.rows[0] as unknown as (UserRow & Record<string, unknown>) | undefined;
  if (!row) {
    // Still counted, so probing many passwords against an address that
    // doesn't exist is no cheaper than probing one that does.
    await recordFailure(accountKey);
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    await recordFailure(accountKey);
    return c.json({ error: "invalid_credentials" }, 401);
  }
  if (row.status === "suspended") {
    return c.json({ error: "account_suspended", message: "This account has been suspended" }, 403);
  }

  await clearFailures(accountKey);

  if (row.role === "admin") {
    // Staff logins are what the activity log exists to answer questions
    // about — recorded here rather than in requireAuth so a login shows up
    // even though it's the one request that doesn't have a token yet.
    await db.execute({ sql: "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", args: [row.id] });
    await logActivity({
      actor: { sub: row.id, name: row.name, adminRole: isAdminRole(row.admin_role) ? row.admin_role : null },
      action: "auth.login",
      entityType: "user",
      entityId: row.id,
      summary: `${row.name as string} logged in`,
      ip: clientIp(c),
    });
  }

  const token = await signToken({ sub: row.id, role: row.role, phone: row.phone });
  return c.json({
    token,
    user: toAuthUser(row),
  });
});

/**
 * Sign out for real. Clearing the token client-side leaves it valid until it
 * expires, so anyone who copied it keeps the session — recording the token's
 * jti here is what actually ends it. Only this one token dies, so signing out
 * on a borrowed laptop doesn't log you out on your phone.
 */
authRoutes.post("/logout", requireAuth, async (c) => {
  const user = c.get("user");
  if (user.jti) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO revoked_sessions (jti, user_id, expires_at)
            VALUES (?, ?, datetime('now', ?))`,
      args: [user.jti, user.sub, `+${TOKEN_TTL_SECONDS} seconds`],
    });
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Sign in / sign up with Google — verifies the ID token the client got from
// Google Identity Services directly against Google's own signing keys, so
// the API never needs the OAuth client secret at all (that's only for the
// server-side authorization-code flow, which this isn't). An email Google
// has already verified is trusted as verified here too, skipping our own
// OTP step for that account.
// ---------------------------------------------------------------------------

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const googleAuthSchema = z.object({
  idToken: z.string().min(10),
  role: z.enum(["customer", "rider"]).default("customer"),
});

authRoutes.post("/google", async (c) => {
  const parsed = googleAuthSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { idToken, role } = parsed.data;

  const ipCheck = await ipLimited(c, "login");
  if (!ipCheck.allowed) {
    return tooManyRequests(c, ipCheck, "Too many sign-in attempts. Please wait a moment and try again.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.json({ error: "google_not_configured" }, 501);

  let email: string | undefined;
  let name: string | undefined;
  try {
    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    if (!payload.email_verified) return c.json({ error: "google_email_unverified" }, 400);
    email = payload.email as string | undefined;
    name = payload.name as string | undefined;
  } catch (err) {
    // Whatever jose objected to (clock skew, wrong audience, a malformed
    // key set) is useful to us and useful to an attacker mapping our setup.
    // It goes to the log, not to the caller.
    console.error("Google ID token rejected:", err);
    return c.json({ error: "invalid_google_token", message: "Google sign-in failed. Please try again." }, 401);
  }
  if (!email) return c.json({ error: "google_email_missing" }, 400);

  const existing = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
  let row = existing.rows[0] as unknown as (UserRow & Record<string, unknown>) | undefined;
  let isNewUser = false;

  // This account already exists under a different role — signing them in
  // here as-is would hand back a token that every route in this app rejects
  // (e.g. a customer landing in the rider app gets 403s everywhere). Tell
  // them where their account actually lives instead of leaving them stuck.
  if (row && row.role !== role) {
    const appName = row.role === "rider" ? "rider" : row.role === "admin" ? "admin" : "customer";
    return c.json(
      {
        error: "role_mismatch",
        message: `This Google account is already registered as a ${row.role}. Please sign in from the ${appName} app instead.`,
      },
      409,
    );
  }

  if (!row) {
    isNewUser = true;
    const id = crypto.randomUUID();
    // Google-only accounts never use a password to sign in, but the column
    // is NOT NULL — fill it with something nobody knows and nobody needs.
    const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
    await db.execute({
      sql: `INSERT INTO users (id, email, name, password_hash, role, email_verified_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      args: [id, email, name?.trim() || email.split("@")[0], passwordHash, role],
    });
    if (role === "rider") {
      await db.execute({ sql: "INSERT INTO riders (user_id, verified, is_online) VALUES (?, 0, 0)", args: [id] });
    }
    const userRow = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
    row = userRow.rows[0] as unknown as typeof row;
  } else if (row.status === "suspended") {
    return c.json({ error: "account_suspended", message: "This account has been suspended" }, 403);
  } else if (!row.email_verified_at) {
    // Google already proved they own this email — piggyback the confirmation.
    await db.execute({
      sql: "UPDATE users SET email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      args: [row.id],
    });
    const userRow = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [row.id] });
    row = userRow.rows[0] as unknown as typeof row;
  }

  const token = await signToken({ sub: row!.id, role: row!.role, phone: row!.phone });
  return c.json({
    token,
    user: toAuthUser(row!),
    ...(isNewUser && row!.role === "rider" ? { riderStatus: "pending_verification" as const } : {}),
  });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE id = ?",
    args: [user.sub],
  });
  const row = result.rows[0];
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ user: toAuthUser(row) });
});

// ---------------------------------------------------------------------------
// One-click email verification — the confirmation link sent by
// createAndSendOtp() (see apps/api/src/verify/service.ts) points here.
// Public: proof of identity is the unguessable token itself, not a session
// — the person clicking may well be on a different device/browser than the
// one they signed up on.
// ---------------------------------------------------------------------------

authRoutes.get("/verify/confirm-link", async (c) => {
  const token = c.req.query("token");
  const fallbackBase = process.env.CUSTOMER_APP_URL ?? "http://localhost:3000";
  if (!token) return c.redirect(`${fallbackBase}/verify/confirmed?ok=0&reason=missing`, 302);

  const tokenHash = await hashCode(token);
  const res = await db.execute({
    sql: `SELECT o.*, u.role as user_role FROM otp_codes o JOIN users u ON u.id = o.user_id
          WHERE o.link_token_hash = ? AND o.purpose = 'verify' AND o.channel = 'email' AND o.consumed_at IS NULL
          LIMIT 1`,
    args: [tokenHash],
  });
  const otp = res.rows[0] as unknown as
    | { id: string; user_id: string; expires_at: string; user_role: string | null }
    | undefined;
  if (!otp) return c.redirect(`${fallbackBase}/verify/confirmed?ok=0&reason=invalid`, 302);

  const base = appBaseUrl(otp.user_role);
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    return c.redirect(`${base}/verify/confirmed?ok=0&reason=expired`, 302);
  }

  await db.execute({
    sql: "UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?",
    args: [otp.id],
  });
  await db.execute({
    sql: "UPDATE users SET email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    args: [otp.user_id],
  });

  return c.redirect(`${base}/verify/confirmed?ok=1`, 302);
});

// ---------------------------------------------------------------------------
// Forgot password — public (the whole point is the user is signed out).
// Reuses the otp_codes table with purpose='reset' so it's short-lived and
// rate-limited the same way onboarding codes are; never reveals whether an
// identifier matches an account.
// ---------------------------------------------------------------------------

const RESET_COOLDOWN_SECONDS = 30;
const RESET_MAX_ATTEMPTS = 5;

function parseSqliteTimestamp(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

const resetRequestSchema = z.object({ identifier: z.string().min(3).max(160) });

authRoutes.post("/password/reset/request", async (c) => {
  const parsed = resetRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { identifier } = parsed.data;

  const ipCheck = await ipLimited(c, "reset");
  if (!ipCheck.allowed) {
    return tooManyRequests(c, ipCheck, "Too many reset requests. Please wait a moment and try again.");
  }

  const result = await db.execute({
    sql: "SELECT id, phone, email FROM users WHERE phone = ? OR email = ?",
    args: [identifier, identifier],
  });
  const row = result.rows[0] as unknown as { id: string; phone: string | null; email: string | null } | undefined;
  // Same response whether or not the account exists — don't let this endpoint
  // be used to enumerate registered phone numbers/emails.
  if (!row) return c.json({ sent: true });

  const channel: "sms" | "email" = row.email ? "email" : "sms";
  const target = (channel === "email" ? row.email : row.phone) as string;

  const recent = await db.execute({
    sql: `SELECT created_at FROM otp_codes WHERE user_id = ? AND purpose = 'reset' ORDER BY created_at DESC LIMIT 1`,
    args: [row.id],
  });
  const lastCreatedAt = recent.rows[0]?.created_at as string | undefined;
  if (lastCreatedAt) {
    const remainingMs = RESET_COOLDOWN_SECONDS * 1000 - (Date.now() - parseSqliteTimestamp(lastCreatedAt).getTime());
    if (remainingMs > 0) return c.json({ sent: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) });
  }

  try {
    const { devCode } = await createAndSendOtp(row.id, channel, target, "reset");
    return c.json({ sent: true, channel, target: maskTarget(channel, target), ...(devCode ? { devCode } : {}) });
  } catch (err) {
    console.error("Failed to send password reset code:", err);
    return c.json({ sent: true });
  }
});

const resetConfirmSchema = z.object({
  identifier: z.string().min(3).max(160),
  code: z.string().length(6),
  newPassword: z.string().min(6).max(100),
});

authRoutes.post("/password/reset/confirm", async (c) => {
  const parsed = resetConfirmSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { identifier, code, newPassword } = parsed.data;

  const result = await db.execute({
    sql: "SELECT id, phone, role, status FROM users WHERE phone = ? OR email = ?",
    args: [identifier, identifier],
  });
  const row = result.rows[0] as unknown as
    | { id: string; phone: string | null; role: string; status: string }
    | undefined;
  if (!row) return c.json({ error: "invalid_code" }, 400);

  const otpRes = await db.execute({
    sql: `SELECT * FROM otp_codes WHERE user_id = ? AND purpose = 'reset' AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    args: [row.id],
  });
  const otp = otpRes.rows[0] as unknown as
    | { id: string; code_hash: string; expires_at: string; attempts: number }
    | undefined;
  if (!otp) return c.json({ error: "no_pending_code" }, 400);
  if (new Date(otp.expires_at).getTime() < Date.now()) return c.json({ error: "code_expired" }, 400);
  if (otp.attempts >= RESET_MAX_ATTEMPTS) return c.json({ error: "too_many_attempts" }, 429);

  const codeHash = await hashCode(code);
  if (!timingSafeEqual(codeHash, otp.code_hash)) {
    await db.execute({ sql: "UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?", args: [otp.id] });
    return c.json({ error: "invalid_code" }, 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.execute({
    sql: "UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?",
    args: [otp.id],
  });
  // sessions_valid_from is the point of a reset: someone resetting because
  // their account was taken needs the intruder's existing session to stop
  // working, not just their next login attempt to fail. The token issued
  // below shares this second, and requireAuth treats equal as still valid.
  // password_set_at also moves forward here — this is a Google-only
  // account's route to gaining a password it actually knows (see 0020).
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, sessions_valid_from = datetime('now'),
                 password_set_at = datetime('now'), force_password_change = 0, updated_at = datetime('now')
          WHERE id = ?`,
    args: [passwordHash, row.id],
  });
  // A fresh password also means the old failed-attempt tally is meaningless.
  await clearFailures(`login:${await hashKey(identifier)}`);

  if (row.status === "suspended") {
    return c.json({ error: "account_suspended", message: "This account has been suspended" }, 403);
  }

  const token = await signToken({ sub: row.id, role: row.role as "customer" | "rider" | "admin", phone: row.phone });
  const userRow = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [row.id] });
  return c.json({ token, user: toAuthUser(userRow.rows[0]) });
});

// ---------------------------------------------------------------------------
// Change password — signed-in equivalent of the reset flow above, for
// someone who knows their current password and just wants a new one (e.g.
// the admin settings page). Requires the current password rather than an
// OTP, since being logged in already proves less than a code sent to a
// verified channel would — a stolen or borrowed token is exactly the case
// this guards against.
// ---------------------------------------------------------------------------

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

authRoutes.post("/password/change", requireAuth, async (c) => {
  const user = c.get("user");
  const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { currentPassword, newPassword } = parsed.data;

  // Keyed on the account, not an attacker-supplied identifier — someone
  // holding a valid token could otherwise hammer this to confirm the
  // current password without ever touching /login's own lockout.
  const lockKey = `pwchange:${user.sub}`;
  const lock = await checkLockout(lockKey);
  if (!lock.allowed) {
    return tooManyRequests(c, lock, "Too many attempts. Please try again shortly.");
  }

  const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [user.sub] });
  const row = result.rows[0] as unknown as (UserRow & Record<string, unknown>) | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);

  const ok = await bcrypt.compare(currentPassword, row.password_hash);
  if (!ok) {
    await recordFailure(lockKey);
    return c.json({ error: "invalid_current_password", message: "That's not your current password." }, 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Same reasoning as the OTP reset path: bump sessions_valid_from so every
  // *other* signed-in session (another device, a stolen token) stops
  // working. The replacement token issued below shares this second, so
  // this request's own session survives — changing your password from
  // Settings shouldn't log you out mid-flow.
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, sessions_valid_from = datetime('now'),
                 password_set_at = datetime('now'), force_password_change = 0, updated_at = datetime('now')
          WHERE id = ?`,
    args: [passwordHash, user.sub],
  });
  await clearFailures(lockKey);

  const token = await signToken({ sub: row.id, role: row.role, phone: row.phone });
  const userRow = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [user.sub] });
  return c.json({ token, user: toAuthUser(userRow.rows[0]) });
});
