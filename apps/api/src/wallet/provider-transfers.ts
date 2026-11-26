import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { hasPeebeeRole } from "../auth/roles.js";
import { db, executeBatch, requireChangedRow, type DbStatement } from "../db/client.js";
import { ensureLedgerAccount, type LedgerOwnerType } from "../ledger/service.js";
import { newId } from "../lib/ids.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import { getRiderReserveSettings, getPlatformEnvironment, getWalletAccountSettings, getSetting } from "../lib/settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getWalletCap } from "./service.js";
import { walletIsFrozen, frozenBody } from "./freeze.js";
import { personalWalletIsActive } from "./personal-wallet.js";
import { ensureProviderWorkWallet, providerWorkWalletBalance, type WorkWalletProviderType } from "./provider-work-wallet.js";

export const providerTransferRoutes = new Hono();
type Row = Record<string, unknown>;
type ProviderType = "rider" | "merchant" | "taxipress" | WorkWalletProviderType;

const transferSchema = z.object({
  providerType: z.enum(["rider", "merchant", "car", "work", "relay", "education", "service", "talent", "taxipress"]),
  providerId: z.string().trim().min(1).max(190).optional(),
  amount: z.number().int().positive().max(100_000_000),
});

function personalBalanceColumn(environment: "live" | "sandbox") {
  return environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
}

providerTransferRoutes.get("/wallet/provider-wallets", requireAuth, async (c) => {
  const user = c.get("user");
  const environment = await getPlatformEnvironment();
  const wallets: { providerType: ProviderType; providerId: string; label: string; balance: number }[] = [];
  const pushWork = async (providerType: WorkWalletProviderType, providerId: string, label: string) => {
    await ensureProviderWorkWallet(providerType, providerId, environment);
    wallets.push({ providerType, providerId, label, balance: (await providerWorkWalletBalance(providerType, providerId, environment)) ?? 0 });
  };

  if (await hasPeebeeRole(user.sub, "rider")) {
    const rider = (await db.execute({
      sql: `SELECT ${personalBalanceColumn(environment)} AS balance FROM riders WHERE user_id=?`, args: [user.sub],
    })).rows[0] as Row | undefined;
    if (rider) wallets.push({ providerType: "rider", providerId: user.sub, label: "Rider work wallet", balance: Number(rider.balance ?? 0) });
  }
  if (!(await hasPeebeeRole(user.sub, "rider")) && await hasTable("taxipress_taxis")) {
    const taxi = (await db.execute({ sql: "SELECT 1 FROM taxipress_taxis WHERE user_id=?", args: [user.sub] })).rows[0];
    const rider = (await db.execute({
      sql: `SELECT ${personalBalanceColumn(environment)} AS balance FROM riders WHERE user_id=?`, args: [user.sub],
    })).rows[0] as Row | undefined;
    if (taxi && rider) wallets.push({ providerType: "taxipress", providerId: user.sub, label: "Taxipress driver work wallet", balance: Number(rider.balance ?? 0) });
  }
  if (await hasTable("merchant_members") && await hasTable("merchant_balances")) {
    const rows = (await db.execute({
      sql: `SELECT m.id, COALESCE(NULLIF(m.display_name,''), m.legal_name, 'Merchant') AS label,
                   COALESCE(mb.available,0) AS balance
            FROM merchant_members mm JOIN merchants m ON m.id=mm.merchant_id
            LEFT JOIN merchant_balances mb ON mb.merchant_id=m.id AND mb.environment=?
            WHERE mm.user_id=? AND mm.role='owner' AND mm.status='active' AND m.status='active'`,
      args: [environment, user.sub],
    })).rows as Row[];
    for (const row of rows) wallets.push({ providerType: "merchant", providerId: String(row.id), label: String(row.label), balance: Number(row.balance ?? 0) });
  }
  if (await hasTable("provider_wallets")) {
    if (await hasTable("car_partners")) {
      const row = (await db.execute({ sql: "SELECT 1 FROM car_partners WHERE user_id=? AND (owner_status IN ('pending','approved') OR driver_status IN ('pending','approved'))", args: [user.sub] })).rows[0];
      if (row) await pushWork("car", user.sub, "Peebee Car work wallet");
    }
    if (await hasTable("work_provider_members")) {
      const rows = (await db.execute({
        sql: `SELECT p.id, COALESCE(NULLIF(p.company_name,''), p.display_name, 'Peebee Work') AS label
              FROM work_provider_members m JOIN work_providers p ON p.id=m.provider_id
              WHERE m.user_id=? AND m.role='owner' AND m.status='active' AND p.status NOT IN ('suspended','rejected')`,
        args: [user.sub],
      })).rows as Row[];
      for (const row of rows) await pushWork("work", String(row.id), String(row.label));
    }
    if (await hasTable("relay_operators")) {
      const row = (await db.execute({ sql: "SELECT 1 FROM relay_operators WHERE user_id=? AND status='approved'", args: [user.sub] })).rows[0];
      if (row) await pushWork("relay", user.sub, "Peebee Relay work wallet");
    }
    if (await hasTable("edu_schools")) {
      const rows = (await db.execute({ sql: "SELECT id, name FROM edu_schools WHERE owner_id=? AND status='active'", args: [user.sub] })).rows as Row[];
      for (const row of rows) await pushWork("education", String(row.id), String(row.name));
    }
    if (await hasTable("service_businesses")) {
      const rows = (await db.execute({ sql: "SELECT id, name FROM service_businesses WHERE owner_id=? AND status!='suspended'", args: [user.sub] })).rows as Row[];
      for (const row of rows) await pushWork("service", String(row.id), String(row.name));
    }
    if (await hasTable("talent_profiles")) {
      const row = (await db.execute({ sql: "SELECT headline FROM talent_profiles WHERE user_id=?", args: [user.sub] })).rows[0] as Row | undefined;
      if (row) await pushWork("talent", user.sub, String(row.headline || "Peebee Hire earnings"));
    }
  }
  return c.json({ wallets, environment });
});

async function findProviderSource(userId: string, providerType: ProviderType, requestedId: string | undefined, environment: "live" | "sandbox") {
  if (providerType === "rider") {
    if ((requestedId && requestedId !== userId) || !(await hasPeebeeRole(userId, "rider"))) return null;
    const rider = await db.execute({ sql: "SELECT user_id FROM riders WHERE user_id = ?", args: [userId] });
    if (!rider.rows[0]) return null;
    return { providerType, providerId: userId, ownerType: "rider" as const, purpose: "work_wallet", balanceTable: "riders" as const, balanceId: userId };
  }

  if (providerType === "taxipress") {
    if ((requestedId && requestedId !== userId) || !(await hasTable("taxipress_taxis"))) return null;
    const taxi = (await db.execute({ sql: "SELECT user_id FROM taxipress_taxis WHERE user_id=?", args: [userId] })).rows[0];
    const rider = (await db.execute({ sql: "SELECT user_id FROM riders WHERE user_id=?", args: [userId] })).rows[0];
    if (!taxi || !rider) return null;
    return { providerType, providerId: userId, ownerType: "rider" as const, purpose: "work_wallet", balanceTable: "riders" as const, balanceId: userId };
  }

  if (providerType === "merchant") {
    const merchantId = requestedId ?? "";
    if (!merchantId) return null;
    const member = (await db.execute({
      sql: `SELECT mm.role, m.status FROM merchant_members mm JOIN merchants m ON m.id=mm.merchant_id
            WHERE mm.user_id=? AND mm.merchant_id=? AND mm.status='active'`,
      args: [userId, merchantId],
    })).rows[0] as Row | undefined;
    // Business earnings can be moved only by the business owner. Finance
    // members can reconcile and withdraw to the merchant's saved destination,
    // but cannot send business funds to their own personal wallet.
    if (!member || member.role !== "owner" || member.status !== "active") return null;
    return { providerType, providerId: merchantId, ownerType: "merchant" as const, purpose: "payable_available", balanceTable: "merchant_balances" as const, balanceId: merchantId };
  }

  if (providerType === "car") {
    if ((requestedId && requestedId !== userId) || !(await hasTable("car_partners"))) return null;
    const partner = (await db.execute({
      sql: `SELECT 1 FROM car_partners WHERE user_id=? AND (owner_status IN ('pending','approved') OR driver_status IN ('pending','approved'))`,
      args: [userId],
    })).rows[0];
    if (!partner) return null;
    await ensureProviderWorkWallet("car", userId, environment);
    const available = await providerWorkWalletBalance("car", userId, environment);
    if (available === null) return null;
    return { providerType, providerId: userId, ownerType: "provider" as const, purpose: "car_work_wallet", balanceTable: "provider_wallets" as const, balanceId: userId };
  }

  if (providerType === "relay") {
    if ((requestedId && requestedId !== userId) || !(await hasTable("relay_operators"))) return null;
    const operator = (await db.execute({
      sql: "SELECT 1 FROM relay_operators WHERE user_id=? AND status='approved'",
      args: [userId],
    })).rows[0];
    if (!operator) return null;
    await ensureProviderWorkWallet("relay", userId, environment);
    const available = await providerWorkWalletBalance("relay", userId, environment);
    if (available === null) return null;
    return { providerType, providerId: userId, ownerType: "provider" as const, purpose: "relay_work_wallet", balanceTable: "provider_wallets" as const, balanceId: userId };
  }

  if (providerType === "education") {
    const providerId = requestedId ?? "";
    if (!providerId || !(await hasTable("edu_schools"))) return null;
    const school = (await db.execute({
      sql: "SELECT id FROM edu_schools WHERE id=? AND owner_id=? AND status='active'",
      args: [providerId, userId],
    })).rows[0];
    if (!school) return null;
    await ensureProviderWorkWallet("education", providerId, environment);
    return { providerType, providerId, ownerType: "provider" as const, purpose: "education_work_wallet", balanceTable: "provider_wallets" as const, balanceId: providerId };
  }

  if (providerType === "service") {
    const providerId = requestedId ?? "";
    if (!providerId || !(await hasTable("service_businesses"))) return null;
    const business = (await db.execute({
      sql: "SELECT id FROM service_businesses WHERE id=? AND owner_id=? AND status!='suspended'",
      args: [providerId, userId],
    })).rows[0];
    if (!business) return null;
    await ensureProviderWorkWallet("service", providerId, environment);
    return { providerType, providerId, ownerType: "provider" as const, purpose: "service_work_wallet", balanceTable: "provider_wallets" as const, balanceId: providerId };
  }

  if (providerType === "talent") {
    if ((requestedId && requestedId !== userId) || !(await hasTable("talent_profiles"))) return null;
    const profile = (await db.execute({ sql: "SELECT user_id FROM talent_profiles WHERE user_id=?", args: [userId] })).rows[0];
    if (!profile) return null;
    await ensureProviderWorkWallet("talent", userId, environment);
    return { providerType, providerId: userId, ownerType: "provider" as const, purpose: "talent_work_wallet", balanceTable: "provider_wallets" as const, balanceId: userId };
  }

  if (providerType !== "work") return null;
  const providerId = requestedId ?? "";
  if (!providerId || !(await hasTable("work_provider_members"))) return null;
  const member = (await db.execute({
    sql: `SELECT p.status FROM work_provider_members m JOIN work_providers p ON p.id=m.provider_id
          WHERE m.provider_id=? AND m.user_id=? AND m.role='owner' AND m.status='active'`,
    args: [providerId, userId],
  })).rows[0] as Row | undefined;
  if (!member || ["suspended", "rejected"].includes(String(member.status))) return null;
  await ensureProviderWorkWallet("work", providerId, environment);
  const available = await providerWorkWalletBalance("work", providerId, environment);
  if (available === null) return null;
  return { providerType, providerId, ownerType: "provider" as const, purpose: "work_provider_wallet", balanceTable: "provider_wallets" as const, balanceId: providerId };
}

async function currentBalance(source: NonNullable<Awaited<ReturnType<typeof findProviderSource>>>, environment: "live" | "sandbox") {
  if (source.providerType === "rider" || source.providerType === "taxipress") {
    const column = personalBalanceColumn(environment);
    const row = (await db.execute({ sql: `SELECT ${column} AS balance FROM riders WHERE user_id=?`, args: [source.balanceId] })).rows[0] as Row | undefined;
    return Number(row?.balance ?? 0);
  }
  if (source.providerType === "merchant") {
    const row = (await db.execute({ sql: "SELECT available AS balance FROM merchant_balances WHERE merchant_id=? AND environment=?", args: [source.balanceId, environment] })).rows[0] as Row | undefined;
    return Number(row?.balance ?? 0);
  }
  return (await providerWorkWalletBalance(source.providerType, source.providerId, environment)) ?? 0;
}

function sourceDebitStatement(
  source: NonNullable<Awaited<ReturnType<typeof findProviderSource>>>,
  environment: "live" | "sandbox",
  amount: number,
  userId: string,
  cap: number,
  reserveAmount: number,
  frozenColumn: boolean,
): DbStatement {
  const userBalance = personalBalanceColumn(environment);
  const recipientCanReceive = `EXISTS (SELECT 1 FROM users WHERE id=? AND ${userBalance} + ? <= ?${frozenColumn ? " AND primary_wallet_frozen_at IS NULL" : ""})`;
  if (source.providerType === "rider" || source.providerType === "taxipress") {
    const balance = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
    return {
      sql: `UPDATE riders SET ${balance}=${balance}-?, updated_at=datetime('now')
            WHERE user_id=? AND ${balance} >= ? AND ${balance}-? >= ? AND ${recipientCanReceive}`,
      args: [amount, source.balanceId, amount, amount, reserveAmount, userId, amount, cap],
    };
  }
  if (source.providerType === "merchant") {
    return {
      sql: `UPDATE merchant_balances SET available=available-?, updated_at=datetime('now')
            WHERE merchant_id=? AND environment=? AND available>=?
              AND NOT EXISTS (SELECT 1 FROM settings WHERE key='merchant_withdrawals_frozen' AND value='1')
              AND ${recipientCanReceive}`,
      args: [amount, source.balanceId, environment, amount, userId, amount, cap],
    };
  }
  return {
    sql: `UPDATE provider_wallets SET balance=balance-?, updated_at=datetime('now')
          WHERE provider_type=? AND provider_id=? AND environment=? AND balance>=? AND ${recipientCanReceive}`,
    args: [amount, source.providerType, source.providerId, environment, amount, userId, amount, cap],
  };
}

providerTransferRoutes.post("/wallet/provider-transfers", requireAuth, async (c) => {
  const user = c.get("user");
  if ((await getSetting("provider_wallet_transfers_enabled")) !== "1") {
    return c.json({ error: "provider_wallet_transfers_disabled", message: "Transfers from provider work wallets are not available right now." }, 409);
  }
  if (!(await hasTable("provider_wallet_transfers"))) {
    return c.json({ error: "provider_wallet_migration_required", message: "Apply migration 0175_provider_wallets.sql before moving provider funds to a personal wallet." }, 503);
  }
  if (!(await personalWalletIsActive(user.sub))) {
    return c.json({ error: "personal_wallet_not_active", message: "Activate your personal Peebee wallet before transferring provider funds." }, 409);
  }

  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 160) return c.json({ error: "idempotency_key_required" }, 400);
  const parsed = transferSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const requestedProviderId = parsed.data.providerId ?? user.sub;
  const prior = (await db.execute({
    sql: `SELECT * FROM provider_wallet_transfers WHERE actor_user_id=? AND idempotency_key=?`,
    args: [user.sub, idempotencyKey],
  })).rows[0] as Row | undefined;
  if (prior) {
    if (prior.provider_type !== parsed.data.providerType || prior.provider_id !== requestedProviderId || Number(prior.amount) !== parsed.data.amount) {
      return c.json({ error: "idempotency_key_reused", message: "That transfer key was already used for a different transfer." }, 409);
    }
    return c.json({ transferId: prior.id, amount: prior.amount, environment: prior.environment, replayed: true });
  }

  const environment = await getPlatformEnvironment();
  const source = await findProviderSource(user.sub, parsed.data.providerType, parsed.data.providerId, environment);
  if (!source) return c.json({ error: "provider_wallet_access_denied", message: "You do not have permission to move funds from that provider wallet." }, 403);
  if (source.providerType === "merchant" && (await getSetting("merchant_withdrawals_frozen")) === "1") {
    return c.json({ error: "merchant_withdrawals_frozen", message: "Merchant wallet transfers are temporarily paused." }, 409);
  }
  if (await walletIsFrozen(user.sub)) return c.json(frozenBody(), 409);

  const walletSettings = await getWalletAccountSettings();
  const quota = await consume(`provider-wallet-transfer:${user.sub}`, walletSettings.transferPerHour, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many wallet transfers just now. Please try again later.");
  const [{ cap }, reserve, personalBalanceRes] = await Promise.all([
    getWalletCap(user.sub), getRiderReserveSettings(),
    db.execute({ sql: `SELECT ${personalBalanceColumn(environment)} AS balance FROM users WHERE id=?`, args: [user.sub] }),
  ]);
  const personalBalance = Number((personalBalanceRes.rows[0] as Row | undefined)?.balance ?? 0);
  if (personalBalance + parsed.data.amount > cap) {
    return c.json({ error: "personal_wallet_cap_exceeded", message: "That amount would put your personal wallet over its balance limit." }, 409);
  }
  const reserveAmount = (source.providerType === "rider" || source.providerType === "taxipress") && reserve.enabled ? reserve.amount : 0;
  const available = await currentBalance(source, environment);
  if (parsed.data.amount > Math.max(0, available - reserveAmount)) {
    return c.json({ error: "insufficient_provider_wallet", available: Math.max(0, available - reserveAmount) }, 409);
  }

  const accountEnvironment = environment;
  const personalAccount = await ensureLedgerAccount({ ownerType: "customer", ownerId: user.sub, purpose: "wallet_payable", environment: accountEnvironment });
  const sourceAccount = await ensureLedgerAccount({ ownerType: source.ownerType as LedgerOwnerType, ownerId: source.providerId, purpose: source.purpose, environment: accountEnvironment });
  const transferId = newId("pwt");
  const ledgerTransactionId = newId("ltx");
  const walletLedgerId = newId("wl");
  const balanceColumn = personalBalanceColumn(environment);
  const includeWalletIdempotency = await hasColumn("wallet_ledger", "idempotency_key");
  const frozenColumn = await hasColumn("users", "primary_wallet_frozen_at");
  const providerLedgerEntry = source.providerType !== "rider" && source.providerType !== "taxipress" && source.providerType !== "merchant"
    ? {
        sql: `INSERT INTO provider_wallet_ledger
              (id, provider_type, provider_id, environment, kind, amount, balance_after,
               reference_type, reference_id, idempotency_key, actor_id, note)
              SELECT ?, ?, ?, ?, 'transfer_out', ?, balance, 'provider_wallet_transfer', ?, ?, ?, ?
              FROM provider_wallets WHERE provider_type=? AND provider_id=? AND environment=?`,
        args: [newId("pwl"), source.providerType, source.providerId, environment, -parsed.data.amount, transferId,
          `provider-transfer:${transferId}`, user.sub, "Transfer to personal wallet", source.providerType, source.providerId, environment],
      }
    : null;

  try {
    await executeBatch([
      sourceDebitStatement(source, environment, parsed.data.amount, user.sub, cap, reserveAmount, frozenColumn),
      requireChangedRow,
      ...(providerLedgerEntry ? [providerLedgerEntry] : []),
      {
        sql: `UPDATE users SET ${balanceColumn}=${balanceColumn}+?, updated_at=datetime('now')
              WHERE id=? AND ${balanceColumn}+? <= ?${frozenColumn ? " AND primary_wallet_frozen_at IS NULL" : ""}`,
        args: [parsed.data.amount, user.sub, parsed.data.amount, cap],
      },
      requireChangedRow,
      {
        sql: `INSERT INTO wallet_ledger
              (id, user_id, type, amount, balance_after, order_id, topup_id, counterparty_id, note, actor_id, environment, wallet_id${includeWalletIdempotency ? ", idempotency_key" : ""})
              SELECT ?, id, 'transfer_in', ?, ${balanceColumn}, NULL, NULL, NULL, ?, ?, ?, NULL${includeWalletIdempotency ? ", ?" : ""}
              FROM users WHERE id=?`,
        args: [walletLedgerId, parsed.data.amount, `Transfer from ${source.providerType} work wallet`, user.sub, environment,
          ...(includeWalletIdempotency ? [`provider:${transferId}`] : []), user.sub],
      },
      {
        sql: `INSERT INTO ledger_transactions
              (id, kind, idempotency_key, reference_type, reference_id, description, environment, actor_id)
              VALUES (?, 'provider_wallet_to_personal', ?, 'provider_wallet_transfer', ?, ?, ?, ?)`,
        args: [ledgerTransactionId, `provider-transfer:${transferId}`, transferId,
          `${source.providerType} work wallet to personal wallet`, environment, user.sub],
      },
      { sql: "INSERT INTO ledger_entries (id, transaction_id, account_id, amount) VALUES (?, ?, ?, ?)", args: [newId("le"), ledgerTransactionId, sourceAccount, -parsed.data.amount] },
      { sql: "INSERT INTO ledger_entries (id, transaction_id, account_id, amount) VALUES (?, ?, ?, ?)", args: [newId("le"), ledgerTransactionId, personalAccount, parsed.data.amount] },
      {
        sql: `INSERT INTO provider_wallet_transfers
              (id, actor_user_id, provider_type, provider_id, amount, environment, ledger_transaction_id, wallet_ledger_id, idempotency_key)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [transferId, user.sub, source.providerType, source.providerId, parsed.data.amount, environment, ledgerTransactionId, walletLedgerId, idempotencyKey],
      },
    ]);
  } catch (error) {
    const raced = (await db.execute({ sql: "SELECT * FROM provider_wallet_transfers WHERE actor_user_id=? AND idempotency_key=?", args: [user.sub, idempotencyKey] })).rows[0] as Row | undefined;
    if (raced && raced.provider_type === parsed.data.providerType && raced.provider_id === source.providerId && Number(raced.amount) === parsed.data.amount) {
      return c.json({ transferId: raced.id, amount: raced.amount, environment: raced.environment, replayed: true });
    }
    const latest = await currentBalance(source, environment);
    if (latest < parsed.data.amount + reserveAmount) {
      return c.json({ error: "insufficient_provider_wallet", available: Math.max(0, latest - reserveAmount) }, 409);
    }
    if (await walletIsFrozen(user.sub)) return c.json(frozenBody(), 409);
    const freshPersonal = await db.execute({ sql: `SELECT ${balanceColumn} AS balance FROM users WHERE id=?`, args: [user.sub] });
    if (Number((freshPersonal.rows[0] as Row | undefined)?.balance ?? 0) + parsed.data.amount > cap) {
      return c.json({ error: "personal_wallet_cap_exceeded", message: "That amount would put your personal wallet over its balance limit." }, 409);
    }
    throw error;
  }

  const [providerBalance, personal] = await Promise.all([
    currentBalance(source, environment),
    db.execute({ sql: `SELECT ${balanceColumn} AS balance FROM users WHERE id=?`, args: [user.sub] }),
  ]);
  return c.json({
    transferId,
    amount: parsed.data.amount,
    providerType: source.providerType,
    providerId: source.providerId,
    providerBalance,
    personalBalance: Number((personal.rows[0] as Row | undefined)?.balance ?? 0),
    environment,
  }, 201);
});
