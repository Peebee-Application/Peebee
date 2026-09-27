"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/forgot-password" || pathname.startsWith("/verify");
  // A specific chat thread ("/chat/<customerId>") is a full-screen takeover
  // with its own header — the bottom nav stays so the owner can jump
  // straight back to the rest of the app without leaving chat first.
  const isChatThread = pathname.startsWith("/chat/");
  const showHeader = !isAuthPage && !isChatThread;
  const showNav = !isAuthPage;

  return (
    <AuthGate>
      <PracticeModeGuard role="restaurant" pathname={pathname} />
      {!isAuthPage && <PracticeModePrompt role="restaurant" />}
      {showHeader && <BrandHeader />}
      {!isAuthPage && <PracticeModeBanner role="restaurant" />}
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
