"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-context";
import { api } from "./api";
import { rememberReturnTo } from "./return-to";
import { goBackOr } from "./nav-primary-action";
import { CustomerGoogleButton } from "../components/account/CustomerGoogleButton";
import { AuthButton, AuthSub, LockIcon } from "../components/account/AuthUi";

const PROTECTED_PREFIXES = ["/cart", "/checkout", "/wallet", "/payments", "/payment", "/orders", "/account", "/settings", "/notifications"];

export function isAccountArea(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Practice is only for someone who already has an account and is signed in. */
export function isPracticeEntry(pathname: string): boolean {
  return pathname === "/practice" || pathname.endsWith("/practice");
}

export function isAuthPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/forgot-password" || pathname === "/activate" || pathname === "/verify" || pathname.startsWith("/verify/");
}

type GuestAccess = {
  configReady: boolean;
  browsingEnabled: boolean;
  checkoutEnabled: boolean;
  openGate: (options?: { returnTo?: string; buyAsGuestHref?: string }) => boolean;
  setBuyAsGuestTarget: (href: string | null) => void;
};

const GuestAccessContext = createContext<GuestAccess | null>(null);

export function GuestAccessProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [configReady, setConfigReady] = useState(false);
  const [browsingEnabled, setBrowsingEnabled] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [buyAsGuestHref, setBuyAsGuestHref] = useState<string | null>(null);
  const [action, setAction] = useState<{ returnTo: string; href: string | null } | null>(null);
  const [dismissedPath, setDismissedPath] = useState<string | null>(null);
  const routeWantsGate = ready && configReady && !user && browsingEnabled && isAccountArea(pathname);
  const routeGate = routeWantsGate && dismissedPath !== pathname;
  if (user && action) setAction(null);
  if (!routeWantsGate && dismissedPath) setDismissedPath(null);

  useEffect(() => {
    let live = true;
    api.getGuestConfig()
      .then((cfg) => {
        if (!live) return;
        setBrowsingEnabled(cfg.browsingEnabled === true);
        setCheckoutEnabled(cfg.enabled === true);
      })
      .catch(() => {
        if (!live) return;
        setBrowsingEnabled(false);
        setCheckoutEnabled(false);
      })
      .finally(() => { if (live) setConfigReady(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!routeGate) return;
    rememberReturnTo(`${pathname}${window.location.search}`);
  }, [routeGate, pathname]);

  const openGate = useCallback((options?: { returnTo?: string; buyAsGuestHref?: string }) => {
    if (user) return true;
    const returnTo = options?.returnTo ?? `${pathname}${typeof window !== "undefined" ? window.location.search : ""}`;
    rememberReturnTo(returnTo);
    if (!browsingEnabled) {
      router.push("/login");
      return false;
    }
    setAction({ returnTo, href: options?.buyAsGuestHref ?? null });
    return false;
  }, [user, pathname, browsingEnabled, router]);

  const setBuyAsGuestTarget = useCallback((href: string | null) => setBuyAsGuestHref(href), []);

  const value = useMemo<GuestAccess>(() => ({
    configReady, browsingEnabled, checkoutEnabled, openGate, setBuyAsGuestTarget,
  }), [configReady, browsingEnabled, checkoutEnabled, openGate, setBuyAsGuestTarget]);

  function notNow() {
    setAction(null);
    if (routeWantsGate) {
      setDismissedPath(pathname);
      goBackOr(router, "/");
    }
  }

  function continueWithEmail() {
    rememberReturnTo(action?.returnTo ?? `${pathname}${window.location.search}`);
    setAction(null);
    router.push("/login");
  }

  const guestHref = action?.href ?? buyAsGuestHref ?? "/stores";
  const gateOpen = !user && (action !== null || routeGate);

  return (
    <GuestAccessContext.Provider value={value}>
      {children}
      {gateOpen && (
        <div className="account-gate" role="presentation">
          <div className="account-sheet" role="dialog" aria-modal="true" aria-labelledby="guest-gate-title">
            <div className="account-grab" aria-hidden />
            <div className="account-lock"><LockIcon /></div>
            <h2 id="guest-gate-title">Sign in to continue</h2>
            <AuthSub>{pathname.startsWith("/cart") ? "Your cart is saved. Sign in or create an account to check out." : "Sign in or create an account to continue."}</AuthSub>
            <div className="account-stack">
              <CustomerGoogleButton />
              <AuthButton tone="sec" onClick={continueWithEmail}>Continue with email or phone</AuthButton>
              <div className="account-actions">
                {checkoutEnabled && <AuthButton tone="muted" onClick={() => { setAction(null); setDismissedPath(pathname); router.push(guestHref); }}>Buy as guest</AuthButton>}
                <AuthButton tone="ghost" onClick={notNow}>Not now</AuthButton>
              </div>
            </div>
            <p className="account-fine">You&apos;ll come straight back here after signing in.</p>
          </div>
        </div>
      )}
    </GuestAccessContext.Provider>
  );
}

export function useGuestAccess(): GuestAccess {
  const ctx = useContext(GuestAccessContext);
  if (!ctx) throw new Error("useGuestAccess must be used within GuestAccessProvider");
  return ctx;
}

/** Returns true when the person is signed in. Otherwise opens the sign-in sheet, or sends them to login when browsing is off. */
export function useRequireAccount() {
  const { user } = useAuth();
  const { openGate } = useGuestAccess();
  return useCallback((options?: { returnTo?: string; buyAsGuestHref?: string }) => {
    if (user) return true;
    openGate(options);
    return false;
  }, [user, openGate]);
}
