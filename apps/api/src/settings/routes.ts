import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { hasPermission, requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { clientIp } from "../lib/ratelimit.js";
import {
  getActiveCallProvider,
  getActiveMapsProvider,
  getActiveProviders,
  getDeliverySettings,
  getTimeFeeSettings,
  getMatchingSettings,
  getMonetizationSettings,
  getNavMode,
  getSetting,
  getPaymentsDemoMode,
  getPlatformEnvironment,
  getRiderReserveSettings,
  getVoiceNoteMaxSeconds,
  getWalletSettings,
  setActiveCallProvider,
  setActiveMapsProvider,
  setActiveProviders,
  setMatchingModesEnabled,
  setMonetizationSettings,
  setNavMode,
  setPaymentsDemoMode,
  setPlatformEnvironment,
  setRiderReserveSettings,
  setSetting,
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
import { clearCredential, PROVIDER_CREDENTIAL_FIELDS, saveCredentials } from "../payments/credentials.js";
import { paymentsIntegrationStatus } from "../payments/service.js";

export const settingsRoutes = new Hono();

async function fullSettings() {
  const [delivery, matching, activeProviders, demoMode, wallet, voiceNoteMaxSeconds, monetization, platformEnvironment, practiceModeEnabled, riderReserve, callsActiveProvider, mapsActiveProvider, navMode, merchantPayments, merchantSandbox, merchantCustody, merchantFrozen] =
    await Promise.all([
      getDeliverySettings(),
      getMatchingSettings(),
      getActiveProviders(),
      getPaymentsDemoMode(),
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
  }

  return {
    timeFees: await getTimeFeeSettings(),
    ...delivery,
    ...matching,
    paymentsActiveProviders: activeProviders,
    paymentsDemoMode: demoMode,
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
    navMode,
    ...monetization,
  };
}

/** Any signed-in user: the customer app needs the current rate/range (to show
 * a live estimate) and which matching modes are on offer (to build the
 * preference picker). None of it is sensitive, but it isn't reachable while
 * signed out either — orderRoutes registers requireAuth as "*" on the shared
 * /v1 router, which covers everything mounted after it, this included. */
settingsRoutes.get("/settings", async (c) => {
  return c.json({ settings: await fullSettings() });
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
  shoppingDeliveryFee: z.number().int().nonnegative().max(1_000_000).optional(),
  rideRatePerKm: z.number().positive().max(1_000_000).optional(),
  rideMinimumFare: z.number().int().nonnegative().max(1_000_000).optional(),
  enabledModes: z.array(z.enum(["first_to_claim", "nearest_window", "customer_selects"])).optional(),
  nearestWindowSeconds: z.number().int().positive().max(3600).optional(),
  maxAssignmentMinutes: z.number().int().positive().max(120).optional(),
  paymentsActiveProviders: z.array(z.enum(["yo", "flutterwave", "mtn", "airtel"])).min(1).max(4).optional(),
  paymentsDemoMode: z.boolean().optional(),
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
  processingFeeEnabled: z.boolean().optional(),
  processingFeePercent: z.number().min(0).max(100).optional(),
  processingFeeMode: z.enum(["customer", "rider", "split"]).optional(),
  processingFeeSplitCustomerPercent: z.number().min(0).max(100).optional(),
  cashFeeSource: z.enum(["wallet", "deposit"]).optional(),
  subscriptionEnabled: z.boolean().optional(),
  subscriptionMode: z.enum(["recurring", "once"]).optional(),
  subscriptionAmount: z.number().min(0).max(1_000_000).optional(),
  subscriptionCadence: z.enum(["daily", "weekly", "monthly"]).optional(),
});

const PAYMENTS_FIELDS = [
  "timeFees",
  "paymentsActiveProviders",
  "paymentsDemoMode",
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
  "processingFeeEnabled",
  "processingFeePercent",
  "processingFeeMode",
  "processingFeeSplitCustomerPercent",
  "cashFeeSource",
  "subscriptionEnabled",
  "subscriptionMode",
  "subscriptionAmount",
  "subscriptionCadence",
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
    if (parsed.data.serviceRangeKm != null) {
      await setSetting("service_range_km", String(parsed.data.serviceRangeKm));
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
    if (parsed.data.paymentsActiveProviders != null) {
      await setActiveProviders(parsed.data.paymentsActiveProviders as PaymentProviderIdentity[]);
    }
    if (parsed.data.paymentsDemoMode != null) {
      await setPaymentsDemoMode(parsed.data.paymentsDemoMode);
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

const mapsProviderParam = z.enum(["streetmaps", "google", "mapbox", "maptiler", "stadia", "thunderforest", "jawg"]);
const configurableMapsProvider = z.enum(["google", "mapbox", "maptiler", "stadia", "thunderforest", "jawg"]);
const CONFIGURABLE_MAPS_PROVIDERS = configurableMapsProvider.options;

settingsRoutes.get(
  "/admin/maps-settings",
  requireAuth,
  requireRole("admin"),
  requirePermission("settings.manage"),
  async (c) => {
    const [activeProvider, entries] = await Promise.all([
      getActiveMapsProvider(),
      Promise.all(
        CONFIGURABLE_MAPS_PROVIDERS.map(async (provider) => [
          provider,
          { configured: await isMapsProviderConfigured(provider), fields: await mapsCredentialFieldStatus(provider) },
        ] as const),
      ),
    ]);
    return c.json({ activeProvider, providers: Object.fromEntries(entries) });
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
