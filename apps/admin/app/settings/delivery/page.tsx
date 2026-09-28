"use client";

import { useEffect, useState } from "react";
import type { TimeFeeSettings } from "@tuma/shared";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

export default function DeliveryPricingPage() {
  const [deliveryRatePerKm, setDeliveryRatePerKm] = useState("");
  const [minimumDeliveryFee, setMinimumDeliveryFee] = useState("");
  const [shoppingDeliveryFee, setShoppingDeliveryFee] = useState("");
  const [rideRatePerKm, setRideRatePerKm] = useState("");
  const [rideMinimumFare, setRideMinimumFare] = useState("");
  const [timeFees, setTimeFees] = useState<TimeFeeSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setDeliveryRatePerKm(String(settings.deliveryRatePerKm));
        setMinimumDeliveryFee(String(settings.minimumDeliveryFee));
        setShoppingDeliveryFee(String(settings.shoppingDeliveryFee));
        setRideRatePerKm(String(settings.rideRatePerKm));
        setRideMinimumFare(String(settings.rideMinimumFare));
        setTimeFees(settings.timeFees);
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
        deliveryRatePerKm: Number(deliveryRatePerKm),
        minimumDeliveryFee: Number(minimumDeliveryFee),
        shoppingDeliveryFee: Number(shoppingDeliveryFee),
        rideRatePerKm: Number(rideRatePerKm),
        rideMinimumFare: Number(rideMinimumFare),
        ...(timeFees ? { timeFees } : {}),
      });
      setDeliveryRatePerKm(String(res.settings.deliveryRatePerKm));
      setMinimumDeliveryFee(String(res.settings.minimumDeliveryFee));
      setShoppingDeliveryFee(String(res.settings.shoppingDeliveryFee));
      setRideRatePerKm(String(res.settings.rideRatePerKm));
      setRideMinimumFare(String(res.settings.rideMinimumFare));
      setTimeFees(res.settings.timeFees);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPageShell title="Delivery pricing" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="rate">
              Rate per km (UGX)
            </label>
            <input
              id="rate"
              inputMode="numeric"
              value={deliveryRatePerKm}
              onChange={(e) => setDeliveryRatePerKm(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="1000"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              A parcel&apos;s cost is distance (pickup → drop-off) × this rate, calculated automatically when both
              points are pinned on the map.
            </p>
          </div>
          {timeFees && (
            <div className="space-y-4 border-t border-[var(--border-faint)] pt-4">
              <div>
                <h2 className="text-sm font-bold text-ink">Cancellation and waiting fees</h2>
                <p className="mt-1 text-xs text-ink-500">
                  Customers get a simple warning before a fee is charged. Flat fees must use UGX 500 increments, starting at UGX 500.
                </p>
              </div>
              {(["cancellation", "waiting"] as const).map((kind) => {
                const enabledKey = `${kind}Enabled` as const;
                const typeKey = `${kind}Type` as const;
                const valueKey = `${kind}Value` as const;
                return (
                  <div key={kind} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={timeFees[enabledKey]}
                        onChange={(e) => setTimeFees({ ...timeFees, [enabledKey]: e.target.checked })}
                      />
                      {kind === "cancellation" ? "Cancellation fee" : "Waiting fee"}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={timeFees[typeKey]}
                        onChange={(e) => setTimeFees({ ...timeFees, [typeKey]: e.target.value as "flat" | "percent" })}
                        className="rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm"
                      >
                        <option value="flat">Flat UGX</option>
                        <option value="percent">Fare percentage</option>
                      </select>
                      <input
                        inputMode="decimal"
                        value={timeFees[valueKey]}
                        onChange={(e) => setTimeFees({ ...timeFees, [valueKey]: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
                        className="rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm"
                        aria-label={`${kind} fee value`}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-500" htmlFor="free-waiting-minutes">Free waiting time (minutes)</label>
                <input
                  id="free-waiting-minutes"
                  inputMode="numeric"
                  value={timeFees.freeWaitingMinutes}
                  onChange={(e) => setTimeFees({ ...timeFees, freeWaitingMinutes: Number(e.target.value.replace(/[^\d]/g, "")) || 1 })}
                  className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                />
                <p className="text-xs text-ink-500">Default: 5 free minutes, then one waiting fee.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-500" htmlFor="waiting-warning-minutes">Waiting fee warning before limit (minutes)</label>
                <input
                  id="waiting-warning-minutes"
                  inputMode="numeric"
                  value={timeFees.waitingWarningMinutes}
                  onChange={(e) => setTimeFees({ ...timeFees, waitingWarningMinutes: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                  className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                />
                <p className="text-xs text-ink-500">Default: warn 2 minutes before the free waiting time ends. Set 0 to warn only when the fee starts.</p>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="minimum-delivery-fee">
              Minimum delivery fee (UGX)
            </label>
            <input
              id="minimum-delivery-fee"
              inputMode="numeric"
              value={minimumDeliveryFee}
              onChange={(e) => setMinimumDeliveryFee(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="2000"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              A floor on the distance-priced fee above — a rider still has to go collect and deliver the item even
              on a very short ride, so this is never allowed to round down toward free.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="shopping-fee">
              Shopping delivery fee (UGX)
            </label>
            <input
              id="shopping-fee"
              inputMode="numeric"
              value={shoppingDeliveryFee}
              onChange={(e) => setShoppingDeliveryFee(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="3000"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              A shopping order has no pickup point to price by distance the way a parcel does — this flat fee is
              added to the items cost instead.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="ride-rate">
              Ride rate per km (UGX)
            </label>
            <input
              id="ride-rate"
              inputMode="numeric"
              value={rideRatePerKm}
              onChange={(e) => setRideRatePerKm(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="1500"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              A passenger ride (&quot;call a rider to pick you up and take you somewhere&quot;) is priced the same
              way as a parcel — distance × rate — but carrying a person is its own fare, tracked separately.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="ride-minimum-fare">
              Minimum ride fare (UGX)
            </label>
            <input
              id="ride-minimum-fare"
              inputMode="numeric"
              value={rideMinimumFare}
              onChange={(e) => setRideMinimumFare(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="2500"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
          </div>
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
