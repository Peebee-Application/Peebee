"use client";

import { isRiderProfileComplete, isUserVerified } from "@peebee/shared";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../lib/auth-context";

const PUBLIC_PATHS = ["/login", "/forgot-password"];
// Always reachable for a signed-in rider even before they're fully set up —
// otherwise they could never reach the screens that get them there.
const ALWAYS_ALLOWED_PATHS = ["/account", "/verify"];
// Reachable no matter the auth state at all — this is where the emailed
// "Verify Email Address" link redirects to, and the person clicking it may
// be signed out here (different device/browser than where they signed up).
const UNGATED_PATHS = ["/verify/confirmed", "/activate"];

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready, rider, riderReady } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isUngated = UNGATED_PATHS.includes(pathname);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const needsVerification = !!user && !isUserVerified(user) && pathname !== "/verify";
  // Verification comes first — profile completion is checked only once
  // they're through it, so /account doesn't fire ahead of /verify.
  const needsProfile =
    !!user &&
    user.role === "rider" &&
    isUserVerified(user) &&
    riderReady &&
    !isRiderProfileComplete(rider) &&
    !ALWAYS_ALLOWED_PATHS.includes(pathname);
  const verifiedButOnVerifyPage = !!user && isUserVerified(user) && pathname === "/verify";

  useEffect(() => {
    if (isUngated || !ready) return;
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic) router.replace("/");
    if (user && needsVerification) router.replace("/verify");
    if (verifiedButOnVerifyPage) router.replace("/");
    if (user && needsProfile) router.replace("/account");
  }, [isUngated, ready, user, isPublic, needsVerification, verifiedButOnVerifyPage, needsProfile, router]);

  if (isUngated) return <>{children}</>;
  if (!ready) return null;
  if (!user && !isPublic) return null;
  if (user && isPublic) return null;
  if (user && needsVerification) return null;
  if (verifiedButOnVerifyPage) return null;
  if (user && needsProfile) return null;

  return <>{children}</>;
}
