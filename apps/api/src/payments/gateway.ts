/**
 * The one contract every payment aggregator adapter implements (Yo!
 * Payments, Flutterwave, and each one's mock). Before this file existed,
 * ../service.ts dispatched provider calls with an inline `=== "yo" ? ... :
 * ...` ternary at each call site — fine for one real provider, not for two.
 * Everything downstream (orders/routes.ts, riders/routes.ts, wallet
 * routes) talks to ../service.ts only; adapters never leak upward.
 */

import type { MobileMoneyNetwork } from "@peebee/shared";

/** Raw card details for a direct card charge. Held in memory for the length
 * of one request only: never stored, logged, or put in an error message. */
export type CardDetails = { number: string; cvv: string; expiryMonth: string; expiryYear: string };

/** The extra proof a card charge can ask for after the first attempt. */
export type CardAuthorization =
  | { mode: "pin"; pin: string }
  | { mode: "avs"; address: string; city: string; state: string; country: string; zipcode: string };

/** What the customer must do next to finish a direct card charge. `redirect`
 * (3-D Secure) is the one step the bank hosts; `pin`, `avs` and `otp` are all
 * asked for inside Peebee. */
export type PaymentNextAction =
  | { type: "pin" }
  | { type: "avs" }
  | { type: "otp"; flowRef: string; message?: string }
  | { type: "redirect"; url: string };

export type GatewayStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "INDETERMINATE";

export type GatewayChargeInput = {
  referenceId: string;
  amount: number;
  currency: string;
  msisdn?: string;
  network?: MobileMoneyNetwork;
  email?: string;
  name?: string;
  narrative: string;
  /** Where a hosted-checkout provider (Flutterwave) should return the
   * customer after they pay. Ignored by a direct-push provider (Yo!),
   * which never leaves the app. */
  returnUrl?: string;
  /** Which kind of payment the customer picked. Absent = the old behaviour
   * (a hosted page offering both). */
  method?: "mobile_money" | "card";
  /** Direct card charge only — see CardDetails. */
  card?: CardDetails;
  cardAuthorization?: CardAuthorization;
};

export type GatewayResult = {
  status: GatewayStatus;
  transactionReference: string;
  /** Present only for hosted-checkout providers — the caller must send the
   * customer's browser here to actually complete payment. A direct-push
   * provider confirms without ever handing back a URL. */
  redirectUrl?: string;
  providerTransactionId?: string;
  statusMessage?: string;
  /** Provider-reported facts from a server-side verification request. These
   * are checked against Peebee's expected reference, amount and currency
   * before any ledger or booking is settled. */
  verification?: { reference?: string | null; amount?: number | null; currency?: string | null };
  /** A direct card charge that needs more from the customer before it can
   * settle. Absent for everything else. */
  nextAction?: PaymentNextAction;
};

export type PaymentProviderErrorCode =
  | "payment_provider_not_configured"
  | "payment_provider_auth_failed"
  | "payment_provider_account_not_ready"
  | "payment_provider_rejected"
  | "payment_provider_unavailable";

/** A provider failure whose customer-facing explanation is deliberately
 * separate from the upstream response. The upstream message is useful in
 * Worker logs, but only the reviewed `clientMessage` may cross the API
 * boundary — provider responses can contain implementation details. */
export class PaymentProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: PaymentProviderErrorCode,
    readonly clientMessage: string,
    readonly httpStatus?: number,
    readonly upstreamMessage?: string,
  ) {
    super(`${provider} request failed${httpStatus ? ` (${httpStatus})` : ""}`);
    this.name = "PaymentProviderError";
  }
}

export interface PaymentGatewayAdapter {
  key: string;
  displayName: string;
  /** True once this adapter's own API credentials are present (DB-stored,
   * admin-entered — see ./credentials.ts — or an env var fallback), checked
   * live every call, never cached, so an admin saving new keys takes effect
   * on the next request with no redeploy. */
  isConfigured(): Promise<boolean>;
  /** Whether this adapter can pay money OUT (rider payouts). Collection-only
   * providers (Flutterwave, for now) report false here rather than fail at
   * call time — see resolveProvider() in ./service.ts. */
  supportsDisbursement: boolean;
  /** Whether this adapter needs a resolved MTN/Airtel network before it can
   * charge — true for a direct-push provider (Yo!), false for a hosted
   * checkout (Flutterwave) that lets the customer pick their method on its
   * own page. */
  requiresNetwork: boolean;
  depositFunds(input: GatewayChargeInput): Promise<GatewayResult>;
  /** Completes a direct card charge that asked for a one-time code. */
  submitCardOtp?(input: { flowRef: string; otp: string; referenceId: string; createdAt: string }): Promise<GatewayResult>;
  withdrawFunds(input: GatewayChargeInput): Promise<GatewayResult>;
  /** `createdAt` (SQLite `datetime('now')` format) is only meaningful to a
   * mock adapter, which derives a fake PENDING→SUCCEEDED/FAILED progression
   * from elapsed time instead of asking a real API that tracks its own. A
   * real adapter ignores it. */
  checkStatus(
    transactionReference: string,
    createdAt: string,
    /** Which leg this reference belongs to, when the caller knows. MTN keeps collections and
     * disbursements in separate reference spaces, so it uses this to ask the right one first. */
    operationType?: "collection" | "disbursement" | "refund",
  ): Promise<GatewayResult>;
}
