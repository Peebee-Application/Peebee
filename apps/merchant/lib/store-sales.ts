"use client";

import { useEffect, useState } from "react";
import { merchantRequest, errorMessage } from "./api";
import { useAuth } from "./auth-context";

export type SalesTier = "pro" | "elite";
export type ComparisonRow = { key: string; label: string; pro: boolean | string; elite: boolean | string; note?: string };
export type StoreSales = {
  merchantId: string; current: string; canUpgrade: boolean; setupRequired: boolean; free: boolean; liveEnabled: boolean;
  carousel: { autoplay: boolean; seconds: number };
  plans: Record<SalesTier, { enabled: boolean; monthly: number; yearly: number; catalog: boolean; live: boolean }>;
  groups: Array<{ title: string; rows: ComparisonRow[] }>;
};
export function useStoreSales() {
  const { merchant } = useAuth();
  const [result, setResult] = useState<{ merchantId: string; data?: StoreSales; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!merchant) return;
    let active = true;
    merchantRequest<StoreSales>("/merchants/me/store/plan-comparison").then(data => {
      if (active) setResult({ merchantId: merchant.id, data });
    }).catch(cause => { if (active) setResult({ merchantId: merchant.id, error: errorMessage(cause) }); });
    return () => { active = false; };
  }, [merchant?.id, attempt]);
  const current = result?.merchantId === merchant?.id ? result : null;
  return { data: current?.data, error: current?.error, retry: () => setAttempt(value => value + 1) };
}
export const salesPrice = (amount: number) => amount === 0 ? "Free now" : `UGX ${Math.round(amount).toLocaleString("en-US")} / month`;
export const upgradeHref = (data: StoreSales, tier: SalesTier) => data.setupRequired
  ? `/store/setup?tier=${tier === "pro" ? "pro_live" : "elite"}`
  : `/store/plans/checkout?tier=${tier === "pro" ? "pro_live" : "elite"}&cycle=monthly`;
