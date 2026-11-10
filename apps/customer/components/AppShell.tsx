"use client";

import { ModuleRouteGate } from "@peebee/shared/module-gate";
import { MODULE_ROUTES } from "../lib/module-routes";
import { useModules } from "../lib/modules";

import { useEffect, useSyncExternalStore } from "react";
import { noteInAppNavigation } from "../lib/nav-primary-action";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { ChatDrawerShell } from "../lib/chat-drawer";
import { FoodBusinessTheme } from "./FoodBusinessTheme";
import { OfflineBanner } from "./OfflineBanner";
import { GuestAccessProvider } from "../lib/guest-access";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";
import { isNavigationOverlayOpen, subscribeToNavigationOverlay } from "../lib/location-flow-state";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const moduleOn = useModules();
  const gated = <ModuleRouteGate rules={MODULE_ROUTES} pathname={pathname} modules={moduleOn}>{children}</ModuleRouteGate>;
  const { user } = useAuth();
  // Lets the nav's Back use router.back() only when there is an in-app screen to return to.
  useEffect(() => { noteInAppNavigation(); }, [pathname]);
  const navigationOverlayOpen = useSyncExternalStore(subscribeToNavigationOverlay, isNavigationOverlayOpen, () => false);
  const foodBusinessId=/^\/restaurants\/([^/]+)(?:\/items\/[^/]+)?$/.exec(pathname)?.[1];
  const isFoodDetail=/^\/restaurants\/[^/]+\/items\/[^/]+$/.test(pathname);
  // A shared channel, cause or post link: signed out, it is a clean public page with its own top bar.
  const isPublicChannelPage = !user && /^\/(c|give|post)\/[^/]+\/?$/.test(pathname);
  const isAuthPage = isPublicChannelPage || pathname === "/login" || pathname === "/activate" || pathname === "/forgot-password" || pathname.startsWith("/verify") || pathname.startsWith("/trip/") || pathname.startsWith("/guest/") || pathname.startsWith("/receipt/") || pathname.startsWith("/ticket/");
  // "/chat" itself is a normal list screen (conversations) with the usual
  // header + nav; a specific thread ("/chat/<counterpartId>" for order
  // chat, or "/restaurants/<id>/chat" for restaurant chat) takes over the
  // whole screen — its own header/footer replace BrandHeader/BottomNav so
  // the conversation gets the full viewport with nothing floating over it.
  const isChatThread = pathname.startsWith("/chat/") || /^\/restaurants\/[^/]+\/chat$/.test(pathname);
  // Single store (/store/<id>) and single product (/product/<id> or /store/<id>/product/<productId>)
  // screens take on full viewport view without top BrandHeader or bottom navigation bar.
  const isSingleStore = /^\/store\/[^/]+$/.test(pathname);
  const isSingleProduct = pathname.startsWith("/product/") || /^\/store\/[^/]+\/product\/[^/]+$/.test(pathname);
  // Spotlight is an edge-to-edge immersive feed: no header. It keeps the bottom nav,
  // which becomes Spotlight's own menu (Home button + five filters) floating over the feed.
  const isSpotlight = pathname === "/spotlight" || pathname.startsWith("/spotlight/");
  // Going live (the camera, or a helper device) takes the whole screen, like Spotlight, with no header or menu.
  const isGoLive = pathname === "/live" || pathname.startsWith("/live/");
  const isImmersiveFullscreen = isSingleStore || isSingleProduct || isGoLive;

  const showHeader = !isAuthPage && !isChatThread && !isFoodDetail && !isImmersiveFullscreen && !isSpotlight;
  const showNav = !isAuthPage && !isChatThread && !isFoodDetail && !navigationOverlayOpen && !isImmersiveFullscreen;

  return (
    <GuestAccessProvider>
    <AuthGate>
      <ChatDrawerShell>

      {user && <PracticeModeGuard role="customer" pathname={pathname} />}
      {user && !isAuthPage && <PracticeModePrompt role="customer" />}
      {user && !isAuthPage && <PracticeModeBanner role="customer" />}
      {!isAuthPage && <OfflineBanner />}
      {showHeader && <BrandHeader />}
      <main
        className={`mx-auto max-w-lg ${showHeader ? "min-h-[calc(100dvh-4rem)]" : "min-h-dvh"} ${showNav && !isSpotlight ? "customer-nav-content-clearance" : ""}`}
      >
        {foodBusinessId ? <FoodBusinessTheme key={foodBusinessId} id={foodBusinessId}>{gated}</FoodBusinessTheme> : gated}
      </main>
      {showNav && <BottomNav />}
      </ChatDrawerShell>
    </AuthGate>
    </GuestAccessProvider>
  );
}
