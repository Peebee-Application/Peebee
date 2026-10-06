"use client";

import { hasPermission } from "@peebee/shared";
import { NavModeSettingsPanel } from "../../../components/NavModeSettingsPanel";
import { RideTrackingSettingsPanel } from "../../../components/RideTrackingSettingsPanel";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { useAuth } from "../../../lib/auth-context";

export default function NavigationModeSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");
  const canManageSettings = hasPermission(user?.adminRole ?? null, "settings.manage");

  if (!canManagePayments && !canManageSettings) {
    return (
      <SettingsPageShell title="Navigation mode" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Navigation mode" loading={false}>
      {canManagePayments && <NavModeSettingsPanel />}
      {canManageSettings && <RideTrackingSettingsPanel />}
    </SettingsPageShell>
  );
}
