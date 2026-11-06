"use client";

import { ModuleRouteGate } from "@peebee/shared/module-gate";
import { MODULE_ROUTES } from "../lib/module-routes";
import { useModules } from "../lib/modules";

import { isUserVerified } from "@peebee/shared";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "../lib/auth-context";
import { BottomNav } from "./BottomNav";
import { BrandLogo } from "./BrandLogo";

const PUBLIC_PAGES = ["/login", "/signup", "/forgot-password"];
// Reachable whatever the auth state — the emailed "Verify Email Address"
// link can be opened signed out, on a different device.
const UNGATED_PAGES = ["/verify/confirmed"];
// Full-screen account screens drawn by the shared AuthScene (same as every
// other Peebee app), so they skip the app header and page padding.
const AUTH_SCENE_PAGES = [...PUBLIC_PAGES, "/verify", ...UNGATED_PAGES];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const moduleOn = useModules();
  const router = useRouter();
  const { user, provider, ready } = useAuth();
  const isPublic = PUBLIC_PAGES.includes(pathname);
  const isUngated = UNGATED_PAGES.includes(pathname);
  const verified = isUserVerified(user);

  // Signed out → sign in. Signed in but phone/email not confirmed yet →
  // verify it (same identity check as the other Peebee apps). Verified but
  // not a provider yet → set up the provider account.
  useEffect(() => {
    if (!ready || isUngated) return;
    if (!user && !isPublic) router.replace("/login");
    else if (!user) return;
    else if (!verified) {
      if (pathname !== "/verify") router.replace("/verify");
    } else if (pathname === "/verify") router.replace(provider ? "/" : "/onboard");
    else if (isPublic) router.replace(provider ? "/" : "/onboard");
    else if (!provider && pathname !== "/onboard" && pathname !== "/account") router.replace("/onboard");
    else if (provider && pathname === "/onboard") router.replace("/");
  }, [ready, user, verified, provider, pathname, isPublic, isUngated, router]);

  if (isUngated) return <>{children}</>;
  if (!ready) return null;
  if (isPublic) return user ? null : <>{children}</>;
  if (!user) return null;
  if (!verified) return pathname === "/verify" ? <>{children}</> : null;
  if (AUTH_SCENE_PAGES.includes(pathname)) return null;
  const showNav = !!provider;

  return (
    <div className="min-h-dvh bg-cream text-ink">
      <header className="customer-header sticky top-0 z-30 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <BrandLogo wordmark={false} className="[&_img]:h-9 [&_img]:w-9" />
          <div className="min-w-0 flex-1 px-3">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Peebee Work</p>
            <h1 className="truncate text-sm font-bold">{provider ? (provider.companyName || provider.displayName) : user.name}</h1>
          </div>
          {provider && (
            <span className="customer-header-toggle flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold">
              <span className={`h-2 w-2 rounded-full ${provider.online ? "bg-green" : "bg-current opacity-50"}`} />
              {provider.online ? "Online" : "Offline"}
            </span>
          )}
        </div>
      </header>
      <main className={`mx-auto max-w-lg px-4 py-4 ${showNav ? "customer-nav-content-clearance" : ""}`}><ModuleRouteGate rules={MODULE_ROUTES} pathname={pathname} modules={moduleOn}>{children}</ModuleRouteGate></main>
      {showNav && <BottomNav />}
    </div>
  );
}
