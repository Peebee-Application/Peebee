import { db } from "../db/client.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { creditWallet } from "./service.js";
import type { PlatformEnvironment } from "../lib/settings.js";

type Row = Record<string, unknown>;

export type TransferIntent = {
  toUserId: string;
  amount: number;
  environment: PlatformEnvironment;
  note?: string;
  toWalletId?: string | null;
  fromWalletId?: string | null;
};

type Stored = { status: number; body: unknown };

/**
 * One idempotency key, one transfer. A retry after a timeout replays the
 * stored result. A crash after the debit but before the credit is finished
 * from the ledger instead of sending the money again.
 *
 * When the table is not there yet, the caller just runs the transfer (the
 * old behaviour). The guarantee starts once migration 0161 is applied.
 */
export async function runIdempotentTransfer(
  userId: string,
  key: string | undefined,
  kind: string,
  intent: TransferIntent,
  run: () => Promise<Stored>,
): Promise<Stored & { replay?: boolean }> {
  const trimmed = key?.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 80) return run();
  if (!(await hasTable("wallet_idempotency"))) return run();

  const inserted = await db.execute({
    sql: `INSERT INTO wallet_idempotency (user_id, idem_key, kind, status, intent_json)
          VALUES (?, ?, ?, 'pending', ?)
          ON CONFLICT(user_id, idem_key) DO NOTHING`,
    args: [userId, trimmed, kind, JSON.stringify(intent)],
  });

  if ((inserted.rowsAffected ?? 0) === 0) {
    const existing = await db.execute({
      sql: "SELECT status, http_status, body_json, intent_json, created_at FROM wallet_idempotency WHERE user_id = ? AND idem_key = ?",
      args: [userId, trimmed],
    });
    const row = existing.rows[0] as Row | undefined;
    if (!row) return run();
    if (row.status === "done" && row.body_json) {
      return { status: Number(row.http_status ?? 200), body: JSON.parse(String(row.body_json)), replay: true };
    }
    const ageMs = Date.now() - new Date(`${String(row.created_at).replace(" ", "T")}Z`).getTime();
    if (ageMs < 20_000) {
      return { status: 409, body: { error: "transfer_in_progress", message: "That transfer is still finishing. Wait a moment, then try the same send again." } };
    }
    const recovered = await recover(userId, trimmed, parseIntent(row.intent_json) ?? intent);
    if (recovered) return { ...recovered, replay: true };
    await db.execute({ sql: "DELETE FROM wallet_idempotency WHERE user_id = ? AND idem_key = ? AND status = 'pending'", args: [userId, trimmed] });
    return runIdempotentTransfer(userId, trimmed, kind, intent, run);
  }

  try {
    const result = await run();
    if (result.status >= 200 && result.status < 300) {
      await db.execute({
        sql: "UPDATE wallet_idempotency SET status = 'done', http_status = ?, body_json = ? WHERE user_id = ? AND idem_key = ?",
        args: [result.status, JSON.stringify(result.body), userId, trimmed],
      });
    } else {
      // A clear refusal (not enough money, frozen, unknown person) must not
      // lock the key. The same send can be tried again after it is fixed.
      await db.execute({
        sql: "DELETE FROM wallet_idempotency WHERE user_id = ? AND idem_key = ? AND status = 'pending'",
        args: [userId, trimmed],
      });
    }
    return result;
  } catch (err) {
    await db.execute({
      sql: "DELETE FROM wallet_idempotency WHERE user_id = ? AND idem_key = ? AND status = 'pending'",
      args: [userId, trimmed],
    }).catch(() => undefined);
    throw err;
  }
}

function parseIntent(value: unknown): TransferIntent | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as TransferIntent;
    if (!parsed?.toUserId || !parsed.amount) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Finish a transfer whose debit landed and whose reply was lost. */
async function recover(userId: string, key: string, intent: TransferIntent): Promise<Stored | null> {
  if (!(await hasColumn("wallet_ledger", "idempotency_key"))) return null;
  const out = await db.execute({
    sql: `SELECT balance_after FROM wallet_ledger
          WHERE user_id = ? AND idempotency_key = ? AND type = 'transfer_out' AND environment = ?
          ORDER BY created_at DESC LIMIT 1`,
    args: [userId, key, intent.environment],
  });
  const debit = out.rows[0] as Row | undefined;
  if (!debit) return null;

  const inn = await db.execute({
    sql: `SELECT 1 FROM wallet_ledger WHERE user_id = ? AND idempotency_key = ? AND type = 'transfer_in' LIMIT 1`,
    args: [intent.toUserId, key],
  });
  if (inn.rows.length === 0) {
    await creditWallet(intent.toUserId, intent.amount, {
      type: "transfer_in",
      environment: intent.environment,
      counterpartyId: userId,
      note: intent.note,
      walletId: intent.toWalletId || undefined,
      idempotencyKey: key,
    });
  }
  const nameRes = await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [intent.toUserId] });
  const body = {
    balance: Number(debit.balance_after ?? 0),
    recipientName: String((nameRes.rows[0] as Row | undefined)?.name ?? ""),
    replay: true,
  };
  await db.execute({
    sql: "UPDATE wallet_idempotency SET status = 'done', http_status = 200, body_json = ? WHERE user_id = ? AND idem_key = ?",
    args: [JSON.stringify(body), userId, key],
  });
  return { status: 200, body };
}
