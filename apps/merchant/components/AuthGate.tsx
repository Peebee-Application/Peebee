"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../lib/auth-context";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready, merchant, merchantsReady } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const isApply = pathname === "/apply";

  useEffect(() => {
    if (pathname === "/activate" || !ready) return;
    if (!user && !isLogin) router.replace("/login");
    if (user && isLogin) router.replace(merchant ? "/" : "/apply");
    if (user && merchantsReady && !merchant && !isApply) router.replace("/apply");
    if (user && merchant && isApply) router.replace("/");
  }, [pathname, isApply, isLogin, merchant, merchantsReady, ready, router, user]);

  if (pathname === "/activate") return <>{children}</>;
  if (!ready || (user && !merchantsReady && !isLogin)) return null;
  if (!user && !isLogin) return null;
  if (user && isLogin) return null;
  return <>{children}</>;
}
