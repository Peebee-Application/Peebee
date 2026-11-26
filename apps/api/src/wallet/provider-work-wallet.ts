import { db, executeBatch, requireChangedRow, type DbStatement } from "../db/client.js";
import { hasTable } from "../lib/schema.js";
import { newId } from "../lib/ids.js";
import type { PlatformEnvironment } from "../lib/settings.js";
import { creditWallet, debitWallet, debitWalletAllowNegative } from "./service.js";

export type WorkWalletProviderType = "car" | "work" | "relay" | "education" | "service" | "talent";
type Row = Record<string, unknown>;

export async function ensureProviderWorkWallet(
  providerType: WorkWalletProviderType,
  providerId: string,
  environment: PlatformEnvironment,
): Promise<void> {
  if (!(await hasTable("provider_wallets"))) return;
  await db.execute({
    sql: `INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
          VALUES (?, ?, ?)`,
    args: [providerType, providerId, environment],
  });
}

export async function providerWorkWalletBalance(
  providerType: WorkWalletProviderType,
  providerId: string,
  environment: PlatformEnvironment,
): Promise<number | null> {
  if (!(await hasTable("provider_wallets"))) return null;
  const result = await db.execute({
    sql: `SELECT balance FROM provider_wallets WHERE provider_type = ? AND provider_id = ? AND environment = ?`,
    args: [providerType, providerId, environment],
  });
  return Number((result.rows[0] as Row | undefined)?.balance ?? 0);
}

/** Append a provider-wallet credit to a caller's atomic ledger batch. */
export async function providerWalletCreditStatements(input: {
  providerType: WorkWalletProviderType;
  providerId: string;
  amount: number;
  environment: PlatformEnvironment;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  actorId?: string;
  note?: string;
}): Promise<DbStatement[] | null> {
  if (!(await hasTable("provider_wallets")) || !(await hasTable("provider_wallet_ledger"))) return null;
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Provider wallet credits must be positive whole UGX amounts");
  const entryId = newId("pwl");
  return [
    {
      sql: `INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
            VALUES (?, ?, ?)`,
      args: [input.providerType, input.providerId, input.environment],
    },
    {
      sql: `UPDATE provider_wallets SET balance=balance+?, updated_at=datetime('now')
            WHERE provider_type=? AND provider_id=? AND environment=?`,
      args: [input.amount, input.providerType, input.providerId, input.environment],
    },
    requireChangedRow,
    {
      sql: `INSERT INTO provider_wallet_ledger
            (id, provider_type, provider_id, environment, kind, amount, balance_after,
             reference_type, reference_id, idempotency_key, actor_id, note)
            SELECT ?, ?, ?, ?, 'earning', ?, balance, ?, ?, ?, ?, ? FROM provider_wallets
            WHERE provider_type=? AND provider_id=? AND environment=?`,
      args: [entryId, input.providerType, input.providerId, input.environment, input.amount,
        input.referenceType ?? null, input.referenceId ?? null, input.idempotencyKey, input.actorId ?? null,
        input.note ?? null, input.providerType, input.providerId, input.environment],
    },
  ];
}

/** Append a balance-checked provider-wallet debit to a caller's atomic batch. */
export async function providerWalletDebitStatements(input: {
  providerType: WorkWalletProviderType;
  providerId: string;
  amount: number;
  environment: PlatformEnvironment;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  actorId?: string;
  note?: string;
}): Promise<DbStatement[] | null> {
  if (!(await hasTable("provider_wallets")) || !(await hasTable("provider_wallet_ledger"))) return null;
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Provider wallet debits must be positive whole UGX amounts");
  const entryId = newId("pwl");
  return [
    {
      sql: `UPDATE provider_wallets SET balance=balance-?, updated_at=datetime('now')
            WHERE provider_type=? AND provider_id=? AND environment=? AND balance>=?`,
      args: [input.amount, input.providerType, input.providerId, input.environment, input.amount],
    },
    requireChangedRow,
    {
      sql: `INSERT INTO provider_wallet_ledger
            (id, provider_type, provider_id, environment, kind, amount, balance_after,
             reference_type, reference_id, idempotency_key, actor_id, note)
            SELECT ?, ?, ?, ?, 'adjustment', ?, balance, ?, ?, ?, ?, ? FROM provider_wallets
            WHERE provider_type=? AND provider_id=? AND environment=?`,
      args: [entryId, input.providerType, input.providerId, input.environment, -input.amount,
        input.referenceType ?? null, input.referenceId ?? null, input.idempotencyKey, input.actorId ?? null,
        input.note ?? null, input.providerType, input.providerId, input.environment],
    },
  ];
}

/**
 * Credits a provider's work wallet. Before migration 0175 lands, preserves
 * the previous wallet behavior so a deploy cannot lose a provider payout.
 */
export async function creditProviderWorkWallet(input: {
  providerType: WorkWalletProviderType;
  providerId: string;
  amount: number;
  environment: PlatformEnvironment;
  kind?: "earning" | "withdrawal_return" | "adjustment";
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
  actorId?: string;
  note?: string;
  legacyUserId?: string;
}): Promise<number> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Provider wallet credits must be positive whole UGX amounts");
  if (!(await hasTable("provider_wallets"))) {
    if (!input.legacyUserId) throw new Error("Provider wallet migration is required");
    return creditWallet(input.legacyUserId, input.amount, {
      type: "adjustment",
      environment: input.environment,
      actorId: input.actorId,
      note: input.note ?? "Provider work earnings",
      idempotencyKey: input.idempotencyKey,
    });
  }

  const entryId = newId("pwl");
  const statements = [
    {
      sql: `INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
            VALUES (?, ?, ?)`,
      args: [input.providerType, input.providerId, input.environment],
    },
    {
      sql: `UPDATE provider_wallets SET balance = balance + ?, updated_at = datetime('now')
            WHERE provider_type = ? AND provider_id = ? AND environment = ?`,
      args: [input.amount, input.providerType, input.providerId, input.environment],
    },
    requireChangedRow,
    {
      sql: `INSERT INTO provider_wallet_ledger
            (id, provider_type, provider_id, environment, kind, amount, balance_after,
             reference_type, reference_id, idempotency_key, actor_id, note)
            SELECT ?, ?, ?, ?, ?, ?, balance, ?, ?, ?, ?, ?
            FROM provider_wallets WHERE provider_type = ? AND provider_id = ? AND environment = ?`,
      args: [entryId, input.providerType, input.providerId, input.environment, input.kind ?? "earning", input.amount,
        input.referenceType ?? null, input.referenceId ?? null, input.idempotencyKey, input.actorId ?? null,
        input.note ?? null, input.providerType, input.providerId, input.environment],
    },
  ];
  try {
    await executeBatch(statements);
  } catch (error) {
    const prior = await db.execute({
      sql: `SELECT id FROM provider_wallet_ledger
            WHERE provider_type = ? AND provider_id = ? AND environment = ? AND idempotency_key = ?`,
      args: [input.providerType, input.providerId, input.environment, input.idempotencyKey],
    });
    if (!prior.rows[0]) throw error;
  }
  return (await providerWorkWalletBalance(input.providerType, input.providerId, input.environment)) ?? 0;
}

/** Debits work funds only when the same provider wallet still covers them. */
export async function debitProviderWorkWallet(input: {
  providerType: WorkWalletProviderType;
  providerId: string;
  amount: number;
  environment: PlatformEnvironment;
  kind: "withdrawal" | "transfer_out" | "adjustment";
  /** Car cash commissions may create a work-wallet debt, netted by later earnings. */
  allowNegative?: boolean;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
  legacyUserId?: string;
  actorId?: string;
  note?: string;
}): Promise<number | null> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Provider wallet debits must be positive whole UGX amounts");
  if (!(await hasTable("provider_wallets"))) {
    if (!input.legacyUserId) return null;
    if (input.allowNegative) return debitWalletAllowNegative(input.legacyUserId, input.amount, {
      type: "adjustment", environment: input.environment, actorId: input.actorId,
      note: input.note ?? "Provider work expense",
      allowInactivePersonalWallet: true,
    });
    return debitWallet(input.legacyUserId, input.amount, {
      type: "adjustment",
      environment: input.environment,
      actorId: input.actorId,
      note: input.note ?? "Provider work expense",
      idempotencyKey: input.idempotencyKey,
      allowInactivePersonalWallet: true,
    });
  }
  await ensureProviderWorkWallet(input.providerType, input.providerId, input.environment);
  const current = await providerWorkWalletBalance(input.providerType, input.providerId, input.environment);
  if (current === null || (!input.allowNegative && current < input.amount)) return null;

  const entryId = newId("pwl");
  try {
    await executeBatch([
      {
        sql: `UPDATE provider_wallets SET balance = balance - ?, updated_at = datetime('now')
              WHERE provider_type = ? AND provider_id = ? AND environment = ?${input.allowNegative ? "" : " AND balance >= ?"}`,
        args: [input.amount, input.providerType, input.providerId, input.environment, ...(!input.allowNegative ? [input.amount] : [])],
      },
      requireChangedRow,
      {
        sql: `INSERT INTO provider_wallet_ledger
              (id, provider_type, provider_id, environment, kind, amount, balance_after,
               reference_type, reference_id, idempotency_key, actor_id, note)
              SELECT ?, ?, ?, ?, ?, ?, balance, ?, ?, ?, ?, ?
              FROM provider_wallets WHERE provider_type = ? AND provider_id = ? AND environment = ?`,
        args: [entryId, input.providerType, input.providerId, input.environment, input.kind, -input.amount,
          input.referenceType ?? null, input.referenceId ?? null, input.idempotencyKey, input.actorId ?? null,
          input.note ?? null, input.providerType, input.providerId, input.environment],
      },
    ]);
  } catch (error) {
    const prior = await db.execute({
      sql: `SELECT id FROM provider_wallet_ledger
            WHERE provider_type = ? AND provider_id = ? AND environment = ? AND idempotency_key = ?`,
      args: [input.providerType, input.providerId, input.environment, input.idempotencyKey],
    });
    if (prior.rows[0]) return (await providerWorkWalletBalance(input.providerType, input.providerId, input.environment)) ?? 0;
    const latest = await providerWorkWalletBalance(input.providerType, input.providerId, input.environment);
    if (!input.allowNegative && latest !== null && latest < input.amount) return null;
    throw error;
  }
  return (await providerWorkWalletBalance(input.providerType, input.providerId, input.environment)) ?? 0;
}
