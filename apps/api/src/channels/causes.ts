import { randomBytes } from "node:crypto";
import { normalizeUgandaMsisdn, type ChannelsConfig } from "@peebee/shared";
import { db, type DbStatement } from "../db/client.js";
import { postLedgerTransaction, reverseLedgerTransaction } from "../ledger/service.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment, type PlatformEnvironment } from "../lib/settings.js";
import { checkPaymentStatus, initiateCollection, initiateDisbursement, paymentProviderErrorResponse, UnsupportedNetworkError } from "../payments/service.js";
import { walletIsFrozen } from "../wallet/freeze.js";
import { scheduleMoneyAlert } from "../wallet/alerts.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { absUrl, addDays, ChannelsError, requireChannels, sqlTime, type Row } from "./common.js";
import { getChannelById, getMyChannel } from "./channels.js";
import { kycState } from "./kyc.js";
import { ownMediaPath } from "./media.js";
import { creditCreator } from "./money.js";

/**
 * Causes: fundraising pages with a goal and a deadline. A cause is public only after staff approve it.
 * Donations (from signed-in people or guests on the public link) are held in a ledger account for the
 * cause and released to the creator, who must be verified before taking any of it out.
 */

export async function requireCauses(): Promise<ChannelsConfig> {
  const cfg = await requireChannels();
  if (!cfg.causes.enabled) throw new ChannelsError("causes_unavailable", "Fundraising is not available yet.", 503);
  for (const t of ["causes", "donations", "cause_updates", "creator_balances"] as const) {
    if (!(await hasTable(t))) throw new ChannelsError("causes_unavailable", "Fundraising is not available yet.", 503);
  }
  return cfg;
}

const escrowPurpose = (causeId: string) => `cause_escrow:${causeId}`;

function slugify(title: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "cause";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export type CauseRow = Row & {
  id: string; channel_id: string; owner_id: string; slug: string; title: string; story: string; goal_ugx: number; raised_ugx: number; released_ugx: number;
  status: string; ends_at: string; funding_mode: string; environment: string;
};

export async function getCauseById(id: string): Promise<CauseRow | null> {
  return ((await db.execute({ sql: "SELECT * FROM causes WHERE id = ?", args: [id] })).rows[0] as unknown as CauseRow | undefined) ?? null;
}
export async function getCauseBySlug(slug: string): Promise<CauseRow | null> {
  return ((await db.execute({ sql: "SELECT * FROM causes WHERE slug = ?", args: [slug] })).rows[0] as unknown as CauseRow | undefined) ?? null;
}

export type CauseInput = { title: string; story: string; coverPath?: string | null; beneficiary?: string; goalUgx: number; days: number; fundingMode?: string };

function checkCause(input: CauseInput, cfg: ChannelsConfig) {
  const title = input.title.trim();
  const story = input.story.trim();
  if (title.length < 5 || title.length > 100) throw new ChannelsError("invalid_title", "Give the cause a title of 5 to 100 characters.", 400);
  if (story.length < 30 || story.length > 5000) throw new ChannelsError("invalid_story", "Tell the story in 30 to 5,000 characters.", 400);
  const goal = Math.round(input.goalUgx);
  if (goal < cfg.causes.minGoalUgx || goal > cfg.causes.maxGoalUgx) throw new ChannelsError("invalid_goal", `The goal must be between UGX ${cfg.causes.minGoalUgx.toLocaleString()} and UGX ${cfg.causes.maxGoalUgx.toLocaleString()}.`, 400);
  const days = Math.round(input.days);
  if (days < cfg.causes.minDays || days > cfg.causes.maxDays) throw new ChannelsError("invalid_days", `A cause runs for ${cfg.causes.minDays} to ${cfg.causes.maxDays} days.`, 400);
  let mode = input.fundingMode ?? cfg.causes.defaultFundingMode;
  if (mode !== "keep" && mode !== "all_or_nothing") mode = cfg.causes.defaultFundingMode;
  if (mode === "all_or_nothing" && !cfg.causes.allowAllOrNothing) mode = "keep";
  return { title, story, goal, days, mode };
}

export async function createCause(userId: string, input: CauseInput): Promise<CauseRow> {
  const cfg = await requireCauses();
  const channel = await getMyChannel(userId);
  if (!channel || channel.status !== "active") throw new ChannelsError("no_channel", "Open a channel first.", 404);
  const v = checkCause(input, cfg);
  const active = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM causes WHERE channel_id = ? AND status IN ('draft', 'submitted', 'live')", args: [channel.id] })).rows[0] as Row).n);
  if (active >= cfg.causes.maxActivePerChannel) throw new ChannelsError("too_many_causes", `You can have up to ${cfg.causes.maxActivePerChannel} causes open at once.`, 400);
  const id = newId("cau");
  await db.execute({
    sql: `INSERT INTO causes (id, channel_id, owner_id, slug, title, story, cover_url, beneficiary, goal_ugx, ends_at, funding_mode, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, channel.id, userId, slugify(v.title), v.title, v.story, ownMediaPath(input.coverPath), input.beneficiary?.trim().slice(0, 120) || null, v.goal, sqlTime(addDays(new Date(), v.days)), v.mode, await getPlatformEnvironment()],
  });
  return (await getCauseById(id))!;
}

export async function updateCause(userId: string, causeId: string, input: Partial<CauseInput>): Promise<CauseRow> {
  const cfg = await requireCauses();
  const cause = await getCauseById(causeId);
  if (!cause || cause.owner_id !== userId) throw new ChannelsError("not_found", "Cause not found.", 404);
  if (!["draft", "rejected", "submitted", "live"].includes(cause.status)) throw new ChannelsError("locked", "This cause can no longer be edited.", 409);

  const baseDate = new Date(`${String(cause.published_at ?? cause.created_at).replace(" ", "T")}Z`);
  const endsAtSql = input.days !== undefined ? sqlTime(addDays(baseDate, Math.round(input.days))) : null;
  const check = checkCause({
    title: input.title ?? cause.title, story: input.story ?? cause.story, goalUgx: input.goalUgx ?? cause.goal_ugx,
    days: input.days ?? cfg.causes.minDays, fundingMode: input.fundingMode ?? cause.funding_mode,
  }, cfg);
  if (cause.status === "live" && check.goal < Number(cause.raised_ugx)) throw new ChannelsError("goal_below_raised", "The goal cannot be lower than what is already raised.", 400);
  if (cause.status === "live" && input.fundingMode !== undefined && check.mode !== cause.funding_mode) throw new ChannelsError("mode_locked", "The funding mode cannot change once a cause is live.", 409);

  const material = check.title !== cause.title || check.story !== cause.story || check.goal !== Number(cause.goal_ugx) || (input.beneficiary !== undefined && (input.beneficiary.trim() || null) !== (cause.beneficiary ?? null)) || endsAtSql !== null;
  const backToReview = cause.status === "live" && material && cfg.causes.reviewEditsAfterApproval && cfg.causes.requireApproval;
  await db.execute({
    sql: `UPDATE causes SET title = ?, story = ?, goal_ugx = ?, beneficiary = ?, cover_url = ?, ends_at = ?, funding_mode = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [
      check.title, check.story, check.goal, input.beneficiary !== undefined ? input.beneficiary.trim().slice(0, 120) || null : (cause.beneficiary as string | null),
      input.coverPath !== undefined ? ownMediaPath(input.coverPath) : (cause.cover_url as string | null), endsAtSql ?? cause.ends_at, check.mode,
      backToReview ? "submitted" : cause.status, causeId,
    ],
  });
  return (await getCauseById(causeId))!;
}

/** Sends a draft for approval (or, when approval is switched off, straight live). */
export async function submitCause(userId: string, causeId: string): Promise<CauseRow> {
  const cfg = await requireCauses();
  const cause = await getCauseById(causeId);
  if (!cause || cause.owner_id !== userId) throw new ChannelsError("not_found", "Cause not found.", 404);
  if (!["draft", "rejected"].includes(cause.status)) throw new ChannelsError("already_submitted", "This cause has already been sent.", 409);
  if (cfg.causes.requireApproval) {
    await db.execute({ sql: "UPDATE causes SET status = 'submitted', rejection_reason = NULL, updated_at = datetime('now') WHERE id = ?", args: [causeId] });
    return (await getCauseById(causeId))!;
  }
  return goLive(cause, cfg, null);
}

async function goLive(cause: CauseRow, cfg: ChannelsConfig, reviewerId: string | null): Promise<CauseRow> {
  if (cfg.causes.requireKycAboveGoalUgx > 0 && Number(cause.goal_ugx) > cfg.causes.requireKycAboveGoalUgx) {
    const kyc = await kycState(cause.owner_id, cfg);
    if (kyc.status !== "approved") {
      throw new ChannelsError("kyc_required_for_goal", `Causes above UGX ${cfg.causes.requireKycAboveGoalUgx.toLocaleString()} need the creator to be verified before they go live.`, 409, { kycStatus: kyc.status });
    }
  }
  // The clock starts when it goes live, so the creator does not lose days waiting for review.
  const days = Math.max(1, Math.ceil((new Date(`${cause.ends_at.replace(" ", "T")}Z`).getTime() - new Date(`${String(cause.created_at).replace(" ", "T")}Z`).getTime()) / 86_400_000));
  await db.execute({
    sql: `UPDATE causes SET status = 'live', published_at = COALESCE(published_at, datetime('now')), ends_at = CASE WHEN published_at IS NULL THEN ? ELSE ends_at END,
            rejection_reason = NULL, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    args: [sqlTime(addDays(new Date(), days)), reviewerId, cause.id],
  });
  return (await getCauseById(cause.id))!;
}

export async function reviewCause(causeId: string, decision: "approve" | "reject", reviewerId: string, reason?: string): Promise<CauseRow> {
  const cfg = await requireCauses();
  const cause = await getCauseById(causeId);
  if (!cause) throw new ChannelsError("not_found", "Cause not found.", 404);
  if (cause.status !== "submitted") throw new ChannelsError("not_waiting", "This cause is not waiting for review.", 409);
  if (decision === "approve") return goLive(cause, cfg, reviewerId);
  if (!reason?.trim()) throw new ChannelsError("reason_required", "Say why it was rejected so the creator can fix it.", 400);
  await db.execute({ sql: "UPDATE causes SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", args: [reason.trim().slice(0, 300), reviewerId, causeId] });
  return (await getCauseById(causeId))!;
}

export async function freezeCause(causeId: string, frozen: boolean): Promise<void> {
  const res = await db.execute({
    sql: frozen ? "UPDATE causes SET status = 'frozen', updated_at = datetime('now') WHERE id = ? AND status IN ('live', 'ended', 'closed')"
      : "UPDATE causes SET status = CASE WHEN ends_at > datetime('now') THEN 'live' ELSE 'ended' END, updated_at = datetime('now') WHERE id = ? AND status = 'frozen'",
    args: [causeId],
  });
  if (!res.rowsAffected) throw new ChannelsError("not_found", "Nothing to change.", 409);
}

export async function closeCause(userId: string, causeId: string): Promise<void> {
  await requireCauses();
  const res = await db.execute({ sql: "UPDATE causes SET status = 'closed', ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_id = ? AND status = 'live'", args: [causeId, userId] });
  if (!res.rowsAffected) throw new ChannelsError("not_found", "Cause not found.", 404);
  await settleEnded(causeId);
}

export async function addCauseUpdate(userId: string, causeId: string, body: string) {
  const cfg = await requireCauses();
  if (!cfg.causes.updatesEnabled) throw new ChannelsError("updates_off", "Updates are not available.", 400);
  const cause = await getCauseById(causeId);
  if (!cause || cause.owner_id !== userId) throw new ChannelsError("not_found", "Cause not found.", 404);
  const text = body.trim();
  if (text.length < 3 || text.length > 1000) throw new ChannelsError("invalid_update", "Write an update of 3 to 1,000 characters.", 400);
  await db.execute({ sql: "INSERT INTO cause_updates (id, cause_id, body) VALUES (?, ?, ?)", args: [newId("cup"), causeId, text] });
}

// -------------------------------------------------------------------- reading

const daysLeft = (endsAt: string) => Math.max(0, Math.ceil((new Date(`${endsAt.replace(" ", "T")}Z`).getTime() - Date.now()) / 86_400_000));

export async function serializeCause(c: CauseRow, origin: string, opts: { owner?: boolean } = {}) {
  const cfg = await requireCauses().catch(() => null);
  const channel = await getChannelById(c.channel_id);
  const updates = (await db.execute({ sql: "SELECT id, body, created_at FROM cause_updates WHERE cause_id = ? ORDER BY created_at DESC LIMIT 20", args: [c.id] })).rows as Row[];
  const donors = cfg?.causes.donorWallVisible
    ? ((await db.execute({ sql: "SELECT donor_name, anonymous, amount_ugx, message, created_at FROM donations WHERE cause_id = ? AND status = 'successful' ORDER BY created_at DESC LIMIT 20", args: [c.id] })).rows as Row[])
    : [];
  const goal = Number(c.goal_ugx);
  const raised = Number(c.raised_ugx);
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    story: c.story,
    coverUrl: absUrl(origin, c.cover_url),
    beneficiary: (c.beneficiary as string) ?? null,
    goalUgx: goal,
    raisedUgx: raised,
    percent: goal > 0 ? Math.min(100, Math.floor((raised / goal) * 100)) : 0,
    donorCount: Number(c.donor_count),
    endsAt: c.ends_at,
    daysLeft: c.status === "live" ? daysLeft(c.ends_at) : 0,
    status: c.status,
    fundingMode: c.funding_mode,
    publishedAt: (c.published_at as string) ?? null,
    channel: channel ? { handle: channel.handle, displayName: channel.display_name, avatarUrl: absUrl(origin, channel.avatar_url), verified: Number(channel.verified_badge) === 1 } : null,
    updates: updates.map((u) => ({ id: String(u.id), body: String(u.body), createdAt: String(u.created_at) })),
    donors: donors.map((d) => ({ name: Number(d.anonymous) === 1 || !d.donor_name ? "Anonymous" : String(d.donor_name), amountUgx: Number(d.amount_ugx), message: (d.message as string) ?? null, createdAt: String(d.created_at) })),
    ...(opts.owner
      ? { rejectionReason: (c.rejection_reason as string) ?? null, releasedUgx: Number(c.released_ugx), refundedUgx: Number(c.refunded_ugx), releasableUgx: cfg ? await releasable(c, cfg) : 0 }
      : {}),
  };
}

export async function myCauses(userId: string): Promise<CauseRow[]> {
  return (await db.execute({ sql: "SELECT * FROM causes WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50", args: [userId] })).rows as unknown as CauseRow[];
}

/** Public causes to browse. */
export async function liveCauses(limit = 20): Promise<CauseRow[]> {
  const env = await getPlatformEnvironment();
  return (await db.execute({ sql: "SELECT * FROM causes WHERE status = 'live' AND environment = ? AND ends_at > datetime('now') ORDER BY published_at DESC LIMIT ?", args: [env, limit] })).rows as unknown as CauseRow[];
}

export const PUBLIC_CAUSE_STATUSES = ["live", "ended", "closed"];

// -------------------------------------------------------------------- donating

function donationCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

export type DonateInput = {
  slug: string; amountUgx: number; tipUgx?: number; name?: string; anonymous?: boolean; message?: string;
  method: "wallet" | "momo"; msisdn?: string; donorId: string | null;
};

export async function donate(input: DonateInput) {
  const cfg = await requireCauses();
  const cause = await getCauseBySlug(input.slug);
  if (!cause || cause.status !== "live" || new Date(`${cause.ends_at.replace(" ", "T")}Z`).getTime() <= Date.now()) throw new ChannelsError("not_accepting", "This cause is not taking donations.", 409);
  if (!input.donorId && !cfg.causes.guestDonations) throw new ChannelsError("sign_in_required", "Sign in to donate.", 401);
  const amount = Math.round(input.amountUgx);
  if (amount < cfg.causes.minDonationUgx || amount > cfg.causes.maxDonationUgx) {
    throw new ChannelsError("invalid_amount", `Donations are between UGX ${cfg.causes.minDonationUgx.toLocaleString()} and UGX ${cfg.causes.maxDonationUgx.toLocaleString()}.`, 400);
  }
  const tip = cfg.causes.donorTipEnabled ? Math.max(0, Math.min(Math.round(input.tipUgx ?? 0), Math.max(amount, 10_000))) : 0;
  const total = amount + tip;
  const env = cause.environment as PlatformEnvironment;
  const anonymous = cfg.causes.allowAnonymous && !!input.anonymous;
  const id = newId("don");
  const code = donationCode();
  const common = [id, cause.id, code, input.donorId, input.name?.trim().slice(0, 60) || null, anonymous ? 1 : 0, input.message?.trim().slice(0, 300) || null, amount, tip] as const;

  if (input.method === "wallet") {
    if (!cfg.causes.allowWalletPayment) throw new ChannelsError("method_off", "Paying from the wallet is not available.", 400);
    if (!input.donorId) throw new ChannelsError("sign_in_required", "Sign in to pay from your wallet.", 401);
    if (await walletIsFrozen(input.donorId)) throw new ChannelsError("account_frozen", "Your Main account is frozen. Unfreeze it to give from your wallet.", 409);
    await db.execute({ sql: "INSERT INTO donations (id, cause_id, code, donor_id, donor_name, anonymous, message, amount_ugx, tip_ugx, method, status, environment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'wallet', 'pending', ?)", args: [...common, env] });
    const balance = await debitWallet(input.donorId, total, { type: "transfer_out", environment: env, note: `Donation: ${cause.title}` });
    if (balance === null) {
      await db.execute({ sql: "UPDATE donations SET status = 'failed', updated_at = datetime('now') WHERE id = ?", args: [id] });
      throw new ChannelsError("insufficient_wallet", "Your wallet balance is too low. Top up and try again.", 402);
    }
    try {
      await finalizeDonation(id);
    } catch (err) {
      await creditWallet(input.donorId, total, { type: "refund", environment: env, note: "Donation could not be completed" }).catch(() => {});
      await db.execute({ sql: "UPDATE donations SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
      throw err;
    }
    if (input.donorId !== cause.owner_id) {
      scheduleMoneyAlert({ transferId: `donation:${id}`, amount: total, fromUserId: input.donorId, toUserId: cause.owner_id, context: cause.title });
    }
    return { code, status: "successful" as const, redirectUrl: null };
  }

  if (!cfg.causes.allowMobileMoney) throw new ChannelsError("method_off", "Mobile money is not available.", 400);
  const msisdn = normalizeUgandaMsisdn(input.msisdn ?? "");
  if (!msisdn) throw new ChannelsError("invalid_number", "Enter the mobile money number to pay from.", 400);
  await db.execute({ sql: "INSERT INTO donations (id, cause_id, code, donor_id, donor_name, anonymous, message, amount_ugx, tip_ugx, method, status, msisdn, environment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'momo', 'pending', ?, ?)", args: [...common, msisdn, env] });
  try {
    const started = await initiateCollection({ referenceId: id, msisdn, amount: total, name: input.name, narrative: `Peebee donation: ${cause.title}`.slice(0, 60), forceMock: env === "sandbox" });
    await db.execute({ sql: "UPDATE donations SET provider = ?, provider_ref = ?, updated_at = datetime('now') WHERE id = ?", args: [started.provider, started.providerRef, id] });
    return { code, status: "pending" as const, redirectUrl: started.redirectUrl ?? null };
  } catch (err) {
    await db.execute({ sql: "UPDATE donations SET status = 'failed', updated_at = datetime('now') WHERE id = ?", args: [id] });
    if (err instanceof UnsupportedNetworkError) throw new ChannelsError("unsupported_network", err.message, 400);
    const shaped = paymentProviderErrorResponse(err, "Could not reach mobile money. You have not been charged.");
    throw new ChannelsError(shaped.error, shaped.message, 502);
  }
}

/** Counts a paid donation exactly once: the ledger entry, the cause totals and the status commit together. */
export async function finalizeDonation(donationId: string): Promise<boolean> {
  const cfg = await requireChannels();
  const d = (await db.execute({ sql: "SELECT * FROM donations WHERE id = ?", args: [donationId] })).rows[0] as Row | undefined;
  if (!d || d.status !== "pending") return false;
  const amount = Number(d.amount_ugx);
  const tip = Number(d.tip_ugx);
  const fee = Math.min(amount - 1, Math.round((amount * cfg.causes.donationCutPercent) / 100));
  const env = String(d.environment) as PlatformEnvironment;
  const causeId = String(d.cause_id);
  const statements: DbStatement[] = [
    { sql: "UPDATE donations SET status = 'successful', fee_ugx = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [Math.max(0, fee), donationId] },
    { sql: "UPDATE causes SET raised_ugx = raised_ugx + ?, donor_count = donor_count + 1, updated_at = datetime('now') WHERE id = ?", args: [amount, causeId] },
  ];
  const postings = [
    { ownerType: "platform" as const, ownerId: "platform", purpose: "donation_clearing", environment: env, amount: -(amount + tip) },
    { ownerType: "platform" as const, ownerId: "platform", purpose: escrowPurpose(causeId), environment: env, amount: amount - Math.max(0, fee) },
    ...(Math.max(0, fee) + tip > 0 ? [{ ownerType: "platform" as const, ownerId: "platform", purpose: "channel_fees", environment: env, amount: Math.max(0, fee) + tip }] : []),
  ];
  const tx = await postLedgerTransaction({ kind: "cause:donation", idempotencyKey: `donation:${donationId}`, environment: env, referenceType: "donation", referenceId: donationId, postings, additionalStatements: statements });
  return !tx.duplicate;
}

/** Checks a pending mobile money donation with the provider. Guests poll this with their receipt code. */
export async function refreshDonation(code: string) {
  const d = (await db.execute({ sql: "SELECT * FROM donations WHERE code = ?", args: [code.toUpperCase()] })).rows[0] as Row | undefined;
  if (!d) throw new ChannelsError("not_found", "Donation not found.", 404);
  if (d.status === "pending" && d.method === "momo" && d.provider_ref) {
    const status = await checkPaymentStatus({ provider: String(d.provider), provider_ref: String(d.provider_ref), created_at: String(d.created_at) });
    if (status === "successful") await finalizeDonation(String(d.id));
    else if (status === "failed") await db.execute({ sql: "UPDATE donations SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [d.id as string] });
  }
  const fresh = (await db.execute({ sql: "SELECT d.status, d.amount_ugx, d.tip_ugx, d.code, d.created_at, c.title, c.slug FROM donations d JOIN causes c ON c.id = d.cause_id WHERE d.code = ?", args: [code.toUpperCase()] })).rows[0] as Row;
  return { code: String(fresh.code), status: String(fresh.status), amountUgx: Number(fresh.amount_ugx), tipUgx: Number(fresh.tip_ugx), causeTitle: String(fresh.title), causeSlug: String(fresh.slug), createdAt: String(fresh.created_at) };
}

// -------------------------------------------------------------- release & refund

/** What the creator could take out of a cause right now. */
export async function releasable(c: CauseRow, cfg: ChannelsConfig): Promise<number> {
  if (!["live", "ended", "closed"].includes(c.status)) return 0;
  const allOrNothing = c.funding_mode === "all_or_nothing";
  const ended = c.status === "ended" || c.status === "closed";
  if ((allOrNothing || cfg.causes.releaseMode === "on_end") && !ended) return 0;
  if (allOrNothing && Number(c.raised_ugx) < Number(c.goal_ugx)) return 0;
  const row = (await db.execute({
    sql: "SELECT COALESCE(SUM(amount_ugx - fee_ugx), 0) AS n FROM donations WHERE cause_id = ? AND status = 'successful' AND created_at <= datetime('now', ?)",
    args: [c.id, `-${cfg.causes.holdDays} days`],
  })).rows[0] as Row;
  return Math.max(0, Number(row.n) - Number(c.released_ugx));
}

/** Moves released cause money into the creator's balance. Withdrawing it needs verification, like any earnings. */
export async function releaseCause(userId: string, causeId: string, amountUgx?: number) {
  const cfg = await requireCauses();
  const cause = await getCauseById(causeId);
  if (!cause || cause.owner_id !== userId) throw new ChannelsError("not_found", "Cause not found.", 404);
  if (cause.status === "frozen") throw new ChannelsError("frozen", "This cause is on hold while staff look into it.", 409);
  if (cfg.kyc.required) {
    const kyc = await kycState(userId, cfg);
    if (kyc.status !== "approved") throw new ChannelsError("kyc_required", "Verify your identity to take out the money raised.", 403, { kycStatus: kyc.status });
  }
  const available = await releasable(cause, cfg);
  const amount = Math.round(amountUgx ?? available);
  if (amount <= 0 || amount > available) throw new ChannelsError("nothing_to_release", available > 0 ? "That is more than can be released now." : "Nothing can be released yet.", 409);

  const claim = await db.execute({ sql: "UPDATE causes SET released_ugx = released_ugx + ?, updated_at = datetime('now') WHERE id = ? AND released_ugx = ?", args: [amount, causeId, Number(cause.released_ugx)] });
  if (!claim.rowsAffected) throw new ChannelsError("busy", "Please try again.", 409);
  try {
    await creditCreator({ creatorId: userId, kind: "cause_release", grossUgx: amount, sourceId: `rel:${causeId}:${Number(cause.released_ugx)}`, note: `Released from "${cause.title}"`, clearingPurpose: escrowPurpose(causeId), channelId: cause.channel_id, environment: cause.environment as PlatformEnvironment });
  } catch (err) {
    await db.execute({ sql: "UPDATE causes SET released_ugx = released_ugx - ? WHERE id = ?", args: [amount, causeId] });
    throw err;
  }
  return { releasedUgx: amount };
}

async function refundDonation(d: Row, reason: string): Promise<boolean> {
  const claim = await db.execute({ sql: "UPDATE donations SET status = 'refunded', updated_at = datetime('now') WHERE id = ? AND status = 'successful'", args: [d.id as string] });
  if (!claim.rowsAffected) return false;
  const env = String(d.environment) as PlatformEnvironment;
  const total = Number(d.amount_ugx) + Number(d.tip_ugx);
  const tx = (await db.execute({ sql: "SELECT id FROM ledger_transactions WHERE environment = ? AND idempotency_key = ?", args: [env, `donation:${d.id}`] })).rows[0] as Row | undefined;
  if (tx) await reverseLedgerTransaction({ transactionId: String(tx.id), idempotencyKey: `donation-refund:${d.id}` });
  await db.execute({ sql: "UPDATE causes SET refunded_ugx = refunded_ugx + ?, raised_ugx = MAX(0, raised_ugx - ?), donor_count = MAX(0, donor_count - 1) WHERE id = ?", args: [Number(d.amount_ugx), Number(d.amount_ugx), d.cause_id as string] });
  try {
    if (d.method === "wallet" && d.donor_id) await creditWallet(String(d.donor_id), total, { type: "refund", environment: env, note: reason });
    else if (d.msisdn) await initiateDisbursement({ referenceId: `refund-${d.id}`, msisdn: String(d.msisdn), amount: total, forceMock: env === "sandbox", narrative: "Peebee donation refund" });
  } catch (err) {
    console.error("donation refund payout failed (marked for follow-up):", d.id, err);
    await db.execute({ sql: "UPDATE donations SET message = COALESCE(message, '') || ' [refund payout needs follow-up]' WHERE id = ?", args: [d.id as string] });
  }
  return true;
}

/** Refunds everyone in a cause (a rejected-after-the-fact or fraudulent cause, or a missed all-or-nothing goal). */
export async function refundCause(causeId: string, reason: string): Promise<number> {
  const rows = (await db.execute({ sql: "SELECT * FROM donations WHERE cause_id = ? AND status = 'successful'", args: [causeId] })).rows as Row[];
  let n = 0;
  for (const d of rows) if (await refundDonation(d, reason)) n += 1;
  return n;
}

async function settleEnded(causeId: string): Promise<void> {
  const cause = await getCauseById(causeId);
  if (!cause) return;
  if (cause.funding_mode === "all_or_nothing" && Number(cause.raised_ugx) < Number(cause.goal_ugx) && Number(cause.released_ugx) === 0) {
    await refundCause(causeId, `"${cause.title}" did not reach its goal`);
  }
}

/** Ends causes past their deadline, settles all-or-nothing ones, and clears stuck wallet donations. Safe to repeat. */
export async function sweepCauses(): Promise<{ ended: number; refunded: number }> {
  const out = { ended: 0, refunded: 0 };
  if (!(await hasTable("causes")) || !(await hasTable("donations"))) return out;
  const due = (await db.execute({ sql: "SELECT id FROM causes WHERE status = 'live' AND ends_at <= datetime('now') LIMIT 100", args: [] })).rows as Row[];
  for (const c of due) {
    const res = await db.execute({ sql: "UPDATE causes SET status = 'ended', ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'live'", args: [c.id as string] });
    if (res.rowsAffected) {
      out.ended += 1;
      await settleEnded(String(c.id));
    }
  }
  // A wallet donation left pending (the app died mid-payment) gives the money back.
  const stuck = (await db.execute({ sql: "SELECT * FROM donations WHERE status = 'pending' AND method = 'wallet' AND created_at < datetime('now', '-15 minutes') LIMIT 100", args: [] })).rows as Row[];
  for (const d of stuck) {
    const claim = await db.execute({ sql: "UPDATE donations SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [d.id as string] });
    if (claim.rowsAffected && d.donor_id) {
      await creditWallet(String(d.donor_id), Number(d.amount_ugx) + Number(d.tip_ugx), { type: "refund", environment: String(d.environment) as PlatformEnvironment, note: "Donation could not be completed" });
      out.refunded += 1;
    }
  }
  // A mobile money donation that never confirmed after a day is dropped.
  await db.execute({ sql: "UPDATE donations SET status = 'failed', updated_at = datetime('now') WHERE status = 'pending' AND method = 'momo' AND created_at < datetime('now', '-1 day')", args: [] });
  return out;
}
