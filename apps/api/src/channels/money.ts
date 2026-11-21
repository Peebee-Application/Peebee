import { parseGiftOptions, type ChannelsConfig } from "@peebee/shared";
import { db, type DbStatement } from "../db/client.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { newId } from "../lib/ids.js";
import { getPlatformEnvironment, type PlatformEnvironment } from "../lib/settings.js";
import { scheduleMoneyAlert } from "../wallet/alerts.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { activeSubscription } from "./access.js";
import { addDays, ChannelsError, requireMoney, sqlTime, type Row } from "./common.js";
import { getChannelById } from "./channels.js";
import { getPost } from "./posts.js";

export type EarningKind = "membership" | "pay_per_view" | "tip" | "gift" | "ad_share" | "reward" | "cause_release";

export const feePercentFor = (cfg: ChannelsConfig, kind: EarningKind): number => {
  switch (kind) {
    case "membership": return cfg.monetization.membershipCutPercent;
    case "pay_per_view": return cfg.monetization.payPerViewCutPercent;
    case "tip": return cfg.monetization.tipCutPercent;
    case "gift": return cfg.monetization.giftCutPercent;
    default: return 0;
  }
};

/**
 * Credits a creator's earnings. One ledger transaction (clearing → creator, plus Peebee's cut) commits
 * together with the creator's balance and an earnings line, and the key makes a retry a no-op, so a
 * payment can never be credited twice.
 */
export async function creditCreator(input: {
  creatorId: string;
  kind: EarningKind;
  grossUgx: number;
  feeUgx?: number;
  feePercent?: number;
  payerId?: string | null;
  channelId?: string | null;
  postId?: string | null;
  sourceId: string;
  note?: string;
  clearingPurpose?: string;
  environment?: PlatformEnvironment;
}): Promise<{ netUgx: number; feeUgx: number; duplicate: boolean }> {
  const environment = input.environment ?? (await getPlatformEnvironment());
  const gross = Math.round(input.grossUgx);
  if (!Number.isSafeInteger(gross) || gross <= 0) throw new Error("A creator credit must be a positive whole amount");
  const fee = Math.max(0, Math.min(gross - 1, input.feeUgx ?? Math.round((gross * (input.feePercent ?? 0)) / 100)));
  const net = gross - fee;
  if (net <= 0) throw new ChannelsError("amount_too_small", "That amount is too small.", 400);

  const postings = [
    { ownerType: "platform" as const, ownerId: "platform", purpose: input.clearingPurpose ?? "channel_clearing", environment, amount: -gross },
    { ownerType: "customer" as const, ownerId: input.creatorId, purpose: "creator_earnings", environment, amount: net },
    ...(fee > 0 ? [{ ownerType: "platform" as const, ownerId: "platform", purpose: "channel_fees", environment, amount: fee }] : []),
  ];
  const statements: DbStatement[] = [
    {
      sql: `INSERT INTO creator_balances (user_id, environment, available_ugx, lifetime_ugx) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, environment) DO UPDATE SET available_ugx = available_ugx + excluded.available_ugx, lifetime_ugx = lifetime_ugx + excluded.lifetime_ugx`,
      args: [input.creatorId, environment, net, net],
    },
    {
      sql: `INSERT INTO creator_earnings (id, creator_id, kind, gross_ugx, fee_ugx, net_ugx, payer_id, channel_id, post_id, source_id, note, environment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [newId("ern"), input.creatorId, input.kind, gross, fee, net, input.payerId ?? null, input.channelId ?? null, input.postId ?? null, input.sourceId, input.note ?? null, environment],
    },
  ];
  const tx = await postLedgerTransaction({
    kind: `creator:${input.kind}`,
    idempotencyKey: `creator:${input.kind}:${input.sourceId}`,
    environment,
    referenceType: "creator_earning",
    referenceId: input.sourceId,
    description: input.note,
    postings,
    additionalStatements: statements,
  });
  return { netUgx: net, feeUgx: fee, duplicate: tx.duplicate };
}

/** Takes money out of a creator's available balance, only if it covers it. Returns false when it does not. */
export async function debitCreator(userId: string, amountUgx: number, environment: PlatformEnvironment): Promise<boolean> {
  const res = await db.execute({
    sql: "UPDATE creator_balances SET available_ugx = available_ugx - ? WHERE user_id = ? AND environment = ? AND available_ugx >= ?",
    args: [amountUgx, userId, environment, amountUgx],
  });
  return !!res.rowsAffected;
}

export async function restoreCreator(userId: string, amountUgx: number, environment: PlatformEnvironment): Promise<void> {
  await db.execute({ sql: "UPDATE creator_balances SET available_ugx = available_ugx + ? WHERE user_id = ? AND environment = ?", args: [amountUgx, userId, environment] });
}

/** The ledger side of money leaving a creator's balance (a payout, or a move to their wallet). */
export async function postCreatorDebit(input: { userId: string; amountUgx: number; purpose: string; key: string; environment: PlatformEnvironment; note?: string }): Promise<void> {
  await postLedgerTransaction({
    kind: `creator:${input.purpose}`,
    idempotencyKey: `creator-debit:${input.key}`,
    environment: input.environment,
    referenceType: "creator_debit",
    referenceId: input.key,
    description: input.note,
    postings: [
      { ownerType: "customer", ownerId: input.userId, purpose: "creator_earnings", environment: input.environment, amount: -input.amountUgx },
      { ownerType: "platform", ownerId: "platform", purpose: input.purpose, environment: input.environment, amount: input.amountUgx },
    ],
  });
}

export async function creatorBalance(userId: string, environment?: PlatformEnvironment) {
  const env = environment ?? (await getPlatformEnvironment());
  const row = (await db.execute({ sql: "SELECT available_ugx, lifetime_ugx FROM creator_balances WHERE user_id = ? AND environment = ?", args: [userId, env] })).rows[0] as Row | undefined;
  return { availableUgx: Number(row?.available_ugx ?? 0), lifetimeUgx: Number(row?.lifetime_ugx ?? 0) };
}

/** A person pays from their Peebee wallet. Refuses cleanly when the balance does not cover it. */
async function chargeWallet(userId: string, amountUgx: number, note: string, counterpartyId: string, environment: PlatformEnvironment): Promise<void> {
  const balance = await debitWallet(userId, amountUgx, { type: "transfer_out", environment, counterpartyId, note });
  if (balance === null) throw new ChannelsError("insufficient_wallet", "Your wallet balance is too low. Top up and try again.", 402);
}

async function refundWallet(userId: string, amountUgx: number, note: string, environment: PlatformEnvironment) {
  await creditWallet(userId, amountUgx, { type: "refund", environment, note }).catch((e) => console.error("wallet refund failed:", e));
}

// ----------------------------------------------------------------------- tiers

export type TierInput = { name: string; description?: string; priceUgx: number; periodDays?: number; perks?: string[]; active?: boolean };

async function ownChannel(userId: string) {
  const env = await getPlatformEnvironment();
  const ch = (await db.execute({ sql: "SELECT * FROM channels WHERE owner_id = ? AND environment = ? AND status = 'active'", args: [userId, env] })).rows[0] as Row | undefined;
  if (!ch) throw new ChannelsError("no_channel", "Open a channel first.", 404);
  return ch;
}

export async function createTier(userId: string, input: TierInput): Promise<Row> {
  const cfg = await requireMoney("memberships");
  const ch = await ownChannel(userId);
  const count = Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM channel_tiers WHERE channel_id = ? AND active = 1", args: [ch.id as string] })).rows[0] as Row).n);
  if (count >= cfg.monetization.maxTiers) throw new ChannelsError("too_many_tiers", `You can have up to ${cfg.monetization.maxTiers} tiers.`, 400);
  const price = Math.round(input.priceUgx);
  if (price < cfg.monetization.minTierPriceUgx || price > cfg.monetization.maxTierPriceUgx) {
    throw new ChannelsError("invalid_price", `A tier costs between UGX ${cfg.monetization.minTierPriceUgx.toLocaleString()} and UGX ${cfg.monetization.maxTierPriceUgx.toLocaleString()}.`, 400);
  }
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new ChannelsError("name_required", "Name your tier.", 400);
  const period = Math.max(1, Math.min(365, Math.round(input.periodDays ?? 30)));
  const id = newId("tir");
  await db.execute({
    sql: "INSERT INTO channel_tiers (id, channel_id, name, description, price_ugx, period_days, perks_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, ch.id as string, name, input.description?.trim().slice(0, 300) || null, price, period, JSON.stringify((input.perks ?? []).map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 8)), count],
  });
  return (await db.execute({ sql: "SELECT * FROM channel_tiers WHERE id = ?", args: [id] })).rows[0] as Row;
}

export async function updateTier(userId: string, tierId: string, input: Partial<TierInput>): Promise<Row> {
  const cfg = await requireMoney("memberships");
  const ch = await ownChannel(userId);
  const tier = (await db.execute({ sql: "SELECT * FROM channel_tiers WHERE id = ? AND channel_id = ?", args: [tierId, ch.id as string] })).rows[0] as Row | undefined;
  if (!tier) throw new ChannelsError("not_found", "Tier not found.", 404);
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (input.name !== undefined) { sets.push("name = ?"); args.push(input.name.trim().slice(0, 40) || String(tier.name)); }
  if (input.description !== undefined) { sets.push("description = ?"); args.push(input.description.trim().slice(0, 300) || null); }
  if (input.perks !== undefined) { sets.push("perks_json = ?"); args.push(JSON.stringify(input.perks.map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 8))); }
  if (input.priceUgx !== undefined) {
    const price = Math.round(input.priceUgx);
    if (price < cfg.monetization.minTierPriceUgx || price > cfg.monetization.maxTierPriceUgx) throw new ChannelsError("invalid_price", "That price is outside the allowed range.", 400);
    sets.push("price_ugx = ?");
    args.push(price);
  }
  if (input.active !== undefined) { sets.push("active = ?"); args.push(input.active ? 1 : 0); }
  if (sets.length) await db.execute({ sql: `UPDATE channel_tiers SET ${sets.join(", ")} WHERE id = ?`, args: [...args, tierId] });
  return (await db.execute({ sql: "SELECT * FROM channel_tiers WHERE id = ?", args: [tierId] })).rows[0] as Row;
}

export async function listTiers(channelId: string, includeInactive = false): Promise<Row[]> {
  return (await db.execute({
    sql: `SELECT t.*, (SELECT COUNT(*) FROM channel_subscriptions s WHERE s.tier_id = t.id AND s.status IN ('active','cancelled') AND s.current_period_end > datetime('now')) AS members
          FROM channel_tiers t WHERE t.channel_id = ? ${includeInactive ? "" : "AND t.active = 1"} ORDER BY t.price_ugx`,
    args: [channelId],
  })).rows as Row[];
}

// ------------------------------------------------------------- subscriptions

export async function subscribe(userId: string, tierId: string): Promise<Row> {
  const cfg = await requireMoney("memberships");
  const tier = (await db.execute({ sql: "SELECT * FROM channel_tiers WHERE id = ? AND active = 1", args: [tierId] })).rows[0] as Row | undefined;
  if (!tier) throw new ChannelsError("not_found", "That membership is not available.", 404);
  const channel = await getChannelById(String(tier.channel_id));
  if (!channel || channel.status !== "active") throw new ChannelsError("not_found", "That channel is not available.", 404);
  if (channel.owner_id === userId) throw new ChannelsError("own_channel", "You cannot join your own channel.", 400);
  const existing = await activeSubscription(userId, channel.id);
  if (existing) throw new ChannelsError("already_member", "You are already a member of this channel.", 409);

  const env = await getPlatformEnvironment();
  const price = Number(tier.price_ugx);
  const subId = newId("sub");
  const periodEnd = sqlTime(addDays(new Date(), Number(tier.period_days)));
  await chargeWallet(userId, price, `Membership: ${channel.display_name}`, channel.owner_id, env);
  try {
    await db.execute({
      sql: `INSERT INTO channel_subscriptions (id, channel_id, tier_id, user_id, price_ugx, period_days, current_period_end, environment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [subId, channel.id, tierId, userId, price, Number(tier.period_days), periodEnd, env],
    });
    await creditCreator({ creatorId: channel.owner_id, kind: "membership", grossUgx: price, feePercent: feePercentFor(cfg, "membership"), payerId: userId, channelId: channel.id, sourceId: `sub:${subId}:0`, note: `Membership: ${tier.name}`, environment: env });
    scheduleMoneyAlert({ transferId: `sub:${subId}:0`, amount: price, fromUserId: userId, toUserId: channel.owner_id, context: `Membership: ${channel.display_name}` });
  } catch (err) {
    await refundWallet(userId, price, "Membership could not be completed", env);
    await db.execute({ sql: "DELETE FROM channel_subscriptions WHERE id = ?", args: [subId] }).catch(() => {});
    throw err;
  }
  return (await db.execute({ sql: "SELECT * FROM channel_subscriptions WHERE id = ?", args: [subId] })).rows[0] as Row;
}

/** Stops renewal; the member keeps access until the period they paid for ends. */
export async function cancelSubscription(userId: string, subId: string): Promise<void> {
  const res = await db.execute({ sql: "UPDATE channel_subscriptions SET auto_renew = 0, status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'active'", args: [subId, userId] });
  if (!res.rowsAffected) throw new ChannelsError("not_found", "Membership not found.", 404);
}

export async function mySubscriptions(userId: string): Promise<Row[]> {
  return (await db.execute({
    sql: `SELECT s.id, s.status, s.price_ugx, s.current_period_end, s.auto_renew, t.name AS tier_name, c.id AS channel_id, c.handle, c.display_name, c.avatar_url
          FROM channel_subscriptions s JOIN channel_tiers t ON t.id = s.tier_id JOIN channels c ON c.id = s.channel_id
          WHERE s.user_id = ? AND s.status IN ('active', 'cancelled') ORDER BY s.current_period_end DESC`,
    args: [userId],
  })).rows as Row[];
}

/** Renews memberships that are due from the member's wallet, and ends the ones that cannot be. */
export async function renewSubscriptions(): Promise<{ renewed: number; expired: number }> {
  const out = { renewed: 0, expired: 0 };
  const cfg = await requireMoney().catch(() => null);
  const due = (await db.execute({ sql: "SELECT * FROM channel_subscriptions WHERE status IN ('active', 'cancelled') AND current_period_end <= datetime('now') LIMIT 200", args: [] })).rows as Row[];
  for (const s of due) {
    const id = String(s.id);
    if (!cfg || Number(s.auto_renew) !== 1 || s.status !== "active") {
      const r = await db.execute({ sql: "UPDATE channel_subscriptions SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND current_period_end <= datetime('now')", args: [id] });
      out.expired += r.rowsAffected ? 1 : 0;
      continue;
    }
    const channel = await getChannelById(String(s.channel_id));
    const env = String(s.environment) as PlatformEnvironment;
    const price = Number(s.price_ugx);
    if (!channel || channel.status !== "active") {
      await db.execute({ sql: "UPDATE channel_subscriptions SET status = 'expired', updated_at = datetime('now') WHERE id = ?", args: [id] });
      out.expired += 1;
      continue;
    }
    const balance = await debitWallet(String(s.user_id), price, { type: "transfer_out", environment: env, counterpartyId: channel.owner_id, note: `Membership renewal: ${channel.display_name}` });
    if (balance === null) {
      await db.execute({ sql: "UPDATE channel_subscriptions SET status = 'expired', updated_at = datetime('now') WHERE id = ?", args: [id] });
      out.expired += 1;
      continue;
    }
    const next = sqlTime(addDays(new Date(`${String(s.current_period_end).replace(" ", "T")}Z`), Number(s.period_days)));
    const renewals = Number(s.renewals) + 1;
    const moved = await db.execute({
      sql: "UPDATE channel_subscriptions SET current_period_end = ?, renewals = ?, updated_at = datetime('now') WHERE id = ? AND renewals = ?",
      args: [next, renewals, id, Number(s.renewals)],
    });
    if (!moved.rowsAffected) {
      await refundWallet(String(s.user_id), price, "Membership renewal refunded", env);
      continue;
    }
    await creditCreator({ creatorId: channel.owner_id, kind: "membership", grossUgx: price, feePercent: feePercentFor(cfg, "membership"), payerId: String(s.user_id), channelId: channel.id, sourceId: `sub:${id}:${renewals}`, note: "Membership renewal", environment: env });
    scheduleMoneyAlert({ transferId: `sub:${id}:${renewals}`, amount: price, fromUserId: String(s.user_id), toUserId: channel.owner_id, context: `Membership renewal: ${channel.display_name}` });
    out.renewed += 1;
  }
  return out;
}

// -------------------------------------------------------- pay-per-view and tips

export async function unlockPost(userId: string, postId: string): Promise<void> {
  const cfg = await requireMoney("payPerView");
  const post = await getPost(postId);
  if (!post || post.status !== "published" || post.access !== "pay_per_view") throw new ChannelsError("not_found", "Post not found.", 404);
  if (post.author_id === userId) throw new ChannelsError("own_post", "This is your own post.", 400);
  const already = (await db.execute({ sql: "SELECT 1 FROM post_unlocks WHERE post_id = ? AND user_id = ?", args: [postId, userId] })).rows[0];
  if (already) return;
  const price = Number(post.price_ugx);
  const env = await getPlatformEnvironment();
  await chargeWallet(userId, price, "Unlocked a post", post.author_id, env);
  try {
    const ins = await db.execute({ sql: "INSERT OR IGNORE INTO post_unlocks (post_id, user_id, price_ugx) VALUES (?, ?, ?)", args: [postId, userId, price] });
    if (!ins.rowsAffected) { await refundWallet(userId, price, "Duplicate unlock refunded", env); return; }
    await creditCreator({ creatorId: post.author_id, kind: "pay_per_view", grossUgx: price, feePercent: feePercentFor(cfg, "pay_per_view"), payerId: userId, channelId: post.publisher_id, postId, sourceId: `ppv:${postId}:${userId}`, note: "Paid post", environment: env });
    scheduleMoneyAlert({ transferId: `ppv:${postId}:${userId}`, amount: price, fromUserId: userId, toUserId: post.author_id, context: "Unlocked a post" });
  } catch (err) {
    await refundWallet(userId, price, "Unlock could not be completed", env);
    await db.execute({ sql: "DELETE FROM post_unlocks WHERE post_id = ? AND user_id = ?", args: [postId, userId] }).catch(() => {});
    throw err;
  }
}

export async function sendTip(userId: string, channelId: string, input: { amountUgx: number; postId?: string | null; gift?: string | null }): Promise<{ kind: EarningKind }> {
  const isGift = !!input.gift;
  const cfg = await requireMoney(isGift ? "gifts" : "tips");
  const channel = await getChannelById(channelId);
  if (!channel || channel.status !== "active") throw new ChannelsError("not_found", "Channel not found.", 404);
  if (channel.owner_id === userId) throw new ChannelsError("own_channel", "You cannot tip yourself.", 400);
  let amount = Math.round(input.amountUgx);
  if (isGift) {
    const option = parseGiftOptions(cfg.monetization.giftOptions).find((g) => g.name === input.gift);
    if (!option) throw new ChannelsError("unknown_gift", "That gift is not available.", 400);
    amount = option.priceUgx;
  } else if (amount < cfg.monetization.minTipUgx || amount > cfg.monetization.maxTipUgx) {
    throw new ChannelsError("invalid_amount", `Tips are between UGX ${cfg.monetization.minTipUgx.toLocaleString()} and UGX ${cfg.monetization.maxTipUgx.toLocaleString()}.`, 400);
  }
  let postId: string | null = null;
  if (input.postId) {
    const post = await getPost(input.postId);
    if (post && post.publisher_id === channelId) postId = post.id;
  }
  const kind: EarningKind = isGift ? "gift" : "tip";
  const env = await getPlatformEnvironment();
  const transferId = `${kind}:${newId("tip")}`;
  await chargeWallet(userId, amount, `${isGift ? "Gift" : "Tip"} to ${channel.display_name}`, channel.owner_id, env);
  try {
    await creditCreator({ creatorId: channel.owner_id, kind, grossUgx: amount, feePercent: feePercentFor(cfg, kind), payerId: userId, channelId, postId, sourceId: transferId, note: isGift ? `Gift: ${input.gift}` : "Tip", environment: env });
    scheduleMoneyAlert({ transferId, amount, fromUserId: userId, toUserId: channel.owner_id, context: isGift ? `Gift: ${input.gift}` : `Tip to ${channel.display_name}` });
  } catch (err) {
    await refundWallet(userId, amount, "Tip could not be completed", env);
    throw err;
  }
  return { kind };
}

export async function earningsSummary(userId: string) {
  const env = await getPlatformEnvironment();
  const bal = await creatorBalance(userId, env);
  const recent = (await db.execute({ sql: "SELECT id, kind, gross_ugx, fee_ugx, net_ugx, note, created_at FROM creator_earnings WHERE creator_id = ? AND environment = ? ORDER BY created_at DESC, id DESC LIMIT 50", args: [userId, env] })).rows as Row[];
  const byKind = (await db.execute({ sql: "SELECT kind, SUM(net_ugx) AS net, COUNT(*) AS n FROM creator_earnings WHERE creator_id = ? AND environment = ? AND created_at > datetime('now', '-30 days') GROUP BY kind", args: [userId, env] })).rows as Row[];
  const ch = (await db.execute({ sql: "SELECT id FROM channels WHERE owner_id = ? AND environment = ?", args: [userId, env] })).rows[0] as Row | undefined;
  const members = ch ? Number(((await db.execute({ sql: "SELECT COUNT(*) AS n FROM channel_subscriptions WHERE channel_id = ? AND status IN ('active','cancelled') AND current_period_end > datetime('now')", args: [ch.id as string] })).rows[0] as Row).n) : 0;
  return {
    availableUgx: bal.availableUgx,
    lifetimeUgx: bal.lifetimeUgx,
    members,
    last30Days: byKind.map((r) => ({ kind: String(r.kind), netUgx: Number(r.net), count: Number(r.n) })),
    recent: recent.map((r) => ({ id: String(r.id), kind: String(r.kind), grossUgx: Number(r.gross_ugx), feeUgx: Number(r.fee_ugx), netUgx: Number(r.net_ugx), note: (r.note as string) ?? null, createdAt: String(r.created_at) })),
  };
}
