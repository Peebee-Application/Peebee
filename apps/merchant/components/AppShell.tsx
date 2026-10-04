"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { ServiceBanner } from "./ServiceBanner";
import { PracticeModeBanner, PracticeModeGuard, PracticeModePrompt } from "./PracticeMode";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { merchant } = useAuth();
  const bare = pathname === "/login" || pathname === "/apply";
  return <AuthGate>
    <PracticeModeGuard role="merchant" pathname={pathname} />
    {!bare && <PracticeModePrompt role="merchant" />}
    {!bare && <header className="sticky top-0 z-30 border-b border-[var(--border-faint)] bg-[rgb(var(--surface))]/95 backdrop-blur"><div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4"><Link href="/" aria-label="Go to merchant home" className="shrink-0"><Image src="/brand/peebee-logo-navy.png" alt="Peebee" width={120} height={36} priority className="h-7 w-auto dark:hidden"/><Image src="/brand/peebee-logo-white.png" alt="Peebee" width={120} height={36} priority className="hidden h-7 w-auto dark:block"/></Link><div className="min-w-0 flex-1"><p className="text-sm font-black text-navy">Merchant</p><p className="max-w-[240px] truncate text-[10px] text-ink-500">{merchant?.display_name}</p></div>{merchant?.environment === "sandbox" && <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">Sandbox</span>}</div></header>}
    {!bare && <PracticeModeBanner role="merchant" />}
    {!bare && <ServiceBanner />}
    <main className={`mx-auto min-h-dvh max-w-xl ${bare ? "" : "pb-20"}`}>{children}</main>
    {!bare && <BottomNav />}
  </AuthGate>;
}
