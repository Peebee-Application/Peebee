import type { MatchingMode } from "@peebee/shared";
import { MODULES, channelModuleOn, getModule, type ModuleDef } from "@peebee/shared";
import { DEFAULT_MONEY_FLOW_CONFIG, DEFAULT_PRICING_CONFIG, mergeDefaults, type PricingConfig } from "@peebee/shared";
import { DEFAULT_CREDIT_CONFIG, DEFAULT_DISCOUNT_WALLET_CONFIG, DEFAULT_INCENTIVE_CONFIG, DEFAULT_OFFERS_CONFIG } from "@peebee/shared";
import { DEFAULT_HOME_MENU, DEFAULT_RIDE_TRACKING_SETTINGS, DEFAULT_SHOPPING_UNIT_SETTINGS, DEFAULT_TIME_FEES, type JobExpirySettings, type TimeFeeSettings } from "@peebee/shared";
import { mainDb as db } from "../db/client.js";
import { inPractice } from "../db/practice-context.js";

const DEFAULTS = {
  /** Live switches for modules that have no older setting of their own: {"ride.boda": false}. Missing = on. See ./modules.ts. */
  modules_live: "{}",
  /** Practice-world switches for every module: {"ride.car": false}. Missing = on. */
  modules_practice: "{}",
  /** "1" keeps Live and Practice the same: a module is on only if it is on in both, and a switch in one world sets both. */
  modules_sync: "0",
  /** Why a module is off and what people see instead: {"ride.car": {"reason": "coming_soon", "returnAt": "2026-12-01"}}. See ./modules.ts. */
  modules_notices: "{}",
  /** Over-the-air updates for the mobile apps: the master switch, whether a newly published version goes live by itself,
   * and each app's published versions with the one phones get. See ../app-updates. */
  app_updates_enabled: "1",
  app_updates_auto_live: "1",
  app_updates_customer: '{"live":null,"versions":[]}',
  ride_tracking: JSON.stringify(DEFAULT_RIDE_TRACKING_SETTINGS),
  shopping_units_config: JSON.stringify(DEFAULT_SHOPPING_UNIT_SETTINGS),
  /** The customer app's main menu names, the Hive shortcuts and the Hire banner. */
  home_menu_config: JSON.stringify(DEFAULT_HOME_MENU),
  time_fees: JSON.stringify(DEFAULT_TIME_FEES),
  /** Offers, rider incentives, the rider discount wallet and customer wallet credit: JSON, edited in Admin → Offers.
   * See packages/shared/src/offers.ts for the shape and the recommended defaults. */
  offers_config: JSON.stringify(DEFAULT_OFFERS_CONFIG),
  discount_wallet_config: JSON.stringify(DEFAULT_DISCOUNT_WALLET_CONFIG),
  incentives_config: JSON.stringify(DEFAULT_INCENTIVE_CONFIG),
  credit_config: JSON.stringify(DEFAULT_CREDIT_CONFIG),
  /** The fare engine: distance bands, multipliers and fees per service (Admin → Pricing). Rates and minimums stay in the older keys. */
  pricing_config: JSON.stringify(DEFAULT_PRICING_CONFIG),
  /** Commission, gateway fees, taxes and the maintenance reserve (Admin → Money flow). */
  money_flow_config: JSON.stringify(DEFAULT_MONEY_FLOW_CONFIG),
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
  /** Where Practice runs: "0" = on each person's own device (the apps' built-in simulator, no database use), "1" = the shared
   * practice world on the server (demo people, shared orders and a background job that keeps it busy, which uses database reads). */
  practice_shared_world: "0",
  delivery_rate_per_km: "1000",
  /** Floor on a parcel ride's distance-priced delivery fee (UGX) — a rider
   * still has to go collect and deliver the item even when pickup and
   * destination are barely apart, so distance × rate is never allowed to
   * round down toward zero for a very short (or same-building) ride. */
  minimum_delivery_fee: "2000",
  service_range_km: "7",
  // Furthest a rider can see or take an order, in km. 0 = no limit. A rider can have their own.
  rider_visibility_range_km: "20",
  /** Hours a cart is left before a new one sets it aside as an earlier (retrievable) cart. */
  cart_expiry_hours: "12",
  /** Delivery distances follow the road: straight line x this factor, unless a routing server answers. */
  road_distance_factor: "1.3",
  /** An OSRM-compatible routing server for true road distances; empty uses the road factor. */
  routing_server_url: "",
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
  /** Booking a ride for someone else: whether customers may, and how far
   * (metres) their pickup may be from where they are before the app asks
   * "is this ride for someone else?". */
  /** Whole-service switches (Settings → Services). Off stops NEW orders of that
   * kind; orders already in flight carry on to completion. */
  service_shopping_enabled: "1",
  service_parcel_enabled: "1",
  service_ride_enabled: "1",
  service_food_enabled: "1",
  service_cargo_enabled: "1",
  ride_for_other_enabled: "1",
  ride_for_other_distance_m: "500",
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
  /** Channels: every switch, limit, percentage and window for creator channels, the shared Spotlight,
   * memberships, verification, causes and rewards. JSON, read through ../channels/settings.ts, which
   * validates against the field list in @peebee/shared. Off until an admin turns it on. */
  channels_config: "{}",
  /** Creator video: which providers are on offer and the limits on uploads. JSON, read through
   * ../video/settings.ts, which clamps every field. Off until an admin turns it on. */
  video_config: "{}",
  /** Ads over videos: the switches, timing, frequency and the creator revenue share. JSON, read
   * through ../ads/settings.ts, which clamps every field. Off until an admin turns it on. */
  ads_config: "{}",
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
  /** Flutterwave mobile money: "1" = Peebee pushes the approval prompt to the
   * customer's phone itself (Direct Charge, never leaves the app); "0" = the
   * Flutterwave-hosted mobile money page. */
  payments_flutterwave_direct_mobile_money: "1",
  /** Flutterwave cards: "1" = the customer types the card into Peebee's own
   * form (Direct Charge — needs PCI DSS accreditation first); "0" = the
   * Flutterwave-hosted card page. Off until accreditation is verified. */
  payments_flutterwave_direct_card: "0",
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
  /** Architecture hook for after Peebee is BOU-licensed to hold funds
   * directly. Off (non-custodial) by default and today: every RSLA
   * money-moving step stays a two-part "intent, then officer-confirmed"
   * record between members' own phones/hands — Peebee never touches it.
   * This flag doesn't change that behavior yet; it only exists so the
   * platform admin can see and later flip the mode once custody is
   * actually implemented. */
  vsla_custodial_mode: "0",

  /** Reads a rider's shopping list aloud in Luganda via Google AI Studio (see
   * ../speech/gemini.ts) — for riders who aren't comfortable reading the
   * typed list themselves. Off by default since it needs a working
   * GEMINI_API_KEY. `luganda_audio_voices` is the admin-curated catalog a
   * rider picks from in their own settings (JSON array of {id, label},
   * `id` being one of Gemini's prebuilt voice names, e.g. "Kore"); the
   * default voice covers a rider who hasn't picked one yet. */
  /** Which Google AI Studio keys the app uses: "test" rotates through every
   * enabled test key (skipping any that have run out of quota); "paid" uses
   * only the master key. See ../speech/ai-keys.ts. */
  gemini_key_mode: "test",
  /** Zero preserves per-request rotation; positive values select clock slots. */
  gemini_rotation_seconds: "0",
  resend_key_mode: "live",
  resend_rotation_seconds: "300",
  /** Testing request budget per Resend account group; zero disables it. */
  resend_window_requests: "0",
  resend_window_seconds: "86400",
  resend_quota_retry_seconds: "3600",
  luganda_audio_enabled: "0",
  luganda_audio_voices: '[{"id":"Kore","label":"Voice 1"}]',
  luganda_audio_default_voice: "Kore",
  /** Off by default so nothing changes until an admin explicitly opts in. */
  luganda_audio_requires_pro: "0",
  /** How a list is translated for Luganda reading: "per_item" sends each item
   * as its own request (the original behaviour); "whole_list" sends the whole
   * list in one request — far fewer requests against Google's limits. */
  luganda_translate_mode: "per_item",
  /** Peebee Car — everything off until an admin switches it on, and nothing
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
  /** Shown beside Ambulance requests: a life-threatening emergency should also call this. */
  car_emergency_number: "999",
  /** Sandbox only: demo car drivers near every pickup take the rides testers book, start to finish. */
  car_sandbox_demo: "1",
  /** How long each demo driver step waits for a real person to act first. */
  car_sandbox_demo_step_seconds: "12",
  /** Car fares: UGX 5,000 per km with a UGX 10,000 minimum. The fare engine (Admin → Pricing) tapers and adjusts these. */
  car_convenient_rate_per_km: "5000",
  car_convenient_minimum_fare: "10000",
  car_comfort_premium_percent: "30",
  car_xl_premium_percent: "50",
  car_xl_min_seats: "6",
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
  /** Carpool: drivers publish trips, passengers book seats. */
  car_carpool_enabled: "0",
  car_carpool_max_seats_per_booking: "4",
  /** A driver may repeat a trip weekly for this many weeks (0 = single trips only). */
  car_carpool_max_repeat_weeks: "0",
  /** Seats can't be booked within this long of departure. */
  car_carpool_cutoff_minutes: "15",
  /** A booked seat that hasn't been paid within this long is released. */
  car_carpool_pay_within_minutes: "15",
  /** A passenger's start/end must be within this distance of the trip's. */
  car_carpool_match_radius_km: "10",
  /** Self-drive hire. Needs the platform percentage to be set before it works. */
  car_selfdrive_enabled: "0",
  /** Peebee's share of the rent, in percent. Empty = not decided, so self-drive stays off. */
  car_selfdrive_platform_percent: "",
  car_selfdrive_max_days: "30",
  /** Lowest deposit an owner may ask for (UGX). */
  car_selfdrive_min_deposit: "0",
  /** An owner who hasn't answered a request in this long loses it (money returned). */
  car_selfdrive_approve_within_hours: "12",
  /** Grace after the agreed return time before extra started hours accrue. */
  car_selfdrive_overtime_grace_hours: "3",
  /** Whether 360 degree photo walkaround inspections are required at pickup and return. */
  car_selfdrive_inspections_required: "1",
  /** Photos an owner may attach to one vehicle (at least 6 are supported). */
  car_vehicle_photos_max: "8",
  /** Photos a vehicle needs before an admin can approve it (0 = none required). */
  car_vehicle_photos_min_required: "0",
  /** Documents an admin needs before approving: owner ID, driver ID, driver licence. */
  car_kyc_owner_id_required: "1",
  car_kyc_driver_id_required: "1",
  car_kyc_driver_licence_required: "1",
  /** Drivers apply to owners' cars; the owner accepts on agreed terms. */
  car_deals_enabled: "0",
  car_deal_share_enabled: "1",
  car_deal_rent_enabled: "1",
  /** Range of the owner's agreed share of what is left after Peebee's cut (%). */
  car_deal_min_owner_share_percent: "40",
  car_deal_max_owner_share_percent: "80",
  /** Highest fixed rent per day an owner may ask (UGX); 0 = no limit. */
  car_deal_max_rent_per_day: "0",
  car_withdrawals_enabled: "0",
  /** Smallest withdrawal in UGX (0 = no minimum). */
  car_withdrawal_min_amount: "0",
  /** Price bidding on rides/parcels — off until an admin enables it. Needs
   * "customer selects" (multiple applications) to be an enabled matching mode. */
  bidding_enabled: "0",
  /** A bid may be this % of the app's price at the lowest / highest. */
  bidding_min_percent: "50",
  bidding_max_percent: "150",
  /** Name your fare (boda rides): a customer's offer may be this % of the app's quote, lowest / highest. */
  fare_offer_min_percent: "70",
  fare_offer_max_percent: "150",
  /** How long an offer stays open for rider counters, and how long one counter waits for the customer. */
  fare_offer_ttl_minutes: "10",
  fare_counter_ttl_seconds: "120",
  /** How many times a customer may raise one offer. */
  fare_offer_max_raises: "5",
  /** Multi-stop boda rides: the most stops between pickup and destination, and a flat fee per stop (UGX). */
  ride_max_stops: "3",
  ride_stop_fee: "1000",
  /** On by default: jobs nobody serves within 6 hours expire. Admin can
   * change the time/unit or switch it off (Settings → Rider matching). */
  job_expiry_enabled: "1",
  job_expiry_value: "6",
  job_expiry_unit: "hours",
  /** Peebee Gas: Fuel merchant network and rider fuel vouchers */
  service_gas_enabled: "1",
  gas_rider_daily_limit_ugx: "60000",
  gas_voucher_expiry_minutes: "60",
  gas_session_hours: "12",
  gas_pin_max_attempts: "5",
  gas_withdrawal_min_ugx: "5000",
  gas_voucher_lookups_per_5min: "20",
  gas_platform_discount_percent: "0",
  /** Pharmacy prescriptions (customer uploads a doctor's slip; the pharmacy quotes it) */
  pharmacy_enabled: "1",
  pharmacy_max_image_mb: "6",
  pharmacy_submissions_per_hour: "10",
  /** Guest checkout on shared product links, and how guests are told about their delivery */
  guest_checkout_enabled: "1",
  guest_checkout_card_enabled: "1",
  guest_checkout_max_quantity: "10",
  guest_checkout_suggest_account: "1",
  guest_checkout_code_status: "0",
  guest_notify_push: "1",
  guest_notify_chat: "1",
  guest_notify_sms: "0",
  guest_notify_email: "0",
  guest_notify_whatsapp: "0",
  guest_whatsapp_template: "",
  /** Peebee Marketplace: Groceries & Stores, Live Commerce, Pro Paywalls, Social Ads & Elite (Shopify Plus level) */
  marketplace_enabled: "1",
  marketplace_live_enabled: "1",
  marketplace_commission_percent: "10",
  marketplace_pro_pricing_mode: "free",
  marketplace_pro_store_price_ugx: "35000",
  marketplace_pro_live_price_ugx: "75000",
  marketplace_pro_trial_days: "14",
  marketplace_ad_min_budget_ugx: "10000",
  marketplace_ad_fee_percent: "5",
  marketplace_min_order_amount: "5000",
  marketplace_live_max_duration_mins: "180",
  marketplace_delivery_base_fee: "3000",
  marketplace_elite_enabled: "1",
  marketplace_elite_price_ugx: "150000",
  marketplace_elite_commission_percent: "5",
  marketplace_pro_max_products: "50",
  marketplace_elite_max_products: "5000",
  marketplace_pro_max_collections: "3",
  marketplace_elite_max_collections: "100",
  marketplace_pro_max_discounts: "2",
  marketplace_elite_max_discounts: "200",
  marketplace_elite_b2b_enabled: "1",
  marketplace_elite_multi_outlet_inventory_enabled: "1",
  marketplace_elite_custom_domain_enabled: "1",
  marketplace_elite_loyalty_enabled: "1",
  marketplace_elite_max_loyalty_cashback_percent: "15",
  marketplace_elite_pos_enabled: "1",
  marketplace_elite_stock_transfers_enabled: "1",
  marketplace_elite_crm_enabled: "1",
  marketplace_elite_purchase_orders_enabled: "1",
  marketplace_elite_bundles_enabled: "1",
  marketplace_elite_winback_enabled: "1",
  marketplace_elite_storefront_sections_enabled: "1",
  marketplace_elite_sms_alerts_enabled: "1",
  marketplace_elite_sms_cost_per_message_ugx: "35",
  marketplace_sms_provider: "simulator",
  marketplace_elite_digital_products_enabled: "1",
  marketplace_elite_lms_sync_enabled: "1",
  marketplace_elite_max_courses: "50",
  marketplace_elite_max_digital_products: "200",
  /** Peebee Learn Studio: schools, classes, courses and lessons made by educators */
  learn_enabled: "1",
  learn_streams: "sprouts,foundations,academy,compass,skills",
  learn_masterclasses_enabled: "1",
  learn_paid_courses_enabled: "1",
  learn_max_course_price_ugx: "5000000",
  learn_max_schools_per_user: "3",
  learn_max_classes_per_school: "30",
  learn_max_courses_per_class: "12",
  learn_max_modules_per_course: "30",
  learn_max_lessons_per_module: "40",
  learn_max_quiz_questions: "20",
  learn_max_lesson_minutes: "240",
  learn_creates_per_hour: "60",
  learn_publish_by_default: "0",
  learn_enrolments_enabled: "1",
  learn_commission_percent: "10",
  learn_video_uploads_enabled: "1",
  learn_max_video_mb: "50",
  learn_max_cover_mb: "2",
  learn_quiz_attempts_per_hour: "30",
  learn_fees_enabled: "1",
  learn_exam_pass_percent: "50",
  learn_live_enabled: "1",
  learn_live_max_participants: "60",
  learn_live_poll_seconds: "3",
  learn_live_max_cues: "100",
  learn_live_question_seconds: "30",
  learn_live_max_exam_minutes: "120",
  learn_max_screens_per_user: "5",
  learn_screen_pair_minutes: "10",
  learn_trial_classes_enabled: "1",
  learn_trial_code_a: "111222",
  learn_trial_code_b: "222111",
  learn_demo_visible: "1",
  learn_home_progress: "1",
  learn_home_tools: "1",
  learn_home_free_rail: "1",
  learn_home_rail_size: "8",
  learn_tv_pro_required: "0",
  learn_tv_learn_enabled: "1",
  learn_pro_price_ugx: "50000",
  learn_pro_days: "30",
  learn_max_slides: "30",
  learn_max_body_chars: "20000",
  learn_quiz_max_attempts: "0",
  learn_exam_max_attempts: "1",
  learn_reveal_quiz_answers: "1",
  learn_reveal_exam_answers: "0",
  learn_live_lessons_enabled: "1",
  learn_live_lesson_hosts: "zoom.us,meet.google.com,meet.jit.si,teams.microsoft.com,whereby.com",
  learn_live_lesson_early_minutes: "15",
  learn_certificates_enabled: "1",
  learn_badges_enabled: "1",
  learn_drip_enabled: "1",
  learn_prerequisites_enabled: "1",
  learn_badge_courses_threshold: "3",
  learn_assignments_enabled: "1",
  learn_max_submission_chars: "5000",
  learn_coupons_enabled: "1",
  learn_max_coupon_percent: "90",
  learn_bundles_enabled: "1",
  learn_max_bundle_courses: "20",
  learn_subscriptions_enabled: "1",
  learn_max_plans_per_school: "5",
  learn_max_plan_days: "365",
  learn_reviews_enabled: "1",
  learn_review_min_progress: "25",
  learn_qa_enabled: "1",
  learn_max_qa_chars: "1500",
  learn_qa_posts_per_hour: "20",
  learn_announcements_enabled: "1",
  learn_cohorts_enabled: "1",
  learn_instructors_enabled: "1",
  learn_max_instructors: "5",
  /** Peebee Work: clean / fix / laundry jobs done by independent providers and companies */
  work_enabled: "1",
  work_service_types: "clean",
  work_pricing_modes: "fixed,quote",
  work_matching_modes: "broadcast,customer_picks",
  work_default_matching: "broadcast",
  work_provider_kinds: "individual,company",
  work_commission_percent: "15",
  work_require_approval: "1",
  work_offer_window_minutes: "60",
  work_radius_km: "15",
  work_max_notified: "20",
  work_min_lead_minutes: "30",
  work_max_advance_days: "30",
  work_quote_valid_hours: "24",
  work_max_quote_ugx: "5000000",
  work_free_cancel_minutes: "10",
  work_late_cancel_fee_percent: "20",
  work_auto_confirm_hours: "24",
  work_dispute_window_hours: "48",
  work_jobs_per_hour: "6",
  work_rematch_on_provider_cancel: "1",
  work_max_rematches: "2",
  work_photos_enabled: "1",
  work_max_photos_per_job: "8",
  work_max_photo_kb: "4096",
  work_chat_enabled: "1",
  work_tracking_enabled: "1",
  // On-site checks: flag cancellations that follow a long stay at the customer's address (off until admin turns it on).
  work_onsite_check_enabled: "0",
  work_onsite_radius_m: "150",
  work_onsite_min_minutes: "20",
  work_onsite_action: "flag",
  work_onsite_flag_no_location: "1",
  work_onsite_require_location: "1",
  work_onsite_suspend_after_flags: "0",
  work_onsite_window_days: "30",
  work_location_retention_days: "30",
  // Quick "when" choices on a Hive booking: minutes ahead (comma list), and "Tomorrow" at a fixed local time.
  work_schedule_quick_minutes: "60,180",
  work_schedule_tomorrow_enabled: "1",
  work_schedule_tomorrow_time: "09:00",
  // Laundry marketplace: how each laundry service is priced (fixed = admin prices apply; estimate = customer may make an offer).
  laundry_pricing_wash_fold: "fixed",
  laundry_pricing_dry_clean: "fixed",
  laundry_pricing_iron: "fixed",
  laundry_pricing_custom: "fixed",
  // Offer slider: lowest and highest offer as a percent of the catalogue total, and the step in UGX.
  laundry_offer_min_percent: "80",
  laundry_offer_max_percent: "130",
  laundry_offer_step_ugx: "500",
  // Who pays each rider leg: customer, provider or split. A split gives the customer this percent of the leg.
  laundry_ride_payer_pickup: "customer",
  laundry_ride_payer_delivery: "provider",
  laundry_ride_split_customer_percent: "50",
  // Flat fee per rider leg until rides are priced by the rider fare system. 0 = no ride charge.
  laundry_ride_fee_ugx: "0",
  // Extra weight over a package limit, UGX per lb (0 = not charged).
  laundry_overage_ugx_per_lb: "0",
  // Tips: a free tip is paid on delivery; a conditional tip is held and paid only for an on-time, undisputed delivery.
  laundry_tip_free_enabled: "1",
  laundry_tip_conditional_enabled: "1",
  laundry_tip_max_ugx: "50000",
  laundry_tip_ontime_hours: "48",
  // Peebee's cut, set the same way as for riders. Provider commission is withheld from the provider's payout on the goods
  // only (never the rider fee or a tip). The customer fee is added at checkout and is 100% platform revenue.
  // When Peebee's commission is taken. "on_payout": withheld from the provider's payout as it lands in their app (like riders).
  // "at_checkout": taken immediately, on every customer checkout, and not left to the payout.
  laundry_commission_timing: "on_payout",
  // If an order is cancelled: "refund" gives the customer everything back, including Peebee's commission and fee; "keep" lets Peebee
  // keep what it already took at checkout (commission under "at_checkout", and the customer fee).
  laundry_cancel_commission: "refund",
  laundry_provider_commission_percent: "15",
  laundry_customer_fee_enabled: "0",
  laundry_customer_fee_type: "flat",
  laundry_customer_fee_value: "0",
  // The customer fee can never be more than this percent of what the customer pays for goods and rides (1-99).
  laundry_customer_fee_max_share_percent: "50",
  /** Peebee Hire: a marketplace where customers find workers and workers find gigs, projects and hiring posts (tables talent_*). Off until admin turns it on. */
  talent_enabled: "0",
  talent_gigs_enabled: "1",
  talent_projects_enabled: "1",
  talent_hiring_enabled: "1",
  talent_worker_search_enabled: "1",
  talent_payment_modes: "escrow,direct",
  talent_default_payment_mode: "escrow",
  talent_riders_can_work: "1",
  talent_worker_approval: "review",
  talent_job_review: "0",
  talent_free_access: "1",
  talent_free_onboarding: "1",
  talent_trial_days: "14",
  talent_max_open_jobs: "20",
  talent_applications_per_day: "30",
  talent_posts_per_hour: "10",
  talent_min_job_ugx: "5000",
  talent_max_job_ugx: "50000000",
  talent_job_expiry_days: "30",
  talent_auto_confirm_hours: "72",
  talent_max_milestones: "10",
  talent_max_workers_per_job: "20",
  talent_search_radius_km: "25",
  talent_max_skills: "15",
  talent_boost_days: "7",
  talent_reviews_enabled: "1",
  talent_chat_enabled: "1",
  talent_hide_contacts: "1",
  talent_unpaid_commission_limit_ugx: "50000",
  talent_recurring_enabled: "1",
  talent_recurring_frequencies: "weekly,biweekly,monthly",
  talent_recurring_max_active: "5",
  talent_recurring_max_runs: "52",
  talent_recurring_max_failures: "2",
  talent_cancel_free_minutes: "30",
  talent_late_cancel_fee_mode: "flat",
  talent_late_cancel_fee_ugx: "5000",
  talent_late_cancel_fee_percent: "10",
  talent_late_cancel_party_share_percent: "70",
  // Relay delivery (boda -> matatu -> boda) for long parcel deliveries. Off until staff turn it on.
  relay_enabled: "0",
  relay_min_distance_km: "25",
  relay_max_access_km: "10",
  relay_last_mile_radius_km: "5",
  relay_release_per_leg: "0",
  // Petrol-station drop: when the customer picks door delivery or collection ("order" = when ordering,
  // "arrival" = once the parcel reaches the station), and how far the station may be from them.
  relay_last_mile_choice: "order",
  relay_station_max_km: "10",
  // Customers may meet the matatu at a stage on its route (off: parcels go to the petrol station).
  relay_stage_pickup: "0",
  // If the customer isn't at the stage, the matatu leaves the parcel at the petrol station instead.
  relay_stage_fallback: "1",
  // For arrival times from the matatu's position, and when to say "arriving in N minutes".
  relay_matatu_speed_kmh: "30",
  relay_arrival_notice_minutes: "10",
  /** Sandbox only: demo riders, a demo matatu and demo petrol stations move relay parcels along by themselves. */
  relay_sandbox_demo: "1",
  /** Seconds each demo step waits, so a real tester can act first. */
  relay_sandbox_demo_step_seconds: "20",
  /** A relay order can be paid as soon as it is placed; off: it waits for a rider like a direct order. */
  relay_pay_before_rider: "1",
  /** "Direct" (one rider all the way) is promised in under this many hours. */
  direct_delivery_max_hours: "3",
  // Taxipress: scheduled shared-taxi seats on fixed routes. Off until staff turn it on.
  taxipress_enabled: "0",
  // full_only: a taxi leaves only when every seat is booked. driver_choice / after_wait relax that.
  taxipress_departure_rule: "full_only",
  // Whether seats still free on a taxi that is On Road may be sold in the app.
  taxipress_sell_free_seats_on_road: "0",
  // How Peebee's cut of a seat is worked out: a percentage (digital and cash can differ) or a flat amount.
  taxipress_commission_type: "percent",
  taxipress_commission_digital_percent: "0",
  taxipress_commission_cash_percent: "0",
  taxipress_commission_flat_ugx: "0",
  // Block a driver from joining the line when they owe Peebee more than this (UGX).
  taxipress_block_when_owing: "0",
  taxipress_max_owed_ugx: "0",
  taxipress_cash_enabled: "1",
  taxipress_seat_choice_fee_ugx: "0",
  taxipress_return_discount_percent: "0",
  taxipress_max_seats_per_booking: "4",
  // Which taxi may take a relay parcel: only the one Boarding Now, or any taxi in the line.
  taxipress_parcel_accept_rule: "boarding_now",
  // Most parcels one taxi takes per trip, by seat count. 0 = none until staff set it.
  taxipress_max_parcels_14: "0",
  taxipress_max_parcels_18: "0",
  taxipress_parcel_fit_text: "Must fit in the taxi's luggage space and be carried by one person.",
  // Minutes a taxi must have been Boarding Now before the driver may leave with free seats (departure rule "after_wait").
  taxipress_wait_minutes: "30",
  // How close (metres) a driver must be to the start stage to join the line. 0 turns the check off.
  taxipress_stage_radius_m: "300",
  // Minutes a passenger has to pay for a seat in the app before it is given back.
  taxipress_pay_within_minutes: "10",
  // Most cash bookings one passenger may hold at a time (cash can be a no-show).
  taxipress_max_cash_bookings: "2",
  // A passenger may cancel for a full refund within this many minutes of booking.
  taxipress_free_cancel_minutes: "10",
  // After that, this share of the fare is kept when a paid seat is cancelled (0 = always a full refund).
  taxipress_cancel_retention_percent: "0",
  // Where a kept cancellation or no-show fee goes: the driver (whose seat was held) or Peebee.
  taxipress_fee_to: "driver",
  // Minutes a taxi must have been Boarding Now before its driver may mark an absent passenger a no-show.
  taxipress_no_show_minutes: "10",
  // Share of the fare kept from a paid seat when the passenger does not board (0 = full refund).
  taxipress_no_show_fee_percent: "0",
  // When a taxi leaves the line, move its passengers to the next taxi with room (off: refund them).
  taxipress_rebook_on_removal: "1",
  taxipress_parcel_not_allowed: '["Charcoal","Fuel","Wet or raw food"]',
  taxipress_bookable_taxis: "3",
  taxipress_max_lap_children: "2",
  taxipress_child_seat_fare_percent: "100",
  taxipress_luggage_enabled: "1",
  taxipress_luggage_prices: '{"personal":0,"standard":2000,"large":4000,"excess":6000,"fragile":7000,"commercial":null}',
  taxipress_assistance_enabled: "1",
  taxipress_language_enabled: "1",
  taxipress_book_for_others_enabled: "1",
  taxipress_show_stops: "1",
  taxipress_ticket_sharing_enabled: "1",
  taxipress_open_tickets_enabled: "0",
  taxipress_open_ticket_validity_days: "0",
  taxipress_open_ticket_refund_percent: "100",
  taxipress_luggage_options_shown: "6",
  taxipress_languages: JSON.stringify([{ code: "en", name: "English", enabled: true }, { code: "lg", name: "Luganda", enabled: true }, { code: "sw", name: "Swahili", enabled: true }]),
  // Standalone Services Platform
  services_platform_enabled: "1",
  services_platform_commission_percent: "5",
  services_platform_lead_time_hours: "2",
  services_platform_max_services: "50",
  services_platform_disallow_aggregator_intangibles: "1",
  services_platform_virtual_enabled: "1",
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
  /** Phone number shown with Ambulance requests. */
  emergencyNumber?: string;
  /** Sandbox only: demo car drivers take the rides testers book. */
  sandboxDemo?: boolean;
  /** Seconds each demo driver step waits for a real person to act first. */
  sandboxDemoStepSeconds?: number;
  servicePricing?: { ratePerKm: number; minimumFare: number; comfortPremiumPercent: number; xlPremiumPercent: number; xlMinSeats: number; engine?: PricingConfig };
  withdrawalsEnabled: boolean;
  withdrawalMinAmount: number;
  scheduled: CarScheduledSettings;
  carpool: CarCarpoolSettings;
  selfDrive: CarSelfDriveSettings;
  vehiclePhotos: { max: number; minRequired: number };
  kyc: { ownerIdRequired: boolean; driverIdRequired: boolean; driverLicenceRequired: boolean };
  deals: CarDealSettings;
};

export type CarDealSettings = {
  enabled: boolean;
  shareEnabled: boolean;
  rentEnabled: boolean;
  minOwnerSharePercent: number;
  maxOwnerSharePercent: number;
  /** Highest fixed rent per day (UGX); 0 = no limit. */
  maxRentPerDay: number;
};

export type CarSelfDriveSettings = {
  enabled: boolean;
  /** Peebee's share of the rent (%); null = not decided, so self-drive stays off. */
  platformPercent: number | null;
  maxDays: number;
  minDeposit: number;
  approveWithinHours: number;
  overtimeGraceHours: number;
  inspectionsRequired: boolean;
};

export type CarCarpoolSettings = {
  enabled: boolean;
  maxSeatsPerBooking: number;
  maxRepeatWeeks: number;
  cutoffMinutes: number;
  payWithinMinutes: number;
  matchRadiusKm: number;
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

export async function getCarServicePricing(): Promise<NonNullable<CarSettings["servicePricing"]>> {
  const [rate, minimum, comfort, xl, seats, engineRaw] = await Promise.all([
    getSetting("car_convenient_rate_per_km"), getSetting("car_convenient_minimum_fare"),
    getSetting("car_comfort_premium_percent"), getSetting("car_xl_premium_percent"), getSetting("car_xl_min_seats"),
    getSetting("pricing_config"),
  ]);
  let engine: PricingConfig = DEFAULT_PRICING_CONFIG;
  try { engine = mergeDefaults(DEFAULT_PRICING_CONFIG, JSON.parse(engineRaw)); } catch { /* keep the defaults */ }
  return {
    engine,
    ratePerKm: Math.max(1, Number(rate) || 5000), minimumFare: Math.max(0, Number(minimum)),
    comfortPremiumPercent: Math.max(0, Number(comfort) || 0), xlPremiumPercent: Math.max(0, Number(xl) || 0),
    xlMinSeats: Math.max(6, Number(seats) || 6),
  };
}

export async function getCarSettings(): Promise<CarSettings> {
  const [enabled, onDemand, mode, owner, driver, platform, maxKm, wdEnabled, wdMin, sEnabled, sMax, sLead, sOpen, sWatch, sNoSig, sSpeed, cpEnabled, cpSeats, cpRepeat, cpCutoff, cpPay, cpRadius, sdEnabled, sdPct, sdDays, sdDeposit, sdApprove, sdGrace, sdInspections, vpMax, vpMin, kycOwner, kycDriverId, kycLicence, dEnabled, dShare, dRent, dMin, dMax, dRentMax, emergencyNumber, sandboxDemo, sandboxDemoStep] = await Promise.all([
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
    getSetting("car_carpool_enabled"),
    getSetting("car_carpool_max_seats_per_booking"),
    getSetting("car_carpool_max_repeat_weeks"),
    getSetting("car_carpool_cutoff_minutes"),
    getSetting("car_carpool_pay_within_minutes"),
    getSetting("car_carpool_match_radius_km"),
    getSetting("car_selfdrive_enabled"),
    getSetting("car_selfdrive_platform_percent"),
    getSetting("car_selfdrive_max_days"),
    getSetting("car_selfdrive_min_deposit"),
    getSetting("car_selfdrive_approve_within_hours"),
    getSetting("car_selfdrive_overtime_grace_hours"),
    getSetting("car_selfdrive_inspections_required"),
    getSetting("car_vehicle_photos_max"),
    getSetting("car_vehicle_photos_min_required"),
    getSetting("car_kyc_owner_id_required"),
    getSetting("car_kyc_driver_id_required"),
    getSetting("car_kyc_driver_licence_required"),
    getSetting("car_deals_enabled"),
    getSetting("car_deal_share_enabled"),
    getSetting("car_deal_rent_enabled"),
    getSetting("car_deal_min_owner_share_percent"),
    getSetting("car_deal_max_owner_share_percent"),
    getSetting("car_deal_max_rent_per_day"),
    getSetting("car_emergency_number"),
    getSetting("car_sandbox_demo"),
    getSetting("car_sandbox_demo_step_seconds"),
  ]);
  const sdPercent = sdPct === "" ? NaN : Number(sdPct);
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
    emergencyNumber: /^[0-9+*#]{2,15}$/.test(String(emergencyNumber ?? "").trim()) ? String(emergencyNumber).trim() : "999",
    sandboxDemo: sandboxDemo !== "0",
    sandboxDemoStepSeconds: clamp(sandboxDemoStep, 3, 600, 12),
    servicePricing: await getCarServicePricing(),
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
    carpool: {
      enabled: cpEnabled === "1",
      maxSeatsPerBooking: clamp(cpSeats, 1, 20, 4),
      maxRepeatWeeks: Math.min(52, Math.max(0, Math.floor(Number(cpRepeat)) || 0)),
      cutoffMinutes: clamp(cpCutoff, 0, 24 * 60, 15),
      payWithinMinutes: clamp(cpPay, 5, 24 * 60, 15),
      matchRadiusKm: clamp(cpRadius, 1, 200, 10),
    },
    selfDrive: {
      enabled: sdEnabled === "1",
      platformPercent: Number.isFinite(sdPercent) && sdPercent >= 0 && sdPercent <= 90 ? Math.floor(sdPercent) : null,
      maxDays: clamp(sdDays, 1, 365, 30),
      minDeposit: Math.max(0, Math.floor(Number(sdDeposit) || 0)),
      approveWithinHours: clamp(sdApprove, 1, 24 * 14, 12),
      overtimeGraceHours: clamp(sdGrace, 1, 24, 3),
      inspectionsRequired: sdInspections !== "0",
    },
    vehiclePhotos: (() => {
      // Always room for at least 6; never ask for more photos than can be added.
      const max = clamp(vpMax, 6, 20, 8);
      return { max, minRequired: Math.min(max, Math.max(0, Math.floor(Number(vpMin)) || 0)) };
    })(),
    kyc: { ownerIdRequired: kycOwner !== "0", driverIdRequired: kycDriverId !== "0", driverLicenceRequired: kycLicence !== "0" },
    deals: (() => {
      const lo = clamp(dMin, 0, 100, 40);
      return {
        enabled: dEnabled === "1",
        shareEnabled: dShare !== "0",
        rentEnabled: dRent !== "0",
        minOwnerSharePercent: lo,
        maxOwnerSharePercent: Math.max(lo, clamp(dMax, 0, 100, 80)),
        maxRentPerDay: Math.max(0, Math.floor(Number(dRentMax)) || 0),
      };
    })(),
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
  if (next.emergencyNumber != null) await setSetting("car_emergency_number", next.emergencyNumber);
  if (next.sandboxDemo != null) await setSetting("car_sandbox_demo", next.sandboxDemo ? "1" : "0");
  if (next.sandboxDemoStepSeconds != null) await setSetting("car_sandbox_demo_step_seconds", String(next.sandboxDemoStepSeconds));
  if (next.servicePricing) {
    await setSetting("car_convenient_rate_per_km", String(next.servicePricing.ratePerKm));
    await setSetting("car_convenient_minimum_fare", String(next.servicePricing.minimumFare));
    await setSetting("car_comfort_premium_percent", String(next.servicePricing.comfortPremiumPercent));
    await setSetting("car_xl_premium_percent", String(next.servicePricing.xlPremiumPercent));
    await setSetting("car_xl_min_seats", String(next.servicePricing.xlMinSeats));
  }
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
  const cp = next.carpool;
  if (cp) {
    await setSetting("car_carpool_enabled", cp.enabled ? "1" : "0");
    await setSetting("car_carpool_max_seats_per_booking", String(cp.maxSeatsPerBooking));
    await setSetting("car_carpool_max_repeat_weeks", String(cp.maxRepeatWeeks));
    await setSetting("car_carpool_cutoff_minutes", String(cp.cutoffMinutes));
    await setSetting("car_carpool_pay_within_minutes", String(cp.payWithinMinutes));
    await setSetting("car_carpool_match_radius_km", String(cp.matchRadiusKm));
  }
  const sd = next.selfDrive;
  if (sd) {
    await setSetting("car_selfdrive_enabled", sd.enabled ? "1" : "0");
    await setSetting("car_selfdrive_platform_percent", sd.platformPercent == null ? "" : String(sd.platformPercent));
    await setSetting("car_selfdrive_max_days", String(sd.maxDays));
    await setSetting("car_selfdrive_min_deposit", String(sd.minDeposit));
    await setSetting("car_selfdrive_approve_within_hours", String(sd.approveWithinHours));
    await setSetting("car_selfdrive_overtime_grace_hours", String(sd.overtimeGraceHours));
    if (sd.inspectionsRequired != null) await setSetting("car_selfdrive_inspections_required", sd.inspectionsRequired ? "1" : "0");
  }
  if (next.vehiclePhotos) {
    await setSetting("car_vehicle_photos_max", String(next.vehiclePhotos.max));
    await setSetting("car_vehicle_photos_min_required", String(next.vehiclePhotos.minRequired));
  }
  if (next.kyc) {
    await setSetting("car_kyc_owner_id_required", next.kyc.ownerIdRequired ? "1" : "0");
    await setSetting("car_kyc_driver_id_required", next.kyc.driverIdRequired ? "1" : "0");
    await setSetting("car_kyc_driver_licence_required", next.kyc.driverLicenceRequired ? "1" : "0");
  }
  if (next.deals) {
    await setSetting("car_deals_enabled", next.deals.enabled ? "1" : "0");
    await setSetting("car_deal_share_enabled", next.deals.shareEnabled ? "1" : "0");
    await setSetting("car_deal_rent_enabled", next.deals.rentEnabled ? "1" : "0");
    await setSetting("car_deal_min_owner_share_percent", String(next.deals.minOwnerSharePercent));
    await setSetting("car_deal_max_owner_share_percent", String(next.deals.maxOwnerSharePercent));
    await setSetting("car_deal_max_rent_per_day", String(next.deals.maxRentPerDay));
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

export type RideExtrasSettings = {
  offerMinPercent: number;
  offerMaxPercent: number;
  offerTtlMinutes: number;
  counterTtlSeconds: number;
  maxRaises: number;
  maxStops: number;
  stopFee: number;
};

/** Name your fare + multi-stop limits. Stored as plain settings keys, so no migration is needed to tune them. */
export async function getRideExtrasSettings(): Promise<RideExtrasSettings> {
  const [minP, maxP, ttl, counterTtl, raises, maxStops, stopFee] = await Promise.all([
    getSetting("fare_offer_min_percent"),
    getSetting("fare_offer_max_percent"),
    getSetting("fare_offer_ttl_minutes"),
    getSetting("fare_counter_ttl_seconds"),
    getSetting("fare_offer_max_raises"),
    getSetting("ride_max_stops"),
    getSetting("ride_stop_fee"),
  ]);
  const num = (v: string, d: string) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : Number(d));
  return {
    offerMinPercent: Math.min(100, Math.max(10, num(minP, DEFAULTS.fare_offer_min_percent))),
    offerMaxPercent: Math.max(100, Math.min(500, num(maxP, DEFAULTS.fare_offer_max_percent))),
    offerTtlMinutes: Math.max(1, Math.min(120, num(ttl, DEFAULTS.fare_offer_ttl_minutes))),
    counterTtlSeconds: Math.max(30, Math.min(1800, num(counterTtl, DEFAULTS.fare_counter_ttl_seconds))),
    maxRaises: Math.max(0, Math.min(20, num(raises, DEFAULTS.fare_offer_max_raises))),
    maxStops: Math.max(0, Math.min(5, num(maxStops, DEFAULTS.ride_max_stops))),
    stopFee: Math.max(0, Math.min(100_000, num(stopFee, DEFAULTS.ride_stop_fee))),
  };
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

/**
 * Settings are read on almost every request (the app-wide /settings payload alone reads dozens of keys), and D1 bills
 * every row read, so the whole table is loaded as one short-lived snapshot instead of one query per key. A save through
 * setSetting() (or invalidateSettingsCache() after a raw write) drops it at once; other server instances pick a change
 * up within SETTINGS_CACHE_TTL_MS. Money-safety flags that must never be stale (withdrawal freeze, custody approval,
 * payments switches) are enforced with their own direct queries, not through here.
 */
/** Tests change settings through their own database client, so the cache stays off while node:test is running. */
const SETTINGS_CACHE_TTL_MS = Number(process.env.SETTINGS_CACHE_TTL_MS ?? (process.env.NODE_TEST_CONTEXT ? 0 : 30_000)) || 0;
let settingsSnapshot: { values: Map<string, string>; at: number } | null = null;
let settingsLoading: Promise<Map<string, string>> | null = null;
let settingsVersion = 0;

export function invalidateSettingsCache(): void {
  settingsSnapshot = null;
  settingsVersion++;
}

async function loadSettings(): Promise<Map<string, string>> {
  if (settingsSnapshot && Date.now() - settingsSnapshot.at < SETTINGS_CACHE_TTL_MS) return settingsSnapshot.values;
  if (!settingsLoading) {
    const version = settingsVersion;
    settingsLoading = (async () => {
      try {
        const res = await db.execute("SELECT key, value FROM settings");
        const values = new Map<string, string>();
        for (const row of res.rows) values.set(String(row.key), String(row.value ?? ""));
        // A save that landed while this read was in flight must not be hidden behind the older snapshot.
        if (version === settingsVersion) settingsSnapshot = { values, at: Date.now() };
        return values;
      } finally {
        settingsLoading = null;
      }
    })();
  }
  return settingsLoading;
}

const MODULE_BY_LIVE_KEY = new Map<string, ModuleDef>(MODULES.filter((x) => x.liveKey).map((x) => [x.liveKey!, x]));

function parseFlagMap(raw: string | undefined): Record<string, boolean> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch { return {}; }
}

/** A module's own Live switch as stored, ignoring the modules above it. */
export function rawModuleLive(def: ModuleDef, values: Map<string, string>): boolean {
  if (def.channel) return channelModuleOn(def, values.get("channels_config"));
  if (def.liveKey) {
    const v = values.get(def.liveKey) ?? DEFAULTS[def.liveKey as SettingKey] ?? (def.defaultOn ? "1" : "0");
    return def.defaultOn ? v !== "0" : v === "1";
  }
  return parseFlagMap(values.get("modules_live"))[def.key] !== false;
}

/** True when every module above this one is on in Live. */
export function ancestorsLive(def: ModuleDef, values: Map<string, string>): boolean {
  for (let up = def.parent ? getModule(def.parent) : undefined; up; up = up.parent ? getModule(up.parent) : undefined) {
    if (!rawModuleLive(up, values)) return false;
  }
  return true;
}

/** A module's own Practice switch (on unless an admin turned it off) and every module above it. */
function practiceModuleOn(def: ModuleDef, values: Map<string, string>): boolean {
  const flags = parseFlagMap(values.get("modules_practice"));
  for (let d: ModuleDef | undefined = def; d; d = d.parent ? getModule(d.parent) : undefined) if (flags[d.key] === false) return false;
  return true;
}

/** True when every module in the chain, the module and those above it, is on in Live (its own switch, not the sync rule). */
function liveChainOn(def: ModuleDef, values: Map<string, string>): boolean {
  for (let d: ModuleDef | undefined = def; d; d = d.parent ? getModule(d.parent) : undefined) if (!rawModuleLive(d, values)) return false;
  return true;
}

const syncOn = (values: Map<string, string>) => (values.get("modules_sync") ?? DEFAULTS.modules_sync) === "1";

/** Values the practice world needs that the live platform may leave unset (a booking window, the platform's cut of a rental). */
const PRACTICE_VALUES: Partial<Record<SettingKey, string>> = {
  car_scheduled_max_advance_hours: "72",
  car_selfdrive_platform_percent: "15",
  car_carpool_max_repeat_weeks: "4",
};

/**
 * Reads a setting. A module's Live switch reads as off while any module above it (its cluster, or Peebee Car for
 * Carpool) is off, so every existing gate obeys the Services page without knowing about it. Inside a practice request
 * the module switches are the Practice ones instead, so something off in Live can still be tried in Practice.
 */
export async function getSetting(key: SettingKey): Promise<string> {
  const values = await loadSettings();
  const def = MODULE_BY_LIVE_KEY.get(key);
  if (inPractice()) {
    if (def) return practiceModuleOn(def, values) && (!syncOn(values) || liveChainOn(def, values)) ? "1" : "0";
    const forced = PRACTICE_VALUES[key];
    if (forced !== undefined) return forced;
  }
  if (def?.parent && !ancestorsLive(def, values)) return "0";
  // Kept the same as Practice: off there means off here too.
  if (def && syncOn(values) && !practiceModuleOn(def, values)) return "0";
  return values.get(key) ?? DEFAULTS[key];
}

/** The stored value, ignoring modules above. Only the Services page and its tests need this. */
export async function getSettingRaw(key: SettingKey): Promise<string> {
  return (await loadSettings()).get(key) ?? DEFAULTS[key];
}

/**
 * Saves a setting. A module's Live switch is owned by the Services page (setModuleFlags), so an older settings page
 * that saves the value it was shown, "off" because a cluster above it is off, must not turn the module off for good:
 * a write equal to what getSetting would already return changes nothing.
 */
export async function setSetting(key: SettingKey, value: string, opts: { force?: boolean } = {}): Promise<void> {
  const def = MODULE_BY_LIVE_KEY.get(key);
  if (def?.parent && !opts.force && value === "0" && !ancestorsLive(def, await loadSettings())) return;
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, value],
  });
  invalidateSettingsCache();
}

export type PlatformEnvironment = "live" | "sandbox";

export async function getPlatformEnvironment(): Promise<PlatformEnvironment> {
  // The practice world is always sandbox: sandbox is what forces mock payments and switches on the demo drivers.
  if (inPractice()) return "sandbox";
  return (await getSetting("platform_environment")) === "sandbox" ? "sandbox" : "live";
}

export async function setPlatformEnvironment(env: PlatformEnvironment): Promise<void> {
  await setSetting("platform_environment", env);
}

export async function getDeliverySettings(): Promise<{
  deliveryRatePerKm: number;
  minimumDeliveryFee: number;
  serviceRangeKm: number;
  riderVisibilityRangeKm: number;
  shoppingDeliveryFee: number;
  rideRatePerKm: number;
  rideMinimumFare: number;
  rideForOtherEnabled: boolean;
  rideForOtherDistanceM: number;
}> {
  const [rate, minimumFee, range, shoppingFee, rideRate, rideMinimum, rideForOther, rideForOtherDistance] = await Promise.all([
    getSetting("delivery_rate_per_km"),
    getSetting("minimum_delivery_fee"),
    getSetting("service_range_km"),
    getSetting("shopping_delivery_fee"),
    getSetting("ride_rate_per_km"),
    getSetting("ride_minimum_fare"),
    getSetting("ride_for_other_enabled"),
    getSetting("ride_for_other_distance_m"),
  ]);
  const visibility = Number(await getSetting("rider_visibility_range_km"));
  return {
    deliveryRatePerKm: Number(rate) || Number(DEFAULTS.delivery_rate_per_km),
    minimumDeliveryFee: Number(minimumFee) || Number(DEFAULTS.minimum_delivery_fee),
    serviceRangeKm: Number(range) || Number(DEFAULTS.service_range_km),
    riderVisibilityRangeKm: Number.isFinite(visibility) && visibility >= 0 ? visibility : Number(DEFAULTS.rider_visibility_range_km),
    shoppingDeliveryFee: Number(shoppingFee) || Number(DEFAULTS.shopping_delivery_fee),
    rideRatePerKm: Number(rideRate) || Number(DEFAULTS.ride_rate_per_km),
    rideMinimumFare: Number(rideMinimum) || Number(DEFAULTS.ride_minimum_fare),
    rideForOtherEnabled: rideForOther !== "0",
    rideForOtherDistanceM: Number(rideForOtherDistance) || Number(DEFAULTS.ride_for_other_distance_m),
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

/** Whether the shared practice world is on offer, and the background job that keeps it busy runs. Always on while the whole platform is in sandbox. */
export async function practiceWorldRunning(): Promise<boolean> {
  return (await getSetting("practice_shared_world")) === "1" || (await getPlatformEnvironment()) === "sandbox";
}

export async function getFlutterwaveDirectMobileMoney(): Promise<boolean> {
  return (await getSetting("payments_flutterwave_direct_mobile_money")) !== "0";
}

export async function getFlutterwaveDirectCard(): Promise<boolean> {
  return (await getSetting("payments_flutterwave_direct_card")) === "1";
}

export async function setFlutterwaveDirect(field: "mobile_money" | "card", enabled: boolean): Promise<void> {
  await setSetting(field === "card" ? "payments_flutterwave_direct_card" : "payments_flutterwave_direct_mobile_money", enabled ? "1" : "0");
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
  translateMode: LugandaTranslateMode;
};

export type LugandaTranslateMode = "per_item" | "whole_list";

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
  const [enabled, voicesRaw, defaultVoice, requiresPro, translateMode] = await Promise.all([
    getSetting("luganda_audio_enabled"),
    getSetting("luganda_audio_voices"),
    getSetting("luganda_audio_default_voice"),
    getSetting("luganda_audio_requires_pro"),
    getSetting("luganda_translate_mode"),
  ]);
  return {
    enabled: enabled === "1",
    voices: parseLugandaVoices(voicesRaw),
    defaultVoice,
    requiresPro: requiresPro === "1",
    translateMode: translateMode === "whole_list" ? "whole_list" : "per_item",
  };
}

export async function setLugandaAudioSettings(input: Partial<LugandaAudioSettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (input.enabled != null) writes.push(setSetting("luganda_audio_enabled", input.enabled ? "1" : "0"));
  if (input.voices != null) writes.push(setSetting("luganda_audio_voices", JSON.stringify(input.voices)));
  if (input.defaultVoice != null) writes.push(setSetting("luganda_audio_default_voice", input.defaultVoice));
  if (input.requiresPro != null) writes.push(setSetting("luganda_audio_requires_pro", input.requiresPro ? "1" : "0"));
  if (input.translateMode != null) writes.push(setSetting("luganda_translate_mode", input.translateMode));
  await Promise.all(writes);
}

// ---------------------------------------------------------------------------
// Services: the customer-facing modules an admin can switch on or off.
// ---------------------------------------------------------------------------

export const SERVICE_KEYS = ["shopping", "parcel", "ride", "food", "cargo"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];
export type ServiceSwitches = Record<ServiceKey, boolean>;

export async function getServiceSwitches(): Promise<ServiceSwitches> {
  const values = await Promise.all(SERVICE_KEYS.map((k) => getSetting(`service_${k}_enabled` as SettingKey)));
  return Object.fromEntries(SERVICE_KEYS.map((k, i) => [k, values[i] !== "0"])) as ServiceSwitches;
}

export async function setServiceSwitches(next: Partial<ServiceSwitches>): Promise<void> {
  for (const k of SERVICE_KEYS) {
    if (next[k] != null) await setSetting(`service_${k}_enabled` as SettingKey, next[k] ? "1" : "0");
  }
}

export async function isServiceEnabled(service: ServiceKey): Promise<boolean> {
  return (await getSetting(`service_${service}_enabled` as SettingKey)) !== "0";
}

/** The 403 body every "this service is switched off" refusal shares, so the apps can show one friendly message. */
export const SERVICE_PAUSED_LABEL: Record<ServiceKey, string> = {
  shopping: "Shopping lists",
  parcel: "Parcel delivery",
  ride: "Rides",
  food: "Food ordering",
  cargo: "Cargo & truck delivery",
};

export type GasSettings = {
  enabled: boolean;
  dailyLimitUgx: number;
  voucherExpiryMinutes: number;
  platformDiscountPercent: number;
  /** How long an attendant/manager sign-in lasts. */
  sessionHours: number;
  /** Wrong PIN guesses before an account is locked out (progressively longer lockouts). */
  pinMaxAttempts: number;
  /** Smallest amount a station can withdraw. */
  withdrawalMinUgx: number;
  /** Voucher code lookups an attendant may make per 5 minutes before being slowed down. */
  voucherLookupsPer5Min: number;
};

export async function getGasSettings(): Promise<GasSettings> {
  const [enabledStr, limitStr, expiryStr, discountStr, sessionStr, pinStr, minWdStr, lookupStr] = await Promise.all([
    getSetting("service_gas_enabled"),
    getSetting("gas_rider_daily_limit_ugx"),
    getSetting("gas_voucher_expiry_minutes"),
    getSetting("gas_platform_discount_percent"),
    getSetting("gas_session_hours"),
    getSetting("gas_pin_max_attempts"),
    getSetting("gas_withdrawal_min_ugx"),
    getSetting("gas_voucher_lookups_per_5min"),
  ]);
  return {
    enabled: enabledStr !== "0",
    dailyLimitUgx: Math.max(0, Number(limitStr) || 60000),
    voucherExpiryMinutes: Math.max(5, Number(expiryStr) || 60),
    platformDiscountPercent: Math.max(0, Math.min(100, Number(discountStr) || 0)),
    sessionHours: Math.max(1, Math.min(168, Number(sessionStr) || 12)),
    pinMaxAttempts: Math.max(3, Math.min(20, Number(pinStr) || 5)),
    withdrawalMinUgx: Math.max(1000, Number(minWdStr) || 5000),
    voucherLookupsPer5Min: Math.max(5, Math.min(200, Number(lookupStr) || 20)),
  };
}

export async function setGasSettings(next: Partial<GasSettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (next.enabled != null) writes.push(setSetting("service_gas_enabled", next.enabled ? "1" : "0"));
  if (next.dailyLimitUgx != null) writes.push(setSetting("gas_rider_daily_limit_ugx", String(Math.max(0, Math.round(next.dailyLimitUgx)))));
  if (next.voucherExpiryMinutes != null) writes.push(setSetting("gas_voucher_expiry_minutes", String(Math.max(5, Math.round(next.voucherExpiryMinutes)))));
  if (next.platformDiscountPercent != null) writes.push(setSetting("gas_platform_discount_percent", String(Math.max(0, Math.min(100, next.platformDiscountPercent)))));
  if (next.sessionHours != null) writes.push(setSetting("gas_session_hours", String(Math.max(1, Math.min(168, Math.round(next.sessionHours))))));
  if (next.pinMaxAttempts != null) writes.push(setSetting("gas_pin_max_attempts", String(Math.max(3, Math.min(20, Math.round(next.pinMaxAttempts))))));
  if (next.withdrawalMinUgx != null) writes.push(setSetting("gas_withdrawal_min_ugx", String(Math.max(1000, Math.round(next.withdrawalMinUgx)))));
  if (next.voucherLookupsPer5Min != null) writes.push(setSetting("gas_voucher_lookups_per_5min", String(Math.max(5, Math.min(200, Math.round(next.voucherLookupsPer5Min))))));
  await Promise.all(writes);
}

export type PharmacySettings = {
  enabled: boolean;
  /** Largest prescription photo accepted. */
  maxImageMb: number;
  /** Prescriptions one customer may submit per hour. */
  submissionsPerHour: number;
};

export async function getPharmacySettings(): Promise<PharmacySettings> {
  const [enabled, mb, perHour] = await Promise.all([
    getSetting("pharmacy_enabled"),
    getSetting("pharmacy_max_image_mb"),
    getSetting("pharmacy_submissions_per_hour"),
  ]);
  return {
    enabled: enabled !== "0",
    maxImageMb: Math.max(1, Math.min(20, Number(mb) || 6)),
    submissionsPerHour: Math.max(1, Math.min(100, Number(perHour) || 10)),
  };
}

export async function setPharmacySettings(next: Partial<PharmacySettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (next.enabled != null) writes.push(setSetting("pharmacy_enabled", next.enabled ? "1" : "0"));
  if (next.maxImageMb != null) writes.push(setSetting("pharmacy_max_image_mb", String(Math.max(1, Math.min(20, Math.round(next.maxImageMb))))));
  if (next.submissionsPerHour != null) writes.push(setSetting("pharmacy_submissions_per_hour", String(Math.max(1, Math.min(100, Math.round(next.submissionsPerHour))))));
  await Promise.all(writes);
}

export type MarketplaceSettings = {
  enabled: boolean;
  liveEnabled: boolean;
  commissionPercent: number;
  proPricingMode: "free" | "paid";
  proStorePriceUgx: number;
  proLivePriceUgx: number;
  proTrialDays: number;
  adMinBudgetUgx: number;
  adFeePercent: number;
  minOrderAmountUgx: number;
  liveMaxDurationMins: number;
  deliveryBaseFeeUgx: number;
  /** A cart left this many hours is set aside as an earlier cart when the customer starts a new one. */
  cartExpiryHours: number;
  /** Tier 3: Merchant Advanced Marketplace (Elite — Shopify / Shopify Pro level) */
  eliteEnabled: boolean;
  elitePriceUgx: number;
  eliteCommissionPercent: number;
  proMaxProducts: number;
  eliteMaxProducts: number;
  proMaxCollections: number;
  eliteMaxCollections: number;
  proMaxDiscounts: number;
  eliteMaxDiscounts: number;
  eliteB2bEnabled: boolean;
  eliteMultiOutletInventoryEnabled: boolean;
  eliteCustomDomainEnabled: boolean;
  eliteLoyaltyEnabled: boolean;
  eliteMaxLoyaltyCashbackPercent: number;
  elitePosEnabled: boolean;
  eliteStockTransfersEnabled: boolean;
  eliteCrmEnabled: boolean;
  elitePurchaseOrdersEnabled: boolean;
  eliteBundlesEnabled: boolean;
  eliteWinbackEnabled: boolean;
  eliteStorefrontSectionsEnabled: boolean;
  eliteSmsAlertsEnabled: boolean;
  eliteSmsCostPerMessageUgx: number;
  smsProvider: "simulator" | "africas_talking" | "twilio";
  eliteDigitalProductsEnabled: boolean;
  eliteLmsSyncEnabled: boolean;
  eliteMaxCourses: number;
  eliteMaxDigitalProducts: number;
};

export async function getMarketplaceSettings(): Promise<MarketplaceSettings> {
  const [
    enabledStr,
    liveEnabledStr,
    commissionStr,
    proPricingModeStr,
    proStoreStr,
    proLiveStr,
    trialDaysStr,
    adMinBudgetStr,
    adFeeStr,
    minOrderStr,
    liveDurationStr,
    deliveryBaseFeeStr,
    cartExpiryStr,
    eliteEnabledStr,
    elitePriceStr,
    eliteCommissionStr,
    proMaxProductsStr,
    eliteMaxProductsStr,
    proMaxCollectionsStr,
    eliteMaxCollectionsStr,
    proMaxDiscountsStr,
    eliteMaxDiscountsStr,
    eliteB2bStr,
    eliteMultiOutletStr,
    eliteCustomDomainStr,
    eliteLoyaltyStr,
    eliteMaxCashbackStr,
    elitePosStr,
    eliteTransfersStr,
    eliteCrmStr,
    elitePosOrdersStr,
    eliteBundlesStr,
    eliteWinbackStr,
    eliteStorefrontSectionsStr,
    eliteSmsAlertsStr,
    eliteSmsCostStr,
    smsProviderStr,
    eliteDigitalProductsStr,
    eliteLmsSyncStr,
    eliteMaxCoursesStr,
    eliteMaxDigitalProductsStr,
  ] = await Promise.all([
    getSetting("marketplace_enabled"),
    getSetting("marketplace_live_enabled"),
    getSetting("marketplace_commission_percent"),
    getSetting("marketplace_pro_pricing_mode"),
    getSetting("marketplace_pro_store_price_ugx"),
    getSetting("marketplace_pro_live_price_ugx"),
    getSetting("marketplace_pro_trial_days"),
    getSetting("marketplace_ad_min_budget_ugx"),
    getSetting("marketplace_ad_fee_percent"),
    getSetting("marketplace_min_order_amount"),
    getSetting("marketplace_live_max_duration_mins"),
    getSetting("marketplace_delivery_base_fee"),
    getSetting("cart_expiry_hours"),
    getSetting("marketplace_elite_enabled"),
    getSetting("marketplace_elite_price_ugx"),
    getSetting("marketplace_elite_commission_percent"),
    getSetting("marketplace_pro_max_products"),
    getSetting("marketplace_elite_max_products"),
    getSetting("marketplace_pro_max_collections"),
    getSetting("marketplace_elite_max_collections"),
    getSetting("marketplace_pro_max_discounts"),
    getSetting("marketplace_elite_max_discounts"),
    getSetting("marketplace_elite_b2b_enabled"),
    getSetting("marketplace_elite_multi_outlet_inventory_enabled"),
    getSetting("marketplace_elite_custom_domain_enabled"),
    getSetting("marketplace_elite_loyalty_enabled"),
    getSetting("marketplace_elite_max_loyalty_cashback_percent"),
    getSetting("marketplace_elite_pos_enabled"),
    getSetting("marketplace_elite_stock_transfers_enabled"),
    getSetting("marketplace_elite_crm_enabled"),
    getSetting("marketplace_elite_purchase_orders_enabled"),
    getSetting("marketplace_elite_bundles_enabled"),
    getSetting("marketplace_elite_winback_enabled"),
    getSetting("marketplace_elite_storefront_sections_enabled"),
    getSetting("marketplace_elite_sms_alerts_enabled"),
    getSetting("marketplace_elite_sms_cost_per_message_ugx"),
    getSetting("marketplace_sms_provider"),
    getSetting("marketplace_elite_digital_products_enabled"),
    getSetting("marketplace_elite_lms_sync_enabled"),
    getSetting("marketplace_elite_max_courses"),
    getSetting("marketplace_elite_max_digital_products"),
  ]);

  return {
    enabled: enabledStr !== "0",
    liveEnabled: liveEnabledStr !== "0",
    commissionPercent: Math.max(0, Math.min(100, Number(commissionStr) || 10)),
    proPricingMode: (proPricingModeStr === "paid" ? "paid" : "free") as "free" | "paid",
    proStorePriceUgx: Math.max(0, Number(proStoreStr) || 35000),
    proLivePriceUgx: Math.max(0, Number(proLiveStr) || 75000),
    proTrialDays: Math.max(0, Number(trialDaysStr) || 14),
    adMinBudgetUgx: Math.max(1000, Number(adMinBudgetStr) || 10000),
    adFeePercent: Math.max(0, Math.min(100, Number(adFeeStr) || 5)),
    minOrderAmountUgx: Math.max(0, Number(minOrderStr) || 5000),
    liveMaxDurationMins: Math.max(15, Number(liveDurationStr) || 180),
    deliveryBaseFeeUgx: Math.max(0, Number(deliveryBaseFeeStr) || 3000),
    cartExpiryHours: Math.max(1, Math.min(720, Number(cartExpiryStr) || 12)),
    eliteEnabled: eliteEnabledStr !== "0",
    elitePriceUgx: Math.max(0, Number(elitePriceStr) || 150000),
    eliteCommissionPercent: Math.max(0, Math.min(100, Number(eliteCommissionStr ?? 5))),
    proMaxProducts: Math.max(1, Number(proMaxProductsStr) || 50),
    eliteMaxProducts: Math.max(10, Number(eliteMaxProductsStr) || 5000),
    proMaxCollections: Math.max(1, Number(proMaxCollectionsStr) || 3),
    eliteMaxCollections: Math.max(1, Number(eliteMaxCollectionsStr) || 100),
    proMaxDiscounts: Math.max(0, Number(proMaxDiscountsStr) || 2),
    eliteMaxDiscounts: Math.max(1, Number(eliteMaxDiscountsStr) || 200),
    eliteB2bEnabled: eliteB2bStr !== "0",
    eliteMultiOutletInventoryEnabled: eliteMultiOutletStr !== "0",
    eliteCustomDomainEnabled: eliteCustomDomainStr !== "0",
    eliteLoyaltyEnabled: eliteLoyaltyStr !== "0",
    eliteMaxLoyaltyCashbackPercent: Math.max(0, Math.min(50, Number(eliteMaxCashbackStr) || 15)),
    elitePosEnabled: elitePosStr !== "0",
    eliteStockTransfersEnabled: eliteTransfersStr !== "0",
    eliteCrmEnabled: eliteCrmStr !== "0",
    elitePurchaseOrdersEnabled: elitePosOrdersStr !== "0",
    eliteBundlesEnabled: eliteBundlesStr !== "0",
    eliteWinbackEnabled: eliteWinbackStr !== "0",
    eliteStorefrontSectionsEnabled: eliteStorefrontSectionsStr !== "0",
    eliteSmsAlertsEnabled: eliteSmsAlertsStr !== "0",
    eliteSmsCostPerMessageUgx: Math.max(0, Number(eliteSmsCostStr) || 35),
    smsProvider: (smsProviderStr === "africas_talking" || smsProviderStr === "twilio") ? smsProviderStr : "simulator",
    eliteDigitalProductsEnabled: eliteDigitalProductsStr !== "0",
    eliteLmsSyncEnabled: eliteLmsSyncStr !== "0",
    eliteMaxCourses: Math.max(1, Number(eliteMaxCoursesStr) || 50),
    eliteMaxDigitalProducts: Math.max(1, Number(eliteMaxDigitalProductsStr) || 200),
  };
}

export async function setMarketplaceSettings(next: Partial<MarketplaceSettings>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (next.enabled != null) writes.push(setSetting("marketplace_enabled", next.enabled ? "1" : "0"));
  if (next.liveEnabled != null) writes.push(setSetting("marketplace_live_enabled", next.liveEnabled ? "1" : "0"));
  if (next.commissionPercent != null) writes.push(setSetting("marketplace_commission_percent", String(Math.max(0, Math.min(100, next.commissionPercent)))));
  if (next.proPricingMode != null) writes.push(setSetting("marketplace_pro_pricing_mode", next.proPricingMode));
  if (next.proStorePriceUgx != null) writes.push(setSetting("marketplace_pro_store_price_ugx", String(Math.max(0, Math.round(next.proStorePriceUgx)))));
  if (next.proLivePriceUgx != null) writes.push(setSetting("marketplace_pro_live_price_ugx", String(Math.max(0, Math.round(next.proLivePriceUgx)))));
  if (next.proTrialDays != null) writes.push(setSetting("marketplace_pro_trial_days", String(Math.max(0, Math.round(next.proTrialDays)))));
  if (next.adMinBudgetUgx != null) writes.push(setSetting("marketplace_ad_min_budget_ugx", String(Math.max(1000, Math.round(next.adMinBudgetUgx)))));
  if (next.adFeePercent != null) writes.push(setSetting("marketplace_ad_fee_percent", String(Math.max(0, Math.min(100, next.adFeePercent)))));
  if (next.minOrderAmountUgx != null) writes.push(setSetting("marketplace_min_order_amount", String(Math.max(0, Math.round(next.minOrderAmountUgx)))));
  if (next.liveMaxDurationMins != null) writes.push(setSetting("marketplace_live_max_duration_mins", String(Math.max(15, Math.round(next.liveMaxDurationMins)))));
  if (next.deliveryBaseFeeUgx != null) writes.push(setSetting("marketplace_delivery_base_fee", String(Math.max(0, Math.round(next.deliveryBaseFeeUgx)))));
  if (next.cartExpiryHours != null) writes.push(setSetting("cart_expiry_hours", String(Math.max(1, Math.min(720, Math.round(next.cartExpiryHours))))));
  if (next.eliteEnabled != null) writes.push(setSetting("marketplace_elite_enabled", next.eliteEnabled ? "1" : "0"));
  if (next.elitePriceUgx != null) writes.push(setSetting("marketplace_elite_price_ugx", String(Math.max(0, Math.round(next.elitePriceUgx)))));
  if (next.eliteCommissionPercent != null) writes.push(setSetting("marketplace_elite_commission_percent", String(Math.max(0, Math.min(100, next.eliteCommissionPercent)))));
  if (next.proMaxProducts != null) writes.push(setSetting("marketplace_pro_max_products", String(Math.max(1, Math.round(next.proMaxProducts)))));
  if (next.eliteMaxProducts != null) writes.push(setSetting("marketplace_elite_max_products", String(Math.max(10, Math.round(next.eliteMaxProducts)))));
  if (next.proMaxCollections != null) writes.push(setSetting("marketplace_pro_max_collections", String(Math.max(1, Math.round(next.proMaxCollections)))));
  if (next.eliteMaxCollections != null) writes.push(setSetting("marketplace_elite_max_collections", String(Math.max(1, Math.round(next.eliteMaxCollections)))));
  if (next.proMaxDiscounts != null) writes.push(setSetting("marketplace_pro_max_discounts", String(Math.max(0, Math.round(next.proMaxDiscounts)))));
  if (next.eliteMaxDiscounts != null) writes.push(setSetting("marketplace_elite_max_discounts", String(Math.max(1, Math.round(next.eliteMaxDiscounts)))));
  if (next.eliteB2bEnabled != null) writes.push(setSetting("marketplace_elite_b2b_enabled", next.eliteB2bEnabled ? "1" : "0"));
  if (next.eliteMultiOutletInventoryEnabled != null) writes.push(setSetting("marketplace_elite_multi_outlet_inventory_enabled", next.eliteMultiOutletInventoryEnabled ? "1" : "0"));
  if (next.eliteCustomDomainEnabled != null) writes.push(setSetting("marketplace_elite_custom_domain_enabled", next.eliteCustomDomainEnabled ? "1" : "0"));
  if (next.eliteLoyaltyEnabled != null) writes.push(setSetting("marketplace_elite_loyalty_enabled", next.eliteLoyaltyEnabled ? "1" : "0"));
  if (next.eliteMaxLoyaltyCashbackPercent != null) writes.push(setSetting("marketplace_elite_max_loyalty_cashback_percent", String(Math.max(0, Math.min(50, next.eliteMaxLoyaltyCashbackPercent)))));
  if (next.elitePosEnabled != null) writes.push(setSetting("marketplace_elite_pos_enabled", next.elitePosEnabled ? "1" : "0"));
  if (next.eliteStockTransfersEnabled != null) writes.push(setSetting("marketplace_elite_stock_transfers_enabled", next.eliteStockTransfersEnabled ? "1" : "0"));
  if (next.eliteCrmEnabled != null) writes.push(setSetting("marketplace_elite_crm_enabled", next.eliteCrmEnabled ? "1" : "0"));
  if (next.elitePurchaseOrdersEnabled != null) writes.push(setSetting("marketplace_elite_purchase_orders_enabled", next.elitePurchaseOrdersEnabled ? "1" : "0"));
  if (next.eliteBundlesEnabled != null) writes.push(setSetting("marketplace_elite_bundles_enabled", next.eliteBundlesEnabled ? "1" : "0"));
  if (next.eliteWinbackEnabled != null) writes.push(setSetting("marketplace_elite_winback_enabled", next.eliteWinbackEnabled ? "1" : "0"));
  if (next.eliteStorefrontSectionsEnabled != null) writes.push(setSetting("marketplace_elite_storefront_sections_enabled", next.eliteStorefrontSectionsEnabled ? "1" : "0"));
  if (next.eliteSmsAlertsEnabled != null) writes.push(setSetting("marketplace_elite_sms_alerts_enabled", next.eliteSmsAlertsEnabled ? "1" : "0"));
  if (next.eliteSmsCostPerMessageUgx != null) writes.push(setSetting("marketplace_elite_sms_cost_per_message_ugx", String(Math.max(0, Math.round(next.eliteSmsCostPerMessageUgx)))));
  if (next.smsProvider != null) writes.push(setSetting("marketplace_sms_provider", next.smsProvider));
  await Promise.all(writes);
}



/** Raw read/write for the option registry (keys that are not part of the typed DEFAULTS). */
export async function getRawSetting(key: string): Promise<string | undefined> {
  return (await loadSettings()).get(key);
}

export async function setRawSetting(key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, value],
  });
  invalidateSettingsCache();
}
