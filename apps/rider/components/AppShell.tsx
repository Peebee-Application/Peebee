"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/forgot-password" || pathname.startsWith("/verify");
  // "/chat" itself is a normal list screen (conversations) with the usual
  // header + nav; a specific thread ("/chat/<counterpartId>") takes over
  // the header only — the bottom nav stays so people can jump straight
  // back to the rest of the app without leaving chat first.
  const isChatThread = pathname.startsWith("/chat/");
  const showHeader = !isAuthPage && !isChatThread;
  const showNav = !isAuthPage;

  return (
    <AuthGate>
      <PracticeModeGuard role="rider" pathname={pathname} />
      {!isAuthPage && <PracticeModePrompt role="rider" />}
      {showHeader && <BrandHeader />}
      {!isAuthPage && <PracticeModeBanner role="rider" />}
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
