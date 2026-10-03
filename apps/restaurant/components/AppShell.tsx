"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { ServiceBanner } from "./ServiceBanner";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/forgot-password" || pathname.startsWith("/verify");
  // A specific chat thread ("/chat/<customerId>") is a full-screen
  // takeover — its own header/footer replace BrandHeader/BottomNav so the
  // conversation gets the full viewport with nothing floating over it.
  const isChatThread = pathname.startsWith("/chat/");
  const showHeader = !isAuthPage && !isChatThread;
  const showNav = !isAuthPage && !isChatThread;

  return (
    <AuthGate>
      <PracticeModeGuard role="restaurant" pathname={pathname} />
      {!isAuthPage && <PracticeModePrompt role="restaurant" />}
      {showHeader && <BrandHeader />}
      {!isAuthPage && <PracticeModeBanner role="restaurant" />}
      {!isAuthPage && <ServiceBanner />}
      <main
        className={`mx-auto max-w-lg ${showHeader ? "min-h-[calc(100dvh-3.5rem)]" : "min-h-dvh"} ${
          showNav ? "pb-[calc(3.5rem+env(safe-area-inset-bottom))]" : ""
        }`}
      >
        {children}
      </main>
      {showNav && <BottomNav />}
    </AuthGate>
  );
}
