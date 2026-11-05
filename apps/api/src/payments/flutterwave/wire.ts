/**
 * Flutterwave API client. Two ways to take each kind of payment, and the
 * admin picks per kind (Admin → Settings → Payments):
 *
 * - **Standard Checkout** (hosted): a Flutterwave-hosted page. A card number
 *   never touches Peebee's server, which keeps this out of PCI-DSS
 *   card-data scope (SAQ-A). Always available; it is the fallback.
 * - **Direct Charge**: Peebee's own UI, Flutterwave behind it.
 *   - Mobile money (on by default): the approval prompt goes straight to the
 *     customer's phone. No card data, no PCI burden.
 *   - Cards (off by default): the customer types the card into Peebee's own
 *     form and it is sent encrypted to Flutterwave. Card data passes through
 *     this server, so turn it on only once PCI DSS accreditation is
 *     verified. When off, cards use the hosted page.
 *
 * Only used when PAYMENTS provider selection (see ../service.ts) resolves
 * to "flutterwave" and a secret key resolves (admin-entered via
 * ../credentials.ts, or the FLUTTERWAVE_SECRET_KEY env var as a fallback) —
 * otherwise ./mock.ts stands in, with the same request/response contract.
 *
 * API reference: https://developer.flutterwave.com/docs (v3)
 */

import { detectMobileMoneyNetwork, normalizeUgandaMsisdn } from "@peebee/shared";
import { getFlutterwaveDirectCard, getFlutterwaveDirectMobileMoney } from "../../lib/settings.js";
import { getCredential, isProviderConfigured } from "../credentials.js";
import { appBaseUrl } from "../../verify/service.js";
import { tripleDesEcbEncrypt } from "./des.js";
import {
  PaymentProviderError,
  type GatewayChargeInput,
  type GatewayResult,
  type PaymentGatewayAdapter,
  type PaymentProviderErrorCode,
} from "../gateway.js";

const API_BASE = "https://api.flutterwave.com/v3";

async function secretKey(): Promise<string> {
  const key = await getCredential("flutterwave", "secretKey");
  if (!key) throw new Error("Flutterwave secret key is not set");
  return key;
}

export function isFlutterwaveConfigured(): Promise<boolean> {
  return isProviderConfigured("flutterwave");
}

/** A phone-first signup may have no email on file, but Standard Checkout
 * requires one — Flutterwave never actually sends mail to it, the field is
 * just an account identifier on their side. */
function customerEmail(input: GatewayChargeInput): string {
  return input.email?.trim() || `${input.referenceId}@customers.peebee.online`;
}

type CreatePaymentResponse = {
  status: string;
  message?: string;
  data?: { link?: string };
};

function providerFailure(status: number, rawMessage: string | undefined): PaymentProviderError {
  const upstreamMessage = (rawMessage ?? "Unknown Flutterwave error").replace(/\s+/g, " ").trim().slice(0, 300);
  const normalized = upstreamMessage.toLowerCase();
  let code: PaymentProviderErrorCode;
  let clientMessage: string;

  if (status === 401 || /unauthor|authentication|secret key|api key|invalid key/.test(normalized)) {
    code = "payment_provider_auth_failed";
    clientMessage = "Flutterwave rejected the saved secret key. Ask an admin to re-enter the correct Flutterwave Secret key.";
  } else if (status === 403 || /not (enabled|activated|approved)|activate|approval|permission|live payment/.test(normalized)) {
    code = "payment_provider_account_not_ready";
    clientMessage =
      "Flutterwave has not enabled this account for live payments. Check account activation and Uganda payment methods in Flutterwave.";
  } else if (status >= 500) {
    code = "payment_provider_unavailable";
    clientMessage = "Flutterwave is temporarily unavailable. Please try again in a moment.";
  } else {
    code = "payment_provider_rejected";
    clientMessage = "Flutterwave rejected this payment request. Check the Flutterwave payment settings and try again.";
  }

  return new PaymentProviderError("flutterwave", code, clientMessage, status, upstreamMessage);
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await secretKey()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (err) {
    console.error("Flutterwave network request failed", { path, error: err instanceof Error ? err.message : String(err) });
    throw new PaymentProviderError(
      "flutterwave",
      "payment_provider_unavailable",
      "Flutterwave is temporarily unavailable. Please try again in a moment.",
    );
  }
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    const failure = providerFailure(res.status, body.message);
    console.error("Flutterwave API request rejected", {
      path,
      status: res.status,
      upstreamMessage: failure.upstreamMessage,
      code: failure.code,
    });
    throw failure;
  }
  return body;
}

/** Creates a hosted payment link — the customer picks (or is limited to) a
 * method on Flutterwave's own page. `options` narrows what that page offers. */
async function createPaymentLink(input: GatewayChargeInput, options: string): Promise<GatewayResult> {
  const body = await call<CreatePaymentResponse>("/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: input.referenceId,
      amount: input.amount,
      currency: input.currency,
      redirect_url: input.returnUrl,
      customer: {
        email: customerEmail(input),
        // Flutterwave Standard names this field `phonenumber` (Direct
        // Charge uses `phone_number`; the two APIs are easy to conflate).
        phonenumber: input.msisdn,
        name: input.name,
      },
      // All Flutterwave lets us style on its hosted page: name, logo and a line under it.
      customizations: {
        title: "Peebee",
        description: input.narrative,
        logo: `${appBaseUrl("customer")}/icons/icon-512.png`,
      },
      payment_options: options,
      meta: { narrative: input.narrative },
    }),
  });
  if (body.status !== "success" || !body.data?.link) {
    throw new Error(`Flutterwave did not return a payment link: ${body.message ?? "unknown error"}`);
  }
  return { status: "PENDING", transactionReference: input.referenceId, redirectUrl: body.data.link };
}

type ChargeResponse = {
  status: string;
  message?: string;
  data?: { id?: number; flw_ref?: string; status?: string; processor_response?: string };
  meta?: { authorization?: { mode?: string; redirect?: string; endpoint?: string; validate_instructions?: string } };
};

/** Direct mobile money: Flutterwave pushes the approval prompt to the
 * customer's phone and the charge settles when they approve. The result is
 * PENDING until the webhook or a status check says otherwise. If Flutterwave
 * instead asks the customer to complete a step on a page of its own (an
 * authorization mode of "redirect"), that link is passed on so the app sends
 * them there; without it no prompt would ever reach the phone. */
async function chargeMobileMoney(input: GatewayChargeInput, network: "MTN" | "AIRTEL", phone: string): Promise<GatewayResult> {
  const body = await call<ChargeResponse>("/charges?type=mobile_money_uganda", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: input.referenceId,
      amount: input.amount,
      currency: input.currency,
      network,
      phone_number: phone,
      email: customerEmail(input),
      fullname: input.name,
      meta: { narrative: input.narrative },
    }),
  });
  const auth = body.meta?.authorization;
  // What Flutterwave answered, so a charge that never reaches a phone can be diagnosed from the logs. No phone numbers.
  console.log("Flutterwave mobile money charge", {
    txRef: input.referenceId,
    network,
    apiStatus: body.status,
    message: (body.message ?? "").slice(0, 200),
    chargeStatus: body.data?.status ?? null,
    processorResponse: (body.data?.processor_response ?? "").slice(0, 200),
    authorizationMode: auth?.mode ?? null,
    hasRedirect: !!auth?.redirect,
  });
  if (body.status !== "success") {
    throw new Error(`Flutterwave did not accept the mobile money charge: ${body.message ?? "unknown error"}`);
  }
  const nextAction = auth?.mode === "redirect" && auth.redirect ? ({ type: "redirect", url: auth.redirect } as const) : undefined;
  return {
    status: "PENDING",
    transactionReference: input.referenceId,
    providerTransactionId: body.data?.id != null ? String(body.data.id) : undefined,
    nextAction,
    redirectUrl: nextAction?.url,
  };
}

/** Flutterwave v3 wants the card payload as Triple-DES (ECB, PKCS#7) under
 * the dashboard's encryption key, base64 encoded. */
export function encryptCardPayload(payload: unknown, encryptionKey: string): string {
  const key = new TextEncoder().encode(encryptionKey);
  if (key.length !== 24) throw new Error("Flutterwave encryption key must be 24 characters");
  const encrypted = tripleDesEcbEncrypt(new TextEncoder().encode(JSON.stringify(payload)), key);
  let binary = "";
  for (const byte of encrypted) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function cardNextAction(body: ChargeResponse): GatewayResult["nextAction"] {
  const auth = body.meta?.authorization;
  switch (auth?.mode) {
    case "pin":
      return { type: "pin" };
    case "avs_noauth":
      return { type: "avs" };
    case "redirect":
      return auth.redirect ? { type: "redirect", url: auth.redirect } : undefined;
    case "otp":
      return body.data?.flw_ref
        ? { type: "otp", flowRef: body.data.flw_ref, message: auth.validate_instructions }
        : undefined;
    default:
      return undefined;
  }
}

function cardResult(body: ChargeResponse, referenceId: string): GatewayResult {
  const nextAction = cardNextAction(body);
  return {
    // A charge that answered "successful" outright (no further step) is
    // still re-read from the verify endpoint by reconciliation before any
    // money is credited — see ../reconciliation.ts.
    status: nextAction ? "PENDING" : mapStatus(body.data?.status),
    transactionReference: referenceId,
    providerTransactionId: body.data?.id != null ? String(body.data.id) : undefined,
    nextAction,
    redirectUrl: nextAction?.type === "redirect" ? nextAction.url : undefined,
  };
}

/** True when Peebee's own card form may be used: the admin switch is on AND
 * the encryption key is saved. Either one missing means cards go to the
 * hosted page instead. */
export async function isDirectCardReady(): Promise<boolean> {
  if (!(await getFlutterwaveDirectCard())) return false;
  // A key of the wrong length (e.g. set through the env var) would fail every charge, so it is as good as missing.
  return (await getCredential("flutterwave", "encryptionKey"))?.length === 24;
}

/** Direct card charge. Card data is encrypted before it leaves this process
 * and is never logged, stored, or echoed in an error. */
async function chargeCard(input: GatewayChargeInput): Promise<GatewayResult> {
  const card = input.card;
  if (!card) throw new Error("Card details are required for a direct card charge");
  const encryptionKey = await getCredential("flutterwave", "encryptionKey");
  if (!encryptionKey) throw new Error("Flutterwave encryption key is not set");
  const auth = input.cardAuthorization;
  const payload: Record<string, unknown> = {
    card_number: card.number.replace(/\s+/g, ""),
    cvv: card.cvv,
    expiry_month: card.expiryMonth.padStart(2, "0"),
    expiry_year: card.expiryYear.slice(-2),
    currency: input.currency,
    amount: input.amount,
    email: customerEmail(input),
    fullname: input.name,
    tx_ref: input.referenceId,
    redirect_url: input.returnUrl,
    ...(auth?.mode === "pin" ? { authorization: { mode: "pin", pin: auth.pin } } : {}),
    ...(auth?.mode === "avs"
      ? { authorization: { mode: "avs_noauth", address: auth.address, city: auth.city, state: auth.state, country: auth.country, zipcode: auth.zipcode } }
      : {}),
  };
  const body = await call<ChargeResponse>("/charges?type=card", {
    method: "POST",
    body: JSON.stringify({ client: encryptCardPayload(payload, encryptionKey) }),
  });
  if (body.status !== "success") {
    throw new Error(`Flutterwave did not accept the card charge: ${body.message ?? "unknown error"}`);
  }
  return cardResult(body, input.referenceId);
}

async function submitCardOtp(input: { flowRef: string; otp: string; referenceId: string }): Promise<GatewayResult> {
  const body = await call<ChargeResponse>("/validate-charge", {
    method: "POST",
    body: JSON.stringify({ otp: input.otp, flw_ref: input.flowRef, type: "card" }),
  });
  if (body.status !== "success") {
    throw new Error(`Flutterwave did not accept the one-time code: ${body.message ?? "unknown error"}`);
  }
  return cardResult(body, input.referenceId);
}

/** Routes a collection to the right Flutterwave flow for what the customer
 * picked and what the admin has switched on. Anything direct falls back to
 * the hosted page rather than failing, so a missing detail never strands a
 * payment. */
async function depositFunds(input: GatewayChargeInput): Promise<GatewayResult> {
  if (input.method === "card") {
    if (input.card && (await isDirectCardReady())) return chargeCard(input);
    return createPaymentLink(input, "card");
  }
  const phone = input.msisdn ? normalizeUgandaMsisdn(input.msisdn) : null;
  const detected = input.network ?? (input.msisdn ? detectMobileMoneyNetwork(input.msisdn) : null);
  if (phone && detected && (await getFlutterwaveDirectMobileMoney())) {
    return chargeMobileMoney(input, detected === "mtn_momo" ? "MTN" : "AIRTEL", phone);
  }
  return createPaymentLink(input, input.method === "mobile_money" ? "mobilemoneyuganda" : "card, mobilemoneyuganda");
}

type VerifyResponse = {
  status: string;
  data?: { status?: string; amount?: number; currency?: string; id?: number };
};

function mapStatus(raw: string | undefined): GatewayResult["status"] {
  switch ((raw ?? "").toLowerCase()) {
    case "successful":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    default:
      return "PENDING";
  }
}

export async function checkStatus(transactionReference: string): Promise<GatewayResult> {
  const body = await call<VerifyResponse>(
    `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(transactionReference)}`,
    { method: "GET" },
  );
  return {
    status: body.status === "success" ? mapStatus(body.data?.status) : "PENDING",
    transactionReference,
    providerTransactionId: body.data?.id != null ? String(body.data.id) : undefined,
  };
}

/** Flutterwave signs webhooks with a plain shared secret in the `verif-hash`
 * header (not an HMAC of the body) — this is their documented scheme, not
 * a shortcut taken here. Constant-time comparison, same pattern as the Yo!
 * callback's own token check in ../routes.ts. */
export async function verifyWebhookSignature(providedHeader: string | null | undefined): Promise<boolean> {
  const expected = await getCredential("flutterwave", "webhookSecret");
  if (!expected) return false;
  const provided = providedHeader ?? "";
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const flutterwaveAdapter: PaymentGatewayAdapter = {
  key: "flutterwave",
  displayName: "Flutterwave",
  isConfigured: isFlutterwaveConfigured,
  // Payouts use a different Flutterwave API (Transfers) with per-network
  // bank codes this adapter doesn't implement yet — rider withdrawals stay
  // on Yo! regardless of which provider is active for collections. See
  // ../service.ts resolveProvider().
  supportsDisbursement: false,
  // The hosted page lets the customer pick MTN/Airtel/card, and the direct
  // mobile money path works the network out from the number itself (falling
  // back to the hosted page when it can't) — so Peebee never has to resolve
  // a network first.
  requiresNetwork: false,
  depositFunds,
  async submitCardOtp({ flowRef, otp, referenceId }) {
    return submitCardOtp({ flowRef, otp, referenceId });
  },
  async withdrawFunds(): Promise<GatewayResult> {
    throw new Error("Flutterwave disbursement is not implemented — resolveProvider() should never route here");
  },
  checkStatus,
};
