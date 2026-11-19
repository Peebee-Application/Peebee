"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";

/** Protect dedicated commerce screens as well as the tiles that lead to them. */
export function StorePlanGate({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const { merchant } = useAuth();
  const feature = pathname.startsWith("/store/items") ? "catalog" : pathname.startsWith("/store/live") ? "live" : pathname.startsWith("/store/learning") ? "elite" : null;
  const requestKey = feature ? `${merchant?.id ?? ""}:${pathname}` : "";
  const [result, setResult] = useState<{ key: string; allowed: boolean; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!feature || !merchant) return;
    let active = true;
    api.getMerchantProStore().then(({ store }) => {
      if (active) setResult({ key: requestKey, allowed: feature === "elite" ? store?.plan?.isElite === true : store?.plan?.features?.[feature] === true });
    }).catch(error => { if (active) setResult({ key: requestKey, allowed: false, error: errorMessage(error) }); });
    return () => { active = false; };
  }, [feature, merchant?.id, requestKey, retry]);
  if (!feature) return <>{children}</>;
  if (result?.key !== requestKey) return <p role="status" className="p-5 text-lg">Checking your plan…</p>;
  if (result.error) return <section className="home-card m-4 space-y-3"><p role="alert">{result.error}</p><button onClick={() => setRetry(value => value + 1)} className="min-h-12 rounded-full border border-gold px-5 font-bold">Retry</button></section>;
  if (!result.allowed) return <section className="home-card m-4 space-y-3" data-testid="store-plan-required">
    <h1 className="text-2xl font-black">Choose a plan for this tool</h1>
    <p className="text-lg text-ink-500">Your current plan does not include this store tool.</p>
    <Link href="/store/plans" className="inline-flex min-h-12 items-center rounded-full bg-gold px-5 font-bold text-ink-gold">View plans</Link>
    <Link href="/store" className="ml-3 inline-flex min-h-12 items-center font-bold">Back</Link>
  </section>;
  return <>{children}</>;
}
