"use client";

import { isUserVerified } from "@peebee/shared";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../lib/auth-context";
import { isAuthPath, isPracticeEntry, useGuestAccess } from "../lib/guest-access";
import { rememberReturnTo, takeReturnTo } from "../lib/return-to";

const PUBLIC_PATHS = ["/login", "/forgot-password"];
// Reachable signed in or signed out. Help is linked from the welcome screen.
const UNGATED_PATHS = ["/verify/confirmed", "/activate", "/help"];
// A shared product or dish link: signed out, the page shows a public preview itself.
const SHARED_ITEM_PATH = /^\/(product\/[^/]+|restaurants\/[^/]+\/items\/[^/]+|c\/[^/]+|give\/[^/]+|post\/[^/]+|learn\/study\/[^/]+)\/?$/;

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const { configReady, browsingEnabled } = useGuestAccess();
  const pathname = usePathname();
  const router = useRouter();
  const isUngated = UNGATED_PATHS.includes(pathname) || pathname.startsWith("/trip/") || pathname === "/guest" || pathname.startsWith("/guest/") || pathname.startsWith("/receipt/") || pathname.startsWith("/ticket/") || SHARED_ITEM_PATH.test(pathname);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const verified = !!user && isUserVerified(user);
  const practiceEntry = isPracticeEntry(pathname);

  useEffect(() => {
    if (isUngated || !ready) return;
    if (!user) {
      if (isPublic) return;
      if (!configReady) return;
      // Practice is only available after an account exists. Don't remember it as the place to return to.
      if (practiceEntry) {
        router.replace(browsingEnabled ? "/" : "/login");
        return;
      }
      if (pathname === "/verify") {
        router.replace("/login");
        return;
      }
      if (!browsingEnabled) {
        rememberReturnTo(`${pathname}${window.location.search}`);
        router.replace("/login");
      }
      return;
    }
    if (!verified && pathname !== "/verify") {
      router.replace("/verify");
      return;
    }
    if (verified && (isPublic || pathname === "/verify" || isAuthPath(pathname))) {
      router.replace(takeReturnTo() ?? "/");
    }
  }, [isUngated, ready, user, verified, isPublic, practiceEntry, configReady, browsingEnabled, router, pathname]);

  if (isUngated) return <>{children}</>;
  if (!ready) return null;
  if (!user && isPublic) return <>{children}</>;
  if (!user) {
    if (!configReady || practiceEntry || pathname === "/verify" || !browsingEnabled) return null;
    return <>{children}</>;
  }
  if (!verified && pathname !== "/verify") return null;
  if (verified && (isPublic || pathname === "/verify")) return null;
  return <>{children}</>;
}
