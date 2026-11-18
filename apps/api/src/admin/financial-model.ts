import { type MoneyFlowConfig, type MoneyModule } from "@peebee/shared";
import { requireFinancialAccess } from "./financial-access.js";
import { getAdsConfig } from "../ads/settings.js";
import { getChannelsConfig } from "../channels/settings.js";
import { getMoneyFlowConfig } from "../costing/config.js";
import { db } from "../db/client.js";
import { getLearnSettings } from "../education/settings.js";
import { getOptions } from "../lib/option-settings.js";
import { hasTable } from "../lib/schema.js";
import { getCarSettings, getMarketplaceSettings, getMonetizationSettings, getProSettings, getSetting } from "../lib/settings.js";
import { getServicesPlatformSettings } from "../services-platform/settings.js";
import { getRule } from "../talent/monetization.js";
import { getTalentSettings } from "../talent/settings.js";
import { getTaxipressSettings } from "../taxipress/settings.js";
import { getLaundrySettings } from "../work/laundry-settings.js";
import { getWorkSettings } from "../work/settings.js";

type Fee = { channel: string; name: string; kind: "percent" | "flat" | "monthly"; value: number; note?: string; vatRate?: number; vatReference?: string; referenceOnly?: boolean };
const percent = (channel: string, name: string, value: number, note?: string): Fee => ({ channel, name, kind: "percent", value, note });
const flat = (channel: string, name: string, value: number): Fee => ({ channel, name, kind: "flat", value });
const monthly = (channel: string, name: string, value: number): Fee => ({ channel, name, kind: "monthly", value });
const monthlyEquivalent = (value: number, cadence: string) => value * (cadence === "daily" ? 365 / 12 : cadence === "weekly" ? 52 / 12 : 1);

async function fees(flow: MoneyFlowConfig): Promise<Fee[]> {
  const [monetization, car, pro, market, options, work, laundry, learn, taxi, services, creator, ads, taxiEnabled] = await Promise.all([
    getMonetizationSettings(), getCarSettings(), getProSettings(), getMarketplaceSettings(),
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

const commissionModules = new Map<string, MoneyModule>([
  ["Parcel delivery commission", "delivery_parcel"], ["Shopping delivery commission", "delivery_shopping"],
  ["Boda fare commission", "ride_boda"], ["Car platform share", "ride_car"],
]);

export async function financialModelDefaults() {
  const now = new Date();
  const flow = await getMoneyFlowConfig();
  const rates = await fees(flow);
  const day = now.toISOString().slice(0, 10);
  for (const rate of rates) {
    const module = commissionModules.get(rate.name);
    if (!module) continue;
    if (!flow.modules[module].taxed) {
      rate.vatRate = 0;
      continue;
    }
    const rules = flow.taxes.filter(rule => rule.enabled && rule.effectiveFrom <= day && /\bvat\b/i.test(rule.name + " " + rule.id)
      && (!rule.modules.length || rule.modules.includes(module)));
    if (!rules.length) {
      rate.vatRate = 0;
    } else if (rules.length === 1 && rules[0].mode === "on_top" && rules[0].appliesTo === "commission") {
      rate.vatRate = rules[0].percent;
    } else {
      rate.vatReference = rules.map(rule => rule.name + " " + rule.percent + "% · " + rule.mode.replaceAll("_", " ")
        + " · " + rule.appliesTo.replaceAll("_", " ")).join(" / ");
      rate.note = [rate.note, "Admin VAT uses a different base, inclusive treatment, or multiple rules."].filter(Boolean).join(" ");
    }
  }
  const references = [
    ["food", "Food Money Flow commission", "food"], ["pharmacy", "Pharmacy Money Flow commission", "pharmacy"],
    ["gas", "Gas Money Flow commission", "gas"], ["talent", "Talent Money Flow commission", "talent"],
  ] as const;
  for (const [channel, name, module] of references) {
    const rule = flow.modules[module].commission;
    if (rule.type !== "flat" && rule.type !== "percent") continue;
    rates.push({ channel, name, kind: rule.type, value: rule.type === "flat" ? rule.flat : rule.percent,
      referenceOnly: true, note: "Money Flow reference. The forecast needs a stream-specific rate." });
  }
  rates.push(...await talentForecastFees());
  return { currency: "UGX", syncedAt: now.toISOString(), rates: rates.filter(rate => Number.isFinite(rate.value)) };
}

async function talentForecastFees(): Promise<Fee[]> {
  if (!(await hasTable("talent_fee_rules"))) return [];
  const settings = await getTalentSettings();
  const definitions = [
    ["Worker gig commission", "worker_commission", "gig"],
    ["Worker project commission", "worker_commission", "project"],
    ["Project listing fees", "listing", "project"],
    ["Hiring listing fees", "listing", "hiring"],
    ["Employer gig commission", "employer_commission", "gig"],
    ["Employer project commission", "employer_commission", "project"],
  ] as const;
  const rows = await Promise.all(definitions.map(async ([name, kind, job]): Promise<Fee | null> => {
    const rule = await getRule(kind, job);
    if (!rule) return null;
    const active = settings.enabled && !settings.freeAccess && Number(rule.active) === 1 && rule.model !== "free"
      && settings.jobTypes.includes(job);
    const commission = kind.endsWith("_commission");
    const flatRule = rule.model === "flat" || (!commission && rule.model === "free");
    return {
      channel: "talent", name, kind: flatRule ? "flat" : "percent",
      value: active ? Number(flatRule ? rule.flat_ugx : rule.percent) : 0,
      referenceOnly: active && (!flatRule && (Number(rule.min_ugx) > 0 || Number(rule.max_ugx) > 0)),
      note: "Job-type base rule. Allowances and Pro benefits can change the fees charged.",
    };
  }));
  const employer = rows.splice(4).filter((row): row is Fee => row !== null);
  const combined = employer.length === 2 && employer[0].kind === employer[1].kind
    && employer[0].value === employer[1].value && employer.every(row => !row.referenceOnly)
    ? [{ ...employer[0], name: "Employer gig and project commission" }]
    : employer.map(row => ({ ...row, referenceOnly: true }));
  return [...rows.filter((row): row is Fee => row !== null), ...combined];
}

type ForecastAnswers = Record<string, string | Record<string, string>[]>;
export async function withFinancialDefaults(answers: ForecastAnswers): Promise<ForecastAnswers> {
  if (!Object.entries(answers).some(([key, rows]) => key.startsWith("channel-") && Array.isArray(rows)
      && rows.some(row => row.adminFee === "follow" || row.adminVat === "follow"))) return answers;
  const { rates } = await financialModelDefaults();
  const index = new Map(rates.filter(rate => !rate.referenceOnly).map(rate => [JSON.stringify([rate.channel, rate.name]), rate]));
  const ugx = answers.currency === "UGX" || (answers.currency === "other" && answers.customCurrency === "UGX");
  return Object.fromEntries(Object.entries(answers).map(([key, rows]) => {
    if (!key.startsWith("channel-") || !Array.isArray(rows)) return [key, rows];
    return [key, rows.map(row => {
      const rate = index.get(JSON.stringify([key.slice(8), row.adminSource || row.name]));
      if (!rate) return row;
      let resolved = row;
      if (row.adminFee === "follow" && rate.value >= 0) {
        const field = rate.kind === "percent" && rate.value <= 100 && ["orders", "percentage"].includes(row.method) ? "rate"
          : ugx && (row.method === "units" && rate.kind === "flat" || row.method === "subscription" && rate.kind === "monthly") ? "price" : null;
        if (field) resolved = { ...resolved, [field]: String(Number(rate.value.toFixed(4))) };
      }
      if (row.adminVat === "follow" && rate.vatRate !== undefined && rate.vatRate >= 0 && rate.vatRate <= 100) {
        resolved = { ...resolved, vatRate: String(rate.vatRate) };
      }
      return resolved;
    })];
  }));
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

export const financialModelPermissions = [requireFinancialAccess] as const;

export async function financialModelSnapshot() {
  const now = Date.now();
  const to = new Date(now).toISOString();
  const from = new Date(now - 30 * 86_400_000).toISOString();
  const [rates, activity] = await Promise.all([getMoneyFlowConfig().then(fees), recordedActivity(from, to)]);
  return { currency: "UGX", environment: "live", from, to, rates, activity };
}
