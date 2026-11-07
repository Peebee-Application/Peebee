"use client";

import { ModuleState } from "../../../components/ModuleState";
import { Switch } from "../../../components/ui/Switch";
import { Select } from "../../../components/ui/Select";

import { MATCHING_MODE_DESCRIPTIONS, MATCHING_MODE_LABELS, type JobExpiryUnit, type MatchingMode } from "@peebee/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const ALL_MODES: MatchingMode[] = ["first_to_claim", "nearest_window", "customer_selects"];

export default function RiderMatchingPage() {
  const [serviceRangeKm, setServiceRangeKm] = useState("");
  const [visibilityRangeKm, setVisibilityRangeKm] = useState("");
  const [enabledModes, setEnabledModes] = useState<MatchingMode[]>(["first_to_claim"]);
  const [nearestWindowSeconds, setNearestWindowSeconds] = useState("");
  const [maxAssignmentMinutes, setMaxAssignmentMinutes] = useState("");
  const [autoAssign, setAutoAssign] = useState(false);
  const [unpaidRelease, setUnpaidRelease] = useState("15");
  const [stuckFunding, setStuckFunding] = useState("30");
  const [oneActiveRide, setOneActiveRide] = useState(true);
  const [payFirst, setPayFirst] = useState(false);
  const [closeUnpaid, setCloseUnpaid] = useState("3");
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
        setVisibilityRangeKm(String(settings.riderVisibilityRangeKm ?? 20));
        setEnabledModes(settings.enabledModes);
        setNearestWindowSeconds(String(settings.nearestWindowSeconds));
        setMaxAssignmentMinutes(String(settings.maxAssignmentMinutes));
        setAutoAssign(settings.autoAssignWithoutAcceptance ?? false);
        setUnpaidRelease(String(settings.unpaidMatchReleaseMinutes ?? 15));
        setStuckFunding(String(settings.stuckFundingReleaseMinutes ?? 30));
        setOneActiveRide(settings.oneActiveRideEnabled ?? true);
        setPayFirst(settings.ridePayFirstEnabled ?? false);
        setCloseUnpaid(String(settings.riderCloseUnpaidMinutes ?? 3));
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
        riderVisibilityRangeKm: Math.max(0, Number(visibilityRangeKm) || 0),
        enabledModes: enabledModes.length > 0 ? enabledModes : ["first_to_claim"],
        nearestWindowSeconds: Number(nearestWindowSeconds),
        maxAssignmentMinutes: Number(maxAssignmentMinutes),
        autoAssignWithoutAcceptance: autoAssign,
        unpaidMatchReleaseMinutes: Math.min(1440, Math.max(0, Number(unpaidRelease) || 0)),
        stuckFundingReleaseMinutes: Math.min(1440, Math.max(0, Number(stuckFunding) || 0)),
        oneActiveRideEnabled: oneActiveRide,
        ridePayFirstEnabled: payFirst,
        riderCloseUnpaidMinutes: Math.min(120, Math.max(0, Number(closeUnpaid) || 0)),
        bidding: {
          enabled: biddingEnabled,
          minPercent: Math.min(100, Math.max(1, Number(biddingMin) || 50)),
          maxPercent: Math.min(500, Math.max(100, Number(biddingMax) || 150)),
        },
        jobExpiry: { enabled: expiryEnabled, value: Math.max(1, Number(expiryValue) || 1), unit: expiryUnit },
      });
      setServiceRangeKm(String(res.settings.serviceRangeKm));
      setVisibilityRangeKm(String(res.settings.riderVisibilityRangeKm ?? 20));
      setEnabledModes(res.settings.enabledModes);
      setNearestWindowSeconds(String(res.settings.nearestWindowSeconds));
      setMaxAssignmentMinutes(String(res.settings.maxAssignmentMinutes));
      setAutoAssign(res.settings.autoAssignWithoutAcceptance ?? false);
      setUnpaidRelease(String(res.settings.unpaidMatchReleaseMinutes ?? 15));
      setStuckFunding(String(res.settings.stuckFundingReleaseMinutes ?? 30));
      setOneActiveRide(res.settings.oneActiveRideEnabled ?? true);
      setPayFirst(res.settings.ridePayFirstEnabled ?? false);
      setCloseUnpaid(String(res.settings.riderCloseUnpaidMinutes ?? 3));
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

          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <label className="text-xs font-semibold text-ink-500" htmlFor="visibility-range">
              Rider visibility range (km)
            </label>
            <input
              id="visibility-range"
              inputMode="numeric"
              value={visibilityRangeKm}
              onChange={(e) => setVisibilityRangeKm(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="20"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              Riders can&apos;t see or take orders farther than this from their stage. 0 means no limit. You can set a
              different range for one rider on their profile.
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
                  className="pb-check"
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
              &ldquo;Nearest available&rdquo; collects applicants for this long before choosing the closest one who
              applied. &ldquo;Max assignment&rdquo; is the overall safety net — past this, if the switch below is on,
              an order is assigned to the nearest online rider even if nobody applied.
            </p>
          </div>

          <div className="space-y-2 border-t border-[var(--border-faint)] pt-3">
            <label className="flex items-center gap-2 text-sm font-bold text-ink">
              <Switch checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
              Assign a rider who hasn&apos;t accepted
            </label>
            <p className="text-xs text-ink-500">
              Off (recommended): a live order stays unassigned until a rider accepts it, or applies and the customer
              chooses them. The customer only ever sees the name of a rider who said yes, and nobody is given a job
              they didn&apos;t take. On: if nobody has accepted, the nearest online rider is assigned automatically.
              Demo orders in the sandbox always assign automatically.
            </p>
          </div>

          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <label className="text-xs font-semibold text-ink-500" htmlFor="unpaid-release">
              Release a rider if the customer hasn&apos;t paid (min)
            </label>
            <input
              id="unpaid-release"
              inputMode="numeric"
              value={unpaidRelease}
              onChange={(e) => setUnpaidRelease(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="15"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              After a rider is matched, the customer has this long to pay. If they don&apos;t, the rider is freed to take other
              jobs and the order goes back to riders. A payment in progress is never interrupted, nothing is charged, and the
              rider isn&apos;t penalised. 0 turns this off. Applies to ordinary orders, not car rides or relayed parcels.
            </p>
          </div>

          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <label className="text-xs font-semibold text-ink-500" htmlFor="stuck-funding">
              Unlock an order stuck at Funding after (min)
            </label>
            <input
              id="stuck-funding"
              inputMode="numeric"
              value={stuckFunding}
              onChange={(e) => setStuckFunding(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="30"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              If a payment never settles, the customer and the rider are both locked on that order. After this long the payment is
              checked one last time and given up on; the order then goes back to unpaid (the customer can pay again, and the unpaid
              release above frees the rider). A payment that did go through moves the order on instead. Nothing extra is charged and
              nobody is penalised. 0 turns this off. Not applied to combined deliveries.
            </p>
          </div>

          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <label className="flex items-center gap-2 text-sm font-bold text-ink">
              <input type="checkbox" checked={payFirst} onChange={(e) => setPayFirst(e.target.checked)} />
              Pay before a rider is found (first come, first served rides)
            </label>
            <p className="text-xs text-ink-500">
              On: the customer goes straight to payment, the money is held safely, and the first rider to take the ride heads to them.
              If nobody takes it, or the customer cancels, it is refunded in full. Off: the customer pays after a rider is matched.
              Rides where the customer picks a rider always pay after picking. Keep Turn on &ldquo;Expire jobs nobody takes&rdquo; so anldquo;Expire jobs nobody servesTurn on &ldquo;Expire jobs nobody takes&rdquo; so anrdquo; on so an
              untaken ride is refunded by itself.
            </p>
          </div>

          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <label className="flex items-center gap-2 text-sm font-bold text-ink">
              <input type="checkbox" checked={oneActiveRide} onChange={(e) => setOneActiveRide(e.target.checked)} />
              One active ride per customer
            </label>
            <p className="text-xs text-ink-500">
              While a ride booked for the customer themself is still active, they can&apos;t request another (the rider is already on
              the way to them). They must cancel it first. A ride booked for someone else doesn&apos;t count.
            </p>
          </div>

          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <label className="text-xs font-semibold text-ink-500" htmlFor="close-unpaid">
              Rider may close an unpaid ride after (min)
            </label>
            <input
              id="close-unpaid"
              inputMode="numeric"
              value={closeUnpaid}
              onChange={(e) => setCloseUnpaid(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="3"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <p className="text-xs text-ink-500">
              A rider waiting for a customer who hasn&apos;t paid can close the ride after this long. The order is cancelled, nothing
              is charged, and the customer is told. 0 lets the rider close it straight away.
            </p>
          </div>
        </section>
        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <ModuleState on={biddingEnabled} />
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
              Bidding only works when the &ldquo;Approve&rdquo; matching mode is also enabled above (several
              applications per job) — right now it isn&apos;t, so no bids will be accepted.
            </p>
          )}
        </section>
        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <Switch
              checked={expiryEnabled}
              onChange={(e) => setExpiryEnabled(e.target.checked)}
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
              <Select
                id="expiry-unit"
                value={expiryUnit}
                disabled={!expiryEnabled}
                onValueChange={(value) => setExpiryUnit(value as JobExpiryUnit)}
                className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-[15px] outline-none focus:border-gold disabled:opacity-50"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </Select>
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
