"use client";

import { isUserVerified } from "@peebee/shared";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../lib/auth-context";
import { rememberReturnTo, takeReturnTo } from "../lib/return-to";

const PUBLIC_PATHS = ["/login", "/forgot-password"];
// Always reachable for a signed-in but not-yet-verified customer —
// otherwise they could never get to the screen that verifies them.
const ALWAYS_ALLOWED_PATHS = ["/verify"];
// Reachable no matter the auth state at all — this is where the emailed
// "Verify Email Address" link redirects to, and the person clicking it may
// be signed out here (different device/browser than where they signed up).
const UNGATED_PATHS = ["/verify/confirmed", "/activate"];
// A shared product or dish link: signed out, the page shows a public preview itself.
const SHARED_ITEM_PATH = /^\/(product\/[^/]+|restaurants\/[^/]+\/items\/[^/]+|c\/[^/]+|give\/[^/]+|post\/[^/]+|learn\/study\/[^/]+)\/?$/;

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // A passenger opens their trip link without an account ("/trip/<token>").
  const isUngated = UNGATED_PATHS.includes(pathname) || pathname.startsWith("/trip/") || pathname === "/guest" || pathname.startsWith("/guest/") || pathname.startsWith("/receipt/") || pathname.startsWith("/ticket/") || SHARED_ITEM_PATH.test(pathname);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const needsVerification = !!user && !isUserVerified(user) && !ALWAYS_ALLOWED_PATHS.includes(pathname);
  const verifiedButOnVerifyPage = !!user && isUserVerified(user) && pathname === "/verify";

  useEffect(() => {
    if (isUngated || !ready) return;
    if (!user && !isPublic) {
      // Someone who scanned the code on their TV lands here signed out: bring them back to the page, with the code, after signing in.
      if (pathname === "/learn/tv" || pathname === "/learn/create" || pathname === "/learn/messages" || pathname.startsWith("/learn/study/")) rememberReturnTo(`${pathname}${window.location.search}`);
      router.replace("/login");
    }
    if (user && isPublic) router.replace(takeReturnTo() ?? "/");
    if (user && needsVerification) router.replace("/verify");
    if (verifiedButOnVerifyPage) router.replace("/");
  }, [isUngated, ready, user, isPublic, needsVerification, verifiedButOnVerifyPage, router, pathname]);

  if (isUngated) return <>{children}</>;
  if (!ready) return null;
  if (!user && !isPublic) return null;
  if (user && isPublic) return null;
  if (user && needsVerification) return null;
  if (verifiedButOnVerifyPage) return null;

  return <>{children}</>;
}
