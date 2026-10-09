"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { FoodBusinessTheme } from "./FoodBusinessTheme";
import { OfflineBanner } from "./OfflineBanner";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";
import { isNavigationOverlayOpen, subscribeToNavigationOverlay } from "../lib/location-flow-state";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navigationOverlayOpen = useSyncExternalStore(subscribeToNavigationOverlay, isNavigationOverlayOpen, () => false);
  const foodBusinessId=/^\/restaurants\/([^/]+)(?:\/items\/[^/]+)?$/.exec(pathname)?.[1];
  const isFoodDetail=/^\/restaurants\/[^/]+\/items\/[^/]+$/.test(pathname);
  const isAuthPage = pathname === "/login" || pathname === "/activate" || pathname === "/forgot-password" || pathname.startsWith("/verify") || pathname.startsWith("/trip/");
  // "/chat" itself is a normal list screen (conversations) with the usual
  // header + nav; a specific thread ("/chat/<counterpartId>" for order
  // chat, or "/restaurants/<id>/chat" for restaurant chat) takes over the
  // whole screen — its own header/footer replace BrandHeader/BottomNav so
  // the conversation gets the full viewport with nothing floating over it.
  const isChatThread = pathname.startsWith("/chat/") || /^\/restaurants\/[^/]+\/chat$/.test(pathname);
  const showHeader = !isAuthPage && !isChatThread && !isFoodDetail;
  const showNav = !isAuthPage && !isChatThread && !isFoodDetail && !navigationOverlayOpen;

  return (
    <AuthGate>

      <PracticeModeGuard role="customer" pathname={pathname} />
      {!isAuthPage && <PracticeModePrompt role="customer" />}
      {!isAuthPage && <OfflineBanner />}
      {showHeader && <BrandHeader />}
      {!isAuthPage && <PracticeModeBanner role="customer" />}
      <main
        className={`mx-auto max-w-lg ${showHeader ? "min-h-[calc(100dvh-4rem)]" : "min-h-dvh"} ${
          showNav ? "pb-[calc(5rem+env(safe-area-inset-bottom))]" : ""
        }`}
      >
        {foodBusinessId ? <FoodBusinessTheme key={foodBusinessId} id={foodBusinessId}>{children}</FoodBusinessTheme> : children}
      </main>
      {showNav && <BottomNav />}
    </AuthGate>
  );
}
