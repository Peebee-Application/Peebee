import { normalizeUgandaMsisdn, detectMobileMoneyNetwork, type ChannelsConfig } from "@peebee/shared";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getPlatformEnvironment, type PlatformEnvironment } from "../lib/settings.js";
import { checkPaymentStatus, initiateDisbursement, paymentProviderErrorResponse, UnsupportedNetworkError } from "../payments/service.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { creditWallet } from "../wallet/service.js";
import { ChannelsError, requireChannels, type Row } from "./common.js";
import { KYC_PREFIX } from "./media.js";
import { creatorBalance, debitCreator, postCreatorDebit, restoreCreator } from "./money.js";
import { settleAdShare } from "./rewards.js";

/**
 * Verification is asked for in one place only: when someone wants to take cash out. Opening a channel,
 * posting, earning and spending inside Peebee never need it. One approved check covers every kind of
 * withdrawal (earnings, rewards, cause funds).
 */
export type KycStatus = "none" | "pending" | "approved" | "rejected" | "expired";

const maskId = (n: string) => (n.length <= 3 ? "***" : `${"*".repeat(Math.max(0, n.length - 3))}${n.slice(-3)}`);

export function ageOn(dob: string, now = new Date()): number | null {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

function expired(cfg: ChannelsConfig, reviewedAt: unknown): boolean {
  if (cfg.kyc.reverifyDays <= 0 || !reviewedAt) return false;
  return Date.now() > new Date(`${String(reviewedAt).replace(" ", "T")}Z`).getTime() + cfg.kyc.reverifyDays * 86_400_000;
}

export async function kycState(userId: string, cfg: ChannelsConfig) {
  const row = (await db.execute({ sql: "SELECT * FROM creator_kyc WHERE user_id = ?", args: [userId] })).rows[0] as Row | undefined;
  let status: KycStatus = "none";
  if (row) status = row.status === "approved" && expired(cfg, row.reviewed_at) ? "expired" : (row.status as KycStatus);
  return {
    status,
    required: cfg.kyc.required,
    fullName: row ? String(row.full_name) : null,
    idType: row ? String(row.id_type) : null,
    idNumberMasked: row ? maskId(String(row.id_number)) : null,
    reviewNotes: row && row.status === "rejected" ? (row.review_notes as string | null) : null,
    submittedAt: row ? String(row.submitted_at) : null,
    reviewedAt: row ? ((row.reviewed_at as string | null) ?? null) : null,
    rules: { idTypes: cfg.kyc.idTypes, requireSelfie: cfg.kyc.requireSelfie, requireIdBack: cfg.kyc.requireIdBack, minAge: cfg.kyc.minAgeToWithdraw, maxDocumentMb: cfg.kyc.maxDocumentMb },
  };
}

export type KycInput = { fullName: string; idType: string; idNumber: string; dateOfBirth: string; idFrontKey: string; idBackKey?: string | null; selfieKey?: string | null };

export async function submitKyc(userId: string, input: KycInput) {
  const cfg = await requireChannels();
  if (!cfg.kyc.withdrawalsEnabled && !cfg.kyc.required) throw new ChannelsError("kyc_unavailable", "Verification is not needed right now.", 400);
  const current = await kycState(userId, cfg);
  if (current.status === "approved") throw new ChannelsError("already_verified", "You are already verified.", 409);
  if (!cfg.kyc.idTypes.includes(input.idType)) throw new ChannelsError("invalid_id_type", "That kind of ID is not accepted.", 400);
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  if (fullName.split(" ").length < 2 || fullName.length > 80) throw new ChannelsError("invalid_name", "Enter your full name as it appears on your ID.", 400);
  const idNumber = input.idNumber.trim().toUpperCase();
  if (!/^[A-Z0-9-]{5,30}$/.test(idNumber)) throw new ChannelsError("invalid_id_number", "Check the ID number.", 400);
  const age = ageOn(input.dateOfBirth);
  if (age === null || age > 120) throw new ChannelsError("invalid_dob", "Check the date of birth.", 400);
  if (age < cfg.kyc.minAgeToWithdraw) throw new ChannelsError("underage", `You must be at least ${cfg.kyc.minAgeToWithdraw} to withdraw.`, 403);
  const own = (k: string | null | undefined) => !!k && k.startsWith(`${KYC_PREFIX}${userId}/`) && !k.includes("..");
  if (!own(input.idFrontKey)) throw new ChannelsError("front_required", "Add a photo of the front of your ID.", 400);
  if (cfg.kyc.requireIdBack && !own(input.idBackKey)) throw new ChannelsError("back_required", "Add a photo of the back of your ID.", 400);
  if (cfg.kyc.requireSelfie && !own(input.selfieKey)) throw new ChannelsError("selfie_required", "Add a selfie.", 400);
  if (input.idBackKey && !own(input.idBackKey)) throw new ChannelsError("invalid_document", "That document is not yours.", 400);
  if (input.selfieKey && !own(input.selfieKey)) throw new ChannelsError("invalid_document", "That document is not yours.", 400);

  await db.execute({
    sql: `INSERT INTO creator_kyc (user_id, full_name, id_type, id_number, date_of_birth, id_front_key, id_back_key, selfie_key, status, review_notes, reviewed_by, reviewed_at, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET full_name = excluded.full_name, id_type = excluded.id_type, id_number = excluded.id_number, date_of_birth = excluded.date_of_birth,
            id_front_key = excluded.id_front_key, id_back_key = excluded.id_back_key, selfie_key = excluded.selfie_key, status = 'pending', review_notes = NULL,
            reviewed_by = NULL, reviewed_at = NULL, submitted_at = datetime('now'), updated_at = datetime('now')`,
    args: [userId, fullName, input.idType, idNumber, input.dateOfBirth, input.idFrontKey, input.idBackKey ?? null, input.selfieKey ?? null],
  });
  return kycState(userId, cfg);
}

export async function reviewKyc(userId: string, decision: "approve" | "reject", reviewerId: string, notes?: string) {
  const row = (await db.execute({ sql: "SELECT status FROM creator_kyc WHERE user_id = ?", args: [userId] })).rows[0] as Row | undefined;
  if (!row) throw new ChannelsError("not_found", "No verification found.", 404);
  if (decision === "reject" && !notes?.trim()) throw new ChannelsError("reason_required", "Say why it was rejected so the person can fix it.", 400);
  await db.execute({
    sql: "UPDATE creator_kyc SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?",
    args: [decision === "approve" ? "approved" : "rejected", notes?.trim().slice(0, 300) || null, reviewerId, userId],
  });
}

// -------------------------------------------------------------- payout accounts

const nameTokens = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);

/** The mobile money account name must be the person's verified name (at least two names in common, or all of a short one). */
export function namesMatch(accountName: string, verifiedName: string): boolean {
  const a = nameTokens(accountName);
  const b = new Set(nameTokens(verifiedName));
  if (!a.length || !b.size) return false;
  const shared = a.filter((t) => b.has(t)).length;
  return shared >= Math.min(2, a.length, b.size);
}

export async function listPayoutAccounts(userId: string) {
  const rows = (await db.execute({ sql: "SELECT * FROM creator_payout_accounts WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC", args: [userId] })).rows as Row[];
  return rows.map((r) => ({ id: String(r.id), type: String(r.type), network: (r.network as string) ?? null, accountMasked: `${"*".repeat(6)}${String(r.account_ref).slice(-3)}`, accountName: String(r.account_name), createdAt: String(r.created_at) }));
}

export async function addPayoutAccount(userId: string, input: { msisdn: string; accountName: string }) {
  await requireChannels();
  const msisdn = normalizeUgandaMsisdn(input.msisdn);
  const network = msisdn ? detectMobileMoneyNetwork(msisdn) : null;
  if (!msisdn || !network) throw new ChannelsError("invalid_number", "Enter an MTN or Airtel mobile money number.", 400);
  const name = input.accountName.trim().replace(/\s+/g, " ").slice(0, 80);
  if (name.split(" ").length < 2) throw new ChannelsError("invalid_name", "Enter the name registered on the mobile money account.", 400);
  const existing = (await db.execute({ sql: "SELECT id FROM creator_payout_accounts WHERE user_id = ? AND account_ref = ? AND status = 'active'", args: [userId, msisdn] })).rows[0] as Row | undefined;
  if (existing) throw new ChannelsError("duplicate", "That account is already added.", 409);
  const count = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM creator_payout_accounts WHERE user_id = ? AND status = 'active'", args: [userId] })).rows[0] as Row).n);
  if (count >= 5) throw new ChannelsError("too_many_accounts", "You can keep up to 5 payout accounts.", 400);
  const id = newId("pya");
  await db.execute({ sql: "INSERT INTO creator_payout_accounts (id, user_id, type, network, account_ref, account_name) VALUES (?, ?, 'momo', ?, ?, ?)", args: [id, userId, network, msisdn, name] });
  return (await listPayoutAccounts(userId)).find((a) => a.id === id)!;
}

export async function removePayoutAccount(userId: string, id: string) {
  await db.execute({ sql: "UPDATE creator_payout_accounts SET status = 'disabled' WHERE id = ? AND user_id = ?", args: [id, userId] });
}

// -------------------------------------------------------------------- withdrawals

async function withdrawnSince(userId: string, since: string): Promise<number> {
  const row = (await db.execute({ sql: "SELECT COALESCE(SUM(amount_ugx), 0) AS n FROM creator_withdrawals WHERE user_id = ? AND status != 'failed' AND created_at >= " + since, args: [userId] })).rows[0] as Row;
  return Number(row.n);
}

export async function withdrawalOverview(userId: string) {
  const cfg = await requireChannels();
  await settleAdShare(userId).catch((e) => console.error("ad share settle failed:", e));
  const bal = await creatorBalance(userId);
  const kyc = await kycState(userId, cfg);
  const [today, month] = await Promise.all([withdrawnSince(userId, "date('now')"), withdrawnSince(userId, "date('now', 'start of month')")]);
  const recent = (await db.execute({ sql: "SELECT id, amount_ugx, status, network, created_at FROM creator_withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", args: [userId] })).rows as Row[];
  return {
    enabled: cfg.kyc.withdrawalsEnabled,
    availableUgx: bal.availableUgx,
    lifetimeUgx: bal.lifetimeUgx,
    kyc,
    accounts: await listPayoutAccounts(userId),
    limits: { minUgx: cfg.kyc.minWithdrawUgx, maxUgx: cfg.kyc.maxWithdrawUgx, dailyCapUgx: cfg.kyc.dailyCapUgx, monthlyCapUgx: cfg.kyc.monthlyCapUgx, withdrawnTodayUgx: today, withdrawnThisMonthUgx: month, accountCooldownDays: cfg.kyc.payoutAccountCooldownDays },
    canMoveToWallet: cfg.monetization.earningsToWalletEnabled,
    recent: recent.map((r) => ({ id: String(r.id), amountUgx: Number(r.amount_ugx), status: String(r.status), network: (r.network as string) ?? null, createdAt: String(r.created_at) })),
  };
}

export async function withdraw(userId: string, input: { amountUgx: number; payoutAccountId: string }) {
  const cfg = await requireChannels();
  if (!cfg.kyc.withdrawalsEnabled) throw new ChannelsError("withdrawals_unavailable", "Withdrawals are not available yet. Your earnings are safe and keep adding up.", 503);

  const kyc = await kycState(userId, cfg);
  if (cfg.kyc.required && kyc.status !== "approved") {
    throw new ChannelsError("kyc_required", kyc.status === "pending" ? "Your verification is being reviewed." : "Verify your identity to withdraw.", 403, { kycStatus: kyc.status });
  }
  await settleAdShare(userId).catch((e) => console.error("ad share settle failed:", e));

  const amount = Math.round(input.amountUgx);
  if (!Number.isSafeInteger(amount) || amount < cfg.kyc.minWithdrawUgx) throw new ChannelsError("below_minimum", `The smallest withdrawal is UGX ${cfg.kyc.minWithdrawUgx.toLocaleString()}.`, 400);
  if (amount > cfg.kyc.maxWithdrawUgx) throw new ChannelsError("above_maximum", `The largest single withdrawal is UGX ${cfg.kyc.maxWithdrawUgx.toLocaleString()}.`, 400);
  if (cfg.kyc.dailyCapUgx > 0 && (await withdrawnSince(userId, "date('now')")) + amount > cfg.kyc.dailyCapUgx) throw new ChannelsError("daily_cap", "That is over today's withdrawal limit.", 409);
  if (cfg.kyc.monthlyCapUgx > 0 && (await withdrawnSince(userId, "date('now', 'start of month')")) + amount > cfg.kyc.monthlyCapUgx) throw new ChannelsError("monthly_cap", "That is over this month's withdrawal limit.", 409);

  const account = (await db.execute({ sql: "SELECT * FROM creator_payout_accounts WHERE id = ? AND user_id = ? AND status = 'active'", args: [input.payoutAccountId, userId] })).rows[0] as Row | undefined;
  if (!account) throw new ChannelsError("account_required", "Choose a payout account.", 400);
  if (cfg.kyc.payoutAccountCooldownDays > 0) {
    const ready = new Date(`${String(account.created_at).replace(" ", "T")}Z`).getTime() + cfg.kyc.payoutAccountCooldownDays * 86_400_000;
    if (Date.now() < ready) throw new ChannelsError("account_cooling_off", `A new payout account can be used from ${new Date(ready).toDateString()}.`, 409);
  }
  if (cfg.kyc.required && kyc.fullName && !namesMatch(String(account.account_name), kyc.fullName)) {
    throw new ChannelsError("name_mismatch", "The payout account name must match your verified name.", 409);
  }

  const env = await getPlatformEnvironment();
  // Take the money first (atomically), pay out second; give it back if the payout cannot start.
  if (!(await debitCreator(userId, amount, env))) throw new ChannelsError("insufficient_balance", "You do not have that much to withdraw.", 409);
  const withdrawalId = newId("cwd");
  await postCreatorDebit({ userId, amountUgx: amount, purpose: "creator_payouts", key: `wd:${withdrawalId}`, environment: env, note: "Creator withdrawal" });
  try {
    const started = await initiateDisbursement({ referenceId: withdrawalId, msisdn: String(account.account_ref), amount, forceMock: env === "sandbox", narrative: "Peebee creator payout" });
    await db.execute({
      sql: "INSERT INTO creator_withdrawals (id, user_id, amount_ugx, payout_account_id, provider, provider_ref, msisdn, network, status, environment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      args: [withdrawalId, userId, amount, String(account.id), started.provider, started.providerRef, String(account.account_ref), started.network, env],
    });
  } catch (err) {
    await undoWithdrawal(userId, withdrawalId, amount, env);
    if (err instanceof UnsupportedNetworkError) throw new ChannelsError("unsupported_network", err.message, 400);
    const shaped = paymentProviderErrorResponse(err, "Could not reach mobile money. Your balance was not changed.");
    throw new ChannelsError(shaped.error, shaped.message, 502);
  }
  return { withdrawalId, amountUgx: amount, status: "pending" as const };
}

/** Gives a failed payout back to the creator's balance (both the cache and the ledger). Safe to repeat. */
async function undoWithdrawal(userId: string, withdrawalId: string, amount: number, env: PlatformEnvironment) {
  await restoreCreator(userId, amount, env);
  await postLedgerTransaction({
    kind: "creator:payout_failed",
    idempotencyKey: `creator-debit:wd-undo:${withdrawalId}`,
    environment: env,
    referenceType: "creator_debit",
    referenceId: withdrawalId,
    postings: [
      { ownerType: "customer", ownerId: userId, purpose: "creator_earnings", environment: env, amount },
      { ownerType: "platform", ownerId: "platform", purpose: "creator_payouts", environment: env, amount: -amount },
    ],
  });
}

export async function refreshWithdrawal(userId: string, id: string) {
  const w = (await db.execute({ sql: "SELECT * FROM creator_withdrawals WHERE id = ? AND user_id = ?", args: [id, userId] })).rows[0] as Row | undefined;
  if (!w) throw new ChannelsError("not_found", "Withdrawal not found.", 404);
  if (w.status !== "pending") return { id, status: String(w.status) };
  const status = await checkPaymentStatus({ provider: String(w.provider), provider_ref: (w.provider_ref as string) ?? null, created_at: String(w.created_at), type: "disbursement" });
  if (status === "successful") {
    await db.execute({ sql: "UPDATE creator_withdrawals SET status = 'successful', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    return { id, status: "successful" };
  }
  if (status === "failed") {
    const moved = await db.execute({ sql: "UPDATE creator_withdrawals SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    if (moved.rowsAffected) await undoWithdrawal(userId, id, Number(w.amount_ugx), String(w.environment) as PlatformEnvironment);
    return { id, status: "failed" };
  }
  return { id, status: "pending" };
}

/** Earnings can always be spent inside Peebee. This moves them to the person's wallet without an ID check. */
export async function moveToWallet(userId: string, amountUgx: number) {
  const cfg = await requireChannels();
  if (!cfg.monetization.earningsToWalletEnabled) throw new ChannelsError("unavailable", "Moving earnings to your wallet is not available.", 503);
  await settleAdShare(userId).catch((e) => console.error("ad share settle failed:", e));
  const amount = Math.round(amountUgx);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new ChannelsError("invalid_amount", "Enter an amount.", 400);
  const env = await getPlatformEnvironment();
  if (!(await debitCreator(userId, amount, env))) throw new ChannelsError("insufficient_balance", "You do not have that much.", 409);
  const key = newId("mtw");
  try {
    await postCreatorDebit({ userId, amountUgx: amount, purpose: "creator_to_wallet", key, environment: env, note: "Moved to wallet" });
    const balance = await creditWallet(userId, amount, { type: "transfer_in", environment: env, note: "Channel earnings" });
    return { walletBalanceUgx: balance, movedUgx: amount };
  } catch (err) {
    await restoreCreator(userId, amount, env);
    throw err;
  }
}
