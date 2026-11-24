/**
 * Customer wallet ledger — the one place balance actually moves, so every
 * credit/debit is both applied to users.wallet_balance and recorded in
 * wallet_ledger in the same call. The running balance is a cache; the
 * ledger is the source of truth an admin (or a support dispute) can always
 * reconstruct it from.
 */

import { db,executeBatch,type DbStatement } from "../db/client.js";
import { newId } from "../lib/ids.js";
import type { CreditModule } from "@peebee/shared";
import { creditPaidForOrder, grantCredit, payWithCreditAndCash } from "../offers/credit.js";
import { hasColumn,hasTable } from "../lib/schema.js";
import { getWalletSettings, type PlatformEnvironment } from "../lib/settings.js";
import { scheduleMoneyAlert } from "./alerts.js";
import { walletIsFrozen } from "./freeze.js";

type Row = Record<string, unknown>;

export type LedgerType = "topup" | "order_payment" | "refund" | "adjustment" | "transfer_out" | "transfer_in";

/** `users.wallet_balance` is the live column (unrenamed, so every
 * pre-sandbox caller keeps working); `wallet_balance_sandbox` is its
 * counterpart — see migrations/0030_sandbox_live_state.sql. Every
 * credit/debit in this file requires an explicit environment rather than
 * defaulting to one, so a caller can't accidentally move real money on a
 * sandbox action or vice versa. */
function balanceColumn(environment: PlatformEnvironment): "wallet_balance" | "wallet_balance_sandbox" {
  return environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
}

export async function getWalletCap(userId: string): Promise<{ cap: number; verified: boolean }> {
  const res = await db.execute({
    sql: "SELECT phone_verified_at, email_verified_at FROM users WHERE id = ?",
    args: [userId],
  });
  const row = res.rows[0] as Row | undefined;
  const verified = !!(row?.phone_verified_at || row?.email_verified_at);
  const settings = await getWalletSettings();
  return { cap: verified ? settings.verifiedCap : settings.unverifiedCap, verified };
}

async function recordLedgerEntry(input: {
  userId: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  environment: PlatformEnvironment;
  orderId?: string;
  topupId?: string;
  counterpartyId?: string;
  note?: string;
  actorId?: string;
  walletId?: string;
  idempotencyKey?: string;
}): Promise<void> {
  const withKey = !!input.idempotencyKey && (await hasColumn("wallet_ledger", "idempotency_key"));
  await db.execute({
    sql: withKey
      ? `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, order_id, topup_id, counterparty_id, note, actor_id, environment, wallet_id, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      : `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, order_id, topup_id, counterparty_id, note, actor_id, environment, wallet_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId("wl"),
      input.userId,
      input.type,
      input.amount,
      input.balanceAfter,
      input.orderId ?? null,
      input.topupId ?? null,
      input.counterpartyId ?? null,
      input.note ?? null,
      input.actorId ?? null,
      input.environment,
      input.walletId ?? null,
      ...(withKey ? [input.idempotencyKey ?? null] : []),
    ],
  });
}

/** Always succeeds (crediting has no failure mode besides a DB error) —
 * returns the balance afterward. Omit `walletId` for the customer's
 * original/primary wallet (users.wallet_balance); pass one of their
 * secondary wallets' ids (see ../db/migrations/0045_multi_wallet.sql) to
 * credit that one instead. */
export async function creditWallet(
  userId: string,
  amount: number,
  info: {
    type: LedgerType;
    environment: PlatformEnvironment;
    orderId?: string;
    topupId?: string;
    counterpartyId?: string;
    note?: string;
    actorId?: string;
    walletId?: string;
    idempotencyKey?: string;
  },
): Promise<number> {
  const column = balanceColumn(info.environment);
  let balance: number;
  if (info.walletId) {
    const walletColumn = column === "wallet_balance_sandbox" ? "balance_sandbox" : "balance";
    await db.execute({
      sql: `UPDATE wallets SET ${walletColumn} = ${walletColumn} + ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`,
      args: [amount, info.walletId, userId],
    });
    const res = await db.execute({ sql: `SELECT ${walletColumn} as balance FROM wallets WHERE id = ?`, args: [info.walletId] });
    balance = Number((res.rows[0] as Row)?.balance ?? 0);
  } else {
    await db.execute({
      sql: `UPDATE users SET ${column} = ${column} + ?, updated_at = datetime('now') WHERE id = ?`,
      args: [amount, userId],
    });
    const res = await db.execute({ sql: `SELECT ${column} as balance FROM users WHERE id = ?`, args: [userId] });
    balance = Number((res.rows[0] as Row)?.balance ?? 0);
  }
  await recordLedgerEntry({ userId, amount, balanceAfter: balance, ...info });
  return balance;
}

/**
 * Debits iff the balance covers it — the WHERE clause makes the check and
 * the write atomic in one statement, so two requests racing to spend the
 * same balance can't both succeed (the loser's UPDATE simply matches zero
 * rows). Returns the balance afterward, or null if there wasn't enough.
 * Same `walletId` convention as creditWallet.
 */
export async function debitWallet(
  userId: string,
  amount: number,
  info: {
    type: LedgerType;
    environment: PlatformEnvironment;
    orderId?: string;
    counterpartyId?: string;
    note?: string;
    actorId?: string;
    walletId?: string;
    idempotencyKey?: string;
  },
): Promise<number | null> {
  const balance = await applyDebit(userId, amount, info.environment, info.walletId);
  if (balance === null) return null;
  await recordLedgerEntry({ userId, amount: -amount, balanceAfter: balance, ...info });
  return balance;
}

/**
 * Takes money the platform is owed from a wallet even when the balance does not cover it: the balance
 * goes below zero, and the next payment into that wallet nets against it. For a cash commission, where the
 * driver already holds the cash and Peebee is collecting its cut. Returns the balance afterward.
 * Never use this for money a person is spending.
 */
export async function debitWalletAllowNegative(
  userId: string,
  amount: number,
  info: { type: LedgerType; environment: PlatformEnvironment; orderId?: string; note?: string; actorId?: string },
): Promise<number> {
  const column = balanceColumn(info.environment);
  await db.execute({ sql: `UPDATE users SET ${column} = ${column} - ?, updated_at = datetime('now') WHERE id = ?`, args: [amount, userId] });
  const res = await db.execute({ sql: `SELECT ${column} as balance FROM users WHERE id = ?`, args: [userId] });
  const balance = Number((res.rows[0] as Row)?.balance ?? 0);
  await recordLedgerEntry({ userId, amount: -amount, balanceAfter: balance, ...info });
  return balance;
}

/** The atomic balance check-and-subtract shared by every debit; returns the balance afterward, or null if it did not cover `amount`. */
async function applyDebit(userId: string, amount: number, environment: PlatformEnvironment, walletId?: string): Promise<number | null> {
  if (await walletIsFrozen(userId, walletId)) return null;
  const column = balanceColumn(environment);
  if (walletId) {
    const walletColumn = column === "wallet_balance_sandbox" ? "balance_sandbox" : "balance";
    const res = await db.execute({
      sql: `UPDATE wallets SET ${walletColumn} = ${walletColumn} - ?, updated_at = datetime('now')
            WHERE id = ? AND owner_id = ? AND ${walletColumn} >= ?`,
      args: [amount, walletId, userId, amount],
    });
    if ((res.rowsAffected ?? 0) === 0) return null;
    const balanceRes = await db.execute({ sql: `SELECT ${walletColumn} as balance FROM wallets WHERE id = ?`, args: [walletId] });
    return Number((balanceRes.rows[0] as Row)?.balance ?? 0);
  }
  const res = await db.execute({
    sql: `UPDATE users SET ${column} = ${column} - ?, updated_at = datetime('now') WHERE id = ? AND ${column} >= ?`,
    args: [amount, userId, amount],
  });
  if ((res.rowsAffected ?? 0) === 0) return null;
  const balanceRes = await db.execute({ sql: `SELECT ${column} as balance FROM users WHERE id = ?`, args: [userId] });
  return Number((balanceRes.rows[0] as Row)?.balance ?? 0);
}

/**
 * Pays for an order directly out of the customer's wallet — debits the
 * ledger and, in the same call, inserts a `payments` row exactly like a
 * successful mobile money collection would (provider "wallet", already
 * `status = 'successful'` since there's no external gateway round trip to
 * wait on). That's what lets this slot into the existing escrow/settle
 * accounting — POST /orders/:id/settle sums successful collections
 * regardless of provider, so a wallet-funded order pays the rider out the
 * same way an escrow one does, with no changes needed there.
 *
 * `actorId` is who actually triggered the payment when that's someone
 * other than the wallet owner — a grantee spending from a wallet shared
 * with them (see wallet_shares). Omitted (left null) for an ordinary
 * self-payment, so the ledger only needs an attribution line when there's
 * actually someone else to attribute it to.
 *
 * Returns the new payments.id, or null if the balance was insufficient.
 */
export async function payFromWallet(input: {
  userId: string;
  amount: number;
  orderId: string;
  environment: PlatformEnvironment;
  note?: string;
  actorId?: string;
  walletId?: string;
}): Promise<string | null> {
  if (await walletIsFrozen(input.userId, input.walletId)) return null;
  const balance = await debitWallet(input.userId, input.amount, {
    type: "order_payment",
    environment: input.environment,
    orderId: input.orderId,
    note: input.note,
    actorId: input.actorId,
    walletId: input.walletId,
  });
  if (balance === null) return null;

  const paymentId = newId("pay");
  await db.execute({
    sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, amount, currency, status)
          VALUES (?, ?, 'collection', 'wallet', NULL, ?, 'UGX', 'successful')`,
    args: [paymentId, input.orderId, input.amount],
  });
  return paymentId;
}

/**
 * Like payFromWallet, but the customer's wallet credit (bonuses, cashback) pays first or second under the admin rules,
 * where credit is allowed for this kind of order. Credit never leaves the platform, so it is only used from the customer's
 * own wallet, never from a shared or secondary one. The payment row records the whole amount, so everything downstream
 * (settlement, refunds) sees what the order was paid. Returns the payment id, or null if the wallet could not cover it.
 */
export async function payFromWalletWithCredit(input: {
  userId: string;
  amount: number;
  orderId: string;
  environment: PlatformEnvironment;
  note?: string;
  actorId?: string;
  walletId?: string;
  creditModule: CreditModule;
  partnerId?: string | null;
}): Promise<string | null> {
  if (await walletIsFrozen(input.userId, input.walletId)) return null;
  const column = balanceColumn(input.environment);
  const cashRes = await db.execute({ sql: `SELECT ${column} AS balance FROM users WHERE id = ?`, args: [input.userId] });
  const paid = await payWithCreditAndCash({
    userId: input.userId,
    amount: input.amount,
    env: input.environment,
    orderId: input.orderId,
    module: input.creditModule,
    partnerId: input.partnerId,
    cashBalance: Number((cashRes.rows[0] as Row | undefined)?.balance ?? 0),
    creditEligible: !input.walletId && !input.actorId,
    payCash: async (cash) =>
      (await debitWallet(input.userId, cash, { type: "order_payment", environment: input.environment, orderId: input.orderId, note: input.note, actorId: input.actorId, walletId: input.walletId })) !== null,
  });
  if (!paid) return null;
  const paymentId = newId("pay");
  await db.execute({
    sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, amount, currency, status)
          VALUES (?, ?, 'collection', 'wallet', NULL, ?, 'UGX', 'successful')`,
    args: [paymentId, input.orderId, input.amount],
  });
  return paymentId;
}

/**
 * One wallet payment that covers several orders (a combined delivery with two
 * pickups). The wallet is debited once for the total, then each order gets its
 * own ledger line and its own successful collection row, so every later
 * per-order step (settlement, merchant holds, refunds, cancellation) sees
 * exactly what that order was paid. Returns the payment ids in `parts` order,
 * or null if the balance did not cover the total (nothing is changed then).
 */
export async function payBundleFromWallet(input: {
  atomic?:boolean;
  userId: string;
  parts: Array<{ orderId: string; amount: number }>;
  environment: PlatformEnvironment;
  note?: string;
  actorId?: string;
  walletId?: string;
}): Promise<string[] | null> {
  if (await walletIsFrozen(input.userId, input.walletId)) return null;
  const total = input.parts.reduce((sum, part) => sum + part.amount, 0);
  if(input.atomic){
    if(!input.parts.length||input.parts.some(p=>!Number.isSafeInteger(p.amount)||p.amount<=0))throw new Error('Invalid bundle payment amounts');
    const column=input.walletId?(input.environment==='sandbox'?'balance_sandbox':'balance'):balanceColumn(input.environment);
    const table=input.walletId?'wallets':'users',where=input.walletId?'id = ? AND owner_id = ?':'id = ?',who=input.walletId?[input.walletId,input.userId]:[input.userId];
    const paymentIds=input.parts.map(()=>newId('pay')),ledgerIds=input.parts.map(()=>newId('wl'));
    const statements:DbStatement[]=[{sql:`UPDATE ${table} SET ${column} = ${column} - ?,updated_at=datetime('now') WHERE ${where} AND ${column} >= ?`,args:[total,...who,total]}];
    let through=0;
    for(const [i,part]of input.parts.entries()){
      through+=part.amount;
      statements.push({sql:`INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,order_id,note,actor_id,environment,wallet_id)
        SELECT ?,?,'order_payment',?,${column}+?,?,?, ?,?,? FROM ${table} WHERE ${where} AND ${i===0?'changes() = 1':'EXISTS (SELECT 1 FROM wallet_ledger WHERE id = ?)'} `,
        args:[ledgerIds[i],input.userId,-part.amount,total-through,part.orderId,input.note??null,input.actorId??null,input.environment,input.walletId??null,...who,...(i===0?[]:[ledgerIds[0]])]});
      statements.push({sql:"INSERT INTO payments(id,order_id,type,provider,amount,currency,status) SELECT ?,?,'collection','wallet',?,'UGX','successful' WHERE EXISTS (SELECT 1 FROM wallet_ledger WHERE id = ?)",args:[paymentIds[i],part.orderId,part.amount,ledgerIds[0]]});
    }
    const changed=await executeBatch(statements);
    return changed[0]?paymentIds:null;
  }
  const balanceAfter = await applyDebit(input.userId, total, input.environment, input.walletId);
  if (balanceAfter === null) return null;
  let running = balanceAfter + total;
  const paymentIds: string[] = [];
  for (const part of input.parts) {
    running -= part.amount;
    await recordLedgerEntry({
      userId: input.userId,
      type: "order_payment",
      amount: -part.amount,
      balanceAfter: running,
      environment: input.environment,
      orderId: part.orderId,
      note: input.note,
      actorId: input.actorId,
      walletId: input.walletId,
    });
    const paymentId = newId("pay");
    await db.execute({
      sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, amount, currency, status)
            VALUES (?, ?, 'collection', 'wallet', NULL, ?, 'UGX', 'successful')`,
      args: [paymentId, part.orderId, part.amount],
    });
    paymentIds.push(paymentId);
  }
  return paymentIds;
}

/**
 * Returns money for an order to a customer's wallet. The part that was paid with wallet credit goes back as credit (never
 * as withdrawable cash); the rest goes back as cash. Returns the cash balance afterward.
 */
export async function refundToWallet(
  userId: string,
  amount: number,
  info: { orderId: string; environment: PlatformEnvironment; note?: string; actorId?: string },
): Promise<number> {
  // Sponsored refunds are allocated atomically by the payment-refund trigger.
  // The caller has already recorded its successful refund payment. Never pay
  // corporate credit or a voucher to the traveller as withdrawable cash.
  if (await hasTable('travel_charges') && (await db.execute({sql:'SELECT 1 FROM travel_charges WHERE order_id=?',args:[info.orderId]})).rows.length) {
    return Number((await db.execute({sql:`SELECT ${balanceColumn(info.environment)} AS balance FROM users WHERE id=?`,args:[userId]})).rows[0]?.balance ?? 0);
  }
  const creditBack = Math.min(amount, await creditPaidForOrder(info.orderId).catch(() => 0));
  const cashBack = amount - creditBack;
  if (creditBack > 0) await grantCredit({ userId, amount: creditBack, kind: "refund", env: info.environment, orderId: info.orderId, note: info.note ?? "Order refund (credit)" });
  if (cashBack > 0) return creditWallet(userId, cashBack, { type: "refund", environment: info.environment, orderId: info.orderId, note: info.note ?? "Order refund", actorId: info.actorId });
  const res = await db.execute({ sql: `SELECT ${balanceColumn(info.environment)} AS balance FROM users WHERE id = ?`, args: [userId] });
  return Number((res.rows[0] as Row | undefined)?.balance ?? 0);
}

/**
 * Admin-issued refund of an order's collected payment(s) back to the
 * customer's wallet — the confirmed shape for "refunds from cancelled
 * orders return to the wallet" without a full self-service cancellation
 * flow (which doesn't exist in the app yet; this is a deliberate scope
 * boundary, see the wallet feature's design notes). Refunds at most what
 * was actually collected for the order, and only once.
 */
export async function refundOrderToWallet(input: {
  orderId: string;
  customerId: string;
  actorId: string;
  /** The order's own environment — the refund always lands in the same
   * balance the original collection would have paid out of, regardless of
   * whatever's currently active. */
  environment: PlatformEnvironment;
  note?: string;
}): Promise<{ refunded: number } | { error: "nothing_to_refund" | "already_refunded" }> {
  const [collectedRes, refundedRes] = await Promise.all([
    db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id = ? AND type = 'collection' AND status = 'successful'",
      args: [input.orderId],
    }),
    db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id = ? AND type = 'refund' AND status = 'successful'",
      args: [input.orderId],
    }),
  ]);
  const collected = Number((collectedRes.rows[0] as Row)?.total ?? 0);
  const alreadyRefunded = Number((refundedRes.rows[0] as Row)?.total ?? 0);
  const refundable = collected - alreadyRefunded;
  if (collected === 0) return { error: "nothing_to_refund" };
  if (refundable <= 0) return { error: "already_refunded" };

  await db.execute({
    sql: `INSERT INTO payments (id, order_id, type, provider, provider_ref, amount, currency, status)
          VALUES (?, ?, 'refund', 'wallet', NULL, ?, 'UGX', 'successful')`,
    args: [newId("pay"), input.orderId, refundable],
  });
  await refundToWallet(input.customerId, refundable, { orderId: input.orderId, environment: input.environment, note: input.note, actorId: input.actorId });
  return { refunded: refundable };
}

/** Finds an active customer by exact phone or email match — used to
 * resolve who a transfer or a wallet-share invite is for. Exact match
 * only (not LIKE): this is a money-moving lookup, not a search box, so
 * it shouldn't return anyone other than exactly who was typed. */
export async function resolveCustomerByIdentifier(identifier: string): Promise<{ id: string; name: string } | null> {
  const value = identifier.trim();
  if (!value) return null;
  const res = await db.execute({
    sql: "SELECT id, name FROM users WHERE role = 'customer' AND status = 'active' AND (phone = ? OR lower(email) = lower(?)) LIMIT 1",
    args: [value, value],
  });
  const row = res.rows[0] as Row | undefined;
  if (!row) return null;
  return { id: row.id as string, name: row.name as string };
}

/**
 * Moves money directly from one customer's wallet into another's — still
 * closed-loop (it never leaves to mobile money), just a wallet-to-wallet
 * move instead of wallet-to-order. Debit-then-credit as two separate
 * statements rather than one DB transaction (the `db` client here doesn't
 * expose one) — the same residual-risk shape payFromWallet already
 * accepts for debit-then-insert-payment: wallet_ledger is always
 * reconstructable/auditable if the two ever needed reconciling.
 *
 * Returns both balances afterward, or null if the sender's balance was
 * insufficient. Caller is responsible for checking the recipient's cap
 * beforehand (this only enforces the sender has the funds).
 */
export async function transferWallet(input: {
  fromUserId: string;
  toUserId: string;
  amount: number;
  environment: PlatformEnvironment;
  note?: string;
  /** Omitted means the sender's original (Main) account. */
  fromWalletId?: string;
  /** Omitted means the recipient's original (Main) account. Money in is allowed even when that account is frozen. */
  toWalletId?: string;
  /** Set when the sender is spending an account someone shared with them. */
  actorId?: string;
  idempotencyKey?: string;
}): Promise<{ fromBalance: number; toBalance: number } | null> {
  const fromBalance = await debitWallet(input.fromUserId, input.amount, {
    type: "transfer_out",
    environment: input.environment,
    counterpartyId: input.toUserId,
    note: input.note,
    walletId: input.fromWalletId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
  });
  if (fromBalance === null) return null;

  const toBalance = await creditWallet(input.toUserId, input.amount, {
    type: "transfer_in",
    environment: input.environment,
    counterpartyId: input.fromUserId,
    note: input.note,
    walletId: input.toWalletId,
    idempotencyKey: input.idempotencyKey,
  });
  if (input.fromUserId !== input.toUserId) {
    scheduleMoneyAlert({
      transferId: input.idempotencyKey ? `transfer:${input.fromUserId}:${input.idempotencyKey}` : newId("xfer"),
      amount: input.amount,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      context: input.note,
    });
  }
  return { fromBalance, toBalance };
}

/**
 * Moves money between two of the SAME customer's own wallets — e.g. their
 * primary wallet and a named secondary one, or two secondary wallets.
 * `fromWalletId`/`toWalletId` omitted means the primary wallet; both can't
 * resolve to the same wallet. Debit-then-credit, same residual-risk shape
 * as transferWallet above.
 */
export async function transferBetweenOwnWallets(input: {
  ownerId: string;
  fromWalletId?: string;
  toWalletId?: string;
  amount: number;
  environment: PlatformEnvironment;
  note?: string;
  idempotencyKey?: string;
}): Promise<{ fromBalance: number; toBalance: number } | null> {
  const fromBalance = await debitWallet(input.ownerId, input.amount, {
    type: "transfer_out",
    environment: input.environment,
    counterpartyId: input.ownerId,
    note: input.note,
    walletId: input.fromWalletId,
    idempotencyKey: input.idempotencyKey,
  });
  if (fromBalance === null) return null;

  const toBalance = await creditWallet(input.ownerId, input.amount, {
    type: "transfer_in",
    environment: input.environment,
    counterpartyId: input.ownerId,
    note: input.note,
    walletId: input.toWalletId,
    idempotencyKey: input.idempotencyKey,
  });
  return { fromBalance, toBalance };
}
