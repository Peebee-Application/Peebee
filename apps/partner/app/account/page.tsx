"use client";

import Link from "next/link";

import { LogOut, LifeBuoy, ChevronRight, UserRound } from "lucide-react";
import { AppearanceSettings } from "../../components/AppearanceSettings";
import { useAuth } from "../../lib/auth-context";

export default function AccountPage() {
  const { user, me, logout } = useAuth();
  return (
    <div className="space-y-5 px-4 py-5">
      <header className="flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-gold"><UserRound className="h-7 w-7" aria-hidden /></span>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-black">{user?.name}</h1>
      </header>
      <section className="grid grid-cols-2 gap-3">
        <div className="home-card text-center"><p className="text-base text-ink-500">Owner</p><p className="text-xl font-bold capitalize text-ink">{me?.ownerStatus ?? "none"}</p></div>
        <div className="home-card text-center"><p className="text-base text-ink-500">Driver</p><p className="text-xl font-bold capitalize text-ink">{me?.driverStatus ?? "none"}</p></div>
      </section>
      <Link href="/help" className="home-card flex items-center gap-3 min-h-16 !rounded-2xl text-xl font-bold text-ink">
        <LifeBuoy className="h-7 w-7 text-gold" strokeWidth={1.75} aria-hidden />
        <span className="flex-1">Help &amp; support</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
      </Link>
      <AppearanceSettings />
      <button onClick={logout} className="flex min-h-16 w-full items-center justify-center gap-2 rounded-full border border-red-300 text-xl font-bold text-red-600">
        <LogOut className="h-6 w-6" aria-hidden />Log out
      </button>
    </div>
  );
}
