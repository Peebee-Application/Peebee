/**
 * Where the customer's money went, recorded for every settled ride and delivery (table payment_splits): the customer's
 * payment, the gateway fee, taxes, Peebee's commission, the maintenance reserve and what the rider or driver received.
 * The numbers come from the same waterfall the admin's calculator shows (packages/shared/src/pricing.ts), fed with the
 * commission that was actually taken, so the books and the preview always agree.
 */
import { roundNearest, commissionAmount, computeWaterfall, tieredCommissionPercent, type MoneyModule, type Waterfall } from "@peebee/shared";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import type { PlatformEnvironment } from "../lib/settings.js";
import { getIncentiveConfig } from "../offers/config.js";
import { creditActiveWallet, riderFacts } from "../offers/incentives.js";
import { serviceOfOrder } from "../offers/service.js";
import { debitProviderWorkWallet } from "../wallet/provider-work-wallet.js";
import { getMoneyFlowConfig } from "./config.js";

type Row = Record<string, unknown>;

export function moduleOfOrder(meta: Awaited<ReturnType<typeof serviceOfOrder>>): MoneyModule {
  switch (meta.service) {
    case "ride.boda": return "ride_boda";
    case "ride.car": return "ride_car";
    case "delivery.shopping": return "delivery_shopping";
    default: return "delivery_parcel";
  }
}

/**
 * Any extra commission the admin set under Money flow for this kind of trip (0 by default, so nothing changes until it is
 * set). A rider's monthly ride count can step the rate down when the "commission tiers" incentive is on.
 */
export async function extraCommissionFor(order: Row, gross: number): Promise<number> {
  try {
    if (!order.rider_id || gross <= 0) return 0;
    const [flow, incentives, meta] = await Promise.all([getMoneyFlowConfig(), getIncentiveConfig(), serviceOfOrder(order)]);
    const rule = flow.modules[moduleOfOrder(meta)].commission;
    const env: PlatformEnvironment = order.environment === "sandbox" ? "sandbox" : "live";
    const facts = await riderFacts(String(order.rider_id), env, new Date(), incentives.tzOffsetMinutes);
    const tier = tieredCommissionPercent(incentives, facts.ridesThisMonth);
    if (tier != null) return roundNearest((gross * tier) / 100);
    return commissionAmount(rule, { gross, monthlyVolume: facts.ridesThisMonth });
  } catch (err) {
    console.error("Extra commission lookup failed; none is taken", err);
    return 0;
  }
}

/** Takes the extra commission from the rider's wallet. It may go below zero: it nets against their next payout. */
export async function takeExtraCommission(order: Row, amount: number, car: boolean): Promise<void> {
  if (amount <= 0 || !order.rider_id) return;
  const env: PlatformEnvironment = order.environment === "sandbox" ? "sandbox" : "live";
  if (car) {
    await debitProviderWorkWallet({
      providerType: "car", providerId: String(order.rider_id), amount, environment: env, kind: "transfer_out",
      referenceType: "car_order_commission", referenceId: String(order.id), idempotencyKey: `car-order-commission:${String(order.id)}`,
      allowNegative: true, legacyUserId: String(order.rider_id), note: "Peebee commission",
    });
  } else {
    const col = env === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
    await db.execute({ sql: `UPDATE riders SET ${col} = ${col} - ?, updated_at = datetime('now') WHERE user_id = ?`, args: [amount, String(order.rider_id)] });
  }
}

export type SplitFacts = {
  /** What the customer's payment actually came to (all collections for the order). */
  collected: number;
  /** Commission the older mechanisms took (delivery commission, or the car platform share). */
  legacyCommission: number;
  extraCommission: number;
  commissionRelief: number;
  serviceFee: number;
  processingFeeCustomer: number;
  /** Discount funded by Peebee on this order. */
  discount: number;
};

/** Records the split for one settled order. Never throws and never records an order twice. */
export async function recordOrderSplit(order: Row, facts: SplitFacts): Promise<Waterfall | null> {
  try {
    if (!(await hasTable("payment_splits"))) return null;
    const meta = await serviceOfOrder(order);
    const module = moduleOfOrder(meta);
    const flow = await getMoneyFlowConfig();
    const pay = (await db.execute({ sql: "SELECT provider, network FROM payments WHERE order_id = ? AND type = 'collection' AND status = 'successful' ORDER BY created_at LIMIT 1", args: [String(order.id)] })).rows[0] as Row | undefined;
    const provider = pay?.provider ? String(pay.provider) : null;
    const rail = order.payment_rail === "float" ? "cash" : provider === "wallet" || !provider ? "wallet" : pay?.network === "card" ? "card" : "mobile_money";
    const gross = Math.max(0, Number(order.final_total ?? order.estimated_total ?? 0));
    const env: PlatformEnvironment = order.environment === "sandbox" ? "sandbox" : "live";
    const w = computeWaterfall(flow, {
      gross, module, rail, provider: rail === "mobile_money" || rail === "card" ? provider : null, network: pay?.network ? String(pay.network) : null,
      commissionOverride: facts.legacyCommission + facts.extraCommission, commissionRelief: facts.commissionRelief, platformFundedDiscount: facts.discount,
    });
    await db.execute({
      sql: `INSERT OR IGNORE INTO payment_splits
              (id, order_id, module, rail, provider, network, environment, gross, customer_pays, collected, gateway_fee, gateway_fee_rule, tax_total, taxes, commission,
               commission_relief, extra_commission, maintenance, provider_share, platform_net, promo_cost, service_fee, processing_fee_customer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        newId("spl"), String(order.id), module, rail, provider, pay?.network ? String(pay.network) : null, env, gross, w.customerPays, facts.collected, w.gatewayFee, w.gatewayFeeRule,
        w.taxTotal, JSON.stringify(w.taxes), w.commission, w.commissionRelief, facts.extraCommission, w.maintenance, w.providerShare, w.platformNet, w.promoCost,
        facts.serviceFee, facts.processingFeeCustomer,
      ],
    });
    return w;
  } catch (err) {
    console.error("Recording the payment split failed; the order is settled regardless", err);
    return null;
  }
}

export { creditActiveWallet };
