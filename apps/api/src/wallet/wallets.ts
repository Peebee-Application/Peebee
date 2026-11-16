/**
 * Multiple named wallets per customer — up to 5 total, counting their
 * original/primary wallet (users.wallet_balance, untouched by this file
 * except for its display name) plus up to 4 real rows in `wallets` (see
 * ../db/migrations/0045_multi_wallet.sql). "primary" is used throughout
 * as the sentinel wallet id for the original wallet, since it isn't a row
 * in `wallets` at all.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn } from "../lib/schema.js";
import { getPlatformEnvironment, getWalletAccountSettings } from "../lib/settings.js";
import { frozenBody, walletIsFrozen } from "./freeze.js";
import { runIdempotentTransfer } from "./idempotency.js";
import { loadLedger } from "./ledger-view.js";
import { transferBetweenOwnWallets } from "./service.js";

export const walletsRoutes = new Hono();
// Scoped to /wallets/* rather than "*" on purpose — this router is mounted
// on the shared /v1 prefix (see app.ts), so an unscoped "*" here leaked
// into every route registered after it across the whole app once merged,
// rejecting any non-customer (e.g. an admin) hitting an unrelated /v1/*
// endpoint with "requires=customer". See apps/api/src/admin/routes.ts for
// the same scoping discipline applied to /admin/*.
walletsRoutes.use("/wallets/*", requireAuth, requireRole("customer"));

type Row = Record<string, unknown>;

/** Fallback names if the admin setting is empty. The live list is wallet_suggested_names. */
export const SUGGESTED_WALLET_NAMES = [
  "Home",
  "Office",
  "Travel",
  "Family Expenses",
  "Personal Savings",
  "Groceries",
  "Emergency Fund",
];

walletsRoutes.get("/wallets", async (c) => {
  const user = c.get("user");
  const environment = await getPlatformEnvironment();
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const walletColumn = environment === "sandbox" ? "balance_sandbox" : "balance";

  const settings = await getWalletAccountSettings();
  const [primaryFrozenCol, namedFrozenCol] = await Promise.all([
    hasColumn("users", "primary_wallet_frozen_at"),
    hasColumn("wallets", "frozen_at"),
  ]);
  const [userRes, walletsRes] = await Promise.all([
    db.execute({
      sql: `SELECT ${column} as balance, primary_wallet_name${primaryFrozenCol ? ", primary_wallet_frozen_at" : ""} FROM users WHERE id = ?`,
      args: [user.sub],
    }),
    db.execute({
      sql: `SELECT id, name, ${walletColumn} as balance, created_at${namedFrozenCol ? ", frozen_at" : ""} FROM wallets WHERE owner_id = ? ORDER BY created_at ASC`,
      args: [user.sub],
    }),
  ]);
  const userRow = userRes.rows[0] as Row | undefined;
  const named = (walletsRes.rows as Row[]).map((w) => ({
    id: w.id as string,
    name: w.name as string,
    balance: Number(w.balance ?? 0),
    isPrimary: false,
    frozen: namedFrozenCol ? !!w.frozen_at : false,
  }));
  const primary = {
    id: "primary",
    name: (userRow?.primary_wallet_name as string | null) ?? "Main Wallet",
    balance: Number(userRow?.balance ?? 0),
    isPrimary: true,
    frozen: primaryFrozenCol ? !!userRow?.primary_wallet_frozen_at : false,
  };
  const own = [primary, ...named];
  const total = own.filter((w) => settings.includeFrozenInTotal || !w.frozen).reduce((sum, w) => sum + w.balance, 0);

  return c.json({
    wallets: own,
    suggestedNames: settings.suggestedNames,
    maxWallets: settings.maxAccounts,
    total,
    includeFrozenInTotal: settings.includeFrozenInTotal,
    features: {
      freeze: settings.freezeEnabled && (primaryFrozenCol || namedFrozenCol),
      requests: settings.requestsEnabled,
      sendFromShared: settings.sendFromShared,
      nicknames: settings.nicknames,
      contactsMax: settings.contactsMax,
      requestContactsOnly: settings.requestContactsOnly,
      requestAllowCancel: settings.requestAllowCancel,
      requestNotify: settings.requestNotify,
    },
  });
});

const nameSchema = z.string().trim().min(1).max(40);

walletsRoutes.post("/wallets", async (c) => {
  const user = c.get("user");
  const parsed = z.object({ name: nameSchema }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const settings = await getWalletAccountSettings();
  const count = await db.execute({ sql: "SELECT COUNT(*) as n FROM wallets WHERE owner_id = ?", args: [user.sub] });
  if (Number((count.rows[0] as Row).n) >= settings.maxAccounts - 1) {
    return c.json({ error: "wallet_limit_reached", message: `You can have up to ${settings.maxAccounts} accounts` }, 409);
  }

  const id = newId("wal");
  await db.execute({
    sql: "INSERT INTO wallets (id, owner_id, name) VALUES (?, ?, ?)",
    args: [id, user.sub, parsed.data.name],
  });
  return c.json({ wallet: { id, name: parsed.data.name, balance: 0, isPrimary: false } }, 201);
});

walletsRoutes.patch("/wallets/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const parsed = z.object({
    name: nameSchema.optional(),
    frozen: z.boolean().optional(),
    confirm: z.boolean().optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success || (parsed.data.name == null && parsed.data.frozen == null)) {
    return c.json({ error: "invalid_body", issues: parsed.success ? [] : parsed.error.issues }, 400);
  }

  if (parsed.data.frozen != null) {
    const settings = await getWalletAccountSettings();
    if (!settings.freezeEnabled) return c.json({ error: "freeze_off", message: "Freezing accounts is turned off." }, 403);
    if (parsed.data.frozen === false && parsed.data.confirm !== true) {
      return c.json({ error: "confirm_required", message: "Confirm to unfreeze this account." }, 400);
    }
    const stamp = parsed.data.frozen ? new Date().toISOString().slice(0, 19).replace("T", " ") : null;
    if (id === "primary") {
      if (!(await hasColumn("users", "primary_wallet_frozen_at"))) {
        return c.json({ error: "migration_pending", message: "Apply migration 0161_wallet_accounts.sql before freezing an account." }, 503);
      }
      await db.execute({
        sql: "UPDATE users SET primary_wallet_frozen_at = ?, updated_at = datetime('now') WHERE id = ?",
        args: [stamp, user.sub],
      });
    } else {
      if (!(await hasColumn("wallets", "frozen_at"))) {
        return c.json({ error: "migration_pending", message: "Apply migration 0161_wallet_accounts.sql before freezing an account." }, 503);
      }
      const res = await db.execute({
        sql: "UPDATE wallets SET frozen_at = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
        args: [stamp, id, user.sub],
      });
      if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
    }
    if (parsed.data.name == null) return c.json({ ok: true, frozen: parsed.data.frozen });
  }

  if (parsed.data.name == null) return c.json({ ok: true });
  if (id === "primary") {
    await db.execute({
      sql: "UPDATE users SET primary_wallet_name = ?, updated_at = datetime('now') WHERE id = ?",
      args: [parsed.data.name, user.sub],
    });
    return c.json({ ok: true });
  }

  const res = await db.execute({
    sql: "UPDATE wallets SET name = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
    args: [parsed.data.name, id, user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/** Only a secondary, empty (both live and sandbox balances zero) wallet
 * can be deleted — move any funds out first. Any shares on it are revoked
 * so a grantee doesn't keep pointing at a wallet that no longer exists. */
walletsRoutes.delete("/wallets/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (id === "primary") return c.json({ error: "cannot_delete_primary" }, 400);

  const res = await db.execute({ sql: "SELECT * FROM wallets WHERE id = ? AND owner_id = ?", args: [id, user.sub] });
  const wallet = res.rows[0] as Row | undefined;
  if (!wallet) return c.json({ error: "not_found" }, 404);
  if (Number(wallet.balance) !== 0 || Number(wallet.balance_sandbox) !== 0) {
    return c.json({ error: "wallet_not_empty", message: "Move any funds out of this wallet before deleting it" }, 409);
  }

  await db.execute({
    sql: "UPDATE wallet_shares SET status = 'revoked', responded_at = datetime('now') WHERE wallet_id = ? AND status IN ('pending', 'active')",
    args: [id],
  });
  await db.execute({ sql: "DELETE FROM wallets WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});

const walletRefSchema = z.string().min(1); // "primary" or a wallets.id

const transferBetweenSchema = z.object({
  fromWalletId: walletRefSchema,
  toWalletId: walletRefSchema,
  amount: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

/** Moving funds between two of your own wallets — distinct from
 * /wallet/transfer, which sends to a *different* customer. */
walletsRoutes.post("/wallets/transfer", async (c) => {
  const user = c.get("user");
  const parsed = transferBetweenSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { fromWalletId, toWalletId, amount } = parsed.data;
  if (fromWalletId === toWalletId) {
    return c.json({ error: "same_wallet", message: "Choose two different wallets" }, 400);
  }

  // Ownership check on any real (non-"primary") wallet id up front, so a
  // bad id fails clearly rather than quietly moving zero rows later.
  for (const walletId of [fromWalletId, toWalletId]) {
    if (walletId === "primary") continue;
    const owned = await db.execute({ sql: "SELECT 1 FROM wallets WHERE id = ? AND owner_id = ?", args: [walletId, user.sub] });
    if (owned.rows.length === 0) return c.json({ error: "not_found", message: "One of those wallets doesn't exist" }, 404);
  }

  const environment = await getPlatformEnvironment();
  const sourceId = fromWalletId === "primary" ? undefined : fromWalletId;
  if (await walletIsFrozen(user.sub, sourceId)) return c.json(frozenBody(), 409);
  const result = await runIdempotentTransfer(
    user.sub,
    parsed.data.idempotencyKey,
    "move",
    { toUserId: user.sub, amount, environment, note: "Between own accounts", fromWalletId: sourceId ?? null, toWalletId: toWalletId === "primary" ? null : toWalletId },
    async () => {
      const moved = await transferBetweenOwnWallets({
        ownerId: user.sub,
        fromWalletId: sourceId,
        toWalletId: toWalletId === "primary" ? undefined : toWalletId,
        amount,
        environment,
        note: "Between own accounts",
        idempotencyKey: parsed.data.idempotencyKey,
      });
      if (!moved) {
        const frozen = await walletIsFrozen(user.sub, sourceId);
        return frozen
          ? { status: 409, body: frozenBody() }
          : { status: 409, body: { error: "insufficient_balance", message: "Not enough in that account" } };
      }
      return { status: 200, body: { fromBalance: moved.fromBalance, toBalance: moved.toBalance } };
    },
  );
  return c.json(result.body, result.status as 200);
});

/** A wallet's own activity — same shape as GET /wallet's ledger, just
 * scoped to one wallet instead of always the primary. */
walletsRoutes.get("/wallets/:id/ledger", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const environment = await getPlatformEnvironment();

  if (id !== "primary") {
    const owned = await db.execute({ sql: "SELECT 1 FROM wallets WHERE id = ? AND owner_id = ?", args: [id, user.sub] });
    if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);
  }

  const ledger = await loadLedger({
    userId: user.sub,
    environment,
    walletId: id === "primary" ? null : id,
    q: c.req.query("q"),
    limit: 100,
  });
  return c.json({ ledger });
});

const REPORT_PERIODS = ["week", "month", "all"] as const;

/** Simple usage summary for one wallet — totals by ledger entry type over
 * a period, plus the net change, computed straight from wallet_ledger
 * rather than kept as a running counter (this is a read-time aggregate,
 * not something that needs to stay fast at huge scale). */
walletsRoutes.get("/wallets/:id/report", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const periodParsed = z.enum(REPORT_PERIODS).safeParse(c.req.query("period") ?? "month");
  const period = periodParsed.success ? periodParsed.data : "month";
  const environment = await getPlatformEnvironment();

  if (id !== "primary") {
    const owned = await db.execute({ sql: "SELECT 1 FROM wallets WHERE id = ? AND owner_id = ?", args: [id, user.sub] });
    if (owned.rows.length === 0) return c.json({ error: "not_found" }, 404);
  }

  const since =
    period === "week"
      ? "datetime('now', '-7 days')"
      : period === "month"
        ? "datetime('now', '-30 days')"
        : "datetime('now', '-100 years')";

  const res = await db.execute({
    sql: `SELECT type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
          FROM wallet_ledger
          WHERE user_id = ? AND environment = ? AND wallet_id ${id === "primary" ? "IS NULL" : "= ?"}
                AND created_at >= ${since}
          GROUP BY type`,
    args: id === "primary" ? [user.sub, environment] : [user.sub, environment, id],
  });

  const byType = res.rows as Row[];
  const totalIn = byType.filter((r) => Number(r.total) > 0).reduce((sum, r) => sum + Number(r.total), 0);
  const totalOut = byType.filter((r) => Number(r.total) < 0).reduce((sum, r) => sum + Math.abs(Number(r.total)), 0);

  return c.json({
    period,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    byType: byType.map((r) => ({ type: r.type, count: Number(r.count), total: Number(r.total) })),
  });
});
