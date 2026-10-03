"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const digits = (v: string) => v.replace(/[^\d]/g, "");

export default function CarSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [onDemand, setOnDemand] = useState(false);
  const [mode, setMode] = useState<"customer_selects" | "first_to_claim">("customer_selects");
  const [owner, setOwner] = useState("60");
  const [driver, setDriver] = useState("30");
  const [platform, setPlatform] = useState("10");
  const [maxKm, setMaxKm] = useState("10");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load(c: { enabled: boolean; onDemandEnabled: boolean; matchingMode: typeof mode; shares: { owner: number; driver: number; platform: number }; maxPickupKm: number }) {
    setEnabled(c.enabled);
    setOnDemand(c.onDemandEnabled);
    setMode(c.matchingMode);
    setOwner(String(c.shares.owner));
    setDriver(String(c.shares.driver));
    setPlatform(String(c.shares.platform));
    setMaxKm(String(c.maxPickupKm));
  }

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => load(settings.car))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const total = (Number(owner) || 0) + (Number(driver) || 0) + (Number(platform) || 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (total !== 100) {
      setError(`Owner, driver and platform shares must total 100% (now ${total}%).`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.adminUpdateSettings({
        car: {
          enabled,
          onDemandEnabled: onDemand,
          matchingMode: mode,
          shares: { owner: Number(owner), driver: Number(driver), platform: Number(platform) },
          maxPickupKm: Math.min(200, Math.max(1, Number(maxKm) || 10)),
        },
      });
      load(res.settings.car);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold";

  return (
    <SettingsPageShell title="Tuma Car" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-gold" />
            Tuma Car is on
          </label>
          <p className="text-xs text-ink-500">
            The master switch. Off hides everything car-related. It needs the car database tables (migration 0065) to be applied first.
          </p>
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input type="checkbox" checked={onDemand} disabled={!enabled} onChange={(e) => setOnDemand(e.target.checked)} className="h-4 w-4 accent-gold" />
            Customers can book a car now
          </label>
          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <label className="text-xs font-semibold text-ink-500" htmlFor="car-mode">How a driver is found</label>
            <select id="car-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={input}>
              <option value="customer_selects">Customer chooses from drivers who applied (bidding possible)</option>
              <option value="first_to_claim">Nearest available driver is assigned automatically</option>
            </select>
            <p className="text-xs text-ink-500">Bids only work in &ldquo;customer chooses&rdquo; and when bidding is on under Rider matching.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="car-km">Furthest a driver can be from the pickup (km)</label>
            <input id="car-km" inputMode="numeric" value={maxKm} onChange={(e) => setMaxKm(digits(e.target.value))} className={input} />
          </div>
        </section>

        <section className="home-card space-y-3">
          <p className="text-sm font-bold text-ink">Profit share of a finished ride</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Owner %", owner, setOwner],
              ["Driver %", driver, setDriver],
              ["Tuma %", platform, setPlatform],
            ].map(([label, value, set]) => (
              <div key={label as string} className="space-y-1">
                <label className="text-xs font-semibold text-ink-500">{label as string}</label>
                <input inputMode="numeric" value={value as string} onChange={(e) => (set as (v: string) => void)(digits(e.target.value))} className={input} />
              </div>
            ))}
          </div>
          <p className={`text-xs ${total === 100 ? "text-ink-500" : "text-red-700 dark:text-red-300"}`}>
            Total {total}% — must be exactly 100%. Applies after payment fees; a category can set its own split on the fleet page.
          </p>
        </section>

        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
      <Link href="/settings/car/fleet" className="home-card block text-sm font-semibold text-ink">
        Car types, owners, drivers and vehicles →
      </Link>
    </SettingsPageShell>
  );
}
