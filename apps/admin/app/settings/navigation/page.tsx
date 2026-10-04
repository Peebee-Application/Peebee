"use client";

import { hasPermission } from "@peebee/shared";
import { NavModeSettingsPanel } from "../../../components/NavModeSettingsPanel";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { useAuth } from "../../../lib/auth-context";

export default function NavigationModeSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");

  if (!canManagePayments) {
    return (
      <SettingsPageShell title="Navigation mode" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Navigation mode" loading={false}>
      <NavModeSettingsPanel />
    </SettingsPageShell>
  );
}
