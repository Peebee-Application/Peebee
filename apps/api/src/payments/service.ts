/**
 * Payment aggregator orchestration — the one seam every caller (order
 * funding, rider payouts, wallet top-ups) goes through. Which real
 * aggregator actually handles a given call is resolved from the
 * admin-configurable settings.payments_active_providers list (see
 * ../lib/settings.ts). Live mode fails closed when no configured provider
 * supports the requested capability; mocks are reachable only through demo
 * mode or an explicitly sandbox-scoped transaction.
 */

import { detectMobileMoneyNetwork, mobileMoneyNetworkLabel, type MobileMoneyNetwork } from "@peebee/shared";
import {
  getActiveProviders,
  getFlutterwaveDirectCard,
  getFlutterwaveDirectMobileMoney,
  getPaymentsDemoMode,
  getPlatformEnvironment,
  type PaymentProviderIdentity,
} from "../lib/settings.js";
import { getCredential } from "./credentials.js";
import { credentialFieldStatus, providerUsesTestCredentials } from "./credentials.js";
import {
  PaymentProviderError,
  type CardAuthorization,
  type CardDetails,
  type GatewayResult,
  type PaymentGatewayAdapter,
  type PaymentNextAction,
} from "./gateway.js";
import { flutterwaveAdapter } from "./flutterwave/wire.js";
import { mockFlutterwaveAdapter } from "./flutterwave/mock.js";
import { yoAdapter } from "./yo/wire.js";
import { mockYoAdapter } from "./yo/mock.js";
import { mtnAdapter } from "./mtn/wire.js";
import { mockMtnAdapter } from "./mtn/mock.js";
import { airtelAdapter } from "./airtel/wire.js";
import { mockAirtelAdapter } from "./airtel/mock.js";

/** Every provider identity this app knows how to talk to, real and mock.
 * The DB only ever stores one of these strings in payments.provider /
 * wallet_topups.provider / wallet_withdrawals.provider. */
export type PaymentsProvider =
  | "yo"
  | "yo_mock"
  | "flutterwave"
  | "flutterwave_mock"
  | "mtn"
  | "mtn_mock"
  | "airtel"
  | "airtel_mock";

const ADAPTERS: Record<PaymentsProvider, PaymentGatewayAdapter> = {
  yo: yoAdapter,
  yo_mock: mockYoAdapter,
  flutterwave: flutterwaveAdapter,
  flutterwave_mock: mockFlutterwaveAdapter,
  mtn: mtnAdapter,
  mtn_mock: mockMtnAdapter,
  airtel: airtelAdapter,
  airtel_mock: mockAirtelAdapter,
};

function mockOf(identity: PaymentProviderIdentity): PaymentsProvider {
  return `${identity}_mock`;
}

/**
 * Walks the admin's priority-ordered provider list and returns the first
 * one that's both configured (real credentials present) and able to do
 * what's being asked (a collection-only provider is skipped for a
 * disbursement). Falls back to the first list entry's mock — never to an
 * unconfigured real adapter — so a misconfigured "flutterwave" selection
 * degrades to a working simulation instead of failing every payment.
 *
 * Demo mode (settings.payments_demo_mode) short-circuits all of that: every
 * payment runs through the mock adapters regardless of what credentials are
 * saved, so an admin can test/demo the app — or pull it back from a shaky
 * live aggregator — without touching the credentials themselves.
 *
 * `forceMock` does the same short-circuit for a single call, independent of
 * the demo-mode setting — this is what a sandbox-environment order/top-up
 * passes (see ../lib/settings.ts's platform_environment and every call site
 * that threads an order's/topup's own environment through here) so sandbox
 * activity can *never* reach a real payment rail, even if an admin flips
 * demo mode off and live credentials are sitting there configured.
 */
export async function resolveProvider(
  capability: "collection" | "disbursement",
  options?: { forceMock?: boolean; network?: MobileMoneyNetwork | null; directPushOnly?: boolean; cardCapable?: boolean },
): Promise<PaymentsProvider> {
  const active = await getActiveProviders();
  // directPushOnly: carriers and Yo! push a prompt to the customer's phone; Flutterwave is a hosted checkout that can take cards.
  const candidates = active
    .filter((identity) => !(options?.directPushOnly && identity === "flutterwave"))
    // Only Flutterwave takes cards; a card payment never routes to a mobile-money-only provider.
    .filter((identity) => !options?.cardCapable || identity === "flutterwave")
    .filter((identity) =>
      !options?.network ||
      options.cardCapable ||
      ((identity !== "mtn" || options.network === "mtn_momo") &&
        (identity !== "airtel" || options.network === "airtel_money")));
  const demoMode = (await getPaymentsDemoMode()) || !!options?.forceMock;
  if (demoMode) {
    const simulatedIdentity =
      candidates.find((identity) => capability !== "disbursement" || ADAPTERS[identity].supportsDisbursement);
    if (simulatedIdentity) return mockOf(simulatedIdentity);
  }

  for (const identity of demoMode ? [] : candidates) {
    const adapter = ADAPTERS[identity];
    if (!(await adapter.isConfigured())) continue;
    if (capability === "disbursement" && !adapter.supportsDisbursement) continue;
    return identity;
  }

  throw new PaymentProviderError(
    active[0] ?? "payments",
    "payment_provider_not_configured",
    capability === "disbursement"
      ? "No live payout provider is configured for this destination. Your balance has not been changed."
      : "No live collection provider is configured. Ask an admin to activate a provider with valid credentials.",
  );
}

export async function paymentsIntegrationStatus() {
  const active = await getActiveProviders();
  const demoMode = await getPaymentsDemoMode();
  async function capabilityStatus(capability: "collection" | "disbursement") {
    try {
      const provider = await resolveProvider(capability);
      return { provider, live: !provider.endsWith("_mock"), error: null };
    } catch (error) {
      return {
        provider: null,
        live: false,
        error: error instanceof PaymentProviderError ? error.clientMessage : "Payment capability unavailable",
      };
    }
  }
  const [collection, disbursement] = await Promise.all([
    capabilityStatus("collection"),
    capabilityStatus("disbursement"),
  ]);
  const providers = await Promise.all(
    (["yo", "flutterwave", "mtn", "airtel"] as PaymentProviderIdentity[]).map(async (identity) => ({
      key: identity,
      displayName: ADAPTERS[identity].displayName,
      configured: await ADAPTERS[identity].isConfigured(),
      supportsDisbursement: ADAPTERS[identity].supportsDisbursement,
      active: active.includes(identity),
      priority: active.indexOf(identity),
      testMode: (await ADAPTERS[identity].isConfigured()) && (await providerUsesTestCredentials(identity)),
      credentialFields: await credentialFieldStatus(identity),
    })),
  );
  return {
    activeProviders: active,
    demoMode,
    providers,
    collection,
    disbursement,
    networks: ["mtn_momo", "airtel_money"],
  };
}

export class UnsupportedNetworkError extends Error {}

/** Converts a reviewed provider error into the stable API shape consumed by
 * every customer/rider payment surface. Raw upstream messages stay in the
 * Worker logs and never cross this boundary. */
export function paymentProviderErrorResponse(
  err: unknown,
  fallbackMessage: string,
): { error: string; message: string } {
  if (err instanceof PaymentProviderError) return { error: err.code, message: err.clientMessage };
  return { error: "payment_request_failed", message: fallbackMessage };
}

/** Credential, account-activation, and request-validation failures are
 * actionable configuration errors, not transient server failures. Returning
 * 422 lets every deployed client (including older cached PWAs) display the
 * reviewed message. Only connectivity/provider outages remain a 502. */
export function paymentProviderHttpStatus(err: unknown): 422 | 502 {
  if (err instanceof PaymentProviderError && err.code !== "payment_provider_unavailable") return 422;
  return 502;
}

function resolveNetwork(msisdn: string): MobileMoneyNetwork {
  const network = detectMobileMoneyNetwork(msisdn);
  if (!network) {
    throw new UnsupportedNetworkError(`${msisdn} isn't a recognized MTN or Airtel Uganda number`);
  }
  return network;
}

type InitiateInput = {
  referenceId: string;
  msisdn?: string;
  amount: number;
  currency?: string;
  email?: string;
  name?: string;
  narrative?: string;
  /** Where a hosted-checkout provider should return the customer once
   * they've paid — required if Flutterwave might end up handling this. */
  returnUrl?: string;
  /** Set true for anything happening under the sandbox platform
   * environment — forces resolveProvider() to mock regardless of demo
   * mode or configured credentials. See resolveProvider's doc comment. */
  forceMock?: boolean;
  /** Only providers that push a mobile-money prompt to the phone; never a hosted checkout that could take a card. */
  directPushOnly?: boolean;
  /** What the customer picked. "card" is only honoured by Flutterwave. */
  method?: "mobile_money" | "card";
  card?: CardDetails;
  cardAuthorization?: CardAuthorization;
};

type InitiateResult = {
  provider: PaymentsProvider;
  providerRef: string;
  network: MobileMoneyNetwork | null;
  /** Set only when the resolved provider is a hosted-checkout style one —
   * the caller must send the customer's browser here before this payment
   * can complete. Absent for a direct-push provider (Yo!). */
  redirectUrl?: string;
  /** A direct card charge that needs a PIN, address or one-time code before it settles. */
  nextAction?: PaymentNextAction;
};

async function initiate(
  capability: "collection" | "disbursement",
  input: InitiateInput,
  defaultNarrative: string,
): Promise<InitiateResult> {
  const provider = await resolveProvider(capability, { forceMock: input.forceMock, directPushOnly: input.directPushOnly, cardCapable: input.method === "card", network: input.msisdn ? detectMobileMoneyNetwork(input.msisdn) : null });
  const adapter = ADAPTERS[provider];

  let network: MobileMoneyNetwork | null = null;
  if (adapter.requiresNetwork) {
    network = resolveNetwork(input.msisdn ?? "");
  } else if (input.msisdn) {
    network = detectMobileMoneyNetwork(input.msisdn);
  }

  const fn = capability === "collection" ? adapter.depositFunds : adapter.withdrawFunds;
  const result: GatewayResult = await fn({
    referenceId: input.referenceId,
    amount: input.amount,
    currency: input.currency ?? "UGX",
    msisdn: input.msisdn,
    network: network ?? undefined,
    email: input.email,
    name: input.name,
    narrative: input.narrative ?? defaultNarrative,
    returnUrl: input.returnUrl,
    method: input.method,
    card: input.card,
    cardAuthorization: input.cardAuthorization,
  });

  return { provider, providerRef: result.transactionReference, network, redirectUrl: result.redirectUrl, nextAction: result.nextAction };
}

/** Collections: pulls funds from the customer into escrow (or a wallet top-up). */
export async function initiateCollection(input: InitiateInput): Promise<InitiateResult> {
  return initiate("collection", input, "Peebee order escrow funding");
}

/** Disbursements: pays a rider out of escrow (or their wallet) at withdrawal time. */
export async function initiateDisbursement(input: InitiateInput): Promise<InitiateResult> {
  return initiate("disbursement", input, "Peebee rider payout");
}

export type DbPaymentStatus = "pending" | "unknown" | "successful" | "failed";

function toDbStatus(status: GatewayResult["status"]): DbPaymentStatus {
  if (status === "SUCCEEDED") return "successful";
  if (status === "FAILED") return "failed";
  if (status === "INDETERMINATE") return "unknown";
  return "pending";
}

export async function checkPaymentStatus(payment: {
  provider: string;
  provider_ref: string | null;
  created_at: string;
  type?: "collection" | "disbursement" | "refund";
}): Promise<DbPaymentStatus> {
  if (!payment.provider_ref) return "pending";
  const adapter = ADAPTERS[payment.provider as PaymentsProvider];
  if (!adapter) return "pending";
  const result = await adapter.checkStatus(payment.provider_ref, payment.created_at, payment.type);
  return toDbStatus(result.status);
}

export { mobileMoneyNetworkLabel };

export function getPaymentAdapter(provider: string): PaymentGatewayAdapter | undefined {
  return ADAPTERS[provider as PaymentsProvider];
}

/**
 * What a payment screen may offer, read live so an admin's toggle takes
 * effect on the next screen load. `directCard` true means the app shows its
 * own card form; false means card payments go to Flutterwave's hosted page.
 */
export async function paymentMethodOptions() {
  const [active, demoMode, environment, directMobileMoneySetting, directCardSetting, hasKey] = await Promise.all([
    getActiveProviders(),
    getPaymentsDemoMode(),
    getPlatformEnvironment(),
    getFlutterwaveDirectMobileMoney(),
    getFlutterwaveDirectCard(),
    getCredential("flutterwave", "encryptionKey").then((key) => key?.length === 24),
  ]);
  const flutterwave = active.includes("flutterwave");
  const simulated = demoMode || environment === "sandbox";
  return {
    // Cards are only taken through Flutterwave.
    card: {
      available: flutterwave,
      direct: flutterwave && directCardSetting && (hasKey || simulated),
    },
    mobileMoney: { direct: flutterwave && directMobileMoneySetting },
  };
}
