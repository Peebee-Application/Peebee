import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getPlatformEnvironment, getWalletAccountSettings, getWalletSettings } from "../lib/settings.js";
import { frozenBody, walletIsFrozen } from "./freeze.js";
import { runIdempotentTransfer } from "./idempotency.js";
import { maskPhone } from "./mask.js";
import { getWalletCap, resolveCustomerByIdentifier, transferWallet } from "./service.js";

export const walletAccountRoutes = new Hono();
walletAccountRoutes.use("/wallet/lookup", requireAuth, requireRole("customer"));
walletAccountRoutes.use("/wallet/contacts", requireAuth, requireRole("customer"));
walletAccountRoutes.use("/wallet/contacts/*", requireAuth, requireRole("customer"));
walletAccountRoutes.use("/wallet/requests", requireAuth, requireRole("customer"));
walletAccountRoutes.use("/wallet/requests/*", requireAuth, requireRole("customer"));
walletAccountRoutes.use("/wallet/spending", requireAuth, requireRole("customer"));

type Row = Record<string, unknown>;

const unavailable = { error: "migration_pending", message: "This isn't available until the wallet accounts migration is applied." };

async function resolvePerson(input: { recipient?: string; recipientId?: string }): Promise<{ id: string; name: string; phone: string | null } | null> {
  if (input.recipientId) {
    const res = await db.execute({
      sql: "SELECT id, name, phone FROM users WHERE id = ? AND role = 'customer' AND status = 'active'",
      args: [input.recipientId],
    });
    const row = res.rows[0] as Row | undefined;
    if (!row) return null;
    return { id: String(row.id), name: String(row.name), phone: row.phone ? String(row.phone) : null };
  }
  const ident = input.recipient?.trim();
  if (!ident) return null;
  const found = await resolveCustomerByIdentifier(ident);
  if (!found) return null;
  const phoneRes = await db.execute({ sql: "SELECT phone FROM users WHERE id = ?", args: [found.id] });
  const phone = (phoneRes.rows[0] as Row | undefined)?.phone;
  return { id: found.id, name: found.name, phone: phone ? String(phone) : null };
}

function publicPerson(person: { id: string; name: string; phone: string | null }, nickname?: string | null) {
  return {
    recipientId: person.id,
    name: person.name,
    nickname: nickname?.trim() || null,
    maskedPhone: maskPhone(person.phone),
  };
}

walletAccountRoutes.get("/wallet/lookup", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 200) return c.json({ error: "invalid_query", message: "Enter a phone number or email." }, 400);
  const settings = await getWalletAccountSettings();
  const quota = await consume(`wallet-lookup:${user.sub}`, settings.lookupPerHour, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many name checks just now. Please try again later.");
  const person = await resolvePerson({ recipient: q });
  if (!person || person.id === user.sub) {
    return c.json({ error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." }, 404);
  }
  return c.json(publicPerson(person));
});

walletAccountRoutes.get("/wallet/contacts", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_contacts"))) return c.json({ contacts: [], available: false });
  const res = await db.execute({
    sql: `SELECT wc.id, wc.nickname, wc.created_at, u.id as contact_user_id, u.name, u.phone
          FROM wallet_contacts wc JOIN users u ON u.id = wc.contact_user_id
          WHERE wc.owner_id = ? ORDER BY wc.created_at DESC`,
    args: [user.sub],
  });
  return c.json({
    contacts: (res.rows as Row[]).map((row) => ({
      id: String(row.id),
      recipientId: String(row.contact_user_id),
      name: String(row.name),
      nickname: row.nickname ? String(row.nickname) : null,
      maskedPhone: maskPhone(row.phone ? String(row.phone) : null),
      createdAt: String(row.created_at),
    })),
    available: true,
  });
});

const contactSchema = z.object({
  recipient: z.string().min(3).max(200).optional(),
  recipientId: z.string().min(3).max(80).optional(),
  nickname: z.string().trim().max(40).optional(),
});

walletAccountRoutes.post("/wallet/contacts", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_contacts"))) return c.json(unavailable, 503);
  const parsed = contactSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.recipient && !parsed.data.recipientId)) {
    return c.json({ error: "invalid_body", message: "Enter a phone number or email." }, 400);
  }
  const settings = await getWalletAccountSettings();
  const person = await resolvePerson(parsed.data);
  if (!person) return c.json({ error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." }, 404);
  if (person.id === user.sub) return c.json({ error: "self_contact", message: "You can't save yourself as a contact." }, 400);
  const count = await db.execute({ sql: "SELECT COUNT(*) as n FROM wallet_contacts WHERE owner_id = ?", args: [user.sub] });
  const existing = await db.execute({
    sql: "SELECT id FROM wallet_contacts WHERE owner_id = ? AND contact_user_id = ?",
    args: [user.sub, person.id],
  });
  if (existing.rows.length === 0 && Number((count.rows[0] as Row).n) >= settings.contactsMax) {
    return c.json({ error: "contacts_limit", message: `You can save up to ${settings.contactsMax} contacts.` }, 409);
  }
  const nickname = settings.nicknames ? parsed.data.nickname?.trim() || null : null;
  if (existing.rows.length > 0) {
    await db.execute({
      sql: "UPDATE wallet_contacts SET nickname = COALESCE(?, nickname) WHERE id = ?",
      args: [nickname, String((existing.rows[0] as Row).id)],
    });
    return c.json({ contact: { id: String((existing.rows[0] as Row).id), ...publicPerson(person, nickname) } });
  }
  const id = newId("wct");
  await db.execute({
    sql: "INSERT INTO wallet_contacts (id, owner_id, contact_user_id, nickname) VALUES (?, ?, ?, ?)",
    args: [id, user.sub, person.id, nickname],
  });
  return c.json({ contact: { id, ...publicPerson(person, nickname) } }, 201);
});

walletAccountRoutes.patch("/wallet/contacts/:id", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_contacts"))) return c.json(unavailable, 503);
  const settings = await getWalletAccountSettings();
  if (!settings.nicknames) return c.json({ error: "nicknames_off", message: "Nicknames are turned off." }, 403);
  const parsed = z.object({ nickname: z.string().trim().max(40) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const res = await db.execute({
    sql: "UPDATE wallet_contacts SET nickname = ? WHERE id = ? AND owner_id = ?",
    args: [parsed.data.nickname || null, c.req.param("id"), user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

walletAccountRoutes.delete("/wallet/contacts/:id", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_contacts"))) return c.json(unavailable, 503);
  const res = await db.execute({
    sql: "DELETE FROM wallet_contacts WHERE id = ? AND owner_id = ?",
    args: [c.req.param("id"), user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

async function expireRequests() {
  if (!(await hasTable("wallet_requests"))) return;
  await db.execute({
    sql: `UPDATE wallet_requests SET status = 'expired', updated_at = datetime('now')
          WHERE status IN ('open', 'later') AND expires_at <= datetime('now')`,
    args: [],
  });
}

function presentRequest(row: Row, viewerId: string, declinesVisible: boolean) {
  const mine = String(row.requester_id) === viewerId;
  let status = String(row.status);
  if (mine && status === "declined" && !declinesVisible) status = "closed";
  return {
    id: String(row.id),
    amount: Number(row.amount),
    note: row.note ? String(row.note) : null,
    status,
    intoWalletId: row.into_wallet_id ? String(row.into_wallet_id) : "primary",
    expiresAt: String(row.expires_at),
    snoozeUntil: row.snooze_until ? String(row.snooze_until) : null,
    createdAt: String(row.created_at),
    direction: mine ? "outgoing" as const : "incoming" as const,
    personName: String(mine ? row.payer_name : row.requester_name),
    maskedPhone: maskPhone(String(mine ? row.payer_phone ?? "" : row.requester_phone ?? "")),
    recipientId: String(mine ? row.payer_id : row.requester_id),
  };
}

const REQUEST_SELECT = `SELECT wr.*, payer.name as payer_name, payer.phone as payer_phone,
        requester.name as requester_name, requester.phone as requester_phone
        FROM wallet_requests wr
        JOIN users payer ON payer.id = wr.payer_id
        JOIN users requester ON requester.id = wr.requester_id`;

walletAccountRoutes.get("/wallet/requests", async (c) => {
  const user = c.get("user");
  const settings = await getWalletAccountSettings();
  if (!(await hasTable("wallet_requests"))) return c.json({ requests: [], incomingOpen: 0, available: false });
  await expireRequests();
  const res = await db.execute({
    sql: `${REQUEST_SELECT} WHERE wr.requester_id = ? OR wr.payer_id = ? ORDER BY wr.created_at DESC LIMIT 50`,
    args: [user.sub, user.sub],
  });
  const requests = (res.rows as Row[]).map((row) => presentRequest(row, user.sub, settings.requestDeclinesVisible));
  const incomingOpen = settings.requestNotify
    ? requests.filter((r) => r.direction === "incoming" && (r.status === "open" || (r.status === "later" && (!r.snoozeUntil || new Date(`${r.snoozeUntil.replace(" ", "T")}Z`).getTime() <= Date.now())))).length
    : 0;
  return c.json({ requests, incomingOpen, available: true, enabled: settings.requestsEnabled });
});

const createRequestSchema = z.object({
  payer: z.string().min(3).max(200).optional(),
  recipientId: z.string().min(3).max(80).optional(),
  amount: z.number().int().positive(),
  note: z.string().max(140).optional(),
  intoWalletId: z.string().min(1).optional(),
});

walletAccountRoutes.post("/wallet/requests", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_requests"))) return c.json(unavailable, 503);
  const settings = await getWalletAccountSettings();
  if (!settings.requestsEnabled) return c.json({ error: "requests_off", message: "Requesting money is turned off." }, 403);
  const parsed = createRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.payer && !parsed.data.recipientId)) return c.json({ error: "invalid_body" }, 400);
  const quota = await consume(`wallet-request:${user.sub}`, settings.requestPerHour, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many requests just now. Please try again later.");
  const payer = await resolvePerson({ recipient: parsed.data.payer, recipientId: parsed.data.recipientId });
  if (!payer) return c.json({ error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." }, 404);
  if (payer.id === user.sub) return c.json({ error: "self_request", message: "You can't request money from yourself." }, 400);
  if (settings.requestContactsOnly) {
    const saved = await db.execute({
      sql: "SELECT 1 FROM wallet_contacts WHERE owner_id = ? AND contact_user_id = ?",
      args: [user.sub, payer.id],
    });
    if (saved.rows.length === 0) return c.json({ error: "not_a_contact", message: "You can only request money from a saved contact." }, 403);
  }
  await expireRequests();
  const open = await db.execute({
    sql: "SELECT COUNT(*) as n FROM wallet_requests WHERE requester_id = ? AND status IN ('open', 'later')",
    args: [user.sub],
  });
  if (Number((open.rows[0] as Row).n) >= settings.requestMaxOpen) {
    return c.json({ error: "too_many_requests", message: `You can have ${settings.requestMaxOpen} open requests at a time.` }, 409);
  }
  const into = !parsed.data.intoWalletId || parsed.data.intoWalletId === "primary" ? null : parsed.data.intoWalletId;
  if (into) {
    const owned = await db.execute({ sql: "SELECT 1 FROM wallets WHERE id = ? AND owner_id = ?", args: [into, user.sub] });
    if (owned.rows.length === 0) return c.json({ error: "not_found", message: "That account doesn't exist." }, 404);
  }
  const id = newId("wrq");
  await db.execute({
    sql: `INSERT INTO wallet_requests (id, requester_id, payer_id, amount, note, into_wallet_id, status, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', datetime('now', ?))`,
    args: [id, user.sub, payer.id, parsed.data.amount, parsed.data.note?.trim() || null, into, `+${settings.requestExpiryHours} hours`],
  });
  return c.json({
    id,
    amount: parsed.data.amount,
    personName: payer.name,
    maskedPhone: maskPhone(payer.phone),
    notified: settings.requestNotify,
  }, 201);
});

async function loadRequest(id: string): Promise<Row | undefined> {
  const res = await db.execute({ sql: `${REQUEST_SELECT} WHERE wr.id = ?`, args: [id] });
  return res.rows[0] as Row | undefined;
}

walletAccountRoutes.post("/wallet/requests/:id/decline", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_requests"))) return c.json(unavailable, 503);
  await expireRequests();
  const res = await db.execute({
    sql: `UPDATE wallet_requests SET status = 'declined', updated_at = datetime('now')
          WHERE id = ? AND payer_id = ? AND status IN ('open', 'later')`,
    args: [c.req.param("id"), user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ status: "declined" });
});

walletAccountRoutes.post("/wallet/requests/:id/later", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_requests"))) return c.json(unavailable, 503);
  const settings = await getWalletAccountSettings();
  await expireRequests();
  const res = await db.execute({
    sql: `UPDATE wallet_requests SET status = 'later', snooze_until = datetime('now', ?), updated_at = datetime('now')
          WHERE id = ? AND payer_id = ? AND status IN ('open', 'later')`,
    args: [`+${settings.requestLaterHours} hours`, c.req.param("id"), user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ status: "later" });
});

walletAccountRoutes.post("/wallet/requests/:id/cancel", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_requests"))) return c.json(unavailable, 503);
  const settings = await getWalletAccountSettings();
  if (!settings.requestAllowCancel) return c.json({ error: "cancel_off", message: "Cancelling a request is turned off." }, 403);
  await expireRequests();
  const res = await db.execute({
    sql: `UPDATE wallet_requests SET status = 'cancelled', updated_at = datetime('now')
          WHERE id = ? AND requester_id = ? AND status IN ('open', 'later')`,
    args: [c.req.param("id"), user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ status: "cancelled" });
});

const paySchema = z.object({
  fromWalletId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

walletAccountRoutes.post("/wallet/requests/:id/pay", async (c) => {
  const user = c.get("user");
  if (!(await hasTable("wallet_requests"))) return c.json(unavailable, 503);
  const settings = await getWalletAccountSettings();
  const parsed = paySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await expireRequests();
  const request = await loadRequest(c.req.param("id"));
  if (!request || String(request.payer_id) !== user.sub) return c.json({ error: "not_found" }, 404);
  if (request.status === "paid") {
    return c.json({ status: "paid", recipientName: String(request.requester_name), amount: Number(request.amount), replay: true });
  }
  if (request.status !== "open" && request.status !== "later") {
    return c.json({ error: "request_closed", message: "This request is no longer open." }, 409);
  }
  const fromWalletId = !parsed.data.fromWalletId || parsed.data.fromWalletId === "primary" ? undefined : parsed.data.fromWalletId;
  const owned = await assertSpendSource(user.sub, fromWalletId, settings.sendFromShared);
  if (owned.error) return c.json(owned.error.body, owned.error.status);
  if (await walletIsFrozen(owned.ownerId, fromWalletId)) return c.json(frozenBody(), 409);

  const environment = await getPlatformEnvironment();
  const toWalletId = request.into_wallet_id ? String(request.into_wallet_id) : undefined;
  const amount = Number(request.amount);
  if (!toWalletId) {
    const capBlock = await recipientCapBlock(String(request.requester_id), String(request.requester_name), amount, environment);
    if (capBlock) return c.json(capBlock, 400);
  }
  const intent = {
    toUserId: String(request.requester_id),
    amount,
    environment,
    note: request.note ? String(request.note) : "Payment request",
    toWalletId: toWalletId ?? null,
    fromWalletId: fromWalletId ?? null,
  };
  const result = await runIdempotentTransfer(user.sub, parsed.data.idempotencyKey, "request_pay", intent, async () => {
    const moved = await transferWallet({
      fromUserId: owned.ownerId,
      toUserId: intent.toUserId,
      amount,
      environment,
      note: intent.note,
      fromWalletId,
      toWalletId,
      actorId: owned.ownerId === user.sub ? undefined : user.sub,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (!moved) {
      const frozen = await walletIsFrozen(owned.ownerId, fromWalletId);
      return frozen
        ? { status: 409, body: frozenBody() }
        : { status: 409, body: { error: "insufficient_balance", message: "You don't have enough in that account." } };
    }
    await db.execute({
      sql: `UPDATE wallet_requests SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now'), idempotency_key = ?
            WHERE id = ? AND status IN ('open', 'later')`,
      args: [parsed.data.idempotencyKey ?? null, String(request.id)],
    });
    return { status: 200, body: { status: "paid", balance: moved.fromBalance, recipientName: String(request.requester_name), amount } };
  });
  return c.json(result.body, result.status as 200);
});

walletAccountRoutes.get("/wallet/spending", async (c) => {
  const { loadSpending } = await import("./ledger-view.js");
  const period = c.req.query("period") === "week" || c.req.query("period") === "all" ? c.req.query("period")! : "month";
  const environment = await getPlatformEnvironment();
  return c.json(await loadSpending(c.get("user").sub, environment, period as "week" | "month" | "all"));
});

export async function assertSpendSource(userId: string, fromWalletId: string | undefined, allowShared: boolean): Promise<
  { ownerId: string; error?: undefined } | { ownerId: string; error: { status: 400 | 403 | 404; body: { error: string; message: string } } }
> {
  if (!fromWalletId) return { ownerId: userId };
  const owned = await db.execute({ sql: "SELECT owner_id FROM wallets WHERE id = ?", args: [fromWalletId] });
  const row = owned.rows[0] as Row | undefined;
  if (!row) return { ownerId: userId, error: { status: 404, body: { error: "not_found", message: "That account doesn't exist." } } };
  if (String(row.owner_id) === userId) return { ownerId: userId };
  if (!allowShared) {
    return { ownerId: userId, error: { status: 403, body: { error: "shared_not_sendable", message: "Shared accounts can be used for orders, not for sending money." } } };
  }
  const share = await db.execute({
    sql: "SELECT 1 FROM wallet_shares WHERE owner_id = ? AND grantee_id = ? AND wallet_id = ? AND status = 'active'",
    args: [String(row.owner_id), userId, fromWalletId],
  });
  if (share.rows.length === 0) {
    return { ownerId: userId, error: { status: 403, body: { error: "shared_not_sendable", message: "That account isn't shared with you." } } };
  }
  if (await hasColumn("wallets", "frozen_at")) {
    /* freeze of the owner's account is checked by the caller via walletIsFrozen(ownerId) */
  }
  return { ownerId: String(row.owner_id) };
}

async function recipientCapBlock(userId: string, name: string, amount: number, environment: "live" | "sandbox") {
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const [{ cap }, balanceRes] = await Promise.all([
    getWalletCap(userId),
    db.execute({ sql: `SELECT ${column} as wallet_balance FROM users WHERE id = ?`, args: [userId] }),
  ]);
  const balance = Number((balanceRes.rows[0] as Row)?.wallet_balance ?? 0);
  if (balance + amount > cap) return { error: "recipient_cap_exceeded", message: `That would put ${name}'s account over their balance limit.` };
  return null;
}

export async function walletFeatureFlags() {
  const settings = await getWalletAccountSettings();
  const caps = await getWalletSettings();
  return { ...settings, ...caps };
}
