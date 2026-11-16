import { db } from "../db/client.js";
import { maskPhone } from "./mask.js";

type Row = Record<string, unknown>;

const BASE = `SELECT wl.*, actor.name as actor_name, cp.name as counterparty_name, cp.phone as counterparty_phone`;

/**
 * Ledger rows for one customer, with a merchant name and logo when the
 * line paid an order, and a masked phone for the other person on a transfer.
 * The join is best-effort: a database without those columns still returns
 * the plain ledger.
 */
export async function loadLedger(input: {
  userId: string;
  environment: string;
  walletId?: string | null;
  limit?: number;
  q?: string;
}): Promise<Row[]> {
  const walletClause = input.walletId === undefined
    ? ""
    : input.walletId
      ? "AND wl.wallet_id = ?"
      : "AND wl.wallet_id IS NULL";
  const search = input.q?.trim();
  const searchClause = search ? "AND (cp.name LIKE ? OR wl.note LIKE ? OR wl.type LIKE ?)" : "";
  const args: Array<string | number | null> = [input.userId, input.environment];
  if (input.walletId) args.push(input.walletId);
  if (search) {
    const like = `%${search.replace(/[%_]/g, "")}%`;
    args.push(like, like, like);
  }
  args.push(input.limit ?? 100);

  const rich = `${BASE},
            COALESCE(r.name, s.name) as merchant_name,
            CASE WHEN r.logo_key IS NOT NULL AND r.logo_key != '' THEN '/v1/restaurants/' || r.id || '/logo' ELSE NULL END as merchant_logo,
            s.logo_url as store_logo
          FROM wallet_ledger wl
          LEFT JOIN users actor ON actor.id = wl.actor_id
          LEFT JOIN users cp ON cp.id = wl.counterparty_id
          LEFT JOIN orders o ON o.id = wl.order_id
          LEFT JOIN restaurants r ON r.id = o.restaurant_id
          LEFT JOIN stores s ON s.id = o.store_id
          WHERE wl.user_id = ? AND wl.environment = ? ${walletClause} ${searchClause}
          ORDER BY wl.created_at DESC LIMIT ?`;
  const plain = `${BASE}
          FROM wallet_ledger wl
          LEFT JOIN users actor ON actor.id = wl.actor_id
          LEFT JOIN users cp ON cp.id = wl.counterparty_id
          WHERE wl.user_id = ? AND wl.environment = ? ${walletClause} ${searchClause}
          ORDER BY wl.created_at DESC LIMIT ?`;
  try {
    const res = await db.execute({ sql: rich, args });
    return (res.rows as Row[]).map(present);
  } catch {
    const res = await db.execute({ sql: plain, args });
    return (res.rows as Row[]).map(present);
  }
}

function present(row: Row): Row {
  const phone = row.counterparty_phone;
  const storeLogo = typeof row.store_logo === "string" && row.store_logo ? row.store_logo : null;
  const merchantLogo = (typeof row.merchant_logo === "string" && row.merchant_logo) || storeLogo;
  const { counterparty_phone: _phone, store_logo: _store, ...rest } = row;
  return {
    ...rest,
    merchant_logo: merchantLogo,
    masked_phone: phone ? maskPhone(String(phone)) : null,
  };
}

/** Distinct merchants the customer paid this period, for the spending widget. */
export async function loadSpending(userId: string, environment: string, period: "week" | "month" | "all") {
  const since = period === "week" ? "-7 days" : period === "month" ? "-30 days" : "-100 years";
  let totalIn = 0;
  let totalOut = 0;
  try {
    const totals = await db.execute({
      sql: `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_in,
                   COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) as total_out
            FROM wallet_ledger
            WHERE user_id = ? AND environment = ? AND created_at >= datetime('now', ?)`,
      args: [userId, environment, since],
    });
    const row = totals.rows[0] as Row | undefined;
    totalIn = Number(row?.total_in ?? 0);
    totalOut = Number(row?.total_out ?? 0);
  } catch {
    /* the ledger read failed; the screen still opens */
  }
  try {
    const merchants = await db.execute({
      sql: `SELECT COALESCE(r.name, s.name) as name,
                   CASE WHEN r.logo_key IS NOT NULL AND r.logo_key != '' THEN '/v1/restaurants/' || r.id || '/logo' ELSE s.logo_url END as logo,
                   COALESCE(r.id, s.id) as id
            FROM wallet_ledger wl
            JOIN orders o ON o.id = wl.order_id
            LEFT JOIN restaurants r ON r.id = o.restaurant_id
            LEFT JOIN stores s ON s.id = o.store_id
            WHERE wl.user_id = ? AND wl.environment = ? AND wl.amount < 0 AND wl.type = 'order_payment'
                  AND wl.created_at >= datetime('now', ?)
                  AND COALESCE(r.name, s.name) IS NOT NULL
            GROUP BY COALESCE(r.id, s.id)
            ORDER BY MAX(wl.created_at) DESC
            LIMIT 8`,
      args: [userId, environment, since],
    });
    return {
      period,
      totalIn,
      totalOut,
      merchants: (merchants.rows as Row[]).map((m) => ({
        id: String(m.id ?? ""),
        name: String(m.name ?? ""),
        logo: m.logo ? String(m.logo) : null,
      })),
    };
  } catch {
    return { period, totalIn, totalOut, merchants: [] as { id: string; name: string; logo: string | null }[] };
  }
}
