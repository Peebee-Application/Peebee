import { db, type DbStatement } from "../db/client.js";
import { hasTable } from "../lib/schema.js";
import { postLedgerTransaction } from "../ledger/service.js";
import type { PlatformEnvironment } from "../lib/settings.js";
type Row = Record<string, unknown>;
export async function listPurchasesReady() { return await hasTable("list_merchant_purchases") && await hasTable("list_merchant_purchase_items"); }
export async function listPurchase(paymentId: string) {
    if (!await listPurchasesReady())
        return null;
    return (await db.execute({ sql: "SELECT * FROM list_merchant_purchases WHERE payment_id=?", args: [paymentId] })).rows[0] as Row | undefined ?? null;
}
export async function purchaseDetails(paymentId: string) {
    const purchase = await listPurchase(paymentId);
    if (!purchase)
        return {};
    const items = (await db.execute({ sql: "SELECT list_item_id, name, quantity, amount FROM list_merchant_purchase_items WHERE payment_id=?", args: [paymentId] })).rows;
    return { purchase_code: purchase.code, delivery_pending: purchase.status === "pending_delivery" && !purchase.delivered_at, purchase_status: purchase.status, items };
}
export function purchaseReservation(paymentId: string, orderId: string, amount: number, code: string, items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    amount: number;
}>): DbStatement[] {
    return [{ sql: `INSERT INTO list_merchant_purchases(payment_id,order_id,code,amount,reserved_available)
    SELECT ?,?,?,?,b.principal_funded-b.principal_allocated-b.principal_refunded-COALESCE((SELECT SUM(p.amount) FROM list_merchant_purchases p WHERE p.order_id=b.order_id AND p.status='awaiting_merchant'),0)
    FROM order_budgets b WHERE b.order_id=?`, args: [paymentId, orderId, code, amount, orderId] },
        ...items.map(item => ({ sql: "INSERT INTO list_merchant_purchase_items(payment_id,list_item_id,order_id,name,quantity,amount) VALUES(?,?,?,?,?,?)", args: [paymentId, item.itemId, orderId, item.name, item.quantity, item.amount] }))];
}
/** A CHECK in the same atomic ledger batch prevents cancellation/confirmation races. */
export function purchaseConfirmationStatements(paymentId: string, actorId: string): DbStatement[] {
    return [{ sql: `UPDATE list_merchant_purchases SET lock_check=CASE WHEN status='awaiting_merchant' AND EXISTS (
    SELECT 1 FROM merchant_payments mp JOIN orders o ON o.id=mp.order_id JOIN merchants m ON m.id=mp.merchant_id JOIN merchant_outlets outlet ON outlet.id=mp.outlet_id
    WHERE mp.id=payment_id AND mp.status='awaiting_confirmation' AND mp.rider_confirmed_at IS NOT NULL AND mp.merchant_confirmed_at IS NOT NULL
    AND o.rider_id=mp.rider_id AND o.stage IN ('Shop','Substitute','Approve') AND m.status='active' AND outlet.status='active'
    AND EXISTS(SELECT 1 FROM merchant_kyc_cases k WHERE k.merchant_id=m.id AND k.status='approved')
    AND EXISTS(SELECT 1 FROM merchant_members member WHERE member.merchant_id=m.id AND member.user_id=? AND member.status='active' AND (member.role!='cashier' OR member.outlet_id=mp.outlet_id))) THEN 1 ELSE 0 END WHERE payment_id=?`, args: [actorId, paymentId] },
        { sql: "UPDATE list_merchant_purchases SET status='pending_delivery' WHERE payment_id=?", args: [paymentId] }];
}
/** Only a customer-confirmed handover can release the delivery hold. Risk holds remain held. */
export async function releaseListPurchases(orderId: string, actorId: string) {
    if (!await listPurchasesReady())
        return;
    await db.execute({sql:`UPDATE list_merchant_purchases SET delivered_at=datetime('now') WHERE order_id=? AND status='pending_delivery' AND delivered_at IS NULL AND EXISTS(SELECT 1 FROM orders WHERE id=order_id AND stage IN ('Handover','Settle'))`,args:[orderId]});
    const eligible = await db.execute({ sql: `SELECT p.payment_id,mp.amount,mp.merchant_id,mp.environment FROM list_merchant_purchases p JOIN merchant_payments mp ON mp.id=p.payment_id
    JOIN orders o ON o.id=p.order_id WHERE p.order_id=? AND p.status='pending_delivery' AND mp.status='held' AND mp.risk_state='passed' AND o.stage IN ('Handover','Settle')`, args: [orderId] });
    for (const row of eligible.rows as Row[]) {
        const amount = Number(row.amount), environment = row.environment as PlatformEnvironment, paymentId = String(row.payment_id);
        await postLedgerTransaction({ kind: "list_purchase_received", idempotencyKey: `list-purchase:${paymentId}:received`, environment, actorId, referenceType: "merchant_payment", referenceId: paymentId,
            description: "Customer confirmed receipt of list purchase", postings: [
                { ownerType: "merchant", ownerId: String(row.merchant_id), purpose: "payable_held", environment, amount: -amount },
                { ownerType: "merchant", ownerId: String(row.merchant_id), purpose: "payable_available", environment, amount }
            ], additionalStatements: [
                { sql: `UPDATE list_merchant_purchases SET lock_check=CASE WHEN status='pending_delivery' AND EXISTS(SELECT 1 FROM merchant_payments mp JOIN orders o ON o.id=mp.order_id WHERE mp.id=payment_id AND mp.status='held' AND mp.risk_state='passed' AND o.stage IN ('Handover','Settle')) THEN 1 ELSE 0 END WHERE payment_id=?`, args: [paymentId] },
                { sql: "UPDATE merchant_balances SET held=held-?,available=available+?,updated_at=datetime('now') WHERE merchant_id=? AND environment=?", args: [amount, amount, row.merchant_id, environment] },
                { sql: "UPDATE merchant_payments SET status='available',available_at=datetime('now'),updated_at=datetime('now') WHERE id=?", args: [paymentId] },
                { sql: "UPDATE list_merchant_purchases SET status='released',delivered_at=datetime('now') WHERE payment_id=?", args: [paymentId] }
            ] });
    }
}
/** Digitally funded list orders cannot leave the shop with unconfirmed or missing purchases. */
export async function assertListPurchasesReadyForDelivery(orderId: string) {
    if (!await listPurchasesReady())
        return;
    if (!(await db.execute({ sql: "SELECT 1 FROM orders WHERE id=? AND type='shopping' AND funds_model='merchant_allocations_v1' AND restaurant_id IS NULL AND store_id IS NULL", args: [orderId] })).rows.length)
        return;
    if ((await db.execute({ sql: "SELECT 1 FROM list_merchant_purchases WHERE order_id=? AND status='awaiting_merchant' LIMIT 1", args: [orderId] })).rows.length)
        throw new Error("A merchant must confirm the remaining purchase requests.");
    const missing = await db.execute({ sql: `SELECT li.id FROM list_items li JOIN orders o ON o.list_id=li.list_id WHERE o.id=?
    AND NOT EXISTS(SELECT 1 FROM list_merchant_purchase_items pi JOIN merchant_payments mp ON mp.id=pi.payment_id WHERE pi.order_id=o.id AND pi.list_item_id=li.id AND pi.active=1 AND mp.status IN ('held','available','settlement_pending','paid'))
    AND NOT EXISTS(SELECT 1 FROM substitutions s WHERE s.order_id=o.id AND s.original_name=li.name AND s.status='approved' AND s.substitute_name='Not available') LIMIT 1`, args: [orderId] });
    if (missing.rows.length)
        throw new Error("Record all remaining item purchases, or get customer approval for unavailable items, before starting delivery.");
}
