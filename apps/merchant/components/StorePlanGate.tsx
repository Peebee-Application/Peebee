"use client";

import Link from "next/link";
import { useMerchantPlan } from "../lib/merchant-plan-context";

/** Protect dedicated commerce screens as well as the tiles that lead to them. */
export function StorePlanGate({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const { plan, loading, error, retry } = useMerchantPlan();
  const page = /^\/services(\/|$)/.test(pathname) ? "services" : /^\/outlets(\/|$)/.test(pathname) ? "outlets" : null;
  const feature = pathname.startsWith("/store/items") ? "catalog" : pathname.startsWith("/store/live") ? "live" : pathname.startsWith("/store/learning") ? "elite" : null;
  const allowed = page ? plan?.pages?.[page] === true : feature === "elite" ? plan?.isElite === true : feature ? plan?.features?.[feature] === true : true;
  if (!feature && !page) return <>{children}</>;
  if (loading) return <p role="status" className="p-5 text-lg">Checking your plan…</p>;
  if (error) return <section className="home-card m-4 space-y-3"><p role="alert">{error}</p><button onClick={retry} className="min-h-12 rounded-full border border-gold px-5 font-bold">Retry</button></section>;
  if (!allowed) return <section className="home-card m-4 space-y-3" data-testid="store-plan-required">
    <h1 className="text-2xl font-black">Choose a plan for this tool</h1>
    <p className="text-lg text-ink-500">Your current plan does not include this store tool.</p>
    <Link href="/store/plans" className="inline-flex min-h-12 items-center rounded-full bg-gold px-5 font-bold text-ink-gold">View plans</Link>
    <Link href="/store" className="ml-3 inline-flex min-h-12 items-center font-bold">Back</Link>
  </section>;
  return <>{children}</>;
}
