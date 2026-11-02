"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../lib/auth-context";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready, merchant, merchantsReady, merchantLoadError, refreshMerchants } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login" || pathname === "/forgot-password";
  const isApply = pathname === "/apply";

  useEffect(() => {
    if (pathname === "/activate" || !ready) return;
    if (user && (!merchantsReady || merchantLoadError)) return;
    if (!user && !isLogin) router.replace("/login");
    if (user && isLogin) router.replace(merchant ? "/" : "/apply");
    if (user && merchantsReady && !merchant && !isApply) router.replace("/apply");
    if (user && merchant && isApply) router.replace("/");
  }, [pathname, isApply, isLogin, merchant, merchantsReady, merchantLoadError, ready, router, user]);

  if (pathname === "/activate") return <>{children}</>;
  if (!ready) return null;
  if (user && merchantLoadError) return <main className="mx-auto max-w-lg space-y-4 p-5"><h1 className="text-xl font-bold">Business account unavailable</h1><p role="alert">{merchantLoadError}</p><button type="button" className="min-h-11 rounded-full border border-gold px-4 font-bold" onClick={() => void refreshMerchants().catch(() => undefined)}>Retry loading account</button></main>;
  if (user && !merchantsReady) return <p role="status" className="p-5 text-sm text-ink-500">Loading your business account…</p>;
  if (!user && !isLogin) return null;
  if (user && isLogin) return null;
  return <>{children}</>;
}
