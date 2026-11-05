import { patchSchema } from "../lib/patch-schema.js";
import { MODULE_NOTICE_MESSAGE_MAX } from "@peebee/shared";
import { Hono } from "hono";
import { getRoadSettings } from "../lib/road-distance.js";
import { z } from "zod";
import { describeOptions, setOptions } from "../lib/option-settings.js";
import { logActivity } from "../admin/activity.js";
import { getWorkSettings, setWorkSettings, WORK_MATCHING_MODES, WORK_PRICING_MODES, WORK_PROVIDER_KINDS, WORK_SERVICE_TYPES } from "../work/settings.js";
import { hasPermission, requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { clientIp } from "../lib/ratelimit.js";
import { getModuleSettings, setModuleFlags, unknownModuleKeys } from "../lib/modules.js";
import {
  getActiveCallProvider,
  getActiveMapsProvider,
  getJawgLightStyle,
  getActiveProviders,
  getDeliverySettings,
  getServiceSwitches,
  setServiceSwitches,
  getTimeFeeSettings,
  getJobExpirySettings,
  setJobExpirySettings,
  getBiddingSettings,
  setBiddingSettings,
  getCarSettings,
  setCarSettings,
  getGasSettings,
  setGasSettings,
  getPharmacySettings,
  setPharmacySettings,
  getMarketplaceSettings,
  setMarketplaceSettings,
  getLugandaAudioSettings,
  getMatchingSettings,
  getMonetizationSettings,
  getNavMode,
  getSetting,
  getPaymentsDemoMode,
  getFlutterwaveDirectMobileMoney,
  getFlutterwaveDirectCard,
  getPaymentsPendingTimeoutMinutes,
  getPaymentsLateWatchHours,
  getWithdrawalNumbersRequireVerification,
  getPlatformEnvironment,
  getProSettings,
  getRiderReserveSettings,
  getVoiceNoteMaxSeconds,
  getVslaSettings,
  getWalletSettings,
  setActiveCallProvider,
  setActiveMapsProvider,
  setJawgLightStyle,
  setActiveProviders,
  setLugandaAudioSettings,
  setMatchingModesEnabled,
  setMonetizationSettings,
  setNavMode,
  setPaymentsDemoMode,
  setFlutterwaveDirect,
  setPlatformEnvironment,
  setProSettings,
  setRiderReserveSettings,
  setSetting,
  setVslaSettings,
  type CallProviderIdentity,
  type MapsProviderIdentity,
  type NavMode,
  type PaymentProviderIdentity,
} from "../lib/settings.js";
import {
  CALL_PROVIDER_CREDENTIAL_FIELDS,
  callCredentialFieldStatus,
  clearCallCredential,
  isCallProviderConfigured,
  saveCallCredentials,
} from "../calls/credentials.js";
import {
  getMapsCredential,
  isMapsProviderConfigured,
  MAPS_PROVIDER_CREDENTIAL_FIELDS,
  mapsCredentialFieldStatus,
  clearMapsCredential as clearMapsCredentialField,
  saveMapsCredentials,
} from "../maps/credentials.js";
import { clearCredential, credentialLengthError, PROVIDER_CREDENTIAL_FIELDS, saveCredentials } from "../payments/credentials.js";
import { paymentsIntegrationStatus } from "../payments/service.js";
import { getShoppingUnitSettings, shoppingUnitSettingsSchema } from "./shopping-units.js";
import { getHomeMenuSettings, homeMenuSchema } from "./home-menu.js";
import { getRideTrackingSettings, rideTrackingSchema } from "./ride-tracking.js";
import { verificationAvailable } from "../account/number-verification.js";

export const settingsRoutes = new Hono();

async function fullSettings() {
  const [delivery, matching, activeProviders, demoMode, flwDirectMobileMoney, flwDirectCard, paymentsPendingTimeout, paymentsLateWatch, requireVerifiedNumbers, wallet, voiceNoteMaxSeconds, monetization, platformEnvironment, practiceModeEnabled, riderReserve, callsActiveProvider, mapsActiveProvider, navMode, merchantPayments, merchantSandbox, merchantCustody, merchantFrozen, vsla, lugandaAudio, pro, services] =
    await Promise.all([
      getDeliverySettings(),
      getMatchingSettings(),
      getActiveProviders(),
      getPaymentsDemoMode(),
      getFlutterwaveDirectMobileMoney(),
      getFlutterwaveDirectCard(),
      getPaymentsPendingTimeoutMinutes(),
      getPaymentsLateWatchHours(),
      getWithdrawalNumbersRequireVerification(),
      getWalletSettings(),
      getVoiceNoteMaxSeconds(),
      getMonetizationSettings(),
      getPlatformEnvironment(),
      getSetting("user_practice_mode_enabled"),
      getRiderReserveSettings(),
      getActiveCallProvider(),
      getActiveMapsProvider(),
      getNavMode(),
      getSetting("merchant_payments_enabled"),
      getSetting("merchant_sandbox_enabled"),
      getSetting("merchant_live_custody_approved"),
      getSetting("merchant_withdrawals_frozen"),
      getVslaSettings(),
      getLugandaAudioSettings(),
      getProSettings(),
      getServiceSwitches(),
    ]);

  // The active provider's own key/token, handed to every signed-in client
  // so it can init that provider's SDK/tile URLs — these are all
  // browser-embedded keys meant to be restricted by domain, same as each
  // provider's own docs recommend, so this isn't a secret leak the way a
  // payment secret key would be. Only the active provider's field is ever
  // populated; "streetmaps" needs none and all stay null.
  let mapsGoogleApiKey: string | null = null;
  let mapsMapboxAccessToken: string | null = null;
  let mapsMaptilerApiKey: string | null = null;
  let mapsStadiaApiKey: string | null = null;
  let mapsThunderforestApiKey: string | null = null;
  let mapsJawgAccessToken: string | null = null;
  let mapsTomtomApiKey: string | null = null;
  const mapsJawgLightStyle = await getJawgLightStyle();
  if (mapsActiveProvider === "google") {
    mapsGoogleApiKey = (await getMapsCredential("google", "apiKey")) ?? null;
  } else if (mapsActiveProvider === "mapbox") {
    mapsMapboxAccessToken = (await getMapsCredential("mapbox", "accessToken")) ?? null;
  } else if (mapsActiveProvider === "maptiler") {
    mapsMaptilerApiKey = (await getMapsCredential("maptiler", "apiKey")) ?? null;
  } else if (mapsActiveProvider === "stadia") {
    mapsStadiaApiKey = (await getMapsCredential("stadia", "apiKey")) ?? null;
  } else if (mapsActiveProvider === "thunderforest") {
    mapsThunderforestApiKey = (await getMapsCredential("thunderforest", "apiKey")) ?? null;
  } else if (mapsActiveProvider === "jawg") {
    mapsJawgAccessToken = (await getMapsCredential("jawg", "accessToken")) ?? null;
  } else if (mapsActiveProvider === "tomtom") {
    mapsTomtomApiKey = (await getMapsCredential("tomtom", "apiKey")) ?? null;
  }

  return {
    shoppingUnits: await getShoppingUnitSettings(),
    homeMenu: await getHomeMenuSettings(),
    rideTracking: await getRideTrackingSettings(),
    timeFees: await getTimeFeeSettings(),
    jobExpiry: await getJobExpirySettings(),
    bidding: await getBiddingSettings(),
    car: await getCarSettings(),
    gas: await getGasSettings(),
    work: await getWorkSettings(),
    pharmacy: await getPharmacySettings(),
    marketplace: await getMarketplaceSettings(),
    ...delivery,
    // How delivery distances follow the road (the server address is removed for non-staff in GET /settings).
    ...(await getRoadSettings().then((road) => ({ roadDistanceFactor: road.factor, routingServerUrl: road.routingServerUrl ?? "" }))),
    services,
    modules: await getModuleSettings(),
    ...matching,
    paymentsActiveProviders: activeProviders,
    paymentsDemoMode: demoMode,
    paymentsFlutterwaveDirectMobileMoney: flwDirectMobileMoney,
    paymentsFlutterwaveDirectCard: flwDirectCard,
    paymentsPendingTimeoutMinutes: paymentsPendingTimeout,
    paymentsLateWatchHours: paymentsLateWatch,
    withdrawalNumbersRequireVerification: requireVerifiedNumbers,
    merchantPaymentsEnabled: (platformEnvironment === "sandbox" ? merchantSandbox : merchantPayments) === "1",
    merchantLiveCustodyApproved: merchantCustody === "1",
    merchantWithdrawalsFrozen: merchantFrozen === "1",
    walletUnverifiedCap: wallet.unverifiedCap,
    walletVerifiedCap: wallet.verifiedCap,
    walletMaxTopup: wallet.maxTopup,
    voiceNoteMaxSeconds,
    platformEnvironment,
    practiceModeEnabled: practiceModeEnabled === "1",
    riderMinimumBalanceEnabled: riderReserve.enabled,
    riderMinimumBalanceAmount: riderReserve.amount,
    callsActiveProvider,
    mapsActiveProvider,
    mapsGoogleApiKey,
    mapsMapboxAccessToken,
    mapsMaptilerApiKey,
    mapsStadiaApiKey,
    mapsThunderforestApiKey,
    mapsJawgAccessToken,
    mapsTomtomApiKey,
    mapsJawgLightStyle,
    navMode,
    ...monetization,
    vslaLoanInterestEnabled: vsla.loanInterestEnabled,
    vslaDefaultInterestRate: vsla.defaultInterestRate,
    vslaDefaultLoanableMultiple: vsla.defaultLoanableMultiple,
    vslaDefaultCycleMonths: vsla.defaultCycleMonths,
    vslaDefaultMaxLoanMonths: vsla.defaultMaxLoanMonths,
    vslaContributionRecorderRole: vsla.contributionRecorderRole,
    vslaCashDoubleCheckRequired: vsla.cashDoubleCheckRequired,
    vslaAdminLedgerVisibility: vsla.adminLedgerVisibility,
    vslaUnconfirmedIntentEscalationHours: vsla.unconfirmedIntentEscalationHours,
    vslaFeaturePlacement: vsla.featurePlacement,
    vslaDefaultSharePrice: vsla.defaultSharePrice,
    vslaRequiresPro: vsla.requiresPro,
    vslaCustodialMode: vsla.custodialMode,
    lugandaAudioEnabled: lugandaAudio.enabled,
    lugandaAudioVoices: lugandaAudio.voices,
    lugandaAudioDefaultVoice: lugandaAudio.defaultVoice,
    lugandaAudioRequiresPro: lugandaAudio.requiresPro,
    lugandaTranslateMode: lugandaAudio.translateMode,
    proSubscriptionEnabled: pro.enabled,
    proRecurringEnabled: pro.recurringEnabled,
    proRecurringAmount: pro.recurringAmount,
    proRecurringCadence: pro.recurringCadence,
    proOnetimeEnabled: pro.onetimeEnabled,
    proOnetimeAmount: pro.onetimeAmount,
  };
}

/** Any signed-in user: the customer app needs the current rate/range (to show
 * a live estimate) and which matching modes are on offer (to build the
 * preference picker). None of it is sensitive, but it isn't reachable while
 * signed out either — orderRoutes registers requireAuth as "*" on the shared
 * /v1 router, which covers everything mounted after it, this included. */
settingsRoutes.get("/settings", async (c) => {
  const { routingServerUrl, ...settings } = await fullSettings();
  // The routing server's address only to staff: it may carry a key.
  return c.json({ settings: c.get("user")?.role === "admin" ? { ...settings, routingServerUrl } : settings });
});

const practiceExperienceSchema = z.enum(["customer", "rider", "restaurant", "merchant"]);
const PRACTICE_REMINDER_DAYS = 7;

settingsRoutes.get("/practice/:experience/status", requireAuth, async (c) => {
  const experience = practiceExperienceSchema.safeParse(c.req.param("experience"));
  if (!experience.success) return c.json({ error: "invalid_experience" }, 400);
  const user = c.get("user");
  const result = await db.execute({
    sql: `SELECT completed_at, opted_out_at, last_prompted_at
          FROM user_practice_preferences WHERE user_id = ? AND experience = ?`,
    args: [user.sub, experience.data],
  });
  const row = result.rows[0] as { completed_at?: string | null; opted_out_at?: string | null; last_prompted_at?: string | null } | undefined;
  const completed = !!row?.completed_at;
  const optedOut = !!row?.opted_out_at;
  const lastPromptedAt = row?.last_prompted_at ?? null;
  const lastPromptedMs = lastPromptedAt ? Date.parse(`${lastPromptedAt.replace(" ", "T")}Z`) : 0;
  const reminderDue = !lastPromptedAt || Date.now() - lastPromptedMs >= PRACTICE_REMINDER_DAYS * 86_400_000;
  const available = (await getSetting("user_practice_mode_enabled")) === "1";
  return c.json({ practice: { experience: experience.data, available, completed, optedOut, lastPromptedAt, shouldPrompt: available && !completed && !optedOut && reminderDue, reminderDays: PRACTICE_REMINDER_DAYS } });
});

settingsRoutes.post("/practice/:experience/prompted", requireAuth, async (c) => {
  const experience = practiceExperienceSchema.safeParse(c.req.param("experience"));
  if (!experience.success) return c.json({ error: "invalid_experience" }, 400);
  const user = c.get("user");
  await db.execute({
    sql: `INSERT INTO user_practice_preferences (user_id, experience, last_prompted_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id, experience) DO UPDATE SET
            last_prompted_at = datetime('now'), updated_at = datetime('now')`,
    args: [user.sub, experience.data],
  });
  return c.json({ ok: true });
});

settingsRoutes.post("/practice/:experience/completed", requireAuth, async (c) => {
  const experience = practiceExperienceSchema.safeParse(c.req.param("experience"));
  if (!experience.success) return c.json({ error: "invalid_experience" }, 400);
  const user = c.get("user");
  await db.execute({
    sql: `INSERT INTO user_practice_preferences (user_id, experience, completed_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id, experience) DO UPDATE SET
            completed_at = datetime('now'), updated_at = datetime('now')`,
    args: [user.sub, experience.data],
  });
  return c.json({ ok: true });
});

settingsRoutes.post("/practice/:experience/dismiss", requireAuth, async (c) => {
  const experience = practiceExperienceSchema.safeParse(c.req.param("experience"));
  if (!experience.success) return c.json({ error: "invalid_experience" }, 400);
  const user = c.get("user");
  await db.execute({
    sql: `INSERT INTO user_practice_preferences (user_id, experience, opted_out_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id, experience) DO UPDATE SET
            opted_out_at = datetime('now'), updated_at = datetime('now')`,
    args: [user.sub, experience.data],
  });
  return c.json({ ok: true });
});

const updateSchema = z.object({
  // Peebee Car work modes and the owner/driver/platform profit share (must total 100).
  car: z
    .object({
      enabled: z.boolean(),
      onDemandEnabled: z.boolean(),
      matchingMode: z.enum(["customer_selects", "first_to_claim"]),
      followCustomerChoice: z.boolean().optional(),
      shares: z.object({
        owner: z.number().int().min(0).max(100),
        driver: z.number().int().min(0).max(100),
        platform: z.number().int().min(0).max(100),
      }),
      maxPickupKm: z.number().int().min(1).max(200),
      emergencyNumber: z.string().trim().regex(/^[0-9+*#]{2,15}$/, "Enter a phone number, digits only.").optional(),
      sandboxDemo: z.boolean().optional(),
      sandboxDemoStepSeconds: z.number().int().min(3).max(600).optional(),
      servicePricing: z.object({
        ratePerKm: z.number().int().min(1).max(1_000_000),
        minimumFare: z.number().int().min(0).max(1_000_000),
        comfortPremiumPercent: z.number().int().min(0).max(200),
        xlPremiumPercent: z.number().int().min(0).max(300),
        xlMinSeats: z.number().int().min(6).max(20),
      }).optional(),
      scheduled: z.object({
        enabled: z.boolean(),
        maxAdvanceHours: z.number().int().min(1).max(24 * 90).nullable(),
        minLeadMinutes: z.number().int().min(0).max(24 * 60),
        openMinutes: z.number().int().min(5).max(24 * 60),
        watchMinutes: z.number().int().min(5).max(24 * 60),
        noSignalMinutes: z.number().int().min(1).max(120),
        avgSpeedKmh: z.number().int().min(5).max(120),
      }),
      carpool: z.object({
        enabled: z.boolean(),
        maxSeatsPerBooking: z.number().int().min(1).max(20),
        maxRepeatWeeks: z.number().int().min(0).max(52),
        cutoffMinutes: z.number().int().min(0).max(24 * 60),
        payWithinMinutes: z.number().int().min(5).max(24 * 60),
        matchRadiusKm: z.number().int().min(1).max(200),
      }),
      selfDrive: z.object({
        enabled: z.boolean(),
        platformPercent: z.number().int().min(0).max(90).nullable(),
        maxDays: z.number().int().min(1).max(365),
        minDeposit: z.number().int().min(0).max(100_000_000),
        approveWithinHours: z.number().int().min(1).max(24 * 14),
        overtimeGraceHours: z.number().int().min(1).max(24).default(3),
        inspectionsRequired: z.boolean().default(true),
      }),
      vehiclePhotos: z.object({ max: z.number().int().min(6).max(20), minRequired: z.number().int().min(0).max(20) }),
      kyc: z.object({ ownerIdRequired: z.boolean(), driverIdRequired: z.boolean(), driverLicenceRequired: z.boolean() }),
      deals: z
        .object({
          enabled: z.boolean(),
          shareEnabled: z.boolean(),
          rentEnabled: z.boolean(),
          minOwnerSharePercent: z.number().int().min(0).max(100),
          maxOwnerSharePercent: z.number().int().min(0).max(100),
          maxRentPerDay: z.number().int().min(0).max(100_000_000),
        })
        .refine((d) => d.minOwnerSharePercent <= d.maxOwnerSharePercent, { message: "The lowest owner share can't be above the highest." }),
      withdrawalsEnabled: z.boolean(),
      withdrawalMinAmount: z.number().int().min(0).max(100_000_000),
    })
    .refine((c) => c.shares.owner + c.shares.driver + c.shares.platform === 100, { message: "Owner, driver and platform shares must total 100%" })
    .optional(),
  // Price bidding on rides/parcels. A bid can be 1–100% of the app price at the
  // lowest and 100–500% at the highest.
  bidding: z
    .object({
      enabled: z.boolean(),
      minPercent: z.number().int().min(1).max(100),
      maxPercent: z.number().int().min(100).max(500),
    })
    .optional(),
  // Jobs nobody serves within this long are expired automatically. Capped at
  // 7 days either way so a typo can't leave jobs hanging for months.
  jobExpiry: z
    .object({
      enabled: z.boolean(),
      value: z.number().int().positive(),
      unit: z.enum(["minutes", "hours"]),
    })
    .refine((j) => (j.unit === "hours" ? j.value * 60 : j.value) <= 7 * 24 * 60, { message: "Max 7 days" })
    .refine((j) => (j.unit === "minutes" ? j.value >= 5 : true), { message: "At least 5 minutes" })
    .optional(),
  timeFees: z.object({
    cancellationEnabled: z.boolean(),
    cancellationType: z.enum(["flat", "percent"]),
    cancellationValue: z.number().nonnegative().max(1_000_000),
    waitingEnabled: z.boolean(),
    waitingType: z.enum(["flat", "percent"]),
    waitingValue: z.number().nonnegative().max(1_000_000),
    freeWaitingMinutes: z.number().int().min(1).max(120),
    waitingWarningMinutes: z.number().int().min(0).max(120),
  }).superRefine((fees, ctx) => {
    for (const kind of ["cancellation", "waiting"] as const) {
      const value = fees[`${kind}Value`];
      if (!fees[`${kind}Enabled`]) continue;
      if (fees[`${kind}Type`] === "percent" ? value > 100 : value < 500 || value % 500 !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [`${kind}Value`], message: "Use 0–100% or a flat fee in UGX 500 increments." });
      }
    }
    if (fees.waitingWarningMinutes > fees.freeWaitingMinutes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["waitingWarningMinutes"], message: "The warning must be at or before the free waiting limit." });
    }
  }).optional(),
  deliveryRatePerKm: z.number().positive().max(1_000_000).optional(),
  minimumDeliveryFee: z.number().int().nonnegative().max(1_000_000).optional(),
  serviceRangeKm: z.number().positive().max(1000).optional(),
  riderVisibilityRangeKm: z.number().min(0).max(1000).optional(),
  roadDistanceFactor: z.number().min(1).max(3).optional(),
  routingServerUrl: z.union([z.literal(""), z.string().url().max(300).regex(/^https?:\/\//)]).optional(),
  shoppingDeliveryFee: z.number().int().nonnegative().max(1_000_000).optional(),
  shoppingUnits: shoppingUnitSettingsSchema.optional(),
  homeMenu: homeMenuSchema.optional(),
  rideTracking: rideTrackingSchema.optional(),
  rideRatePerKm: z.number().positive().max(1_000_000).optional(),
  rideMinimumFare: z.number().int().nonnegative().max(1_000_000).optional(),
  services: patchSchema(z.object({ shopping: z.boolean(), parcel: z.boolean(), ride: z.boolean(), food: z.boolean() })).optional(),
  gas: patchSchema(z
    .object({
      enabled: z.boolean(),
      dailyLimitUgx: z.number().int().min(0).max(10_000_000),
      voucherExpiryMinutes: z.number().int().min(5).max(1440),
      platformDiscountPercent: z.number().min(0).max(100),
      sessionHours: z.number().int().min(1).max(168),
      pinMaxAttempts: z.number().int().min(3).max(20),
      withdrawalMinUgx: z.number().int().min(1000).max(100_000_000),
      voucherLookupsPer5Min: z.number().int().min(5).max(200),
    }))
    .optional(),
  pharmacy: patchSchema(z
    .object({
      enabled: z.boolean(),
      maxImageMb: z.number().int().min(1).max(20),
      submissionsPerHour: z.number().int().min(1).max(100),
    }))
    .optional(),
  work: patchSchema(z
    .object({
      enabled: z.boolean(),
      serviceTypes: z.array(z.enum(WORK_SERVICE_TYPES)),
      pricingModes: z.array(z.enum(WORK_PRICING_MODES)).min(1),
      matchingModes: z.array(z.enum(WORK_MATCHING_MODES)).min(1),
      defaultMatching: z.enum(WORK_MATCHING_MODES),
      providerKinds: z.array(z.enum(WORK_PROVIDER_KINDS)).min(1),
      commissionPercent: z.number().int().min(0).max(60),
      requireApproval: z.boolean(),
      offerWindowMinutes: z.number().int().min(5).max(10080),
      radiusKm: z.number().int().min(1).max(200),
      maxNotified: z.number().int().min(1).max(200),
      minLeadMinutes: z.number().int().min(0).max(10080),
      maxAdvanceDays: z.number().int().min(1).max(365),
      quoteValidHours: z.number().int().min(1).max(336),
      maxQuoteUgx: z.number().int().min(1000).max(1_000_000_000),
      freeCancelMinutes: z.number().int().min(0).max(1440),
      lateCancelFeePercent: z.number().int().min(0).max(100),
      autoConfirmHours: z.number().int().min(1).max(336),
      disputeWindowHours: z.number().int().min(1).max(720),
      jobsPerHour: z.number().int().min(1).max(100),
      rematchOnProviderCancel: z.boolean(),
      maxRematches: z.number().int().min(0).max(10),
      photosEnabled: z.boolean(),
      maxPhotosPerJob: z.number().int().min(1).max(30),
      maxPhotoKb: z.number().int().min(100).max(10240),
      chatEnabled: z.boolean(),
      trackingEnabled: z.boolean(),
      onsiteCheckEnabled: z.boolean(),
      onsiteRadiusM: z.number().int().min(20).max(2000),
      onsiteMinMinutes: z.number().int().min(1).max(1440),
      onsiteAction: z.enum(["flag", "suspend"]),
      onsiteFlagNoLocation: z.boolean(),
      onsiteRequireLocation: z.boolean(),
      onsiteSuspendAfterFlags: z.number().int().min(0).max(50),
      onsiteWindowDays: z.number().int().min(1).max(365),
      locationRetentionDays: z.number().int().min(1).max(365),
      scheduleQuickMinutes: z.array(z.number().int().min(5).max(4320)).max(4),
      scheduleTomorrowEnabled: z.boolean(),
      scheduleTomorrowTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }))
    .optional(),
  marketplace: patchSchema(z
    .object({
      enabled: z.boolean(),
      liveEnabled: z.boolean(),
      commissionPercent: z.number().min(0).max(100),
      proPricingMode: z.enum(["free", "paid"]),
      proStorePriceUgx: z.number().int().min(0).max(10_000_000),
      proLivePriceUgx: z.number().int().min(0).max(10_000_000),
      proTrialDays: z.number().int().min(0).max(365),
      adMinBudgetUgx: z.number().int().min(1000).max(100_000_000),
      adFeePercent: z.number().min(0).max(100),
      minOrderAmountUgx: z.number().int().min(0).max(10_000_000),
      liveMaxDurationMins: z.number().int().min(15).max(1440),
      deliveryBaseFeeUgx: z.number().int().min(0).max(1_000_000),
      cartExpiryHours: z.number().int().min(1).max(720),
      eliteEnabled: z.boolean(),
      elitePriceUgx: z.number().int().min(0).max(50_000_000),
      eliteCommissionPercent: z.number().min(0).max(100),
      proMaxProducts: z.number().int().min(1).max(100_000),
      eliteMaxProducts: z.number().int().min(10).max(500_000),
      proMaxCollections: z.number().int().min(1).max(1000),
      eliteMaxCollections: z.number().int().min(1).max(5000),
      proMaxDiscounts: z.number().int().min(0).max(1000),
      eliteMaxDiscounts: z.number().int().min(1).max(10_000),
      eliteB2bEnabled: z.boolean(),
      eliteMultiOutletInventoryEnabled: z.boolean(),
      eliteCustomDomainEnabled: z.boolean(),
      eliteLoyaltyEnabled: z.boolean(),
      eliteMaxLoyaltyCashbackPercent: z.number().min(0).max(50),
      elitePosEnabled: z.boolean(),
      eliteStockTransfersEnabled: z.boolean(),
      eliteCrmEnabled: z.boolean(),
      elitePurchaseOrdersEnabled: z.boolean(),
      eliteBundlesEnabled: z.boolean(),
      eliteWinbackEnabled: z.boolean(),
    eliteStorefrontSectionsEnabled: z.boolean(),
    eliteSmsAlertsEnabled: z.boolean(),
    eliteSmsCostPerMessageUgx: z.number().min(0).max(1000),
    smsProvider: z.enum(["simulator", "africas_talking", "twilio"]),
    eliteDigitalProductsEnabled: z.boolean(),
    eliteLmsSyncEnabled: z.boolean(),
    eliteMaxCourses: z.number().int().min(1).max(1000),
    eliteMaxDigitalProducts: z.number().int().min(1).max(5000),
    }))
    .optional(),
  rideForOtherEnabled: z.boolean().optional(),
  rideForOtherDistanceM: z.number().int().min(50).max(50_000).optional(),
  enabledModes: z.array(z.enum(["first_to_claim", "nearest_window", "customer_selects"])).optional(),
  nearestWindowSeconds: z.number().int().positive().max(3600).optional(),
  maxAssignmentMinutes: z.number().int().positive().max(120).optional(),
  autoAssignWithoutAcceptance: z.boolean().optional(),
  unpaidMatchReleaseMinutes: z.number().int().min(0).max(1440).optional(),
  stuckFundingReleaseMinutes: z.number().int().min(0).max(1440).optional(),
  oneActiveRideEnabled: z.boolean().optional(),
  riderCloseUnpaidMinutes: z.number().int().min(0).max(120).optional(),
  paymentsActiveProviders: z.array(z.enum(["yo", "flutterwave", "mtn", "airtel"])).min(1).max(4).optional(),
  paymentsDemoMode: z.boolean().optional(),
  paymentsFlutterwaveDirectMobileMoney: z.boolean().optional(),
  paymentsFlutterwaveDirectCard: z.boolean().optional(),
  paymentsPendingTimeoutMinutes: z.number().int().min(0).max(1440).optional(),
  paymentsLateWatchHours: z.number().int().min(0).max(168).optional(),
  withdrawalNumbersRequireVerification: z.boolean().optional(),
  practiceModeEnabled: z.boolean().optional(),
  merchantPaymentsEnabled: z.boolean().optional(),
  walletUnverifiedCap: z.number().int().positive().max(100_000_000).optional(),
  walletVerifiedCap: z.number().int().positive().max(100_000_000).optional(),
  walletMaxTopup: z.number().int().positive().max(100_000_000).optional(),
  voiceNoteMaxSeconds: z.number().int().positive().max(600).optional(),
  riderMinimumBalanceEnabled: z.boolean().optional(),
  riderMinimumBalanceAmount: z.number().int().nonnegative().max(1_000_000).optional(),
  // Monetization — see ../lib/monetization.ts for how these combine.
  deliveryCommissionEnabled: z.boolean().optional(),
  deliveryCommissionParcelPercent: z.number().min(0).max(100).optional(),
  deliveryCommissionShoppingPercent: z.number().min(0).max(100).optional(),
  serviceFeeEnabled: z.boolean().optional(),
  serviceFeeType: z.enum(["flat", "percent"]).optional(),
  serviceFeeValue: z.number().min(0).max(1_000_000).optional(),
  // The service fee can never be more than this % of the fare — always under 100.
  serviceFeeMaxSharePercent: z.number().int().min(1).max(99).optional(),
  processingFeeEnabled: z.boolean().optional(),
  processingFeePercent: z.number().min(0).max(100).optional(),
  processingFeeMode: z.enum(["customer", "rider", "split"]).optional(),
  processingFeeSplitCustomerPercent: z.number().min(0).max(100).optional(),
  cashFeeSource: z.enum(["wallet", "deposit"]).optional(),
  subscriptionEnabled: z.boolean().optional(),
  subscriptionMode: z.enum(["recurring", "once"]).optional(),
  subscriptionAmount: z.number().min(0).max(1_000_000).optional(),
  subscriptionCadence: z.enum(["daily", "weekly", "monthly"]).optional(),
  // Rider Stage Savings Circles — see ../lib/settings.ts getVslaSettings.
  vslaLoanInterestEnabled: z.boolean().optional(),
  vslaDefaultInterestRate: z.number().min(0).max(100).optional(),
  vslaDefaultLoanableMultiple: z.number().positive().max(10).optional(),
  vslaDefaultCycleMonths: z.number().int().positive().max(60).optional(),
  vslaDefaultMaxLoanMonths: z.number().int().positive().max(24).optional(),
  vslaContributionRecorderRole: z.enum(["any_officer", "treasurer_only"]).optional(),
  vslaCashDoubleCheckRequired: z.boolean().optional(),
  vslaAdminLedgerVisibility: z.enum(["read_only_all", "private_per_stage"]).optional(),
  vslaUnconfirmedIntentEscalationHours: z.number().int().positive().max(168).optional(),
  vslaFeaturePlacement: z.enum(["home_card_and_screen", "bottom_nav_tab", "account_only", "wallet_card"]).optional(),
  vslaDefaultSharePrice: z.number().int().positive().optional(),
  vslaRequiresPro: z.boolean().optional(),
  vslaCustodialMode: z.boolean().optional(),
  // Luganda list-reading — see ../lib/settings.ts getLugandaAudioSettings.
  lugandaAudioEnabled: z.boolean().optional(),
  lugandaAudioVoices: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(60) })).max(20).optional(),
  lugandaAudioDefaultVoice: z.string().min(1).max(60).optional(),
  lugandaAudioRequiresPro: z.boolean().optional(),
  lugandaTranslateMode: z.enum(["per_item", "whole_list"]).optional(),
  // Rider Pro — see ../lib/settings.ts getProSettings.
  proSubscriptionEnabled: z.boolean().optional(),
  proRecurringEnabled: z.boolean().optional(),
  proRecurringAmount: z.number().min(0).max(1_000_000).optional(),
  proRecurringCadence: z.enum(["daily", "weekly", "monthly"]).optional(),
  proOnetimeEnabled: z.boolean().optional(),
  proOnetimeAmount: z.number().min(0).max(1_000_000).optional(),
}).superRefine((d, ctx) => {
  // A percentage service fee can't be more than the admin's own cap (or 99% when none was sent).
  const cap = d.serviceFeeMaxSharePercent ?? 99;
  if (d.serviceFeeType === "percent" && d.serviceFeeValue != null && d.serviceFeeValue > cap) {
    ctx.addIssue({ code: "custom", path: ["serviceFeeValue"], message: `A percentage service fee can't be more than ${cap}%` });
  }
});

const PAYMENTS_FIELDS = [
  "timeFees",
  "paymentsActiveProviders",
  "paymentsDemoMode",
  "paymentsFlutterwaveDirectMobileMoney",
  "paymentsFlutterwaveDirectCard",
  "paymentsPendingTimeoutMinutes",
  "paymentsLateWatchHours",
  "withdrawalNumbersRequireVerification",
  "merchantPaymentsEnabled",
  "walletUnverifiedCap",
  "walletVerifiedCap",
  "walletMaxTopup",
  "riderMinimumBalanceEnabled",
  "riderMinimumBalanceAmount",
  "deliveryCommissionEnabled",
  "deliveryCommissionParcelPercent",
  "deliveryCommissionShoppingPercent",
  "serviceFeeEnabled",
  "serviceFeeType",
  "serviceFeeValue",
  "serviceFeeMaxSharePercent",
  "processingFeeEnabled",
  "processingFeePercent",
  "processingFeeMode",
  "processingFeeSplitCustomerPercent",
  "cashFeeSource",
  "subscriptionEnabled",
  "subscriptionMode",
  "subscriptionAmount",
  "subscriptionCadence",
  "proSubscriptionEnabled",
  "proRecurringEnabled",
  "proRecurringAmount",
  "proRecurringCadence",
  "proOnetimeEnabled",
  "proOnetimeAmount",
] as const;

settingsRoutes.put(
  "/admin/settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    // Which payment aggregator moves real money is a bigger blast radius
    // than delivery pricing — require the more specific permission too,
    // rather than letting anyone with generic settings.manage flip it.
    if (PAYMENTS_FIELDS.some((f) => parsed.data[f] != null) && !hasPermission(user.adminRole, "payments.manage")) {
      return c.json({ error: "forbidden", message: "Requires the payments.manage permission" }, 403);
    }

    const before = await fullSettings();

    if (parsed.data.timeFees) await setSetting("time_fees", JSON.stringify(parsed.data.timeFees));
    if (parsed.data.shoppingUnits) await setSetting("shopping_units_config", JSON.stringify(parsed.data.shoppingUnits));
    if (parsed.data.homeMenu) await setSetting("home_menu_config", JSON.stringify(parsed.data.homeMenu));
    if (parsed.data.rideTracking) await setSetting("ride_tracking", JSON.stringify(parsed.data.rideTracking));
    if (parsed.data.jobExpiry) await setJobExpirySettings(parsed.data.jobExpiry);
    if (parsed.data.bidding) await setBiddingSettings(parsed.data.bidding);
    if (parsed.data.car) await setCarSettings(parsed.data.car);
    if (parsed.data.gas) await setGasSettings(parsed.data.gas);
    if (parsed.data.work) await setWorkSettings(parsed.data.work);
    if (parsed.data.pharmacy) await setPharmacySettings(parsed.data.pharmacy);
    if (parsed.data.marketplace) await setMarketplaceSettings(parsed.data.marketplace);

    if (parsed.data.deliveryRatePerKm != null) {
      await setSetting("delivery_rate_per_km", String(parsed.data.deliveryRatePerKm));
    }
    if (parsed.data.minimumDeliveryFee != null) {
      await setSetting("minimum_delivery_fee", String(parsed.data.minimumDeliveryFee));
    }
    if (parsed.data.rideRatePerKm != null) {
      await setSetting("ride_rate_per_km", String(parsed.data.rideRatePerKm));
    }
    if (parsed.data.rideMinimumFare != null) {
      await setSetting("ride_minimum_fare", String(parsed.data.rideMinimumFare));
    }
    if (parsed.data.services) await setServiceSwitches(parsed.data.services);
    if (parsed.data.rideForOtherEnabled != null) {
      await setSetting("ride_for_other_enabled", parsed.data.rideForOtherEnabled ? "1" : "0");
    }
    if (parsed.data.rideForOtherDistanceM != null) {
      await setSetting("ride_for_other_distance_m", String(parsed.data.rideForOtherDistanceM));
    }
    if (parsed.data.serviceRangeKm != null) {
      await setSetting("service_range_km", String(parsed.data.serviceRangeKm));
    }
    if (parsed.data.riderVisibilityRangeKm != null) {
      await setSetting("rider_visibility_range_km", String(parsed.data.riderVisibilityRangeKm));
    }
    if (parsed.data.roadDistanceFactor != null) {
      await setSetting("road_distance_factor", String(parsed.data.roadDistanceFactor));
    }
    if (parsed.data.routingServerUrl != null) {
      await setSetting("routing_server_url", parsed.data.routingServerUrl.trim());
    }
    if (parsed.data.shoppingDeliveryFee != null) {
      await setSetting("shopping_delivery_fee", String(parsed.data.shoppingDeliveryFee));
    }
    if (parsed.data.enabledModes != null) {
      await setMatchingModesEnabled(parsed.data.enabledModes);
    }
    if (parsed.data.nearestWindowSeconds != null) {
      await setSetting("nearest_window_seconds", String(parsed.data.nearestWindowSeconds));
    }
    if (parsed.data.maxAssignmentMinutes != null) {
      await setSetting("max_assignment_minutes", String(parsed.data.maxAssignmentMinutes));
    }
    if (parsed.data.autoAssignWithoutAcceptance != null) {
      await setSetting("auto_assign_without_acceptance", parsed.data.autoAssignWithoutAcceptance ? "1" : "0");
    }
    if (parsed.data.unpaidMatchReleaseMinutes != null) {
      await setSetting("unpaid_match_release_minutes", String(parsed.data.unpaidMatchReleaseMinutes));
    }
    if (parsed.data.stuckFundingReleaseMinutes != null) {
      await setSetting("stuck_funding_release_minutes", String(parsed.data.stuckFundingReleaseMinutes));
    }
    if (parsed.data.oneActiveRideEnabled != null) {
      await setSetting("one_active_ride_enabled", parsed.data.oneActiveRideEnabled ? "1" : "0");
    }
    if (parsed.data.riderCloseUnpaidMinutes != null) {
      await setSetting("rider_close_unpaid_minutes", String(parsed.data.riderCloseUnpaidMinutes));
    }
    if (parsed.data.paymentsActiveProviders != null) {
      await setActiveProviders(parsed.data.paymentsActiveProviders as PaymentProviderIdentity[]);
    }
    if (parsed.data.paymentsDemoMode != null) {
      await setPaymentsDemoMode(parsed.data.paymentsDemoMode);
    }
    if (parsed.data.paymentsFlutterwaveDirectMobileMoney != null) {
      await setFlutterwaveDirect("mobile_money", parsed.data.paymentsFlutterwaveDirectMobileMoney);
    }
    if (parsed.data.paymentsFlutterwaveDirectCard != null) {
      await setFlutterwaveDirect("card", parsed.data.paymentsFlutterwaveDirectCard);
    }
    if (parsed.data.paymentsPendingTimeoutMinutes != null) {
      await setSetting("payments_pending_timeout_minutes", String(parsed.data.paymentsPendingTimeoutMinutes));
    }
    if (parsed.data.withdrawalNumbersRequireVerification != null) {
      if (parsed.data.withdrawalNumbersRequireVerification && !(await verificationAvailable())) {
        return c.json({ error: "migration_pending", message: "Apply migration 0155_saved_number_verification.sql before turning this on." }, 409);
      }
      await setSetting("withdrawal_numbers_require_verification", parsed.data.withdrawalNumbersRequireVerification ? "1" : "0");
    }
    if (parsed.data.paymentsLateWatchHours != null) {
      await setSetting("payments_late_watch_hours", String(parsed.data.paymentsLateWatchHours));
    }
    if (parsed.data.practiceModeEnabled != null) {
      await setSetting("user_practice_mode_enabled", parsed.data.practiceModeEnabled ? "1" : "0");
    }
    if (parsed.data.merchantPaymentsEnabled != null) {
      if (parsed.data.merchantPaymentsEnabled && before.platformEnvironment === "live") {
        const approved = await getSetting("merchant_live_custody_approved");
        if (approved !== "1") {
          return c.json({
            error: "merchant_custody_approval_required",
            message: "Record an active regulated custody and safeguarding approval before enabling live merchant payments.",
          }, 409);
        }
      }
      const key = before.platformEnvironment === "sandbox" ? "merchant_sandbox_enabled" : "merchant_payments_enabled";
      await setSetting(key, parsed.data.merchantPaymentsEnabled ? "1" : "0");
    }
    if (parsed.data.walletUnverifiedCap != null) {
      await setSetting("wallet_unverified_cap", String(parsed.data.walletUnverifiedCap));
    }
    if (parsed.data.walletVerifiedCap != null) {
      await setSetting("wallet_verified_cap", String(parsed.data.walletVerifiedCap));
    }
    if (parsed.data.walletMaxTopup != null) {
      await setSetting("wallet_max_topup", String(parsed.data.walletMaxTopup));
    }
    if (parsed.data.voiceNoteMaxSeconds != null) {
      await setSetting("voice_note_max_seconds", String(parsed.data.voiceNoteMaxSeconds));
    }
    await setRiderReserveSettings({
      enabled: parsed.data.riderMinimumBalanceEnabled,
      amount: parsed.data.riderMinimumBalanceAmount,
    });
    await setMonetizationSettings({
      deliveryCommissionEnabled: parsed.data.deliveryCommissionEnabled,
      deliveryCommissionParcelPercent: parsed.data.deliveryCommissionParcelPercent,
      deliveryCommissionShoppingPercent: parsed.data.deliveryCommissionShoppingPercent,
      serviceFeeEnabled: parsed.data.serviceFeeEnabled,
      serviceFeeType: parsed.data.serviceFeeType,
      serviceFeeValue: parsed.data.serviceFeeValue,
      serviceFeeMaxSharePercent: parsed.data.serviceFeeMaxSharePercent,
      processingFeeEnabled: parsed.data.processingFeeEnabled,
      processingFeePercent: parsed.data.processingFeePercent,
      processingFeeMode: parsed.data.processingFeeMode,
      processingFeeSplitCustomerPercent: parsed.data.processingFeeSplitCustomerPercent,
      cashFeeSource: parsed.data.cashFeeSource,
      subscriptionEnabled: parsed.data.subscriptionEnabled,
      subscriptionMode: parsed.data.subscriptionMode,
      subscriptionAmount: parsed.data.subscriptionAmount,
      subscriptionCadence: parsed.data.subscriptionCadence,
    });

    await setVslaSettings({
      loanInterestEnabled: parsed.data.vslaLoanInterestEnabled,
      defaultInterestRate: parsed.data.vslaDefaultInterestRate,
      defaultLoanableMultiple: parsed.data.vslaDefaultLoanableMultiple,
      defaultCycleMonths: parsed.data.vslaDefaultCycleMonths,
      defaultMaxLoanMonths: parsed.data.vslaDefaultMaxLoanMonths,
      contributionRecorderRole: parsed.data.vslaContributionRecorderRole,
      cashDoubleCheckRequired: parsed.data.vslaCashDoubleCheckRequired,
      adminLedgerVisibility: parsed.data.vslaAdminLedgerVisibility,
      unconfirmedIntentEscalationHours: parsed.data.vslaUnconfirmedIntentEscalationHours,
      featurePlacement: parsed.data.vslaFeaturePlacement,
      defaultSharePrice: parsed.data.vslaDefaultSharePrice,
      requiresPro: parsed.data.vslaRequiresPro,
      custodialMode: parsed.data.vslaCustodialMode,
    });

    await setLugandaAudioSettings({
      enabled: parsed.data.lugandaAudioEnabled,
      voices: parsed.data.lugandaAudioVoices,
      defaultVoice: parsed.data.lugandaAudioDefaultVoice,
      requiresPro: parsed.data.lugandaAudioRequiresPro,
      translateMode: parsed.data.lugandaTranslateMode,
    });

    await setProSettings({
      enabled: parsed.data.proSubscriptionEnabled,
      recurringEnabled: parsed.data.proRecurringEnabled,
      recurringAmount: parsed.data.proRecurringAmount,
      recurringCadence: parsed.data.proRecurringCadence,
      onetimeEnabled: parsed.data.proOnetimeEnabled,
      onetimeAmount: parsed.data.proOnetimeAmount,
    });

    const after = await fullSettings();

    await logActivity({
      actor: user,
      action: "settings.update",
      entityType: "settings",
      summary: "Updated platform settings",
      before,
      after,
      revertible: true,
      ip: clientIp(c),
    });

    return c.json({ settings: after });
  },
);

const modulesUpdateSchema = z.object({
  live: z.record(z.string(), z.boolean()).optional(),
  practice: z.record(z.string(), z.boolean()).optional(),
  notices: z.record(z.string(), z.object({
    reason: z.enum(["coming_soon", "maintenance", "unavailable"]),
    message: z.string().max(MODULE_NOTICE_MESSAGE_MAX).optional(),
    returnAt: z.string().max(40).refine((v) => v === "" || Number.isFinite(Date.parse(v)), "Not a date").optional(),
  }).nullable()).optional(),
  sync: z.boolean().optional(),
  practiceModeEnabled: z.boolean().optional(),
  practiceSharedWorld: z.boolean().optional(),
});

async function modulesPayload() {
  const [modules, practiceModeEnabled, practiceSharedWorld] = await Promise.all([getModuleSettings(), getSetting("user_practice_mode_enabled"), getSetting("practice_shared_world")]);
  return { modules, practiceModeEnabled: practiceModeEnabled === "1", practiceSharedWorld: practiceSharedWorld === "1" };
}

/** Every module's Live and Practice switch, and the master Practice switches. */
settingsRoutes.get("/admin/modules", requireAuth, requireRole("admin"), requirePermission("settings.manage"), async (c) => c.json(await modulesPayload()));

/**
 * One place that turns modules on and off, in Live and in Practice. Only the switches named in the body change.
 * Each change is logged by module, so the activity log shows who switched Carpool on in Practice and off in Live.
 */
settingsRoutes.put("/admin/modules", requireAuth, requireRole("admin"), requirePermission("settings.manage"), async (c) => {
  const user = c.get("user");
  const parsed = modulesUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const unknown = unknownModuleKeys(parsed.data);
  if (unknown.length) return c.json({ error: "unknown_module", message: `Unknown module: ${unknown.join(", ")}` }, 400);
  const before = await modulesPayload();
  await setModuleFlags(parsed.data);
  if (parsed.data.practiceModeEnabled != null) await setSetting("user_practice_mode_enabled", parsed.data.practiceModeEnabled ? "1" : "0");
  if (parsed.data.practiceSharedWorld != null) await setSetting("practice_shared_world", parsed.data.practiceSharedWorld ? "1" : "0");
  const after = await modulesPayload();
  const changed: string[] = [];
  for (const world of ["live", "practice"] as const) {
    for (const [key, on] of Object.entries(parsed.data[world] ?? {})) {
      if (before.modules.flags[key]?.[world] !== on) changed.push(`${key} ${world} ${on ? "on" : "off"}`);
    }
  }
  for (const [key, n] of Object.entries(parsed.data.notices ?? {})) {
    if (JSON.stringify(before.modules.notices?.[key] ?? null) !== JSON.stringify(after.modules.notices?.[key] ?? null)) changed.push(n ? `${key} notice "${n.reason}"` : `${key} notice cleared`);
  }
  if (before.modules.sync !== after.modules.sync) changed.push(`keep Live and Practice the same ${after.modules.sync ? "on" : "off"}`);
  if (before.practiceModeEnabled !== after.practiceModeEnabled) changed.push(`practice mode ${after.practiceModeEnabled ? "on" : "off"}`);
  if (before.practiceSharedWorld !== after.practiceSharedWorld) changed.push(`practice runs on ${after.practiceSharedWorld ? "the shared world" : "each person's device"}`);
  if (changed.length) {
    await logActivity({
      actor: user, action: "modules.update", entityType: "modules",
      summary: `Switched: ${changed.join(", ")}`,
      before: { flags: before.modules.flags, notices: before.modules.notices, practiceModeEnabled: before.practiceModeEnabled, practiceSharedWorld: before.practiceSharedWorld },
      after: { flags: after.modules.flags, notices: after.modules.notices, practiceModeEnabled: after.practiceModeEnabled, practiceSharedWorld: after.practiceSharedWorld },
      revertible: false, ip: clientIp(c),
    });
  }
  return c.json(after);
});

const environmentSchema = z.object({ environment: z.enum(["live", "sandbox"]) });

/**
 * The whole-platform live/sandbox switch — kept as its own endpoint rather
 * than folded into PUT /admin/settings above, deliberately: this is the
 * single most consequential toggle in the app (every customer and rider
 * sees a different dataset the instant it flips), so it gets its own
 * explicit action and its own activity log entry rather than riding along
 * with an unrelated settings save. Same permission gate as the payments
 * fields above — it's exactly as financially significant.
 */
settingsRoutes.put(
  "/admin/platform-environment",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  requirePermission("payments.manage"),
  async (c) => {
    const user = c.get("user");
    const parsed = environmentSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    const before = await getPlatformEnvironment();
    if (before === parsed.data.environment) {
      return c.json({ platformEnvironment: before });
    }

    await setPlatformEnvironment(parsed.data.environment);

    await logActivity({
      actor: user,
      action: "settings.platform_environment",
      entityType: "settings",
      summary: `Switched the platform from ${before} to ${parsed.data.environment}`,
      before: { platformEnvironment: before },
      after: { platformEnvironment: parsed.data.environment },
      ip: clientIp(c),
    });

    return c.json({ platformEnvironment: parsed.data.environment });
  },
);

const providerParam = z.enum(["yo", "flutterwave", "mtn", "airtel"]);

const saveCredentialsSchema = z.object({
  fields: z.record(z.string(), z.string().max(2000)),
});

/**
 * Saves API credentials for one payment aggregator. Same gate as the
 * paymentsActiveProviders field above (settings.manage + payments.manage) —
 * this is a strictly more sensitive version of the same action, so it
 * doesn't need its own permission. Values are encrypted before they touch
 * the DB (see ../payments/credentials.ts); the activity log only ever
 * records which field *keys* changed, never their contents.
 */
settingsRoutes.put(
  "/admin/payments/credentials/:provider",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  requirePermission("payments.manage"),
  async (c) => {
    const user = c.get("user");
    const providerParsed = providerParam.safeParse(c.req.param("provider"));
    if (!providerParsed.success) return c.json({ error: "invalid_provider" }, 400);
    const provider = providerParsed.data as PaymentProviderIdentity;

    const bodyParsed = saveCredentialsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!bodyParsed.success) return c.json({ error: "invalid_body", issues: bodyParsed.error.issues }, 400);

    const validKeys = new Set(PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
    const unknown = Object.keys(bodyParsed.data.fields).filter((k) => !validKeys.has(k));
    if (unknown.length > 0) return c.json({ error: "unknown_field", fields: unknown }, 400);

    const lengthError = credentialLengthError(provider, bodyParsed.data.fields);
    if (lengthError) return c.json({ error: "invalid_credential", message: lengthError }, 400);

    const changed = await saveCredentials(provider, bodyParsed.data.fields);

    if (changed.length > 0) {
      await logActivity({
        actor: user,
        action: "payments.credentials.update",
        entityType: "payment_credentials",
        entityId: provider,
        summary: `Updated ${provider} credentials: ${changed.join(", ")}`,
        ip: clientIp(c),
      });
    }

    return c.json({ changed });
  },
);

/** Clears one saved credential field, reverting it to its env-var fallback
 * (if any) — e.g. to roll back to sandbox after testing production keys. */
settingsRoutes.delete(
  "/admin/payments/credentials/:provider/:field",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  requirePermission("payments.manage"),
  async (c) => {
    const user = c.get("user");
    const providerParsed = providerParam.safeParse(c.req.param("provider"));
    if (!providerParsed.success) return c.json({ error: "invalid_provider" }, 400);
    const provider = providerParsed.data as PaymentProviderIdentity;

    const field = c.req.param("field") ?? "";
    const validKeys = new Set(PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
    if (!validKeys.has(field)) return c.json({ error: "unknown_field" }, 400);

    await clearCredential(provider, field);
    await logActivity({
      actor: user,
      action: "payments.credentials.clear",
      entityType: "payment_credentials",
      entityId: provider,
      summary: `Cleared ${provider} credential field: ${field}`,
      ip: clientIp(c),
    });

    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Voice calls — which provider is live, and per-provider credentials. Same
// shape and same permission gate as the payments provider/credentials
// endpoints above, deliberately — see ../calls/credentials.ts and
// ../calls/routes.ts.
// ---------------------------------------------------------------------------

const callProviderParam = z.enum(["mock", "cloudflare", "webrtc_p2p", "twilio", "agora"]);
const configurableCallProvider = z.enum(["cloudflare", "webrtc_p2p", "twilio", "agora"]);

settingsRoutes.get(
  "/admin/calls-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const [activeProvider, cloudflare, webrtcP2p, twilio, agora] = await Promise.all([
      getActiveCallProvider(),
      callCredentialFieldStatus("cloudflare"),
      callCredentialFieldStatus("webrtc_p2p"),
      callCredentialFieldStatus("twilio"),
      callCredentialFieldStatus("agora"),
    ]);
    return c.json({
      activeProvider,
      providers: {
        cloudflare: { configured: await isCallProviderConfigured("cloudflare"), fields: cloudflare },
        webrtc_p2p: { configured: await isCallProviderConfigured("webrtc_p2p"), fields: webrtcP2p },
        twilio: { configured: await isCallProviderConfigured("twilio"), fields: twilio },
        agora: { configured: await isCallProviderConfigured("agora"), fields: agora },
      },
    });
  },
);

const setCallProviderSchema = z.object({ provider: callProviderParam });

settingsRoutes.put(
  "/admin/calls-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const parsed = setCallProviderSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    const before = await getActiveCallProvider();
    if (parsed.data.provider !== "mock" && !(await isCallProviderConfigured(parsed.data.provider as CallProviderIdentity))) {
      return c.json(
        { error: "not_configured", message: "Save that provider's credentials before switching to it" },
        409,
      );
    }

    await setActiveCallProvider(parsed.data.provider);
    if (before !== parsed.data.provider) {
      await logActivity({
        actor: user,
        action: "calls.provider.switch",
        entityType: "settings",
        summary: `Switched voice calls from ${before} to ${parsed.data.provider}`,
        before: { callsActiveProvider: before },
        after: { callsActiveProvider: parsed.data.provider },
        ip: clientIp(c),
      });
    }
    return c.json({ activeProvider: parsed.data.provider });
  },
);

const setJawgLightStyleSchema = z.object({ style: z.enum(["normal", "light"]) });

settingsRoutes.put(
  "/admin/maps/jawg-style",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const parsed = setJawgLightStyleSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    const before = await getJawgLightStyle();
    await setJawgLightStyle(parsed.data.style);
    if (before !== parsed.data.style) {
      await logActivity({
        actor: user,
        action: "maps.jawg_style.switch",
        entityType: "settings",
        summary: `Switched Jawg light-mode map style from ${before} to ${parsed.data.style}`,
        before: { mapsJawgLightStyle: before },
        after: { mapsJawgLightStyle: parsed.data.style },
        ip: clientIp(c),
      });
    }
    return c.json({ jawgLightStyle: parsed.data.style });
  },
);

settingsRoutes.put(
  "/admin/calls/credentials/:provider",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const providerParsed = configurableCallProvider.safeParse(c.req.param("provider"));
    if (!providerParsed.success) return c.json({ error: "invalid_provider" }, 400);
    const provider = providerParsed.data;

    const bodyParsed = saveCredentialsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!bodyParsed.success) return c.json({ error: "invalid_body", issues: bodyParsed.error.issues }, 400);

    const validKeys = new Set(CALL_PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
    const unknown = Object.keys(bodyParsed.data.fields).filter((k) => !validKeys.has(k));
    if (unknown.length > 0) return c.json({ error: "unknown_field", fields: unknown }, 400);

    const changed = await saveCallCredentials(provider, bodyParsed.data.fields);
    if (changed.length > 0) {
      await logActivity({
        actor: user,
        action: "calls.credentials.update",
        entityType: "call_credentials",
        entityId: provider,
        summary: `Updated ${provider} call credentials: ${changed.join(", ")}`,
        ip: clientIp(c),
      });
    }
    return c.json({ changed });
  },
);

settingsRoutes.delete(
  "/admin/calls/credentials/:provider/:field",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const providerParsed = configurableCallProvider.safeParse(c.req.param("provider"));
    if (!providerParsed.success) return c.json({ error: "invalid_provider" }, 400);
    const provider = providerParsed.data;

    const field = c.req.param("field") ?? "";
    const validKeys = new Set(CALL_PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
    if (!validKeys.has(field)) return c.json({ error: "unknown_field" }, 400);

    await clearCallCredential(provider, field);
    await logActivity({
      actor: user,
      action: "calls.credentials.clear",
      entityType: "call_credentials",
      entityId: provider,
      summary: `Cleared ${provider} call credential field: ${field}`,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Map provider — which backend location pickers/geocoding use, and
// per-provider credentials. Same shape and same permission gate as the
// voice-calls provider/credentials endpoints above, deliberately — see
// ../maps/credentials.ts.
// ---------------------------------------------------------------------------

const mapsProviderParam = z.enum(["streetmaps", "google", "mapbox", "maptiler", "stadia", "thunderforest", "jawg", "tomtom"]);
const configurableMapsProvider = z.enum(["google", "mapbox", "maptiler", "stadia", "thunderforest", "jawg", "tomtom"]);
const CONFIGURABLE_MAPS_PROVIDERS = configurableMapsProvider.options;

settingsRoutes.get(
  "/admin/maps-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const [activeProvider, jawgLightStyle, entries] = await Promise.all([
      getActiveMapsProvider(),
      getJawgLightStyle(),
      Promise.all(
        CONFIGURABLE_MAPS_PROVIDERS.map(async (provider) => [
          provider,
          { configured: await isMapsProviderConfigured(provider), fields: await mapsCredentialFieldStatus(provider) },
        ] as const),
      ),
    ]);
    return c.json({ activeProvider, jawgLightStyle, providers: Object.fromEntries(entries) });
  },
);

const setMapsProviderSchema = z.object({ provider: mapsProviderParam });

settingsRoutes.put(
  "/admin/maps-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const parsed = setMapsProviderSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    const before = await getActiveMapsProvider();
    if (parsed.data.provider !== "streetmaps" && !(await isMapsProviderConfigured(parsed.data.provider as MapsProviderIdentity))) {
      return c.json(
        { error: "not_configured", message: "Save that provider's API key before switching to it" },
        409,
      );
    }

    await setActiveMapsProvider(parsed.data.provider);
    if (before !== parsed.data.provider) {
      await logActivity({
        actor: user,
        action: "maps.provider.switch",
        entityType: "settings",
        summary: `Switched maps from ${before} to ${parsed.data.provider}`,
        before: { mapsActiveProvider: before },
        after: { mapsActiveProvider: parsed.data.provider },
        ip: clientIp(c),
      });
    }
    return c.json({ activeProvider: parsed.data.provider });
  },
);

settingsRoutes.put(
  "/admin/maps/credentials/:provider",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const providerParsed = configurableMapsProvider.safeParse(c.req.param("provider"));
    if (!providerParsed.success) return c.json({ error: "invalid_provider" }, 400);
    const provider = providerParsed.data;

    const bodyParsed = saveCredentialsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!bodyParsed.success) return c.json({ error: "invalid_body", issues: bodyParsed.error.issues }, 400);

    const validKeys = new Set(MAPS_PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
    const unknown = Object.keys(bodyParsed.data.fields).filter((k) => !validKeys.has(k));
    if (unknown.length > 0) return c.json({ error: "unknown_field", fields: unknown }, 400);

    const changed = await saveMapsCredentials(provider, bodyParsed.data.fields);
    if (changed.length > 0) {
      await logActivity({
        actor: user,
        action: "maps.credentials.update",
        entityType: "maps_credentials",
        entityId: provider,
        summary: `Updated ${provider} maps credentials: ${changed.join(", ")}`,
        ip: clientIp(c),
      });
    }
    return c.json({ changed });
  },
);

settingsRoutes.delete(
  "/admin/maps/credentials/:provider/:field",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const providerParsed = configurableMapsProvider.safeParse(c.req.param("provider"));
    if (!providerParsed.success) return c.json({ error: "invalid_provider" }, 400);
    const provider = providerParsed.data;

    const field = c.req.param("field") ?? "";
    const validKeys = new Set(MAPS_PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
    if (!validKeys.has(field)) return c.json({ error: "unknown_field" }, 400);

    await clearMapsCredentialField(provider, field);
    await logActivity({
      actor: user,
      action: "maps.credentials.clear",
      entityType: "maps_credentials",
      entityId: provider,
      summary: `Cleared ${provider} maps credential field: ${field}`,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Navigation mode — whether the rider app's "Start Navigation" sends riders
// out to Google Maps (default) or renders turn-by-turn-style navigation
// in-app using the active maps provider. Independent of which maps provider
// is active; both options work with any provider (in-app navigation just
// draws a route/position on whichever map is currently rendering).
// ---------------------------------------------------------------------------

const setNavModeSchema = z.object({ mode: z.enum(["external", "in_app"]) });

settingsRoutes.put(
  "/admin/nav-mode",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const parsed = setNavModeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    const before: NavMode = await getNavMode();
    if (before !== parsed.data.mode) {
      await setNavMode(parsed.data.mode);
      await logActivity({
        actor: user,
        action: "nav.mode.switch",
        entityType: "settings",
        summary: `Switched rider navigation from ${before} to ${parsed.data.mode}`,
        before: { navMode: before },
        after: { navMode: parsed.data.mode },
        ip: clientIp(c),
      });
    }
    return c.json({ navMode: parsed.data.mode });
  },
);

const patchMarketplaceSettingsSchema = patchSchema(z
  .object({
    enabled: z.boolean(),
    liveEnabled: z.boolean(),
    commissionPercent: z.number().min(0).max(100),
    proPricingMode: z.enum(["free", "paid"]),
    proStorePriceUgx: z.number().int().min(0).max(10_000_000),
    proLivePriceUgx: z.number().int().min(0).max(10_000_000),
    proTrialDays: z.number().int().min(0).max(365),
    adMinBudgetUgx: z.number().int().min(1000).max(100_000_000),
    adFeePercent: z.number().min(0).max(100),
    minOrderAmountUgx: z.number().int().min(0).max(10_000_000),
    liveMaxDurationMins: z.number().int().min(15).max(1440),
    deliveryBaseFeeUgx: z.number().int().min(0).max(1_000_000),
    cartExpiryHours: z.number().int().min(1).max(720),
    eliteEnabled: z.boolean(),
    elitePriceUgx: z.number().int().min(0).max(50_000_000),
    eliteCommissionPercent: z.number().min(0).max(100),
    proMaxProducts: z.number().int().min(1).max(100_000),
    eliteMaxProducts: z.number().int().min(10).max(500_000),
    proMaxCollections: z.number().int().min(1).max(1000),
    eliteMaxCollections: z.number().int().min(1).max(5000),
    proMaxDiscounts: z.number().int().min(0).max(1000),
    eliteMaxDiscounts: z.number().int().min(1).max(10_000),
    eliteB2bEnabled: z.boolean(),
    eliteMultiOutletInventoryEnabled: z.boolean(),
    eliteCustomDomainEnabled: z.boolean(),
    eliteLoyaltyEnabled: z.boolean(),
    eliteMaxLoyaltyCashbackPercent: z.number().min(0).max(50),
    elitePosEnabled: z.boolean(),
    eliteStockTransfersEnabled: z.boolean(),
    eliteCrmEnabled: z.boolean(),
    elitePurchaseOrdersEnabled: z.boolean(),
    eliteBundlesEnabled: z.boolean(),
    eliteWinbackEnabled: z.boolean(),
  }));

settingsRoutes.get(
  "/admin/marketplace-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.view"),
  async (c) => {
    const marketplace = await getMarketplaceSettings();
    return c.json({ marketplace });
  },
);

settingsRoutes.patch(
  "/admin/marketplace-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const user = c.get("user");
    const parsed = patchMarketplaceSettingsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

    const before = await getMarketplaceSettings();
    await setMarketplaceSettings(parsed.data);
    const after = await getMarketplaceSettings();

    await logActivity({
      actor: user,
      action: "settings.update",
      entityType: "settings",
      summary: "Updated Marketplace & Pro Live Commerce settings",
      before: { marketplace: before },
      after: { marketplace: after },
      ip: clientIp(c),
    });

    return c.json({ marketplace: after });
  },
);


// Store, digital-product, learning and services options: one registry (lib/option-registry.ts) drives these.
settingsRoutes.get(
  "/admin/option-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.view"),
  async (c) => {
    const module = c.req.query("module");
    const known = ["storefront", "portal", "plans", "digital", "lms", "services", "platform", "support"] as const;
    if (module && !(known as readonly string[]).includes(module)) return c.json({ error: "unknown_module" }, 400);
    return c.json({ settings: await describeOptions(module as (typeof known)[number] | undefined) });
  },
);

settingsRoutes.patch(
  "/admin/option-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as { values?: Record<string, unknown> } | null;
    if (!body?.values || typeof body.values !== "object" || Array.isArray(body.values)) return c.json({ error: "invalid_body" }, 400);
    const result = await setOptions(body.values, c.get("user"), clientIp(c));
    if (!result.ok) return c.json({ error: "invalid_settings", errors: result.errors }, 400);
    return c.json({ ok: true, changed: result.changed, settings: await describeOptions() });
  },
);
