"use client";

import { hasPermission, type SubscriptionCadence } from "@tuma/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

/**
 * A separate, optional paid tier from the "Rider subscription" on the
 * Monetization page, which gates job matching itself. Pro instead unlocks
 * premium features that individually opt into requiring it — see the
 * "Require a Pro subscription" checkbox on the Luganda list reading and
 * Stage savings circles settings pages.
 */
export default function RiderProSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");

  const [enabled, setEnabled] = useState(false);
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringAmount, setRecurringAmount] = useState("0");
  const [recurringCadence, setRecurringCadence] = useState<SubscriptionCadence>("weekly");
  const [onetimeEnabled, setOnetimeEnabled] = useState(false);
  const [onetimeAmount, setOnetimeAmount] = useState("0");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setEnabled(settings.proSubscriptionEnabled);
        setRecurringEnabled(settings.proRecurringEnabled);
        setRecurringAmount(String(settings.proRecurringAmount));
        setRecurringCadence(settings.proRecurringCadence);
        setOnetimeEnabled(settings.proOnetimeEnabled);
        setOnetimeAmount(String(settings.proOnetimeAmount));
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
        proSubscriptionEnabled: enabled,
        proRecurringEnabled: recurringEnabled,
        proRecurringAmount: Number(recurringAmount),
        proRecurringCadence: recurringCadence,
        proOnetimeEnabled: onetimeEnabled,
        proOnetimeAmount: Number(onetimeAmount),
      });
      setEnabled(res.settings.proSubscriptionEnabled);
      setRecurringEnabled(res.settings.proRecurringEnabled);
      setRecurringAmount(String(res.settings.proRecurringAmount));
      setRecurringCadence(res.settings.proRecurringCadence);
      setOnetimeEnabled(res.settings.proOnetimeEnabled);
      setOnetimeAmount(String(res.settings.proOnetimeAmount));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Rider Pro" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Rider Pro" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            />
            <span>
              <span className="text-sm font-semibold text-ink">Rider Pro</span>
              <span className="block text-xs text-ink-500">
                A separate paid tier from the rider subscription above — that one gates job matching, this one
                unlocks premium perks (Luganda list reading, Stage Savings) that each have their own
                &quot;Require a Pro subscription&quot; switch on their own settings page. Charged to the rider&apos;s
                own mobile money number.
              </span>
            </span>
          </label>
        </section>

        {enabled && (
          <>
            <section className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={recurringEnabled}
                  onChange={(e) => setRecurringEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
                />
                <span>
                  <span className="text-sm font-semibold text-ink">Recurring plan</span>
                  <span className="block text-xs text-ink-500">Bills every cadence until cancelled.</span>
                </span>
              </label>
              {recurringEnabled && (
                <div className="grid grid-cols-2 gap-3 pl-6.5">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-500" htmlFor="recurringAmount">
                      Amount (UGX)
                    </label>
                    <input
                      id="recurringAmount"
                      inputMode="numeric"
                      value={recurringAmount}
                      onChange={(e) => setRecurringAmount(e.target.value.replace(/[^\d.]/g, ""))}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-500" htmlFor="recurringCadence">
                      Cadence
                    </label>
                    <select
                      id="recurringCadence"
                      value={recurringCadence}
                      onChange={(e) => setRecurringCadence(e.target.value as SubscriptionCadence)}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={onetimeEnabled}
                  onChange={(e) => setOnetimeEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
                />
                <span>
                  <span className="text-sm font-semibold text-ink">One-time plan</span>
                  <span className="block text-xs text-ink-500">
                    A single lifetime charge — a rider who pays never needs to renew.
                  </span>
                </span>
              </label>
              {onetimeEnabled && (
                <div className="pl-6.5">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="onetimeAmount">
                    Amount (UGX)
                  </label>
                  <input
                    id="onetimeAmount"
                    inputMode="numeric"
                    value={onetimeAmount}
                    onChange={(e) => setOnetimeAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                  />
                </div>
              )}
            </section>

            {recurringEnabled && onetimeEnabled && (
              <p className="text-xs text-ink-500">
                Both plans are on — a rider will see both prices and choose which one to buy.
              </p>
            )}
            {!recurringEnabled && !onetimeEnabled && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                Turn on at least one plan, or riders won&apos;t be able to buy Pro at all.
              </p>
            )}
          </>
        )}

        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
