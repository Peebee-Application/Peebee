"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { OfflineBanner } from "./OfflineBanner";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/forgot-password" || pathname.startsWith("/verify");
  // "/chat" itself is a normal list screen (conversations) with the usual
  // header + nav; a specific thread ("/chat/<counterpartId>" for order
  // chat, or "/restaurants/<id>/chat" for restaurant chat) takes over the
  // whole screen — its own header/footer replace BrandHeader/BottomNav so
  // the conversation gets the full viewport with nothing floating over it.
  const isChatThread = pathname.startsWith("/chat/") || /^\/restaurants\/[^/]+\/chat$/.test(pathname);
  const showHeader = !isAuthPage && !isChatThread;
  const showNav = !isAuthPage && !isChatThread;

  return (
    <AuthGate>
      <PracticeModeGuard role="customer" pathname={pathname} />
      {!isAuthPage && <PracticeModePrompt role="customer" />}
      {!isAuthPage && <OfflineBanner />}
      {showHeader && <BrandHeader />}
      {!isAuthPage && <PracticeModeBanner role="customer" />}
      <main
        className={`mx-auto max-w-lg ${showHeader ? "min-h-[calc(100dvh-3.5rem)]" : "min-h-dvh"} ${
          showNav ? "pb-[calc(5rem+env(safe-area-inset-bottom))]" : ""
        }`}
      >
        {children}
      </main>
      {showNav && <BottomNav />}
    </AuthGate>
  );
}
