import { createPracticeFetch } from "@peebee/shared";
import { api, getStoredToken } from "./api";

/** Plan checkout and add-item wizard calls. Unlike merchantRequest these keep the server's error code, which the flows branch on. */
export type Tier = "merchant" | "pro_live" | "elite";
export type Cycle = "monthly" | "yearly";
export type Method = "wallet" | "mobile_money" | "card" | "free";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; message: string; data: Record<string, unknown> };

function headers(json = true) {
  const h = new Headers();
  if (json) h.set("Content-Type", "application/json");
  const token = getStoredToken();
  if (token) h.set("Authorization", `Bearer ${token}`);
  const selected = typeof window === "undefined" ? null : localStorage.getItem("peebee_merchant_selected");
  if (selected) h.set("X-Merchant-Id", selected);
  return h;
}

export async function call<T>(path: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await createPracticeFetch("merchant")(`${api.baseUrl}/v1${path}`, {
      method, headers: headers(), cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, status: res.status, error: String(data.error ?? "request_failed"), message: String(data.message ?? data.error ?? "Something went wrong. Try again."), data };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "network", message: "No connection. Check your internet and try again.", data: {} };
  }
}

export type PlanCard = { tier: Tier; label: string; monthly: number; yearly: number; listMonthly: number; maxProducts: number | null; commissionPercent: number };
export type Checkout = {
  id: string; reference: string; kind: "upgrade" | "renew" | "downgrade"; fromPlan: string; tier: Tier; billingCycle: Cycle;
  listPrice: number; credit: number; amount: number; method: Method; status: string; startsAt: string | null; expiresAt: string | null;
  failure: string | null; verifyMethod: "sms" | "pin" | "session"; codeSentTo: string | null; verifiedAt: string | null; createdAt: string;
};
export type Methods = { wallet: boolean; mobileMoney: boolean; card: boolean };
export type PlansResponse = {
  current: { plan: string; visiblePlan?: string; isElite: boolean; expiresAt: string | null; daysLeft: number | null; legacy: boolean };
  pricingMode: "free" | "paid";
  eliteEnabled: boolean;
  downgradesEnabled: boolean;
  plans: PlanCard[];
  scheduled: Checkout | null;
  paying: Checkout | null;
  phone: string | null;
  verify: { channel: "sms" | "pin"; pinSet: boolean };
  methods: Methods;
};
export type Quote = {
  kind: "upgrade" | "renew" | "downgrade"; fromPlan: string; tier: Tier; billingCycle: Cycle; listPrice: number; credit: number;
  creditDays: number; amount: number; laterAmount: number; startsAt: string; expiresAt: string | null; free: boolean;
};
export type QuoteResponse = { quote: Quote; wallet: { balance: number }; methods: Methods; phone: string | null; verify: { channel: "sms" | "pin" | "session"; pinSet: boolean } };
export type PaymentStart = { network: string | null; redirectUrl: string | null; nextAction: string | null; topupId: string };

export const plansApi = {
  plans: () => call<PlansResponse>("/merchants/me/store/plans"),
  quote: (tier: Tier, billingCycle: Cycle) => call<QuoteResponse>("/merchants/me/store/plan-quote", "POST", { tier, billingCycle }),
  start: (input: { tier: Tier; billingCycle: Cycle; method: Method; msisdn?: string }) => call<{ checkout: Checkout; devCode?: string }>("/merchants/me/store/plan-checkouts", "POST", input),
  resend: (id: string) => call<{ checkout: Checkout; devCode?: string }>(`/merchants/me/store/plan-checkouts/${id}/resend`, "POST", {}),
  verify: (id: string, code: string) => call<{ checkout: Checkout; payment?: PaymentStart; message?: string }>(`/merchants/me/store/plan-checkouts/${id}/verify`, "POST", { code }),
  get: (id: string) => call<{ checkout: Checkout; message?: string }>(`/merchants/me/store/plan-checkouts/${id}`),
  cancel: (id: string) => call<{ checkout: Checkout }>(`/merchants/me/store/plan-checkouts/${id}/cancel`, "POST", {}),
  receipts: () => call<{ checkouts: Checkout[] }>("/merchants/me/store/plan-checkouts"),
  setPin: (input: { pin: string; currentPin?: string; password?: string }) => call<{ ok: boolean }>("/merchants/me/store/plan-pin", "POST", input),
};

export type MediaUpload = { key: string; kind: "image" | "video"; path: string; url: string };

/** Uploads one photo or video from the camera or gallery. */
export async function uploadStoreMedia(file: File): Promise<ApiResult<MediaUpload>> {
  const form = new FormData();
  form.set("file", file);
  try {
    const res = await createPracticeFetch("merchant")(`${api.baseUrl}/v1/merchants/me/store/media`, { method: "POST", headers: headers(false), body: form });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: String(data.error ?? "upload_failed"), message: String(data.message ?? "Upload failed. Try again."), data };
    return { ok: true, status: res.status, data: data as MediaUpload };
  } catch {
    return { ok: false, status: 0, error: "network", message: "No connection. Check your internet and try again.", data: {} };
  }
}

export const ugx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
export const PLAN_NAME: Record<string, string> = { merchant: "Merchant", pro_store: "Pro", pro_live: "Pro", elite: "Elite", legacy: "Current" };
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
