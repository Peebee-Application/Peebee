import { Hono } from "hono";
import { getCreditBalance } from "../offers/credit.js";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import { getPlatformEnvironment, getWalletAccountSettings, getWalletSettings } from "../lib/settings.js";
import {
  initiateCollection,
  paymentProviderErrorResponse,
  paymentProviderHttpStatus,
  UnsupportedNetworkError,
} from "../payments/service.js";
import { cardSchema } from "../payments/card.js";
import { appBaseUrl } from "../verify/service.js";
import { frozenBody, walletIsFrozen } from "./freeze.js";
import { runIdempotentTransfer } from "./idempotency.js";
import { loadLedger } from "./ledger-view.js";
import { assertSpendSource } from "./accounts-routes.js";
import { maskPhone } from "./mask.js";
import { getWalletCap, resolveCustomerByIdentifier, transferWallet } from "./service.js";
import { settleCustomerTopup } from "./topup-settle.js";
import { findActiveUserWithRoleById } from "../auth/roles.js";
import { activatePersonalWallet, personalWalletIsActive, requireActivePersonalWallet } from "./personal-wallet.js";

export const walletRoutes = new Hono();

// Personal wallet activation belongs to the shared Peebee identity. It is
// deliberately independent from creating a Customer app profile.
walletRoutes.post("/personal-wallet/activate", requireAuth, async (c) => {
  const user = c.get("user");
  if (!(await activatePersonalWallet(user.sub))) {
    return c.json({ error: "personal_wallet_migration_required", message: "Apply migration 0176_provider_wallets.sql before activating a new personal wallet." }, 503);
  }
  return c.json({ walletType: "personal", active: true });
});

walletRoutes.get("/personal-wallet/status", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json({
    walletType: "personal",
    active: await personalWalletIsActive(user.sub),
    activationAvailable: await hasTable("personal_wallets"),
  });
});

type Row = Record<string, unknown>;

/** Balance, cap/verification tier, and recent activity — everything the
 * wallet screen needs in one call. */
walletRoutes.get("/wallet", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const environment = await getPlatformEnvironment();
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const [{ cap, verified }, balanceRes, ledgerRes] = await Promise.all([
    getWalletCap(user.sub),
    db.execute({ sql: `SELECT ${column} as wallet_balance FROM users WHERE id = ?`, args: [user.sub] }),
    // Joined so a transfer/shared-wallet entry can be labeled with an
    // actual name ("Sent to Grace", "Order payment by Grace") instead of
    // a bare user id — actor_id is who spent it when that's not the
    // wallet owner, counterparty_id is the other side of a transfer.
    loadLedger({ userId: user.sub, environment, q: c.req.query("q"), limit: 50 }),
  ]);
  const balance = Number((balanceRes.rows[0] as Row)?.wallet_balance ?? 0);
  // Bonus money (deposit bonuses, cashback, fee top-ups) is shown beside the cash balance; it can only be spent, never withdrawn.
  const credit = await getCreditBalance(user.sub, environment).catch(() => 0);
  const frozen = await walletIsFrozen(user.sub);
  return c.json({ walletType: "personal", personalWalletActive: await personalWalletIsActive(user.sub), balance, credit, total: balance + credit, cap, verified, frozen, ledger: ledgerRes });
});

const topupSchema = z.object({
  amount: z.number().int().positive(),
  msisdn: z.string().min(6).max(20).optional(),
  method: z.enum(["mobile_money", "card"]).optional(),
  // Only sent when the admin has Peebee's own card form switched on (Flutterwave direct card).
  card: cardSchema.optional(),
});

walletRoutes.post("/wallet/topup", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const user = c.get("user");
  const parsed = topupSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { amount, method, card } = parsed.data;
  const msisdn = method === "card" ? undefined : parsed.data.msisdn;

  const environment = await getPlatformEnvironment();
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const [{ cap }, settings, balanceRes] = await Promise.all([
    getWalletCap(user.sub),
    getWalletSettings(),
    db.execute({ sql: `SELECT ${column} as wallet_balance FROM users WHERE id = ?`, args: [user.sub] }),
  ]);
  if (amount > settings.maxTopup) {
    return c.json({ error: "topup_too_large", message: `A single top-up can't exceed UGX ${settings.maxTopup.toLocaleString()}` }, 400);
  }
  const balance = Number((balanceRes.rows[0] as Row)?.wallet_balance ?? 0);
  if (balance + amount > cap) {
    return c.json(
      { error: "cap_exceeded", message: `That would put your wallet over its UGX ${cap.toLocaleString()} balance limit` },
      400,
    );
  }

  const topupId = newId("wtu");
  try {
    const initiated = await initiateCollection({
      referenceId: topupId,
      msisdn,
      amount,
      name: user.name,
      method,
      card,
      returnUrl: `${appBaseUrl("customer")}/wallet?topup_return=${topupId}`,
      forceMock: environment === "sandbox",
    });

    await db.execute({
      sql: `INSERT INTO wallet_topups (id, user_id, amount, provider, provider_ref, method, msisdn, network, status, environment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [
        topupId,
        user.sub,
        amount,
        initiated.provider,
        initiated.providerRef,
        method ?? (initiated.network ? "mobile_money" : "card"),
        msisdn ?? null,
        initiated.network,
        environment,
      ],
    });

    return c.json({ topupId, status: "pending", network: initiated.network, redirectUrl: initiated.redirectUrl, nextAction: initiated.nextAction }, 201);
  } catch (err) {
    if (err instanceof UnsupportedNetworkError) {
      return c.json({ error: "unsupported_network", message: err.message }, 400);
    }
    console.error("Wallet top-up request failed:", err);
    return c.json(
      paymentProviderErrorResponse(err, "Couldn't start that top-up just now. Please try again."),
      paymentProviderHttpStatus(err),
    );
  }
});

walletRoutes.get("/wallet/topups/:id/refresh", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const res = await db.execute({ sql: "SELECT * FROM wallet_topups WHERE id = ? AND user_id = ?", args: [id, user.sub] });
  const topup = res.rows[0] as Row | undefined;
  if (!topup) return c.json({ error: "not_found" }, 404);
  if (topup.status !== "pending") return c.json({ topup });

  // The same settlement the background sweep and the provider webhooks use (./topup-settle.ts).
  const status = await settleCustomerTopup(topup);
  return c.json({ topup: { ...topup, status } });
});

// ---------------------------------------------------------------------------
// Peer-to-peer transfers — still closed-loop (funds move between two
// customer wallets, never out to mobile money).
// ---------------------------------------------------------------------------

const transferSchema = z.object({
  recipient: z.string().min(3).max(200).optional(),
  recipientId: z.string().min(3).max(80).optional(),
  amount: z.number().int().positive(),
  note: z.string().max(140).optional(),
  fromWalletId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(80).optional(),
}).refine((d) => !!(d.recipient || d.recipientId), { message: "recipient" });

walletRoutes.post("/wallet/transfer", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const user = c.get("user");
  const parsed = transferSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { recipient, recipientId, amount, note, idempotencyKey } = parsed.data;
  const fromWalletId = !parsed.data.fromWalletId || parsed.data.fromWalletId === "primary" ? undefined : parsed.data.fromWalletId;

  const accountSettings = await getWalletAccountSettings();
  // A phone/email lookup that moves money is an enumeration target —
  // rate-limited per sender, with the limit set by an admin.
  const quota = await consume(`wallet-transfer:${user.sub}`, accountSettings.transferPerHour, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many transfers just now. Please try again later.");

  const target = recipientId
    ? await (async () => {
        const row = await findActiveUserWithRoleById(recipientId, "customer");
        return row ? { id: row.id, name: row.name } : null;
      })()
    : await resolveCustomerByIdentifier(recipient ?? "");
  if (!target) {
    return c.json({ error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." }, 404);
  }
  if (target.id === user.sub) {
    return c.json({ error: "self_transfer", message: "You can't send money to your own account. Move funds between your accounts instead." }, 400);
  }

  const source = await assertSpendSource(user.sub, fromWalletId, accountSettings.sendFromShared);
  if (source.error) return c.json(source.error.body, source.error.status);
  if (await walletIsFrozen(source.ownerId, fromWalletId)) return c.json(frozenBody(), 409);

  const environment = await getPlatformEnvironment();
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const [{ cap: recipientCap }, recipientBalanceRes] = await Promise.all([
    getWalletCap(target.id),
    db.execute({ sql: `SELECT ${column} as wallet_balance FROM users WHERE id = ?`, args: [target.id] }),
  ]);
  const recipientBalance = Number((recipientBalanceRes.rows[0] as Row)?.wallet_balance ?? 0);
  if (recipientBalance + amount > recipientCap) {
    return c.json(
      { error: "recipient_cap_exceeded", message: `That would put ${target.name}'s account over their balance limit.` },
      400,
    );
  }

  const result = await runIdempotentTransfer(
    user.sub,
    idempotencyKey,
    "transfer",
    { toUserId: target.id, amount, environment, note, fromWalletId: fromWalletId ?? null, toWalletId: null },
    async () => {
      const moved = await transferWallet({
        fromUserId: source.ownerId,
        toUserId: target.id,
        amount,
        environment,
        note,
        fromWalletId,
        actorId: source.ownerId === user.sub ? undefined : user.sub,
        idempotencyKey,
      });
      if (!moved) {
        const frozen = await walletIsFrozen(source.ownerId, fromWalletId);
        return frozen
          ? { status: 409, body: frozenBody() }
          : { status: 409, body: { error: "insufficient_balance", message: "You don't have enough in that account." } };
      }
      return { status: 201, body: { balance: moved.fromBalance, recipientName: target.name } };
    },
  );
  return c.json(result.body, result.status as 200);
});

// ---------------------------------------------------------------------------
// Shared wallet access — ongoing, revocable "spend from my wallet on your
// own orders" grants between two customers. The balance always stays the
// owner's; an active grant just lets the grantee pay for their own orders
// out of it (see orders/routes.ts POST /orders/:id/fund's walletOwnerId).
// ---------------------------------------------------------------------------

const shareInviteSchema = z.object({
  recipient: z.string().min(3).max(200),
  // Which of the owner's wallets this grant applies to — omitted (or
  // "primary") means their original wallet, matching every share created
  // before multi-wallet support existed.
  walletId: z.string().optional(),
});

walletRoutes.post("/wallet/shares", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const user = c.get("user");
  const parsed = shareInviteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const walletId = !parsed.data.walletId || parsed.data.walletId === "primary" ? null : parsed.data.walletId;

  const shareSettings = await getWalletAccountSettings();
  const quota = await consume(`wallet-share-invite:${user.sub}`, shareSettings.sharePerHour, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many invites just now. Please try again later.");

  const target = await resolveCustomerByIdentifier(parsed.data.recipient);
  if (!target) {
    return c.json({ error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." }, 404);
  }
  if (target.id === user.sub) {
    return c.json({ error: "self_share", message: "You can't share your wallet with yourself." }, 400);
  }
  if (walletId) {
    const owned = await db.execute({ sql: "SELECT 1 FROM wallets WHERE id = ? AND owner_id = ?", args: [walletId, user.sub] });
    if (owned.rows.length === 0) return c.json({ error: "not_found", message: "That wallet doesn't exist" }, 404);
  }

  const existing = await db.execute({
    sql: `SELECT id FROM wallet_shares WHERE owner_id = ? AND grantee_id = ? AND status IN ('pending', 'active')
          AND wallet_id ${walletId ? "= ?" : "IS NULL"}`,
    args: walletId ? [user.sub, target.id, walletId] : [user.sub, target.id],
  });
  if (existing.rows.length > 0) {
    return c.json({ error: "already_shared", message: `You've already shared that wallet with ${target.name}.` }, 409);
  }

  const id = newId("wsh");
  await db.execute({
    sql: "INSERT INTO wallet_shares (id, owner_id, grantee_id, status, wallet_id) VALUES (?, ?, ?, 'pending', ?)",
    args: [id, user.sub, target.id, walletId],
  });
  return c.json({ id, granteeName: target.name, status: "pending" }, 201);
});

/** Everything the wallet screen needs to render both directions: shares
 * this customer has extended to others ("granted"), and shares extended
 * to them ("received") — pending ones to accept/decline, active ones to
 * spend from or walk away from. A pending owner's balance isn't included
 * (they haven't accepted yet); it only appears once status is "active". */
walletRoutes.get("/wallet/shares", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const user = c.get("user");
  const environment = await getPlatformEnvironment();
  const balanceColumn = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const walletColumn = environment === "sandbox" ? "balance_sandbox" : "balance";
  const [grantedRes, receivedRes] = await Promise.all([
    db.execute({
      sql: `SELECT ws.id, ws.grantee_id, u.name as grantee_name, u.phone as grantee_phone, ws.status, ws.created_at, ws.responded_at,
                   ws.wallet_id, COALESCE(w.name, owner.primary_wallet_name, 'Main Wallet') as wallet_name
            FROM wallet_shares ws
            JOIN users u ON u.id = ws.grantee_id
            JOIN users owner ON owner.id = ws.owner_id
            LEFT JOIN wallets w ON w.id = ws.wallet_id
            WHERE ws.owner_id = ? ORDER BY ws.created_at DESC`,
      args: [user.sub],
    }),
    db.execute({
      sql: `SELECT ws.id, ws.owner_id, u.name as owner_name, u.phone as owner_phone, ws.status, ws.created_at, ws.responded_at,
                   ws.wallet_id, COALESCE(w.name, u.primary_wallet_name, 'Main Wallet') as wallet_name,
                   COALESCE(w.${walletColumn}, u.${balanceColumn}) as owner_balance
            FROM wallet_shares ws
            JOIN users u ON u.id = ws.owner_id
            LEFT JOIN wallets w ON w.id = ws.wallet_id
            WHERE ws.grantee_id = ? ORDER BY ws.created_at DESC`,
      args: [user.sub],
    }),
  ]);
  const hidePhone = (row: Row, phoneKey: string) => {
    const { [phoneKey]: phone, ...rest } = row;
    return { ...rest, masked_phone: phone ? maskPhone(String(phone)) : null };
  };
  const received = (receivedRes.rows as Row[]).map((r) => hidePhone({
    ...r,
    owner_balance: r.status === "active" ? r.owner_balance : null,
  }, "owner_phone"));
  return c.json({ granted: (grantedRes.rows as Row[]).map((r) => hidePhone(r, "grantee_phone")), received });
});

walletRoutes.post("/wallet/shares/:id/accept", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const res = await db.execute({
    sql: "UPDATE wallet_shares SET status = 'active', responded_at = datetime('now') WHERE id = ? AND grantee_id = ? AND status = 'pending'",
    args: [id, user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ status: "active" });
});

walletRoutes.post("/wallet/shares/:id/decline", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const res = await db.execute({
    sql: "UPDATE wallet_shares SET status = 'declined', responded_at = datetime('now') WHERE id = ? AND grantee_id = ? AND status = 'pending'",
    args: [id, user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ status: "declined" });
});

/** Either side can end an active (or still-pending) share — the owner
 * revoking access, or the grantee giving it up themselves. */
walletRoutes.post("/wallet/shares/:id/revoke", requireAuth, requireRole("customer"), requireActivePersonalWallet, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") as string;
  const res = await db.execute({
    sql: `UPDATE wallet_shares SET status = 'revoked', responded_at = datetime('now')
          WHERE id = ? AND (owner_id = ? OR grantee_id = ?) AND status IN ('pending', 'active')`,
    args: [id, user.sub, user.sub],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ status: "revoked" });
});
