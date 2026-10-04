import { db, executeBatch, type DbStatement } from "../db/client.js";
import { newId } from "../lib/ids.js";
import type { PlatformEnvironment } from "../lib/settings.js";

type Row = Record<string, unknown>;

export type LedgerOwnerType = "platform" | "customer" | "order" | "merchant" | "rider" | "provider";

export type LedgerAccountRef = {
  ownerType: LedgerOwnerType;
  ownerId: string;
  purpose: string;
  currency?: string;
  environment: PlatformEnvironment;
};

export type LedgerPosting = LedgerAccountRef & { amount: number };

export type PostLedgerInput = {
  kind: string;
  idempotencyKey: string;
  environment: PlatformEnvironment;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  actorId?: string;
  reversalOf?: string;
  postings: LedgerPosting[];
  /** State/cache changes that must commit with the ledger entries. */
  additionalStatements?: DbStatement[];
};

function accountId(ref: LedgerAccountRef): string {
  return `la_${ref.environment}_${ref.ownerType}_${ref.ownerId}_${ref.purpose}_${ref.currency ?? "UGX"}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 190);
}

export async function ensureLedgerAccount(ref: LedgerAccountRef): Promise<string> {
  // The platform is one owner. Reuse its existing account across brand
  // changes so new postings and reversals keep the same ledger history.
  if (ref.ownerType === "platform") {
    const existing = await db.execute({
      sql: `SELECT id FROM ledger_accounts
            WHERE owner_type = 'platform' AND purpose = ? AND currency = ? AND environment = ?
            ORDER BY created_at, id LIMIT 1`,
      args: [ref.purpose, ref.currency ?? "UGX", ref.environment],
    });
    if (existing.rows[0]) return String((existing.rows[0] as Row).id);
  }
  const id = accountId(ref);
  await db.execute({
    sql: `INSERT OR IGNORE INTO ledger_accounts
          (id, owner_type, owner_id, purpose, currency, environment)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, ref.ownerType, ref.ownerId, ref.purpose, ref.currency ?? "UGX", ref.environment],
  });
  return id;
}

export async function postLedgerTransaction(input: PostLedgerInput): Promise<{ id: string; duplicate: boolean }> {
  if (input.postings.length < 2) throw new Error("A ledger transaction needs at least two postings");
  if (input.postings.some((posting) => !Number.isSafeInteger(posting.amount) || posting.amount === 0)) {
    throw new Error("Ledger amounts must be non-zero integer minor units");
  }
  if (input.postings.some((posting) => posting.environment !== input.environment)) {
    throw new Error("A ledger transaction cannot cross environments");
  }
  const sum = input.postings.reduce((total, posting) => total + posting.amount, 0);
  if (sum !== 0) throw new Error(`Unbalanced ledger transaction: ${sum}`);

  const existing = await db.execute({
    sql: "SELECT id FROM ledger_transactions WHERE environment = ? AND idempotency_key = ?",
    args: [input.environment, input.idempotencyKey],
  });
  if (existing.rows[0]) return { id: String((existing.rows[0] as Row).id), duplicate: true };

  const accounts = await Promise.all(input.postings.map(ensureLedgerAccount));
  const transactionId = newId("ltx");
  const statements: DbStatement[] = [
    {
      sql: `INSERT INTO ledger_transactions
            (id, kind, idempotency_key, reference_type, reference_id, description, environment, reversal_of, actor_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        transactionId,
        input.kind,
        input.idempotencyKey,
        input.referenceType ?? null,
        input.referenceId ?? null,
        input.description ?? null,
        input.environment,
        input.reversalOf ?? null,
        input.actorId ?? null,
      ],
    },
    ...input.postings.map((posting, index) => ({
      sql: "INSERT INTO ledger_entries (id, transaction_id, account_id, amount) VALUES (?, ?, ?, ?)",
      args: [newId("le"), transactionId, accounts[index], posting.amount],
    })),
    ...(input.additionalStatements ?? []),
  ];

  try {
    await executeBatch(statements);
    return { id: transactionId, duplicate: false };
  } catch (error) {
    // A racing retry may have won the unique idempotency key. Return that
    // transaction rather than turning a safe retry into a visible failure.
    const raced = await db.execute({
      sql: "SELECT id FROM ledger_transactions WHERE environment = ? AND idempotency_key = ?",
      args: [input.environment, input.idempotencyKey],
    });
    if (raced.rows[0]) return { id: String((raced.rows[0] as Row).id), duplicate: true };
    throw error;
  }
}

export async function reverseLedgerTransaction(input: {
  transactionId: string;
  idempotencyKey: string;
  actorId?: string;
}): Promise<{ id: string; duplicate: boolean }> {
  const transaction = await db.execute({
    sql: "SELECT * FROM ledger_transactions WHERE id = ?",
    args: [input.transactionId],
  });
  const row = transaction.rows[0] as Row | undefined;
  if (!row) throw new Error("Ledger transaction not found");
  const entries = await db.execute({
    sql: `SELECT e.amount, a.owner_type, a.owner_id, a.purpose, a.currency, a.environment
          FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
          WHERE e.transaction_id = ?`,
    args: [input.transactionId],
  });
  return postLedgerTransaction({
    kind: `reversal:${String(row.kind)}`,
    idempotencyKey: input.idempotencyKey,
    environment: row.environment as PlatformEnvironment,
    referenceType: row.reference_type ? String(row.reference_type) : undefined,
    referenceId: row.reference_id ? String(row.reference_id) : undefined,
    description: `Reversal of ${input.transactionId}`,
    reversalOf: input.transactionId,
    actorId: input.actorId,
    postings: entries.rows.map((entry) => ({
      ownerType: entry.owner_type as LedgerOwnerType,
      ownerId: String(entry.owner_id),
      purpose: String(entry.purpose),
      currency: String(entry.currency),
      environment: entry.environment as PlatformEnvironment,
      amount: -Number(entry.amount),
    })),
  });
}

export async function ledgerBalance(ref: LedgerAccountRef): Promise<number> {
  const result = await db.execute({
    sql: `SELECT COALESCE(SUM(e.amount), 0) AS balance
          FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
          WHERE a.owner_type = ? AND (? = 'platform' OR a.owner_id = ?) AND a.purpose = ?
            AND a.currency = ? AND a.environment = ?`,
    args: [ref.ownerType, ref.ownerType, ref.ownerId, ref.purpose, ref.currency ?? "UGX", ref.environment],
  });
  return Number((result.rows[0] as Row | undefined)?.balance ?? 0);
}

export async function assertLedgerBalanced(transactionId: string): Promise<boolean> {
  const result = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE transaction_id = ?",
    args: [transactionId],
  });
  return Number((result.rows[0] as Row | undefined)?.total ?? 0) === 0;
}
