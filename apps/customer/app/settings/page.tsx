"use client";

import Link from "next/link";

import { LifeBuoy, ChevronRight } from "lucide-react";

import { AppearanceSettings } from "../../components/AppearanceSettings";
import { ChangePasswordPanel } from "../../components/ChangePasswordPanel";
import { LanguageSettings } from "../../components/LanguageSettings";
import { MatchingPreference } from "../../components/MatchingPreference";
import { NotificationSettings } from "../../components/NotificationSettings";
import { PracticeModeCard } from "../../components/PracticeMode";

export default function SettingsPage() {
  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Settings</h1>
      <AppearanceSettings />
      <NotificationSettings />
      <LanguageSettings />
      <MatchingPreference />
      <PracticeModeCard role="customer" />
      <Link href="/help" className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink">
        <LifeBuoy className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden />
        <span className="flex-1">Help &amp; support</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
      </Link>
      <ChangePasswordPanel />
    </div>
  );
}
