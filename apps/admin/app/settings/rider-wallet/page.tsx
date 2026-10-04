"use client";

import { hasPermission } from "@peebee/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export default function RiderWalletSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");
  const [riderMinimumBalanceEnabled, setRiderMinimumBalanceEnabled] = useState(false);
  const [riderMinimumBalanceAmount, setRiderMinimumBalanceAmount] = useState("2000");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setRiderMinimumBalanceEnabled(settings.riderMinimumBalanceEnabled);
        setRiderMinimumBalanceAmount(String(settings.riderMinimumBalanceAmount));
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateSettings({
        riderMinimumBalanceEnabled,
        riderMinimumBalanceAmount: Number(riderMinimumBalanceAmount),
      });
      setRiderMinimumBalanceEnabled(res.settings.riderMinimumBalanceEnabled);
      setRiderMinimumBalanceAmount(String(res.settings.riderMinimumBalanceAmount));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Rider wallet minimum balance" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Rider wallet minimum balance" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={riderMinimumBalanceEnabled}
              onChange={(e) => setRiderMinimumBalanceEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">Keep a minimum balance in every rider wallet</span>
              <span className="block text-xs text-ink-500">
                When on, a rider&apos;s own withdrawal always leaves at least this much behind — they can withdraw
                less if they choose, never below it. Only closing the account pays out everything, reserve
                included. This same reserve is used as the required deposit when the cash-order fee source (in
                Monetization) is set to &quot;deposit&quot;.
              </span>
            </span>
          </label>
          {riderMinimumBalanceEnabled && (
            <div className="space-y-1 pl-6.5">
              <label className="text-xs font-semibold text-ink-500" htmlFor="riderMinimumBalance">
                Minimum balance (UGX)
              </label>
              <input
                id="riderMinimumBalance"
                inputMode="numeric"
                value={riderMinimumBalanceAmount}
                onChange={(e) => setRiderMinimumBalanceAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="2000"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
          )}
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
