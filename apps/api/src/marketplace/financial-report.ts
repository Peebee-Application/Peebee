import { db } from "../db/client.js";
import { hasColumn, hasTable, tablesExist } from "../lib/schema.js";

type Row = Record<string, unknown>;
export type ReportScope = {storeId: string; merchantId: string; environment: "live" | "sandbox"; from: string; until: string; outletId?: string; page: number};
const LIMIT = 100; // Response-size safety rail; pagination never changes the financial totals.
export async function financialReport(scope: ReportScope) {
  const {storeId, merchantId, environment, from, until, outletId, page} = scope;
  const posReady = await hasTable("store_pos_sales");
  const snapshotReady = posReady && await hasColumn("store_pos_sales", "environment") && await hasColumn("store_pos_sales", "cost_snapshot_json");
  const journalReady = await hasTable("store_financial_entries");
  const ledgerReady = await tablesExist(["ledger_transactions", "ledger_entries", "ledger_accounts"]);
  const offset = (page - 1) * LIMIT;
  const posWhere = "store_id=? AND created_at>=? AND created_at<?" + (outletId ? " AND outlet_id=?" : "");
  const posArgs = [storeId, from, until, ...(outletId ? [outletId] : [])];
  const scopedPosWhere = posWhere + (snapshotReady ? " AND environment=?" : " AND 0");
  const scopedPosArgs = [...posArgs, ...(snapshotReady ? [environment] : [])];
  const posTotals = snapshotReady ? (await db.execute({sql: `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal_amount),0) AS subtotal,
    COALESCE(SUM(discount_amount+loyalty_redeemed_ugx),0) AS discounts, COALESCE(SUM(total_amount),0) AS recordedTotal
    FROM store_pos_sales WHERE ${scopedPosWhere}`, args: scopedPosArgs})).rows[0] : {count: 0, subtotal: 0, discounts: 0, recordedTotal: 0};
  const legacy = posReady ? (await db.execute({sql: `SELECT COUNT(*) AS count,COALESCE(SUM(total_amount),0) AS total FROM store_pos_sales
    WHERE ${posWhere}${snapshotReady ? " AND environment IS NULL" : ""}`, args: posArgs})).rows[0] : {count: 0, total: 0};
  const pos = snapshotReady ? (await db.execute({sql: `SELECT id,created_at,outlet_id,receipt_code,payment_method,total_amount,discount_amount,loyalty_redeemed_ugx,cost_snapshot_json
    FROM store_pos_sales WHERE ${scopedPosWhere} ORDER BY created_at,id LIMIT ? OFFSET ?`, args: [...scopedPosArgs, LIMIT+1, offset]})).rows as Row[] : [];
  const ledgerWhere = `a.owner_type='merchant' AND a.owner_id=? AND a.environment=? AND t.created_at>=? AND t.created_at<?`
    + (outletId ? " AND t.reference_type='merchant_payment' AND EXISTS (SELECT 1 FROM merchant_payments mp WHERE mp.id=t.reference_id AND mp.merchant_id=a.owner_id AND mp.outlet_id=?)" : "");
  const ledgerArgs = [merchantId, environment, from, until, ...(outletId ? [outletId] : [])];
  const ledgerTotals = ledgerReady ? (await db.execute({sql: `SELECT t.kind, a.purpose, SUM(e.amount) AS amount, COUNT(DISTINCT t.id) AS transactions
    FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id JOIN ledger_transactions t ON t.id=e.transaction_id
    WHERE ${ledgerWhere} GROUP BY t.kind,a.purpose ORDER BY t.kind,a.purpose`, args: ledgerArgs})).rows : [];
  const ledger = ledgerReady ? (await db.execute({sql: `SELECT e.id,t.id AS transaction_id,t.created_at,t.kind,t.reference_type,t.reference_id,a.purpose,e.amount,
    CASE WHEN t.kind IN ('digital_sale','digital_refund') THEN (SELECT COALESCE(-SUM(pe.amount),0) FROM ledger_entries pe JOIN ledger_accounts pa ON pa.id=pe.account_id WHERE pe.transaction_id=t.id AND pa.owner_type='customer' AND pa.purpose='wallet_payable') END AS buyer_amount_ugx,
    CASE WHEN t.kind IN ('digital_sale','digital_refund') THEN (SELECT COALESCE(SUM(pe.amount),0) FROM ledger_entries pe JOIN ledger_accounts pa ON pa.id=pe.account_id WHERE pe.transaction_id=t.id AND pa.owner_type='platform' AND pa.purpose='digital_sales_commission') END AS platform_fee_ugx
    FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id JOIN ledger_transactions t ON t.id=e.transaction_id
    WHERE ${ledgerWhere} ORDER BY t.created_at,e.id LIMIT ? OFFSET ?`, args: [...ledgerArgs,LIMIT+1,offset]})).rows : [];
  const entryWhere = "store_id=? AND environment=? AND occurred_at>=? AND occurred_at<?" + (outletId ? " AND outlet_id=?" : "");
  const entryArgs = [storeId, environment, from, until, ...(outletId ? [outletId] : [])];
  const expenseTotals = journalReady ? (await db.execute({sql: `SELECT category,SUM(amount_ugx) AS amount,COUNT(*) AS count FROM store_financial_entries WHERE ${entryWhere} AND voided_at IS NULL GROUP BY category ORDER BY category`, args: entryArgs})).rows : [];
  const entries = journalReady ? (await db.execute({sql: `SELECT * FROM store_financial_entries WHERE ${entryWhere} ORDER BY occurred_at,id LIMIT ? OFFSET ?`, args: [...entryArgs,LIMIT+1,offset]})).rows : [];
  const balances = await hasTable("merchant_balances") && !outletId ? (await db.execute({sql: "SELECT pending,held,available,settling,updated_at FROM merchant_balances WHERE merchant_id=? AND environment=?", args: [merchantId,environment]})).rows[0] ?? null : null;
  return {
    scope: {environment, from, until, outletId: outletId ?? null, currency: "UGX"},
    availability: {pos: posReady, posSnapshots: snapshotReady, expenseJournal: journalReady, ledger: ledgerReady},
    summary: {pos: posTotals, unassignedHistoricalPos: legacy, ledger: ledgerTotals, expenses: expenseTotals, currentBalances: balances},
    pos: pos.slice(0,LIMIT).map(row => {
      let costUgx: number | null = null;
      try {
        const items = JSON.parse(String(row.cost_snapshot_json));
        if (Array.isArray(items) && items.length && items.every(i => i.unitCostUgx != null && Number.isSafeInteger(i.unitCostUgx) && i.unitCostUgx>=0 && Number.isSafeInteger(i.quantity) && i.quantity>0)) costUgx = items.reduce((sum,i) => sum+i.unitCostUgx*i.quantity,0);
      } catch { /* Historical missing costs remain unknown. */ }
      const {cost_snapshot_json: _snapshot, ...safe} = row;
      return {...safe,costUgx};
    }),
    ledger: ledger.slice(0,LIMIT), entries: entries.slice(0,LIMIT), page,
    hasMore: pos.length>LIMIT || ledger.length>LIMIT || entries.length>LIMIT,
    accounting: {combinedProfitUgx: null, note: "POS records and ledger money movements are separate evidence and may describe the same sale. They are not added together. Historical unassigned POS is excluded from live/sandbox totals. Costs shown are sale-time snapshots; expenses and taxes are recorded entries, not inferred. Settlement is a balance movement, not another sale. Branch filtering excludes digital and unassigned merchant-wide transactions. Current balances are current, not the selected period's closing balances."},
  };
}
