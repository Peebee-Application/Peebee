import type { MatchingMode } from "@tuma/shared";
import { DEFAULT_TIME_FEES, type JobExpirySettings, type TimeFeeSettings } from "@tuma/shared";
import { db } from "../db/client.js";

const DEFAULTS = {
  time_fees: JSON.stringify(DEFAULT_TIME_FEES),
  /** Which dataset the whole platform — every customer, rider, and the
   * admin dashboard's default view — currently reads and writes against.
   * "live" is real orders/money; "sandbox" is demo/test data, fully
   * isolated (separate orders, lists, wallet balances, ledger entries —
   * see migrations/0030_sandbox_live_state.sql) and never able to reach a
   * real payment rail regardless of what credentials are configured (see
   * ../payments/service.ts resolveProvider's forceMock). Toggling this
   * doesn't delete or move anything — it just changes which environment's
   * rows every read/write path in the app targets. */
  platform_environment: "live",
  /** Allows users to launch isolated guided practice journeys. Unlike
   * platform_environment this never redirects operational API traffic. */
  user_practice_mode_enabled: "1",
  delivery_rate_per_km: "1000",
  /** Floor on a parcel ride's distance-priced delivery fee (UGX) — a rider
   * still has to go collect and deliver the item even when pickup and
   * destination are barely apart, so distance × rate is never allowed to
   * round down toward zero for a very short (or same-building) ride. */
  minimum_delivery_fee: "2000",
  service_range_km: "7",
  /** Flat delivery fee (UGX) charged on top of a shopping order's item
   * costs. Unlike a parcel ride there's no pickup point to measure a
   * distance from at order-creation time (the "pickup" is wherever the
   * rider ends up shopping, unknown until one claims the job) — so this
   * is a flat admin-set amount rather than distance × rate. */
  shopping_delivery_fee: "3000",
  /** A passenger ride's own per-km rate and floor (UGX) — priced the same
   * way as a parcel (distance × rate, never below the floor) but tracked
   * separately since carrying a person is a different real-world fare
   * than carrying a package. */
  ride_rate_per_km: "1500",
  ride_minimum_fare: "2500",
  /** Ceiling on what a single order may charge into escrow (UGX). Guards
   * against a fat-fingered or forged estimate turning into a payment
   * request nobody meant to make. */
  max_order_value: "5000000",
  /** Which rider-matching modes are on offer platform-wide — see
   * ../orders/matching.ts. JSON array of MatchingMode values. A customer's
   * own preference only takes effect if it's in this set; the default
   * keeps today's behavior (first rider to claim wins) until an admin
   * turns anything else on. */
  matching_modes_enabled: '["first_to_claim"]',
  /** How long an order in "nearest_window" mode waits to collect applicants
   * before the app auto-assigns whichever is nearest. */
  nearest_window_seconds: "90",
  /** Safety-net ceiling (for nearest_window and customer_selects) — if
   * nobody's been assigned by this long after the order was created, the
   * app auto-assigns rather than leaving the customer waiting indefinitely. */
  max_assignment_minutes: "5",
  /** Which payment aggregators are on offer, in priority order — the first
   * entry is primary, each later entry is a fallback tried once everything
   * ahead of it has no working credentials. JSON array of "yo" |
   * "flutterwave" | "mtn" | "airtel". See ../payments/service.ts
   * resolveProvider(). */
  payments_active_providers: '["yo"]',
  /** Which voice-calling backend live "call" buttons actually use — see
   * ../calls/service.ts. "mock" (the default) runs the full ring/accept/
   * decline flow with no real audio, safe with zero setup; switching to a
   * real provider needs that provider's credentials saved first. */
  calls_active_provider: "mock",
  /** Which map backend location pickers/geocoding across the customer,
   * rider, and restaurant apps actually use — see ../maps/credentials.ts.
   * "streetmaps" (OpenStreetMap tiles + Nominatim) needs no API key and is
   * the safe default; "google"/"mapbox" only actually take over once an
   * admin saves a working key for that provider (see getActiveMapsProvider). */
  maps_active_provider: "streetmaps",
  /** Jawg's default light-mode style: "normal" (Jawg Sunny) or "light"
   * (Jawg Light). Dark mode always uses Jawg Dark, and users can override
   * either in their own Appearance settings. */
  maps_jawg_light_style: "normal",
  /** Whether the rider's "Start Navigation" button sends them out to Google
   * Maps (default, unchanged behavior) or renders turn-by-turn-style
   * navigation inside the app itself, using whichever maps_active_provider
   * is on. "external" is the safe default since it needs nothing extra
   * configured; "in_app" keeps riders on the platform end to end. See
   * apps/rider/components/DeliveryNavigation.tsx. */
  nav_mode: "external",
  /** Force every payment through the mock/simulated adapters, even when a
   * real provider has working credentials saved. Lets an admin test live
   * credentials without switching them live, or pull the whole platform
   * back to demo transactions instantly (no need to delete/blank the
   * credentials themselves) if something looks wrong with a real
   * aggregator. "1" = demo mode on, anything else = off. See
   * ../payments/service.ts resolveProvider(). */
  payments_demo_mode: "0",
  /** Merchant-funded shopping is deliberately dark-launched. Live traffic
   * also requires a current regulated-custody approval; this flag alone can
   * never bypass that gate. */
  merchant_payments_enabled: "0",
  /** Sandbox merchant allocations are on by default and always use the
   * simulator. This is intentionally separate from live activation. */
  merchant_sandbox_enabled: "1",
  merchant_live_custody_approved: "0",
  /** Operational circuit breaker. Reconciliation can set this automatically
   * and an admin may only clear it after every merchant subledger matches. */
  merchant_withdrawals_frozen: "0",
  merchant_instant_fee_flat: "0",
  /** Wallet balance ceilings (UGX), tiered by verification the same way
   * mobile money itself limits unverified accounts — see
   * ../wallet/routes.ts. */
  wallet_unverified_cap: "200000",
  wallet_verified_cap: "2000000",
  /** Ceiling on a single top-up request, independent of the balance cap —
   * stops one oversized top-up from being the only thing that matters. */
  wallet_max_topup: "1000000",
  /** Floor a rider's own withdrawal always leaves behind in their wallet
   * (UGX) — "presumed to keep the account active" per the admin who asked
   * for this. Only a normal withdrawal respects it; closing the account
   * (see ../riders/routes.ts POST /riders/me/close-account) always pays
   * out everything, reserve included. */
  rider_minimum_balance_enabled: "0",
  rider_minimum_balance_amount: "2000",
  /** How long any voice recording (a shopping list, an order note, a fee-
   * proposal reason, a chat voice message) may run before it auto-stops.
   * Nobody's meant to be recording minutes of audio here — this is a cap,
   * not a target. */
  voice_note_max_seconds: "60",

  // Monetization — every mechanism is independently toggleable, and each
  // one an admin turns on defines its own amount/rate. See
  // ../lib/monetization.ts for how these combine at Fund/Settle time, and
  // apps/admin/app/settings/page.tsx's "Monetization" card for the UI.

  /** % of the delivery fee (never the item cost) the platform keeps,
   * withheld from the rider's payout at Settle — set per order type since
   * a parcel ride's whole total IS its delivery fee, while a shopping
   * order's items cost is untouched either way. */
  monetization_delivery_commission_enabled: "0",
  monetization_delivery_commission_parcel_percent: "0",
  monetization_delivery_commission_shopping_percent: "0",

  /** Flat or % surcharge added on top of what the customer pays at Fund
   * time — 100% platform revenue, the rider's payout is never touched by
   * this one. */
  monetization_service_fee_enabled: "0",
  monetization_service_fee_type: "flat",
  monetization_service_fee_value: "0",
  /** The service fee can never be more than this % of the fare (1–99). */
  monetization_service_fee_max_share_percent: "50",

  /** Models the real cost of moving money through a payment rail. Can be
   * charged to the customer (surcharge at Fund), to the rider (withheld at
   * Settle), or split between both — see processingFeeMode. Skipped
   * entirely for wallet-funded and float-rail orders, since neither
   * touches an external payment rail. */
  monetization_processing_fee_enabled: "0",
  monetization_processing_fee_percent: "0",
  monetization_processing_fee_mode: "customer",
  /** Only used when mode is "split" — the customer's share of the
   * processing fee, 0-100; the rider bears the remainder. */
  monetization_processing_fee_split_customer_percent: "50",

  /** Rider subscription — a recurring or one-time-lifetime charge, not a
   * per-order one, so it doesn't plug into Fund/Settle math the way the
   * others do. See ../riders/subscription.ts for the billing/enforcement
   * logic and ../worker.ts's scheduled() for the daily renewal sweep. */
  /** Which pool absorbs a cash (float-rail) order's platform-fee deduction
   * at Settle — see apps/api/src/orders/routes.ts POST /orders/:id/settle.
   * "wallet": comes out of the rider's normal earnings balance, allowed to
   * go negative, nets against their next payout automatically — no
   * restriction on taking new jobs either way. "deposit": treats the
   * existing rider minimum-balance reserve (rider_minimum_balance_amount
   * above) as a hard floor a rider must keep topped up to work at all —
   * once their balance dips below it, POST /riders/jobs/available and
   * claim/apply both refuse until they top back up. */
  monetization_cash_fee_source: "wallet",
  monetization_subscription_enabled: "0",
  /** "recurring" bills every `cadence`; "once" charges a single lifetime
   * fee at activation and never bills that rider again. */
  monetization_subscription_mode: "recurring",
  monetization_subscription_amount: "0",
  monetization_subscription_cadence: "weekly",

  /** Rider "Pro" — a separate, optional paid tier from the job-activation
   * subscription above (see apps/api/src/riders/pro-subscription.ts).
   * Unlocks whichever premium features individually opt into requiring it
   * — see luganda_audio_requires_pro and vsla_requires_pro below. Unlike
   * the base subscription, both pricing modes can be enabled at once; a
   * rider then picks which to buy. */
  pro_subscription_enabled: "0",
  pro_recurring_enabled: "0",
  pro_recurring_amount: "0",
  pro_recurring_cadence: "weekly",
  pro_onetime_enabled: "0",
  pro_onetime_amount: "0",

  /** Rider Stage Savings Circles — a VSLA-style group savings/loans
   * feature. Every knob here exists so admin can change behavior without
   * a redeploy; see apps/api/src/stages/routes.ts for where each is read. */
  vsla_loan_interest_enabled: "1",
  vsla_default_interest_rate: "8",
  vsla_default_loanable_multiple: "2",
  vsla_default_cycle_months: "12",
  vsla_default_max_loan_months: "3",
  /** UGX per share when a cycle doesn't set its own — see stage_cycles.share_price. */
  vsla_default_share_price: "1000",
  vsla_contribution_recorder_role: "any_officer", // "any_officer" | "treasurer_only"
  vsla_cash_double_check_required: "0",
  vsla_admin_ledger_visibility: "read_only_all", // "read_only_all" | "private_per_stage"
  vsla_unconfirmed_intent_escalation_hours: "6",
  vsla_feature_placement: "home_card_and_screen", // "home_card_and_screen" | "bottom_nav_tab" | "account_only"
  /** Off by default so nothing changes until an admin explicitly opts in.
   * A rider who already has a stage membership row keeps free access even
   * after this is turned on — see stages/routes.ts's grandfather check. */
  vsla_requires_pro: "0",
  /** Architecture hook for after Tuma is BOU-licensed to hold funds
   * directly. Off (non-custodial) by default and today: every RSLA
   * money-moving step stays a two-part "intent, then officer-confirmed"
   * record between members' own phones/hands — Tuma never touches it.
   * This flag doesn't change that behavior yet; it only exists so the
   * platform admin can see and later flip the mode once custody is
   * actually implemented. */
  vsla_custodial_mode: "0",

  /** Reads a rider's shopping list aloud in Luganda via Sunbird AI (see
   * ../speech/sunbird.ts) — for riders who aren't comfortable reading the
   * typed list themselves. Off by default since it needs a working
   * SUNBIRD_API_KEY. `luganda_audio_voices` is the admin-curated catalog a
   * rider picks from in their own settings (JSON array of {id, label},
   * `id` being one of Sunbird's own "lug" speaker tags); the default voice
   * covers a rider who hasn't picked one yet. */
  luganda_audio_enabled: "0",
  luganda_audio_voices: '[{"id":"waxal_lug_0004","label":"Voice 1"}]',
  luganda_audio_default_voice: "waxal_lug_0004",
  /** Off by default so nothing changes until an admin explicitly opts in. */
  luganda_audio_requires_pro: "0",
  /** Tuma Car — everything off until an admin switches it on, and nothing
   * works until migration 0065 (the car tables) has been applied. */
  car_enabled: "0",
  car_ondemand_enabled: "0",
  /** How a car ride finds its driver: "customer_selects" (drivers apply/bid,
   * the customer picks) or "first_to_claim" (the nearest eligible driver is
   * assigned automatically). */
  car_matching_mode: "customer_selects",
  /** Default split of a settled car ride's pool (must total 100). A
   * category can override it. */
  car_share_owner_percent: "60",
  car_share_driver_percent: "30",
  car_share_platform_percent: "10",
  /** A driver further than this from the pickup isn't offered the ride. */
  car_driver_max_pickup_km: "10",
  /** Owners and drivers can cash their ride earnings out to mobile money. */
  /** Scheduled rides: book now, pick up later. Needs a booking window (hours)
   * to be set before it works; empty = off. */
  car_scheduled_enabled: "0",
  car_scheduled_max_advance_hours: "",
  car_scheduled_min_lead_minutes: "30",
  /** The job opens to drivers this long before pickup. */
  car_scheduled_open_minutes: "60",
  /** Within this long of pickup, the assigned driver is watched. */
  car_scheduled_watch_minutes: "30",
  /** No location update for this long counts as "no signal". */
  car_scheduled_no_signal_minutes: "10",
  /** Average speed used to judge whether a driver will make it. */
  car_scheduled_avg_speed_kmh: "25",
  car_withdrawals_enabled: "0",
  /** Smallest withdrawal in UGX (0 = no minimum). */
  car_withdrawal_min_amount: "0",
  /** Price bidding on rides/parcels — off until an admin enables it. Needs
   * "customer selects" (multiple applications) to be an enabled matching mode. */
  bidding_enabled: "0",
  /** A bid may be this % of the app's price at the lowest / highest. */
  bidding_min_percent: "50",
  bidding_max_percent: "150",
  /** On by default: jobs nobody serves within 6 hours expire. Admin can
   * change the time/unit or switch it off (Settings → Rider matching). */
  job_expiry_enabled: "1",
  job_expiry_value: "6",
  job_expiry_unit: "hours",
} as const;

export type SettingKey = keyof typeof DEFAULTS;

export type CarMatchingMode = "customer_selects" | "first_to_claim";
export type CarShares = { owner: number; driver: number; platform: number };
export type CarSettings = {
  enabled: boolean;
  onDemandEnabled: boolean;
  matchingMode: CarMatchingMode;
  shares: CarShares;
  maxPickupKm: number;
  withdrawalsEnabled: boolean;
  withdrawalMinAmount: number;
  scheduled: CarScheduledSettings;
};

export type CarScheduledSettings = {
  enabled: boolean;
  /** How far ahead a ride can be booked; null = not set, so the feature stays off. */
  maxAdvanceHours: number | null;
  minLeadMinutes: number;
  openMinutes: number;
  watchMinutes: number;
  noSignalMinutes: number;
  avgSpeedKmh: number;
};

export async function getCarSettings(): Promise<CarSettings> {
  const [enabled, onDemand, mode, owner, driver, platform, maxKm, wdEnabled, wdMin, sEnabled, sMax, sLead, sOpen, sWatch, sNoSig, sSpeed] = await Promise.all([
    getSetting("car_enabled"),
    getSetting("car_ondemand_enabled"),
    getSetting("car_matching_mode"),
    getSetting("car_share_owner_percent"),
    getSetting("car_share_driver_percent"),
    getSetting("car_share_platform_percent"),
    getSetting("car_driver_max_pickup_km"),
    getSetting("car_withdrawals_enabled"),
    getSetting("car_withdrawal_min_amount"),
    getSetting("car_scheduled_enabled"),
    getSetting("car_scheduled_max_advance_hours"),
    getSetting("car_scheduled_min_lead_minutes"),
    getSetting("car_scheduled_open_minutes"),
    getSetting("car_scheduled_watch_minutes"),
    getSetting("car_scheduled_no_signal_minutes"),
    getSetting("car_scheduled_avg_speed_kmh"),
  ]);
  const clamp = (v: string, lo: number, hi: number, fallback: number) => Math.min(hi, Math.max(lo, Math.floor(Number(v)) || fallback));
  const maxAdvance = Math.floor(Number(sMax));
  let shares: CarShares = { owner: Number(owner), driver: Number(driver), platform: Number(platform) };
  // A saved split that doesn't total 100 can't be trusted: fall back to the defaults.
  if (![shares.owner, shares.driver, shares.platform].every(Number.isFinite) || shares.owner + shares.driver + shares.platform !== 100) {
    shares = { owner: 60, driver: 30, platform: 10 };
  }
  return {
    enabled: enabled === "1",
    onDemandEnabled: onDemand === "1",
    matchingMode: mode === "first_to_claim" ? "first_to_claim" : "customer_selects",
    shares,
    maxPickupKm: Math.min(200, Math.max(1, Number(maxKm) || 10)),
    withdrawalsEnabled: wdEnabled === "1",
    withdrawalMinAmount: Math.max(0, Math.floor(Number(wdMin) || 0)),
    scheduled: {
      enabled: sEnabled === "1",
      maxAdvanceHours: Number.isFinite(maxAdvance) && maxAdvance > 0 ? Math.min(24 * 90, maxAdvance) : null,
      minLeadMinutes: clamp(sLead, 0, 24 * 60, 30),
      openMinutes: clamp(sOpen, 5, 24 * 60, 60),
      watchMinutes: clamp(sWatch, 5, 24 * 60, 30),
      noSignalMinutes: clamp(sNoSig, 1, 120, 10),
      avgSpeedKmh: clamp(sSpeed, 5, 120, 25),
    },
  };
}

export async function setCarSettings(next: CarSettings): Promise<void> {
  await setSetting("car_enabled", next.enabled ? "1" : "0");
  await setSetting("car_ondemand_enabled", next.onDemandEnabled ? "1" : "0");
  await setSetting("car_matching_mode", next.matchingMode);
  await setSetting("car_share_owner_percent", String(next.shares.owner));
  await setSetting("car_share_driver_percent", String(next.shares.driver));
  await setSetting("car_share_platform_percent", String(next.shares.platform));
  await setSetting("car_driver_max_pickup_km", String(next.maxPickupKm));
  // Older activity-log entries predate these two fields.
  const sch = next.scheduled;
  if (sch) {
    await setSetting("car_scheduled_enabled", sch.enabled ? "1" : "0");
    await setSetting("car_scheduled_max_advance_hours", sch.maxAdvanceHours ? String(sch.maxAdvanceHours) : "");
    await setSetting("car_scheduled_min_lead_minutes", String(sch.minLeadMinutes));
    await setSetting("car_scheduled_open_minutes", String(sch.openMinutes));
    await setSetting("car_scheduled_watch_minutes", String(sch.watchMinutes));
    await setSetting("car_scheduled_no_signal_minutes", String(sch.noSignalMinutes));
    await setSetting("car_scheduled_avg_speed_kmh", String(sch.avgSpeedKmh));
  }
  await setSetting("car_withdrawals_enabled", next.withdrawalsEnabled ? "1" : "0");
  await setSetting("car_withdrawal_min_amount", String(Math.max(0, Math.floor(Number(next.withdrawalMinAmount) || 0))));
}

export type BiddingSettings = { enabled: boolean; minPercent: number; maxPercent: number };

export async function getBiddingSettings(): Promise<BiddingSettings> {
  const [enabled, min, max] = await Promise.all([
    getSetting("bidding_enabled"),
    getSetting("bidding_min_percent"),
    getSetting("bidding_max_percent"),
  ]);
  const minPercent = Math.min(100, Math.max(1, Number(min) || Number(DEFAULTS.bidding_min_percent)));
  const maxPercent = Math.max(100, Math.min(500, Number(max) || Number(DEFAULTS.bidding_max_percent)));
  return { enabled: enabled === "1", minPercent, maxPercent };
}

export async function setBiddingSettings(next: BiddingSettings): Promise<void> {
  await setSetting("bidding_enabled", next.enabled ? "1" : "0");
  await setSetting("bidding_min_percent", String(next.minPercent));
  await setSetting("bidding_max_percent", String(next.maxPercent));
}

export async function getJobExpirySettings(): Promise<JobExpirySettings> {
  const [enabled, value, unit] = await Promise.all([
    getSetting("job_expiry_enabled"),
    getSetting("job_expiry_value"),
    getSetting("job_expiry_unit"),
  ]);
  return {
    enabled: enabled === "1",
    value: Math.max(1, Math.floor(Number(value)) || Number(DEFAULTS.job_expiry_value)),
    unit: unit === "minutes" ? "minutes" : "hours",
  };
}

export async function setJobExpirySettings(next: JobExpirySettings): Promise<void> {
  await setSetting("job_expiry_enabled", next.enabled ? "1" : "0");
  await setSetting("job_expiry_value", String(next.value));
  await setSetting("job_expiry_unit", next.unit);
}

export function jobExpiryMinutes(s: JobExpirySettings): number {
  return s.unit === "hours" ? s.value * 60 : s.value;
}

export async function getTimeFeeSettings(): Promise<TimeFeeSettings> {
  return { ...DEFAULT_TIME_FEES, ...JSON.parse(await getSetting("time_fees")) };
}

export async function getSetting(key: SettingKey): Promise<string> {
  const res = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  return (res.rows[0]?.value as string | undefined) ?? DEFAULTS[key];
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, value],
  });
}

export type PlatformEnvironment = "live" | "sandbox";

export async function getPlatformEnvironment(): Promise<PlatformEnvironment> {
  return (await getSetting("platform_environment")) === "sandbox" ? "sandbox" : "live";
}

export async function setPlatformEnvironment(env: PlatformEnvironment): Promise<void> {
  await setSetting("platform_environment", env);
}

export async function getDeliverySettings(): Promise<{
  deliveryRatePerKm: number;
  minimumDeliveryFee: number;
  serviceRangeKm: number;
  shoppingDeliveryFee: number;
  rideRatePerKm: number;
  rideMinimumFare: number;
}> {
  const [rate, minimumFee, range, shoppingFee, rideRate, rideMinimum] = await Promise.all([
    getSetting("delivery_rate_per_km"),
    getSetting("minimum_delivery_fee"),
    getSetting("service_range_km"),
    getSetting("shopping_delivery_fee"),
    getSetting("ride_rate_per_km"),
    getSetting("ride_minimum_fare"),
  ]);
  return {
    deliveryRatePerKm: Number(rate) || Number(DEFAULTS.delivery_rate_per_km),
    minimumDeliveryFee: Number(minimumFee) || Number(DEFAULTS.minimum_delivery_fee),
    serviceRangeKm: Number(range) || Number(DEFAULTS.service_range_km),
    shoppingDeliveryFee: Number(shoppingFee) || Number(DEFAULTS.shopping_delivery_fee),
    rideRatePerKm: Number(rideRate) || Number(DEFAULTS.ride_rate_per_km),
    rideMinimumFare: Number(rideMinimum) || Number(DEFAULTS.ride_minimum_fare),
  };
}

export async function getMaxOrderValue(): Promise<number> {
  return Number(await getSetting("max_order_value")) || Number(DEFAULTS.max_order_value);
}

const ALL_MATCHING_MODES: MatchingMode[] = ["first_to_claim", "nearest_window", "customer_selects"];

function parseEnabledModes(raw: string): MatchingMode[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const modes = Array.isArray(parsed) ? parsed.filter((m): m is MatchingMode => ALL_MATCHING_MODES.includes(m as MatchingMode)) : [];
    return modes.length > 0 ? modes : ["first_to_claim"];
  } catch {
    return ["first_to_claim"];
  }
}

export async function getMatchingSettings(): Promise<{
  enabledModes: MatchingMode[];
  nearestWindowSeconds: number;
  maxAssignmentMinutes: number;
}> {
  const [modesRaw, windowRaw, maxRaw] = await Promise.all([
    getSetting("matching_modes_enabled"),
    getSetting("nearest_window_seconds"),
    getSetting("max_assignment_minutes"),
  ]);
  return {
    enabledModes: parseEnabledModes(modesRaw),
    nearestWindowSeconds: Number(windowRaw) || Number(DEFAULTS.nearest_window_seconds),
    maxAssignmentMinutes: Number(maxRaw) || Number(DEFAULTS.max_assignment_minutes),
  };
}

export async function setMatchingModesEnabled(modes: MatchingMode[]): Promise<void> {
  const valid = modes.filter((m) => ALL_MATCHING_MODES.includes(m));
  await setSetting("matching_modes_enabled", JSON.stringify(valid.length > 0 ? valid : ["first_to_claim"]));
}

export type PaymentProviderIdentity = "yo" | "flutterwave" | "mtn" | "airtel";
const ALL_PROVIDER_IDENTITIES: PaymentProviderIdentity[] = ["yo", "flutterwave", "mtn", "airtel"];

/** Priority-ordered list of admin-enabled providers — first is primary, a
 * second is the fallback. Falls back to just "yo" (today's only provider)
 * if the stored value is missing/corrupt/empty. */
export async function getActiveProviders(): Promise<PaymentProviderIdentity[]> {
  const raw = await getSetting("payments_active_providers");
  try {
    const parsed = JSON.parse(raw) as unknown;
    const providers = Array.isArray(parsed)
      ? parsed.filter((p): p is PaymentProviderIdentity => ALL_PROVIDER_IDENTITIES.includes(p as PaymentProviderIdentity))
      : [];
    return providers.length > 0 ? providers : ["yo"];
  } catch {
    return ["yo"];
  }
}

export async function setActiveProviders(providers: PaymentProviderIdentity[]): Promise<void> {
  const valid = providers.filter((p) => ALL_PROVIDER_IDENTITIES.includes(p));
  const deduped = [...new Set(valid)];
  await setSetting("payments_active_providers", JSON.stringify(deduped.length > 0 ? deduped : ["yo"]));
}

export type CallProviderIdentity = "mock" | "cloudflare" | "webrtc_p2p" | "twilio" | "agora";
const ALL_CALL_PROVIDER_IDENTITIES: CallProviderIdentity[] = ["mock", "cloudflare", "webrtc_p2p", "twilio", "agora"];

export async function getActiveCallProvider(): Promise<CallProviderIdentity> {
  const raw = await getSetting("calls_active_provider");
  return ALL_CALL_PROVIDER_IDENTITIES.includes(raw as CallProviderIdentity) ? (raw as CallProviderIdentity) : "mock";
}

export async function setActiveCallProvider(provider: CallProviderIdentity): Promise<void> {
  await setSetting("calls_active_provider", ALL_CALL_PROVIDER_IDENTITIES.includes(provider) ? provider : "mock");
}

export type MapsProviderIdentity = "streetmaps" | "google" | "mapbox" | "maptiler" | "stadia" | "thunderforest" | "jawg" | "tomtom";
const ALL_MAPS_PROVIDER_IDENTITIES: MapsProviderIdentity[] = [
  "streetmaps",
  "google",
  "mapbox",
  "maptiler",
  "stadia",
  "thunderforest",
  "jawg",
  "tomtom",
];

export async function getActiveMapsProvider(): Promise<MapsProviderIdentity> {
  const raw = await getSetting("maps_active_provider");
  return ALL_MAPS_PROVIDER_IDENTITIES.includes(raw as MapsProviderIdentity) ? (raw as MapsProviderIdentity) : "streetmaps";
}

export async function setActiveMapsProvider(provider: MapsProviderIdentity): Promise<void> {
  await setSetting("maps_active_provider", ALL_MAPS_PROVIDER_IDENTITIES.includes(provider) ? provider : "streetmaps");
}

export type JawgLightStyle = "normal" | "light";

export async function getJawgLightStyle(): Promise<JawgLightStyle> {
  return (await getSetting("maps_jawg_light_style")) === "light" ? "light" : "normal";
}

export async function setJawgLightStyle(style: JawgLightStyle): Promise<void> {
  await setSetting("maps_jawg_light_style", style === "light" ? "light" : "normal");
}

export type NavMode = "external" | "in_app";
const ALL_NAV_MODES: NavMode[] = ["external", "in_app"];

export async function getNavMode(): Promise<NavMode> {
  const raw = await getSetting("nav_mode");
  return ALL_NAV_MODES.includes(raw as NavMode) ? (raw as NavMode) : "external";
}

export async function setNavMode(mode: NavMode): Promise<void> {
  await setSetting("nav_mode", ALL_NAV_MODES.includes(mode) ? mode : "external");
}

export async function getPaymentsDemoMode(): Promise<boolean> {
  return (await getSetting("payments_demo_mode")) === "1";
}

export async function setPaymentsDemoMode(enabled: boolean): Promise<void> {
  await setSetting("payments_demo_mode", enabled ? "1" : "0");
}

export async function getWalletSettings(): Promise<{ unverifiedCap: number; verifiedCap: number; maxTopup: number }> {
  const [unverified, verified, maxTopup] = await Promise.all([
    getSetting("wallet_unverified_cap"),
    getSetting("wallet_verified_cap"),
    getSetting("wallet_max_topup"),
  ]);
  return {
    unverifiedCap: Number(unverified) || Number(DEFAULTS.wallet_unverified_cap),
    verifiedCap: Number(verified) || Number(DEFAULTS.wallet_verified_cap),
    maxTopup: Number(maxTopup) || Number(DEFAULTS.wallet_max_topup),
  };
}

export async function getVoiceNoteMaxSeconds(): Promise<number> {
  return Number(await getSetting("voice_note_max_seconds")) || Number(DEFAULTS.voice_note_max_seconds);
}

export async function getRiderReserveSettings(): Promise<{ enabled: boolean; amount: number }> {
  const [enabled, amount] = await Promise.all([
    getSetting("rider_minimum_balance_enabled"),
    getSetting("rider_minimum_balance_amount"),
  ]);
  return { enabled: enabled === "1", amount: Number(amount) || Number(DEFAULTS.rider_minimum_balance_amount) };
}

export async function setRiderReserveSettings(input: { enabled?: boolean; amount?: number }): Promise<void> {
  const writes: Promise<void>[] = [];
  if (input.enabled != null) writes.push(setSetting("rider_minimum_balance_enabled", input.enabled ? "1" : "0"));
  if (input.amount != null) writes.push(setSetting("rider_minimum_balance_amount", String(input.amount)));
  await Promise.all(writes);
}

export type ServiceFeeType = "flat" | "percent";
export type ProcessingFeeMode = "customer" | "rider" | "split";
export type SubscriptionCadence = "daily" | "weekly" | "monthly";
export type SubscriptionMode = "recurring" | "once";
export type CashFeeSource = "wallet" | "deposit";

export type MonetizationSettings = {
  deliveryCommissionEnabled: boolean;
  deliveryCommissionParcelPercent: number;
  deliveryCommissionShoppingPercent: number;
  serviceFeeEnabled: boolean;
  serviceFeeType: ServiceFeeType;
  serviceFeeValue: number;
  serviceFeeMaxSharePercent: number;
  processingFeeEnabled: boolean;
  processingFeePercent: number;
  processingFeeMode: ProcessingFeeMode;
  processingFeeSplitCustomerPercent: number;
  cashFeeSource: CashFeeSource;
  subscriptionEnabled: boolean;
  subscriptionMode: SubscriptionMode;
  subscriptionAmount: number;
  subscriptionCadence: SubscriptionCadence;
};

function asServiceFeeType(raw: string): ServiceFeeType {
  return raw === "percent" ? "percent" : "flat";
}

function asProcessingFeeMode(raw: string): ProcessingFeeMode {
  return raw === "rider" || raw === "split" ? raw : "customer";
}

function asSubscriptionCadence(raw: string): SubscriptionCadence {
  return raw === "daily" || raw === "monthly" ? raw : "weekly";
}

function asSubscriptionMode(raw: string): SubscriptionMode {
  return raw === "once" ? "once" : "recurring";
}

function asCashFeeSource(raw: string): CashFeeSource {
  return raw === "deposit" ? "deposit" : "wallet";
}

export async function getMonetizationSettings(): Promise<MonetizationSettings> {
  const [
    deliveryCommissionEnabled,
    deliveryCommissionParcelPercent,
    deliveryCommissionShoppingPercent,
    serviceFeeEnabled,
    serviceFeeType,
    serviceFeeValue,
    serviceFeeMaxSharePercent,
    processingFeeEnabled,
    processingFeePercent,
    processingFeeMode,
    processingFeeSplitCustomerPercent,
    cashFeeSource,
    subscriptionEnabled,
    subscriptionMode,
    subscriptionAmount,
    subscriptionCadence,
  ] = await Promise.all([
    getSetting("monetization_delivery_commission_enabled"),
    getSetting("monetization_delivery_commission_parcel_percent"),
    getSetting("monetization_delivery_commission_shopping_percent"),
    getSetting("monetization_service_fee_enabled"),
    getSetting("monetization_service_fee_type"),
    getSetting("monetization_service_fee_value"),
    getSetting("monetization_service_fee_max_share_percent"),
    getSetting("monetization_processing_fee_enabled"),
    getSetting("monetization_processing_fee_percent"),
    getSetting("monetization_processing_fee_mode"),
    getSetting("monetization_processing_fee_split_customer_percent"),
    getSetting("monetization_cash_fee_source"),
    getSetting("monetization_subscription_enabled"),
    getSetting("monetization_subscription_mode"),
    getSetting("monetization_subscription_amount"),
    getSetting("monetization_subscription_cadence"),
  ]);
  return {
    deliveryCommissionEnabled: deliveryCommissionEnabled === "1",
    deliveryCommissionParcelPercent: Number(deliveryCommissionParcelPercent) || 0,
    deliveryCommissionShoppingPercent: Number(deliveryCommissionShoppingPercent) || 0,
    serviceFeeEnabled: serviceFeeEnabled === "1",
    serviceFeeType: asServiceFeeType(serviceFeeType),
    serviceFeeValue: Number(serviceFeeValue) || 0,
    serviceFeeMaxSharePercent: Math.min(99, Math.max(1, Math.floor(Number(serviceFeeMaxSharePercent)) || 50)),
    processingFeeEnabled: processingFeeEnabled === "1",
    processingFeePercent: Number(processingFeePercent) || 0,
    processingFeeMode: asProcessingFeeMode(processingFeeMode),
    processingFeeSplitCustomerPercent: Number(processingFeeSplitCustomerPercent) || 0,
    cashFeeSource: asCashFeeSource(cashFeeSource),
    subscriptionEnabled: subscriptionEnabled === "1",
    subscriptionMode: asSubscriptionMode(subscriptionMode),
    subscriptionAmount: Number(subscriptionAmount) || 0,
    subscriptionCadence: asSubscriptionCadence(subscriptionCadence),
  };
}

export async function setMonetizationSettings(input: Partial<MonetizationSettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (input.deliveryCommissionEnabled != null) {
    writes.push(setSetting("monetization_delivery_commission_enabled", input.deliveryCommissionEnabled ? "1" : "0"));
  }
  if (input.deliveryCommissionParcelPercent != null) {
    writes.push(setSetting("monetization_delivery_commission_parcel_percent", String(input.deliveryCommissionParcelPercent)));
  }
  if (input.deliveryCommissionShoppingPercent != null) {
    writes.push(setSetting("monetization_delivery_commission_shopping_percent", String(input.deliveryCommissionShoppingPercent)));
  }
  if (input.serviceFeeEnabled != null) {
    writes.push(setSetting("monetization_service_fee_enabled", input.serviceFeeEnabled ? "1" : "0"));
  }
  if (input.serviceFeeType != null) {
    writes.push(setSetting("monetization_service_fee_type", input.serviceFeeType));
  }
  if (input.serviceFeeValue != null) {
    writes.push(setSetting("monetization_service_fee_value", String(input.serviceFeeValue)));
  }
  if (input.serviceFeeMaxSharePercent != null) {
    writes.push(setSetting("monetization_service_fee_max_share_percent", String(input.serviceFeeMaxSharePercent)));
  }
  if (input.processingFeeEnabled != null) {
    writes.push(setSetting("monetization_processing_fee_enabled", input.processingFeeEnabled ? "1" : "0"));
  }
  if (input.processingFeePercent != null) {
    writes.push(setSetting("monetization_processing_fee_percent", String(input.processingFeePercent)));
  }
  if (input.processingFeeMode != null) {
    writes.push(setSetting("monetization_processing_fee_mode", input.processingFeeMode));
  }
  if (input.processingFeeSplitCustomerPercent != null) {
    writes.push(
      setSetting("monetization_processing_fee_split_customer_percent", String(input.processingFeeSplitCustomerPercent)),
    );
  }
  if (input.cashFeeSource != null) {
    writes.push(setSetting("monetization_cash_fee_source", input.cashFeeSource));
  }
  if (input.subscriptionEnabled != null) {
    writes.push(setSetting("monetization_subscription_enabled", input.subscriptionEnabled ? "1" : "0"));
  }
  if (input.subscriptionMode != null) {
    writes.push(setSetting("monetization_subscription_mode", input.subscriptionMode));
  }
  if (input.subscriptionAmount != null) {
    writes.push(setSetting("monetization_subscription_amount", String(input.subscriptionAmount)));
  }
  if (input.subscriptionCadence != null) {
    writes.push(setSetting("monetization_subscription_cadence", input.subscriptionCadence));
  }
  await Promise.all(writes);
}

/** Rider "Pro" — deliberately separate from MonetizationSettings' own
 * subscriptionEnabled/Mode/Amount/Cadence above, which gate whether a
 * rider is matchable for jobs at all. This is an independent, optional
 * paid tier that unlocks premium features (see LugandaAudioSettings.
 * requiresPro, VslaSettings.requiresPro) — a rider can be job-activated
 * without being Pro, or Pro without paying the job-activation fee. Unlike
 * the base subscription, both pricing modes may be on at once. */
export type ProSettings = {
  enabled: boolean;
  recurringEnabled: boolean;
  recurringAmount: number;
  recurringCadence: SubscriptionCadence;
  onetimeEnabled: boolean;
  onetimeAmount: number;
};

export async function getProSettings(): Promise<ProSettings> {
  const [enabled, recurringEnabled, recurringAmount, recurringCadence, onetimeEnabled, onetimeAmount] = await Promise.all([
    getSetting("pro_subscription_enabled"),
    getSetting("pro_recurring_enabled"),
    getSetting("pro_recurring_amount"),
    getSetting("pro_recurring_cadence"),
    getSetting("pro_onetime_enabled"),
    getSetting("pro_onetime_amount"),
  ]);
  return {
    enabled: enabled === "1",
    recurringEnabled: recurringEnabled === "1",
    recurringAmount: Number(recurringAmount) || 0,
    recurringCadence: asSubscriptionCadence(recurringCadence),
    onetimeEnabled: onetimeEnabled === "1",
    onetimeAmount: Number(onetimeAmount) || 0,
  };
}

export async function setProSettings(input: Partial<ProSettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (input.enabled != null) writes.push(setSetting("pro_subscription_enabled", input.enabled ? "1" : "0"));
  if (input.recurringEnabled != null) writes.push(setSetting("pro_recurring_enabled", input.recurringEnabled ? "1" : "0"));
  if (input.recurringAmount != null) writes.push(setSetting("pro_recurring_amount", String(input.recurringAmount)));
  if (input.recurringCadence != null) writes.push(setSetting("pro_recurring_cadence", input.recurringCadence));
  if (input.onetimeEnabled != null) writes.push(setSetting("pro_onetime_enabled", input.onetimeEnabled ? "1" : "0"));
  if (input.onetimeAmount != null) writes.push(setSetting("pro_onetime_amount", String(input.onetimeAmount)));
  await Promise.all(writes);
}

export type VslaContributionRecorderRole = "any_officer" | "treasurer_only";
export type VslaAdminLedgerVisibility = "read_only_all" | "private_per_stage";
export type VslaFeaturePlacement = "home_card_and_screen" | "bottom_nav_tab" | "account_only" | "wallet_card";

export type VslaSettings = {
  loanInterestEnabled: boolean;
  defaultInterestRate: number;
  defaultLoanableMultiple: number;
  defaultCycleMonths: number;
  defaultMaxLoanMonths: number;
  defaultSharePrice: number;
  contributionRecorderRole: VslaContributionRecorderRole;
  cashDoubleCheckRequired: boolean;
  adminLedgerVisibility: VslaAdminLedgerVisibility;
  unconfirmedIntentEscalationHours: number;
  featurePlacement: VslaFeaturePlacement;
  /** When on, joining or creating a new stage requires an active Pro
   * subscription — except for a rider who already has a stage membership
   * row (grandfathered, per the deliberate "current users keep it free"
   * decision). See stages/routes.ts's assertProIfRequired. */
  requiresPro: boolean;
  /** Architecture hook only — see the vsla_custodial_mode default comment.
   * Doesn't change any money-flow behavior yet. */
  custodialMode: boolean;
};

export async function getVslaSettings(): Promise<VslaSettings> {
  const [
    loanInterestEnabled,
    defaultInterestRate,
    defaultLoanableMultiple,
    defaultCycleMonths,
    defaultMaxLoanMonths,
    defaultSharePrice,
    contributionRecorderRole,
    cashDoubleCheckRequired,
    adminLedgerVisibility,
    unconfirmedIntentEscalationHours,
    featurePlacement,
    requiresPro,
    custodialMode,
  ] = await Promise.all([
    getSetting("vsla_loan_interest_enabled"),
    getSetting("vsla_default_interest_rate"),
    getSetting("vsla_default_loanable_multiple"),
    getSetting("vsla_default_cycle_months"),
    getSetting("vsla_default_max_loan_months"),
    getSetting("vsla_default_share_price"),
    getSetting("vsla_contribution_recorder_role"),
    getSetting("vsla_cash_double_check_required"),
    getSetting("vsla_admin_ledger_visibility"),
    getSetting("vsla_unconfirmed_intent_escalation_hours"),
    getSetting("vsla_feature_placement"),
    getSetting("vsla_requires_pro"),
    getSetting("vsla_custodial_mode"),
  ]);
  return {
    loanInterestEnabled: loanInterestEnabled === "1",
    defaultInterestRate: Number(defaultInterestRate) || 0,
    defaultLoanableMultiple: Number(defaultLoanableMultiple) || 2,
    defaultCycleMonths: Number(defaultCycleMonths) || 12,
    defaultMaxLoanMonths: Number(defaultMaxLoanMonths) || 3,
    defaultSharePrice: Number(defaultSharePrice) || 1000,
    contributionRecorderRole: contributionRecorderRole === "treasurer_only" ? "treasurer_only" : "any_officer",
    cashDoubleCheckRequired: cashDoubleCheckRequired === "1",
    adminLedgerVisibility: adminLedgerVisibility === "private_per_stage" ? "private_per_stage" : "read_only_all",
    unconfirmedIntentEscalationHours: Number(unconfirmedIntentEscalationHours) || 6,
    featurePlacement:
      featurePlacement === "bottom_nav_tab" || featurePlacement === "account_only" || featurePlacement === "wallet_card"
        ? featurePlacement
        : "home_card_and_screen",
    requiresPro: requiresPro === "1",
    custodialMode: custodialMode === "1",
  };
}

export async function setVslaSettings(input: Partial<VslaSettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (input.loanInterestEnabled != null) {
    writes.push(setSetting("vsla_loan_interest_enabled", input.loanInterestEnabled ? "1" : "0"));
  }
  if (input.defaultInterestRate != null) writes.push(setSetting("vsla_default_interest_rate", String(input.defaultInterestRate)));
  if (input.defaultLoanableMultiple != null) {
    writes.push(setSetting("vsla_default_loanable_multiple", String(input.defaultLoanableMultiple)));
  }
  if (input.defaultCycleMonths != null) writes.push(setSetting("vsla_default_cycle_months", String(input.defaultCycleMonths)));
  if (input.defaultMaxLoanMonths != null) {
    writes.push(setSetting("vsla_default_max_loan_months", String(input.defaultMaxLoanMonths)));
  }
  if (input.defaultSharePrice != null) writes.push(setSetting("vsla_default_share_price", String(input.defaultSharePrice)));
  if (input.contributionRecorderRole != null) {
    writes.push(setSetting("vsla_contribution_recorder_role", input.contributionRecorderRole));
  }
  if (input.cashDoubleCheckRequired != null) {
    writes.push(setSetting("vsla_cash_double_check_required", input.cashDoubleCheckRequired ? "1" : "0"));
  }
  if (input.adminLedgerVisibility != null) {
    writes.push(setSetting("vsla_admin_ledger_visibility", input.adminLedgerVisibility));
  }
  if (input.unconfirmedIntentEscalationHours != null) {
    writes.push(setSetting("vsla_unconfirmed_intent_escalation_hours", String(input.unconfirmedIntentEscalationHours)));
  }
  if (input.featurePlacement != null) writes.push(setSetting("vsla_feature_placement", input.featurePlacement));
  if (input.requiresPro != null) writes.push(setSetting("vsla_requires_pro", input.requiresPro ? "1" : "0"));
  if (input.custodialMode != null) writes.push(setSetting("vsla_custodial_mode", input.custodialMode ? "1" : "0"));
  await Promise.all(writes);
}

export type LugandaVoice = { id: string; label: string };

export type LugandaAudioSettings = {
  enabled: boolean;
  voices: LugandaVoice[];
  defaultVoice: string;
  /** When on, GET /orders/:id/list-audio requires the order's rider to
   * have an active Pro subscription. See orders/routes.ts. */
  requiresPro: boolean;
};

function parseLugandaVoices(raw: string): LugandaVoice[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const voices = Array.isArray(parsed)
      ? parsed.filter((v): v is LugandaVoice => !!v && typeof v === "object" && typeof (v as LugandaVoice).id === "string" && typeof (v as LugandaVoice).label === "string")
      : [];
    return voices.length > 0 ? voices : parseLugandaVoices(DEFAULTS.luganda_audio_voices);
  } catch {
    return [{ id: "waxal_lug_0004", label: "Voice 1" }];
  }
}

export async function getLugandaAudioSettings(): Promise<LugandaAudioSettings> {
  const [enabled, voicesRaw, defaultVoice, requiresPro] = await Promise.all([
    getSetting("luganda_audio_enabled"),
    getSetting("luganda_audio_voices"),
    getSetting("luganda_audio_default_voice"),
    getSetting("luganda_audio_requires_pro"),
  ]);
  return { enabled: enabled === "1", voices: parseLugandaVoices(voicesRaw), defaultVoice, requiresPro: requiresPro === "1" };
}

export async function setLugandaAudioSettings(input: Partial<LugandaAudioSettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (input.enabled != null) writes.push(setSetting("luganda_audio_enabled", input.enabled ? "1" : "0"));
  if (input.voices != null) writes.push(setSetting("luganda_audio_voices", JSON.stringify(input.voices)));
  if (input.defaultVoice != null) writes.push(setSetting("luganda_audio_default_voice", input.defaultVoice));
  if (input.requiresPro != null) writes.push(setSetting("luganda_audio_requires_pro", input.requiresPro ? "1" : "0"));
  await Promise.all(writes);
}
