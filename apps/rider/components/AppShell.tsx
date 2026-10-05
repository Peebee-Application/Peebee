"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { ServiceBanner } from "./ServiceBanner";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/activate" || pathname === "/forgot-password" || pathname.startsWith("/verify");
  // "/chat" itself is a normal list screen (conversations) with the usual
  // header + nav; a specific thread ("/chat/<counterpartId>") is a
  // full-screen takeover — its own header/footer replace
  // BrandHeader/BottomNav so the conversation gets the full viewport
  // with nothing floating over it.
  const isChatThread = pathname.startsWith("/chat/");
  const showHeader = !isAuthPage && !isChatThread;
  const showNav = !isAuthPage && !isChatThread;

  return (
    <AuthGate>
      <PracticeModeGuard role="rider" pathname={pathname} />
      {!isAuthPage && <PracticeModePrompt role="rider" />}
      {showHeader && <BrandHeader />}
      {!isAuthPage && <PracticeModeBanner role="rider" />}
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
