import bcrypt from "bcryptjs";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { db, executeBatch } from "../db/client.js";
import { emailIsReady, sendPlainEmail } from "../lib/email-gateway.js";
import { clientIp, consume, hashKey, tooManyRequests } from "../lib/ratelimit.js";
import { randomToken } from "../lib/random.js";
import { hasTable } from "../lib/schema.js";
import { generateCode, generateLinkToken, hashCode } from "../verify/otp.js";
import { logActivity } from "./activity.js";
import { requireFinancialAccess } from "./financial-access.js";
import { getFinancialDraft } from "./financial-draft.js";
import { requireSuperAdmin } from "./permissions.js";

const cookie = "__Host-peebee-financial-guest";
const day = 86400;
const codeLifetime = 600;
const sessionLifetime = 8 * 3600;
const clock = () => Math.floor(Date.now() / 1000);
const emailInput = z.string().trim().email().max(160).transform(email => email.toLowerCase());
const inviteId = z.string().uuid();
const credentials = z.object({ invite: inviteId, email: emailInput }).strict();
const verification = credentials.extend({
  code: z.string().regex(/^\d{6}$/),
  password: z.string().max(80).optional(),
});
const invitation = z.object({ email: emailInput, passwordRequired: z.boolean(), days: z.number().int().min(1).max(30) }).strict();
const requestAccess = z.object({ email: emailInput, note: z.string().trim().max(500).default("") }).strict();
const readJson = (c: Context) => c.req.json().catch(() => null);
const invalid = (c: Context) => c.json({ error: "invalid_input", message: "Check the details you entered and try again." }, 400);
const unavailable = (c: Context) => c.json({ error: "unavailable", message: "Guest access is temporarily unavailable." }, 503);
const denied = (c: Context) => c.json({ error: "invalid_guest_credentials", message: "The invitation, email, passcode, or password is invalid or expired." }, 401);
const inviteLink = (id: string) => `https://financials.peebee.online/?guest=${id}`;
const codeDigest = (invite: string, code: string) => hashCode(`financial-guest:${invite}:${code}`);
const cookieOptions = { path: "/", httpOnly: true, secure: true, sameSite: "Strict" } as const;

function guestStorage(table: "financial_guest_invites" | "financial_guest_requests") {
  return async (c: Context, next: Next) => {
    c.header("Cache-Control", "private, no-store");
    if (!(await hasTable(table))) return unavailable(c);
    await next();
  };
}

async function inviteAudit(c: Context, action: string, id: string, summary: string) {
  await logActivity({ actor: c.get("user"), action, summary, entityType: "financial_guest_invite", entityId: id })
    .catch(error => console.error("Could not log Financials invitation change", error));
}

export const financialInviteRoutes = new Hono();
financialInviteRoutes.use("*", requireFinancialAccess, guestStorage("financial_guest_invites"));

financialInviteRoutes.get("/", async c => {
  const actor = c.get("user");
  const { rows } = await db.execute({
    sql: `SELECT id, email, created_at, expires_at, revoked_at, password_hash IS NOT NULL AS password_required
          FROM financial_guest_invites
          WHERE (created_by = ? OR ? = 'super_admin') AND expires_at > ?
          ORDER BY created_at DESC LIMIT 100`,
    args: [actor.sub, actor.adminRole, clock()],
  });
  return c.json({ invites: rows.map(row => ({
    id: row.id, email: row.email, expiresAt: row.expires_at, revokedAt: row.revoked_at,
    passwordRequired: Boolean(row.password_required), link: inviteLink(String(row.id)),
  })) });
});

financialInviteRoutes.post("/", bodyLimit({ maxSize: 2048 }), async c => {
  const input = invitation.safeParse(await readJson(c));
  if (!input.success) return invalid(c);
  if (!(await getFinancialDraft())) {
    return c.json({ error: "missing_forecast", message: "Save a forecast before creating an invitation." }, 409);
  }
  const actor = c.get("user");
  const { email, passwordRequired, days } = input.data;
  const id = crypto.randomUUID();
  const password = passwordRequired ? randomToken(16) : null;
  const now = clock();
  const expiresAt = now + days * day;
  await db.execute({
    sql: `INSERT INTO financial_guest_invites (id, email, created_by, created_at, expires_at, password_hash)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, email, actor.sub, now, expiresAt, password ? await bcrypt.hash(password, 10) : null],
  });
  await inviteAudit(c, "financial_guest.invite", id, "Created a Financials guest invitation");
  return c.json({ link: inviteLink(id), password, expiresAt }, 201);
});

financialInviteRoutes.delete("/:id", async c => {
  const parsed = inviteId.safeParse(c.req.param("id"));
  if (!parsed.success) return invalid(c);
  const actor = c.get("user");
  const result = await db.execute({
    sql: `UPDATE financial_guest_invites SET revoked_at = ?, code_hash = NULL, session_hash = NULL
          WHERE id = ? AND revoked_at IS NULL AND (created_by = ? OR ? = 'super_admin')`,
    args: [clock(), parsed.data, actor.sub, actor.adminRole],
  });
  if (!result.rowsAffected) return c.json({ error: "not_found", message: "Active invitation not found." }, 404);
  await inviteAudit(c, "financial_guest.revoke", parsed.data, "Revoked a Financials guest invitation");
  return c.json({ ok: true });
});

export const financialRequestRoutes = new Hono();
financialRequestRoutes.use("*", requireSuperAdmin(), guestStorage("financial_guest_requests"));
financialRequestRoutes.get("/", async c => {
  const { rows } = await db.execute(
    "SELECT id, email, note, created_at AS createdAt FROM financial_guest_requests WHERE reviewed_at IS NULL ORDER BY created_at DESC LIMIT 100",
  );
  return c.json({ requests: rows });
});
financialRequestRoutes.post("/:id", guestStorage("financial_guest_invites"), bodyLimit({ maxSize: 1024 }), async c => {
  const id = inviteId.safeParse(c.req.param("id"));
  const decision = z.object({ approve: z.boolean() }).strict().safeParse(await readJson(c));
  if (!id.success || !decision.success) return invalid(c);
  const now = clock();
  const invite = decision.data.approve ? crypto.randomUUID() : null;
  if (invite && !(await getFinancialDraft())) {
    return c.json({ error: "missing_forecast", message: "Save a forecast before approving access." }, 409);
  }
  const writes = invite ? [{
    sql: `INSERT INTO financial_guest_invites (id, email, created_by, created_at, expires_at)
          SELECT ?, email, ?, ?, ? FROM financial_guest_requests WHERE id = ? AND reviewed_at IS NULL`,
    args: [invite, c.get("user").sub, now, now + 7 * day, id.data],
  }] : [];
  const changes = await executeBatch([...writes, {
    sql: "UPDATE financial_guest_requests SET reviewed_at = ?, invite_id = ? WHERE id = ? AND reviewed_at IS NULL",
    args: [now, invite, id.data],
  }]);
  if (!changes.at(-1)) return c.json({ error: "not_found", message: "This request was already reviewed." }, 404);
  await inviteAudit(c, invite ? "financial_guest.approve" : "financial_guest.dismiss", invite ?? id.data,
    invite ? "Approved a Financials guest access request" : "Dismissed a Financials guest access request");
  return c.json({ link: invite ? inviteLink(invite) : null });
});

export const financialGuestRoutes = new Hono();
financialGuestRoutes.use("*", bodyLimit({ maxSize: 4096 }));
financialGuestRoutes.use("*", async (c, next) => {
  if (c.req.method === "POST" && !/^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? "")) return invalid(c);
  await next();
});
financialGuestRoutes.post("/request", guestStorage("financial_guest_requests"), async c => {
  const input = requestAccess.safeParse(await readJson(c));
  if (!input.success) return invalid(c);
  const ipLimit = await consume(`financial-guest-request:${await hashKey(clientIp(c))}`, 5, 3600);
  if (!ipLimit.allowed) return tooManyRequests(c, ipLimit, "Too many access requests. Try again later.");
  await db.execute({
    sql: "INSERT OR IGNORE INTO financial_guest_requests (id, email, note, created_at) VALUES (?, ?, ?, ?)",
    args: [crypto.randomUUID(), input.data.email, input.data.note, clock()],
  });
  return c.json({ ok: true });
});

financialGuestRoutes.post("/code", guestStorage("financial_guest_invites"), async c => {
  const input = credentials.safeParse(await readJson(c));
  if (!input.success) return invalid(c);
  const { invite, email } = input.data;
  const limit = await consume(`financial-guest-send:${await hashKey(clientIp(c))}`, 15, 600);
  if (!limit.allowed) return tooManyRequests(c, limit, "Too many requests for a passcode. Try again later.");
  if (!(await emailIsReady())) return unavailable(c);
  const now = clock();
  const code = generateCode();
  const digest = await codeDigest(invite, code);
  const result = await db.execute({
    sql: `UPDATE financial_guest_invites SET code_hash = ?, code_expires_at = ?, code_sent_at = ?
          WHERE id = ? AND email = ? AND revoked_at IS NULL AND expires_at > ?
            AND (code_sent_at IS NULL OR code_sent_at <= ?) `,
    args: [digest, now + codeLifetime, now, invite, email, now, now - 60],
  });
  if (result.rowsAffected) {
    try {
      await sendPlainEmail(email, "Your Peebee Financials passcode", `Your guest passcode is ${code}. It expires in 10 minutes.`);
    } catch {
      await db.execute({
        sql: "UPDATE financial_guest_invites SET code_hash = NULL, code_sent_at = NULL WHERE id = ? AND code_hash = ?",
        args: [invite, digest],
      });
      return unavailable(c);
    }
  }
  // The same response prevents disclosing the email attached to an invite.
  return c.json({ ok: true });
});

financialGuestRoutes.post("/verify", guestStorage("financial_guest_invites"), async c => {
  const input = verification.safeParse(await readJson(c));
  if (!input.success) return invalid(c);
  const { invite, email, code, password } = input.data;
  const ipLimit = await consume(`financial-guest-verify-ip:${await hashKey(clientIp(c))}`, 30, codeLifetime);
  if (!ipLimit.allowed) return tooManyRequests(c, ipLimit, "Too many passcode attempts. Try again later.");
  const inviteLimit = await consume(`financial-guest-verify:${invite}`, 8, codeLifetime);
  if (!inviteLimit.allowed) return tooManyRequests(c, inviteLimit, "Too many passcode attempts. Try again later.");
  const now = clock();
  const digest = await codeDigest(invite, code);
  const { rows } = await db.execute({
    sql: `SELECT password_hash, expires_at FROM financial_guest_invites
          WHERE id = ? AND email = ? AND revoked_at IS NULL AND expires_at > ? AND code_expires_at > ? AND code_hash = ?`,
    args: [invite, email, now, now, digest],
  });
  const row = rows[0];
  if (!row || (typeof row.password_hash === "string" && !(await bcrypt.compare(password ?? "", row.password_hash)))) return denied(c);
  const token = generateLinkToken();
  const expires = Math.min(clock() + sessionLifetime, Number(row.expires_at));
  const result = await db.execute({
    sql: `UPDATE financial_guest_invites SET session_hash = ?, session_expires_at = ?, code_hash = NULL, code_expires_at = NULL
          WHERE id = ? AND code_hash = ? AND revoked_at IS NULL AND expires_at > ? AND code_expires_at > ?`,
    args: [await hashKey(token), expires, invite, digest, clock(), clock()],
  });
  if (!result.rowsAffected) return denied(c);
  setCookie(c, cookie, token, { ...cookieOptions, maxAge: expires - clock() });
  return c.json({ ok: true });
});

financialGuestRoutes.get("/draft", guestStorage("financial_guest_invites"), async c => {
  const id = inviteId.safeParse(c.req.query("invite"));
  const token = getCookie(c, cookie);
  if (!id.success || !token || !/^[a-f0-9]{64}$/.test(token)) return denied(c);
  const now = clock();
  const { rows } = await db.execute({
    sql: `SELECT email FROM financial_guest_invites WHERE id = ? AND session_hash = ?
          AND revoked_at IS NULL AND expires_at > ? AND session_expires_at > ?`,
    args: [id.data, await hashKey(token), now, now],
  });
  if (!rows.length) return denied(c);
  const draft = await getFinancialDraft();
  if (!draft) return c.json({ draft: null });
  const { actuals: _actuals, ...answers } = draft.answers;
  return c.json({ draft: { ...draft, answers } });
});

financialGuestRoutes.post("/logout", guestStorage("financial_guest_invites"), async c => {
  const token = getCookie(c, cookie);
  deleteCookie(c, cookie, cookieOptions);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await db.execute({ sql: "UPDATE financial_guest_invites SET session_hash = NULL WHERE session_hash = ?", args: [await hashKey(token)] });
  }
  return c.json({ ok: true });
});
