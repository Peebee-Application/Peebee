"use client";

import { ChevronRight, LogOut, Settings, Shield, Wallet } from "lucide-react";
import Link from "next/link";
import { ChannelEntryCard } from "../../components/channels/ChannelEntryCard";
import { DisplayNameSettings } from "../../components/DisplayNameSettings";
import { ProfilePhoto } from "../../components/ProfilePhoto";
import { PracticeModeCard } from "../../components/PracticeMode";
import { SavedLocations } from "../../components/SavedLocations";
import { useAuth } from "../../lib/auth-context";
import { useTranslate } from "../../lib/i18n";

export default function AccountPage() {
  const t = useTranslate();
  const { user, logout } = useAuth();

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">{t("account_title")}</h1>

      <section className="home-card flex items-center gap-3">
        <ProfilePhoto />
        <span>
          <span className="block text-[15px] font-bold text-ink">{user?.name ?? "—"}</span>
          <span className="block text-sm text-ink-500">{user?.phone}</span>
          {user?.accountCode && <span className="mt-1 block font-mono text-xs text-ink-500">Peebee ID · {user.accountCode}</span>}
        </span>
      </section>

      <Link
        href="/wallet"
        className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink"
      >
        <Wallet className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden />
        {t("nav_wallet")}
      </Link>

      <ChannelEntryCard />

      <DisplayNameSettings />

      <PracticeModeCard role="customer" />

      <SavedLocations />

      <Link
        href="/settings"
        className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink"
      >
        <Settings className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden />
        <span className="flex-1">Settings</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
      </Link>

      {user?.role === "admin" && (
        <Link
          href="/admin"
          className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink"
        >
          <Shield className="h-5 w-5 text-green" strokeWidth={1.75} aria-hidden />
          Rider verification (admin)
        </Link>
      )}

      <button
        onClick={logout}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        {t("log_out")}
      </button>
    </div>
  );
}
