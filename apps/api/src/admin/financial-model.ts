import { requirePermission } from "./permissions.js";
import { getAdsConfig } from "../ads/settings.js";
import { getChannelsConfig } from "../channels/settings.js";
import { getMoneyFlowConfig } from "../costing/config.js";
import { db } from "../db/client.js";
import { getLearnSettings } from "../education/settings.js";
import { getOptions } from "../lib/option-settings.js";
import { hasTable } from "../lib/schema.js";
import { getCarSettings, getMarketplaceSettings, getMonetizationSettings, getProSettings, getSetting } from "../lib/settings.js";
import { getServicesPlatformSettings } from "../services-platform/settings.js";
import { getTaxipressSettings } from "../taxipress/settings.js";
import { getLaundrySettings } from "../work/laundry-settings.js";
import { getWorkSettings } from "../work/settings.js";

type Fee = { channel: string; name: string; kind: "percent" | "flat" | "monthly"; value: number; note?: string };
const percent = (channel: string, name: string, value: number, note?: string): Fee => ({ channel, name, kind: "percent", value, note });
const flat = (channel: string, name: string, value: number): Fee => ({ channel, name, kind: "flat", value });
const monthly = (channel: string, name: string, value: number): Fee => ({ channel, name, kind: "monthly", value });
const monthlyEquivalent = (value: number, cadence: string) => value * (cadence === "daily" ? 365 / 12 : cadence === "weekly" ? 52 / 12 : 1);

async function fees(): Promise<Fee[]> {
  const [monetization, flow, car, pro, market, options, work, laundry, learn, taxi, services, creator, ads, taxiEnabled] = await Promise.all([
    getMonetizationSettings(), getMoneyFlowConfig(), getCarSettings(), getProSettings(), getMarketplaceSettings(),
    getOptions(["digital_commission_percent"]), getWorkSettings(), getLaundrySettings(), getLearnSettings(),
    getTaxipressSettings(), getServicesPlatformSettings(), getChannelsConfig(), getAdsConfig(), getSetting("taxipress_enabled"),
  ]);
  const delivery = monetization.deliveryCommissionEnabled;
  const paidPlans = market.enabled && market.proPricingMode === "paid";
  const media = creator.monetization;
  const taxiOn = taxiEnabled === "1";
  const fee = (channel: string, name: string, enabled: boolean, type: "flat" | "percent", amount: number): Fee =>
    type === "flat" ? flat(channel, name, enabled ? amount : 0) : percent(channel, name, enabled ? amount : 0);
  const rows = [
    percent("concierge", "Parcel delivery commission", delivery ? monetization.deliveryCommissionParcelPercent : 0, "Applies to the delivery fee."),
    percent("concierge", "Shopping delivery commission", delivery ? monetization.deliveryCommissionShoppingPercent : 0, "Applies to the delivery fee."),
    fee("concierge", "Concierge service fees", monetization.serviceFeeEnabled, monetization.serviceFeeType, monetization.serviceFeeValue),
    percent("concierge", "Processing fees retained by Peebee", monetization.processingFeeEnabled ? monetization.processingFeePercent : 0,
      "Configured charge on eligible payments. Forecast gateway costs separately."),
    percent("buy", "Standard marketplace commission", market.enabled ? market.commissionPercent : 0),
    percent("buy", "Elite marketplace commission", market.enabled && market.eliteEnabled ? market.eliteCommissionPercent : 0),
    percent("buy", "Digital sales commission", Number(options.digital_commission_percent)),
    monthly("buy", "Pro Store monthly plans", paidPlans ? market.proStorePriceUgx : 0),
    monthly("buy", "Pro Live monthly plans", paidPlans ? market.proLivePriceUgx : 0),
    monthly("buy", "Elite monthly plans", paidPlans && market.eliteEnabled ? market.elitePriceUgx : 0),
    percent("work", "Home services commission", work.enabled ? work.commissionPercent : 0, "Service-level rates can override this default."),
    percent("work", "Laundry provider commission", laundry.providerCommissionPercent),
    fee("work", "Laundry customer fees", laundry.customerFeeEnabled, laundry.customerFeeType, laundry.customerFeeValue),
    percent("rides", "Car platform share", car.enabled ? car.shares.platform : 0, "Applies to the car settlement pool. Category and driver agreements can vary."),
    monthly("rides", "Recurring rider access subscriptions", monetization.subscriptionEnabled && monetization.subscriptionMode === "recurring"
      ? monthlyEquivalent(monetization.subscriptionAmount, monetization.subscriptionCadence) : 0),
    monthly("rides", "Recurring Rider Pro subscriptions", pro.enabled && pro.recurringEnabled ? monthlyEquivalent(pro.recurringAmount, pro.recurringCadence) : 0),
    percent("learn", "Course and masterclass commission", learn.enabled && learn.paidCoursesEnabled ? learn.commissionPercent : 0),
    percent("learn", "Bundle commission", learn.enabled && learn.enrolmentsEnabled ? learn.commissionPercent : 0),
    percent("learn", "School pass commission", learn.enabled && learn.subscriptionsEnabled ? learn.commissionPercent : 0),
    percent("learn", "School fee commission", learn.enabled && learn.feesEnabled ? learn.commissionPercent : 0),
    fee("taxipress", "Digital seat commission", taxiOn, taxi.commissionType, taxi.commissionType === "flat" ? taxi.commissionFlatUgx : taxi.commissionDigitalPercent),
    fee("taxipress", "Cash seat commission", taxiOn, taxi.commissionType, taxi.commissionType === "flat" ? taxi.commissionFlatUgx : taxi.commissionCashPercent),
    flat("taxipress", "Seat-choice fees", taxiOn ? Number(await getSetting("taxipress_seat_choice_fee_ugx")) : 0),
    percent("services", "Services platform commission", services.enabled ? services.commissionPercent : 0),
    percent("creator-media", "Creator membership share", media.enabled && media.memberships ? media.membershipCutPercent : 0),
    percent("creator-media", "Paid post share", media.enabled && media.payPerView ? media.payPerViewCutPercent : 0),
    percent("creator-media", "Tips share", media.enabled && media.tips ? media.tipCutPercent : 0),
    percent("creator-media", "Live gift share", media.enabled && media.gifts ? media.giftCutPercent : 0),
    percent("creator-media", "Fundraising fee", creator.causes.enabled ? creator.causes.donationCutPercent : 0),
    percent("creator-media", "Ad revenue after creator share", ads.enabled ? 100 - ads.creatorSharePercent : 0),
  ];
  const boda = flow.modules.ride_boda.commission;
  if (boda.type === "percent") rows.push(percent("rides", "Boda fare commission", boda.percent, "Incentives and rounding may change individual settlements."));
  if (boda.type === "flat") rows.push(flat("rides", "Boda fare commission", boda.flat));
  return rows;
}

const settlementSources = [
  {
    table: "payment_splits",
    label: "Order settlement splits",
    sql: `SELECT module AS name, COUNT(*) AS orders, SUM(gross) AS volume,
                 SUM(commission + service_fee) AS fees
          FROM payment_splits WHERE environment = 'live' AND created_at >= ? AND created_at < ? GROUP BY module`,
  },
  {
    table: "taxipress_settlements",
    label: "TaxiPress bookings",
    sql: `SELECT payment_method AS name, COUNT(*) AS orders, SUM(fare) AS volume,
                 SUM(commission + platform_fees) AS fees
          FROM taxipress_settlements WHERE environment = 'live' AND created_at >= ? AND created_at < ? GROUP BY payment_method`,
  },
  {
    table: "work_jobs",
    label: "Settled Work jobs",
    sql: `SELECT service_type AS name, COUNT(*) AS orders, SUM(price_ugx) AS volume, SUM(commission_ugx) AS fees
          FROM work_jobs WHERE environment = 'live' AND status = 'settled' AND settled_at >= ? AND settled_at < ? GROUP BY service_type`,
  },
  {
    table: "edu_creator_purchases",
    label: "Learn creator purchases (school payments)",
    sql: `SELECT 'Courses' AS name, COUNT(*) AS orders, SUM(price_ugx) AS volume, SUM(commission_ugx) AS fees
          FROM edu_creator_purchases WHERE environment = 'live' AND status = 'settled' AND beneficiary_type = 'customer'
            AND price_ugx > 0 AND created_at >= ? AND created_at < ? HAVING COUNT(*) > 0`,
  },
  {
    table: "edu_bundle_purchases",
    label: "Learn bundle purchases",
    sql: `SELECT 'Bundles' AS name, COUNT(*) AS orders, SUM(price_paid_ugx) AS volume, SUM(commission_ugx) AS fees
          FROM edu_bundle_purchases WHERE environment = 'live' AND price_paid_ugx > 0
            AND created_at >= ? AND created_at < ? HAVING COUNT(*) > 0`,
  },
  {
    table: "edu_subscriptions",
    label: "Learn school passes",
    sql: `SELECT 'School passes' AS name, COUNT(*) AS orders, SUM(price_paid_ugx) AS volume, SUM(commission_ugx) AS fees
          FROM edu_subscriptions WHERE environment = 'live' AND price_paid_ugx > 0
            AND started_at >= ? AND started_at < ? HAVING COUNT(*) > 0`,
  },
  {
    table: "edu_fee_payments",
    label: "Learn school fee payments",
    sql: `SELECT 'School fees' AS name, COUNT(*) AS orders, SUM(amount_ugx) AS volume, SUM(commission_ugx) AS fees
          FROM edu_fee_payments WHERE environment = 'live' AND created_at >= ? AND created_at < ? HAVING COUNT(*) > 0`,
  },
  {
    table: "talent_charges",
    label: "Paid Jobs & Talent charges",
    sql: `SELECT kind AS name, NULL AS orders, NULL AS volume, SUM(amount_ugx) AS fees
          FROM talent_charges WHERE environment = 'live' AND status = 'paid'
            AND created_at >= ? AND created_at < ? GROUP BY kind`,
  },
  {
    table: "ledger_entries",
    label: "Platform ledger fees",
    sql: `SELECT a.purpose AS name, NULL AS orders, NULL AS volume, SUM(e.amount) AS fees
          FROM ledger_accounts a JOIN ledger_entries e ON e.account_id = a.id
          WHERE a.environment = 'live' AND a.currency = 'UGX' AND a.owner_type = 'platform'
            AND a.purpose IN ('channel_fees', 'digital_sales_commission', 'service_commission')
            AND e.created_at >= ? AND e.created_at < ?
          GROUP BY a.purpose`,
  },
];

async function recordedActivity(from: string, to: string) {
  const utc = (iso: string) => iso.slice(0, 19).replace("T", " ");
  return Promise.all(settlementSources.map(async ({ table, label, sql }) => {
    if (!(await hasTable(table))) return { label, available: false, rows: [] };
    const { rows } = await db.execute({ sql, args: [utc(from), utc(to)] });
    return { label, available: true, rows: rows.map(row => ({
      name: String(row.name), orders: row.orders == null ? null : Number(row.orders),
      volume: row.volume == null ? null : Number(row.volume), fees: Number(row.fees ?? 0),
    })) };
  }));
}

export const financialModelPermissions = [requirePermission("payments.manage"), requirePermission("stats.view")] as const;

export async function financialModelSnapshot() {
  const now = Date.now();
  const to = new Date(now).toISOString();
  const from = new Date(now - 30 * 86_400_000).toISOString();
  const [rates, activity] = await Promise.all([fees(), recordedActivity(from, to)]);
  return { currency: "UGX", environment: "live", from, to, rates, activity };
}
