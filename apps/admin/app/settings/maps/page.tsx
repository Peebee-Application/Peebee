"use client";

import { hasPermission } from "@peebee/shared";
import { MapsSettingsPanel } from "../../../components/MapsSettingsPanel";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { useAuth } from "../../../lib/auth-context";

export default function MapsSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");

  if (!canManagePayments) {
    return (
      <SettingsPageShell title="Maps" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Maps" loading={false}>
      <MapsSettingsPanel />
    </SettingsPageShell>
  );
}
