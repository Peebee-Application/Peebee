"use client";

import { MATCHING_MODE_DESCRIPTIONS, MATCHING_MODE_LABELS, type JobExpiryUnit, type MatchingMode } from "@peebee/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const ALL_MODES: MatchingMode[] = ["first_to_claim", "nearest_window", "customer_selects"];

export default function RiderMatchingPage() {
  const [serviceRangeKm, setServiceRangeKm] = useState("");
  const [enabledModes, setEnabledModes] = useState<MatchingMode[]>(["first_to_claim"]);
  const [nearestWindowSeconds, setNearestWindowSeconds] = useState("");
  const [maxAssignmentMinutes, setMaxAssignmentMinutes] = useState("");
  const [biddingEnabled, setBiddingEnabled] = useState(false);
  const [biddingMin, setBiddingMin] = useState("50");
  const [biddingMax, setBiddingMax] = useState("150");
  const [expiryEnabled, setExpiryEnabled] = useState(true);
  const [expiryValue, setExpiryValue] = useState("6");
  const [expiryUnit, setExpiryUnit] = useState<JobExpiryUnit>("hours");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setServiceRangeKm(String(settings.serviceRangeKm));
        setEnabledModes(settings.enabledModes);
        setNearestWindowSeconds(String(settings.nearestWindowSeconds));
        setMaxAssignmentMinutes(String(settings.maxAssignmentMinutes));
        setBiddingEnabled(settings.bidding.enabled);
        setBiddingMin(String(settings.bidding.minPercent));
        setBiddingMax(String(settings.bidding.maxPercent));
        setExpiryEnabled(settings.jobExpiry.enabled);
        setExpiryValue(String(settings.jobExpiry.value));
        setExpiryUnit(settings.jobExpiry.unit);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  function toggleMode(mode: MatchingMode) {
    setEnabledModes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateSettings({
        serviceRangeKm: Number(serviceRangeKm),
        enabledModes: enabledModes.length > 0 ? enabledModes : ["first_to_claim"],
        nearestWindowSeconds: Number(nearestWindowSeconds),
        maxAssignmentMinutes: Number(maxAssignmentMinutes),
        bidding: {
          enabled: biddingEnabled,
          minPercent: Math.min(100, Math.max(1, Number(biddingMin) || 50)),
          maxPercent: Math.min(500, Math.max(100, Number(biddingMax) || 150)),
        },
        jobExpiry: { enabled: expiryEnabled, value: Math.max(1, Number(expiryValue) || 1), unit: expiryUnit },
      });
      setServiceRangeKm(String(res.settings.serviceRangeKm));
      setEnabledModes(res.settings.enabledModes);
      setNearestWindowSeconds(String(res.settings.nearestWindowSeconds));
      setMaxAssignmentMinutes(String(res.settings.maxAssignmentMinutes));
      setBiddingEnabled(res.settings.bidding.enabled);
      setBiddingMin(String(res.settings.bidding.minPercent));
      setBiddingMax(String(res.settings.bidding.maxPercent));
      setExpiryEnabled(res.settings.jobExpiry.enabled);
      setExpiryValue(String(res.settings.jobExpiry.value));
      setExpiryUnit(res.settings.jobExpiry.unit);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPageShell title="Rider matching" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="range">
              Normal service range (km)
            </label>
            <input
              id="range"
              inputMode="numeric"
              value={serviceRangeKm}
              onChange={(e) => setServiceRangeKm(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="7"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              We always match the nearest available rider, even beyond this range if nobody closer is online — the
              customer just gets a heads-up that the rider is out of range and the ride may cost a bit more.
            </p>
          </div>

          <div className="space-y-2 border-t border-[var(--border-faint)] pt-3">
            <p className="text-xs font-semibold text-ink-500">Matching modes on offer</p>
            {ALL_MODES.map((mode) => (
              <label key={mode} className="flex items-start gap-2.5 rounded-xl border border-[var(--border-faint)] p-2.5">
                <input
                  type="checkbox"
                  checked={enabledModes.includes(mode)}
                  onChange={() => toggleMode(mode)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">{MATCHING_MODE_LABELS[mode]}</span>
                  <span className="block text-xs text-ink-500">{MATCHING_MODE_DESCRIPTIONS[mode]}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-ink-500">
              When more than one is enabled, each customer picks their own default in their account settings. With
              just one enabled, every order uses it — no choice shown.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[var(--border-faint)] pt-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="window">
                Nearest-window (sec)
              </label>
              <input
                id="window"
                inputMode="numeric"
                value={nearestWindowSeconds}
                onChange={(e) => setNearestWindowSeconds(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="90"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="ceiling">
                Max assignment (min)
              </label>
              <input
                id="ceiling"
                inputMode="numeric"
                value={maxAssignmentMinutes}
                onChange={(e) => setMaxAssignmentMinutes(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="5"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
            <p className="col-span-2 text-xs text-ink-500">
              &ldquo;Nearest available&rdquo; collects applicants for this long before auto-assigning the closest
              one. &ldquo;Max assignment&rdquo; is the overall safety net — past this, an order gets auto-assigned
              no matter the mode, so nobody waits forever.
            </p>
          </div>
        </section>
        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input
              type="checkbox"
              checked={biddingEnabled}
              onChange={(e) => setBiddingEnabled(e.target.checked)}
              className="h-4 w-4 accent-gold"
            />
            Let riders and drivers bid on rides and parcels
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="bid-min">
                Lowest bid (% of app price)
              </label>
              <input
                id="bid-min"
                inputMode="numeric"
                value={biddingMin}
                disabled={!biddingEnabled}
                onChange={(e) => setBiddingMin(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="50"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="bid-max">
                Highest bid (% of app price)
              </label>
              <input
                id="bid-max"
                inputMode="numeric"
                value={biddingMax}
                disabled={!biddingEnabled}
                onChange={(e) => setBiddingMax(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="150"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold disabled:opacity-50"
              />
            </div>
          </div>
          <p className="text-xs text-ink-500">
            Applicants can name their own price for a ride or parcel (boda and car); the customer sees every bid next to
            the app&apos;s price and picks one. The price they pick becomes the price for that job. Bids must stay between
            the two limits above (1–100% and 100–500%). Shopping and food orders never bid.
          </p>
          {biddingEnabled && !enabledModes.includes("customer_selects") && (
            <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-ink">
              Bidding only works when the &ldquo;Let me choose&rdquo; matching mode is also enabled above (several
              applications per job) — right now it isn&apos;t, so no bids will be accepted.
            </p>
          )}
        </section>
        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input
              type="checkbox"
              checked={expiryEnabled}
              onChange={(e) => setExpiryEnabled(e.target.checked)}
              className="h-4 w-4 accent-gold"
            />
            Expire jobs nobody serves
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="expiry-value">
                Expire after
              </label>
              <input
                id="expiry-value"
                inputMode="numeric"
                value={expiryValue}
                disabled={!expiryEnabled}
                onChange={(e) => setExpiryValue(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="12"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="expiry-unit">
                Unit
              </label>
              <select
                id="expiry-unit"
                value={expiryUnit}
                disabled={!expiryEnabled}
                onChange={(e) => setExpiryUnit(e.target.value as JobExpiryUnit)}
                className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-[15px] outline-none focus:border-gold disabled:opacity-50"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-500">
            A job no rider has taken within this time expires automatically, with no fee: anything the customer paid
            goes back to their wallet and the order returns to their drafts so they can resend it. Jobs a rider has
            already accepted are never expired. Checked every couple of minutes. Minimum 5 minutes, maximum 7 days.
          </p>
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
