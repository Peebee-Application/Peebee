"use client";

import { FileText, LifeBuoy, LogOut } from "lucide-react";
import { AccountFrame, GRow, Group, SectionLabel, useBack } from "../../../components/account/AccountUI";
import { AppearanceSettings } from "../../../components/AppearanceSettings";
import { PracticeModeCard } from "../../../components/PracticeMode";
import { PageHeader } from "../../../components/store/StoreUI";
import { useAuth } from "../../../lib/auth-context";
import { useModules } from "../../../lib/modules";

export default function AppSettingsPage() {
  const { merchant, logout } = useAuth();
  const back = useBack("/account");
  const moduleOn = useModules();
  const cashier = merchant?.member_role === "cashier";
  return (
    <AccountFrame testId="app-settings">
      <PageHeader title="App settings" onBack={back} backLabel="Back" />
      <SectionLabel>Look</SectionLabel>
      <AppearanceSettings />
      <SectionLabel>Learn</SectionLabel>
      <PracticeModeCard role="merchant" />
      <SectionLabel>Help</SectionLabel>
      <Group>
        <GRow icon={LifeBuoy} value="Help & support" href="/help" testId="settings-help" />
        {!cashier && moduleOn("buy.marketplace") && <GRow icon={FileText} value="Statements" href="/reports" testId="settings-statements" />}
      </Group>
      <button type="button" onClick={logout} data-testid="logout"
        className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full border-[2.5px] border-red-600/45 text-[21px] font-black text-red-600 active:scale-[.98] dark:text-red-400">
        <LogOut className="h-6 w-6" strokeWidth={2.6} /> Log out
      </button>
    </AccountFrame>
  );
}
