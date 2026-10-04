"use client";

import { hasPermission } from "@peebee/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export default function CustomerWalletSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");
  const [walletUnverifiedCap, setWalletUnverifiedCap] = useState("");
  const [walletVerifiedCap, setWalletVerifiedCap] = useState("");
  const [walletMaxTopup, setWalletMaxTopup] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setWalletUnverifiedCap(String(settings.walletUnverifiedCap));
        setWalletVerifiedCap(String(settings.walletVerifiedCap));
        setWalletMaxTopup(String(settings.walletMaxTopup));
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
        walletUnverifiedCap: Number(walletUnverifiedCap),
        walletVerifiedCap: Number(walletVerifiedCap),
        walletMaxTopup: Number(walletMaxTopup),
      });
      setWalletUnverifiedCap(String(res.settings.walletUnverifiedCap));
      setWalletVerifiedCap(String(res.settings.walletVerifiedCap));
      setWalletMaxTopup(String(res.settings.walletMaxTopup));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Customer wallet limits" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Customer wallet limits" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <p className="text-xs text-ink-500">
            Closed-loop store credit — customers top up and spend it on orders, no cash-out. Balance is capped by
            verification, the same way mobile money limits unverified accounts.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="walletUnverified">
                Unverified cap (UGX)
              </label>
              <input
                id="walletUnverified"
                inputMode="numeric"
                value={walletUnverifiedCap}
                onChange={(e) => setWalletUnverifiedCap(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="walletVerified">
                Verified cap (UGX)
              </label>
              <input
                id="walletVerified"
                inputMode="numeric"
                value={walletVerifiedCap}
                onChange={(e) => setWalletVerifiedCap(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="walletMaxTopup">
                Max amount per top-up (UGX)
              </label>
              <input
                id="walletMaxTopup"
                inputMode="numeric"
                value={walletMaxTopup}
                onChange={(e) => setWalletMaxTopup(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
          </div>
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
