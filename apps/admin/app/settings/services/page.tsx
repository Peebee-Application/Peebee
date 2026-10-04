"use client";

import type { ServiceKey, ServiceSwitches } from "@peebee/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const SERVICES: Array<{ key: ServiceKey; label: string; affects: string }> = [
  {
    key: "shopping",
    label: "Shopping lists",
    affects: "Customers can't start new shopping lists. Merchants see a paused notice and riders get no new shopping jobs.",
  },
  {
    key: "parcel",
    label: "Parcel delivery",
    affects: "Customers can't send new parcels. Riders get no new parcel jobs.",
  },
  {
    key: "ride",
    label: "Rides",
    affects: "Customers can't book new boda or Peebee Car rides (including rides for someone else). Riders and Peebee Car drivers get no new ride jobs.",
  },
  {
    key: "food",
    label: "Food ordering",
    affects: "Restaurants disappear from the customer app and can't take new orders; the restaurant app shows a paused notice and riders get no new food jobs.",
  },
];

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceSwitches | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => setServices(settings.services))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!services) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateSettings({ services });
      setServices(res.settings.services);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPageShell title="Services" loading={loading}>
      {services && (
        <form onSubmit={onSubmit} className="space-y-5">
          <p className="text-sm text-ink-500">
            Switch a whole service off and the apps that depend on it go quiet: new orders stop, and the related parts of the customer,
            rider, restaurant, merchant and Peebee Car apps show as paused. Everything else keeps working. Orders already in progress
            finish as normal.
          </p>
          <section className="space-y-3">
            {SERVICES.map((s) => (
              <div key={s.key} className="home-card space-y-1.5">
                <label className="flex items-center gap-2 text-sm font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={services[s.key]}
                    onChange={(e) => setServices({ ...services, [s.key]: e.target.checked })}
                    className="h-4 w-4 accent-gold"
                  />
                  {s.label} <span className="font-normal text-ink-500">— {services[s.key] ? "on" : "paused"}</span>
                </label>
                <p className="text-xs text-ink-500">{s.affects}</p>
              </div>
            ))}
          </section>
          <SettingsSaveBar busy={busy} error={error} saved={saved} />
        </form>
      )}
      {!services && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </SettingsPageShell>
  );
}
