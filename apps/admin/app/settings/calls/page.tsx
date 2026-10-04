"use client";

import { hasPermission } from "@peebee/shared";
import { CallsSettingsPanel } from "../../../components/CallsSettingsPanel";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { useAuth } from "../../../lib/auth-context";

export default function CallsSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");

  if (!canManagePayments) {
    return (
      <SettingsPageShell title="Calls" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Calls" loading={false}>
      <CallsSettingsPanel />
    </SettingsPageShell>
  );
}
