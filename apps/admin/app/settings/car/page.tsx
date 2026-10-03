"use client";

import type { CarSettings } from "@tuma/shared";
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
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedMax, setSchedMax] = useState("");
  const [schedLead, setSchedLead] = useState("30");
  const [schedOpen, setSchedOpen] = useState("60");
  const [schedWatch, setSchedWatch] = useState("30");
  const [schedNoSignal, setSchedNoSignal] = useState("10");
  const [schedSpeed, setSchedSpeed] = useState("25");
  const [cpEnabled, setCpEnabled] = useState(false);
  const [cpSeats, setCpSeats] = useState("4");
  const [cpRepeat, setCpRepeat] = useState("0");
  const [cpCutoff, setCpCutoff] = useState("15");
  const [cpPay, setCpPay] = useState("15");
  const [cpRadius, setCpRadius] = useState("10");
  const [sdEnabled, setSdEnabled] = useState(false);
  const [sdPercent, setSdPercent] = useState("");
  const [sdDays, setSdDays] = useState("30");
  const [sdDeposit, setSdDeposit] = useState("0");
  const [sdApprove, setSdApprove] = useState("12");
  const [kycOwner, setKycOwner] = useState(true);
  const [kycDriverId, setKycDriverId] = useState(true);
  const [kycLicence, setKycLicence] = useState(true);
  const [photoMax, setPhotoMax] = useState("8");
  const [photoMin, setPhotoMin] = useState("0");
  const [withdrawals, setWithdrawals] = useState(false);
  const [withdrawMin, setWithdrawMin] = useState("0");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load(c: { enabled: boolean; onDemandEnabled: boolean; matchingMode: typeof mode; shares: { owner: number; driver: number; platform: number }; maxPickupKm: number; withdrawalsEnabled: boolean; withdrawalMinAmount: number; scheduled: CarSettings["scheduled"]; carpool: CarSettings["carpool"]; selfDrive: CarSettings["selfDrive"]; vehiclePhotos: CarSettings["vehiclePhotos"]; kyc: CarSettings["kyc"] }) {
    setEnabled(c.enabled);
    setOnDemand(c.onDemandEnabled);
    setMode(c.matchingMode);
    setOwner(String(c.shares.owner));
    setDriver(String(c.shares.driver));
    setPlatform(String(c.shares.platform));
    setMaxKm(String(c.maxPickupKm));
    setSchedEnabled(c.scheduled.enabled);
    setSchedMax(c.scheduled.maxAdvanceHours ? String(c.scheduled.maxAdvanceHours) : "");
    setSchedLead(String(c.scheduled.minLeadMinutes));
    setSchedOpen(String(c.scheduled.openMinutes));
    setSchedWatch(String(c.scheduled.watchMinutes));
    setSchedNoSignal(String(c.scheduled.noSignalMinutes));
    setSchedSpeed(String(c.scheduled.avgSpeedKmh));
    setCpEnabled(c.carpool.enabled);
    setCpSeats(String(c.carpool.maxSeatsPerBooking));
    setCpRepeat(String(c.carpool.maxRepeatWeeks));
    setCpCutoff(String(c.carpool.cutoffMinutes));
    setCpPay(String(c.carpool.payWithinMinutes));
    setCpRadius(String(c.carpool.matchRadiusKm));
    setSdEnabled(c.selfDrive.enabled);
    setSdPercent(c.selfDrive.platformPercent == null ? "" : String(c.selfDrive.platformPercent));
    setSdDays(String(c.selfDrive.maxDays));
    setSdDeposit(String(c.selfDrive.minDeposit));
    setSdApprove(String(c.selfDrive.approveWithinHours));
    setKycOwner(c.kyc.ownerIdRequired);
    setKycDriverId(c.kyc.driverIdRequired);
    setKycLicence(c.kyc.driverLicenceRequired);
    setPhotoMax(String(c.vehiclePhotos.max));
    setPhotoMin(String(c.vehiclePhotos.minRequired));
    setWithdrawals(c.withdrawalsEnabled);
    setWithdrawMin(String(c.withdrawalMinAmount));
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
          scheduled: {
            enabled: schedEnabled,
            maxAdvanceHours: Number(schedMax) > 0 ? Number(schedMax) : null,
            minLeadMinutes: Number(schedLead) || 0,
            openMinutes: Math.max(5, Number(schedOpen) || 60),
            watchMinutes: Math.max(5, Number(schedWatch) || 30),
            noSignalMinutes: Math.max(1, Number(schedNoSignal) || 10),
            avgSpeedKmh: Math.max(5, Number(schedSpeed) || 25),
          },
          carpool: {
            enabled: cpEnabled,
            maxSeatsPerBooking: Math.max(1, Number(cpSeats) || 4),
            maxRepeatWeeks: Math.max(0, Number(cpRepeat) || 0),
            cutoffMinutes: Math.max(0, Number(cpCutoff) || 0),
            payWithinMinutes: Math.max(5, Number(cpPay) || 15),
            matchRadiusKm: Math.max(1, Number(cpRadius) || 10),
          },
          selfDrive: {
            enabled: sdEnabled,
            platformPercent: sdPercent === "" ? null : Math.min(90, Number(sdPercent)),
            maxDays: Math.max(1, Number(sdDays) || 30),
            minDeposit: Math.max(0, Number(sdDeposit) || 0),
            approveWithinHours: Math.max(1, Number(sdApprove) || 12),
          },
          kyc: { ownerIdRequired: kycOwner, driverIdRequired: kycDriverId, driverLicenceRequired: kycLicence },
          vehiclePhotos: { max: Math.min(20, Math.max(6, Number(photoMax) || 8)), minRequired: Math.max(0, Number(photoMin) || 0) },
          withdrawalsEnabled: withdrawals,
          withdrawalMinAmount: Math.max(0, Number(withdrawMin) || 0),
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

        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input type="checkbox" checked={schedEnabled} disabled={!enabled} onChange={(e) => setSchedEnabled(e.target.checked)} className="h-4 w-4 accent-gold" />
            Customers can schedule a car for later
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["How far ahead (hours) — required", schedMax, setSchedMax],
              ["Shortest notice (minutes)", schedLead, setSchedLead],
              ["Open to drivers before pickup (min)", schedOpen, setSchedOpen],
              ["Watch the driver within (min)", schedWatch, setSchedWatch],
              ["No location for (min) = no signal", schedNoSignal, setSchedNoSignal],
              ["Average speed (km/h)", schedSpeed, setSchedSpeed],
            ].map(([label, value, set]) => (
              <div key={label as string} className="space-y-1">
                <label className="text-xs font-semibold text-ink-500">{label as string}</label>
                <input inputMode="numeric" value={value as string} disabled={!schedEnabled} onChange={(e) => (set as (v: string) => void)(digits(e.target.value))} className={`${input} disabled:opacity-50`} />
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            Scheduling stays off until &ldquo;how far ahead&rdquo; is set. A scheduled ride is only shown to drivers shortly before pickup (the customer pays after choosing a driver), so no driver is tied up for days. Within the watch time, the driver&apos;s distance to the pickup is checked every couple of minutes and the customer is warned once if they look late or can&apos;t be located. Needs migration 0067.
          </p>
        </section>

        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input type="checkbox" checked={cpEnabled} disabled={!enabled} onChange={(e) => setCpEnabled(e.target.checked)} className="h-4 w-4 accent-gold" />
            Carpool: drivers publish trips, passengers book seats
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Most seats per booking", cpSeats, setCpSeats],
              ["Repeat a trip weekly for (weeks, 0 = never)", cpRepeat, setCpRepeat],
              ["Stop booking before departure (min)", cpCutoff, setCpCutoff],
              ["Release unpaid seats after (min)", cpPay, setCpPay],
              ["Match start/end within (km)", cpRadius, setCpRadius],
            ].map(([label, value, set]) => (
              <div key={label as string} className="space-y-1">
                <label className="text-xs font-semibold text-ink-500">{label as string}</label>
                <input inputMode="numeric" value={value as string} disabled={!cpEnabled} onChange={(e) => (set as (v: string) => void)(digits(e.target.value))} className={`${input} disabled:opacity-50`} />
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            The seat price is set by the driver. Each booked seat is its own paid ride, split between owner, driver and Tuma like any car ride. No-show and late-cancel fees are not enabled yet. Needs migration 0068.
          </p>
        </section>

        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input type="checkbox" checked={sdEnabled} disabled={!enabled} onChange={(e) => setSdEnabled(e.target.checked)} className="h-4 w-4 accent-gold" />
            Self-drive hire: owners rent vehicles out by the day
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Tuma's share of the rent (%) — required", sdPercent, setSdPercent],
              ["Longest rental (days)", sdDays, setSdDays],
              ["Lowest deposit (UGX)", sdDeposit, setSdDeposit],
              ["Owner must answer within (hours)", sdApprove, setSdApprove],
            ].map(([label, value, set]) => (
              <div key={label as string} className="space-y-1">
                <label className="text-xs font-semibold text-ink-500">{label as string}</label>
                <input inputMode="numeric" value={value as string} disabled={!sdEnabled} onChange={(e) => (set as (v: string) => void)(digits(e.target.value))} className={`${input} disabled:opacity-50`} />
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            Stays off until Tuma&apos;s share is set. The renter&apos;s rent and deposit are held from their wallet; the deposit comes back unless the owner claims damage, which you rule on under Car fleet → Rentals. Late-return fees and inspection photos are not enabled yet. Have the hire terms and insurance position reviewed before using this with real money. Needs migration 0069.
          </p>
        </section>

        <section className="home-card space-y-3">
          <p className="text-sm font-bold text-ink">Documents needed before approval</p>
          {[
            ["Owners: national ID", kycOwner, setKycOwner],
            ["Drivers: national ID", kycDriverId, setKycDriverId],
            ["Drivers: driving licence", kycLicence, setKycLicence],
          ].map(([label, value, set]) => (
            <label key={label as string} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={value as boolean} onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} className="h-4 w-4 accent-gold" />
              {label as string}
            </label>
          ))}
          <p className="text-xs text-ink-500">People upload a photo from the Tuma Car app. You can&apos;t approve an owner or driver whose required documents are missing. Needs migration 0072.</p>
        </section>

        <section className="home-card space-y-3">
          <p className="text-sm font-bold text-ink">Vehicle photos</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Most photos per vehicle (6–20)", photoMax, setPhotoMax],
              ["Photos needed before approval (0 = none)", photoMin, setPhotoMin],
            ].map(([label, value, set]) => (
              <div key={label as string} className="space-y-1">
                <label className="text-xs font-semibold text-ink-500">{label as string}</label>
                <input inputMode="numeric" value={value as string} onChange={(e) => (set as (v: string) => void)(digits(e.target.value))} className={input} />
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-500">Owners add photos when they submit a vehicle. You can&apos;t approve a vehicle that has fewer photos than the number needed. Needs migration 0070.</p>
        </section>

        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <input type="checkbox" checked={withdrawals} onChange={(e) => setWithdrawals(e.target.checked)} className="h-4 w-4 accent-gold" />
            Owners and drivers can cash out to mobile money
          </label>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="car-wd-min">Smallest withdrawal (UGX, 0 = no minimum)</label>
            <input id="car-wd-min" inputMode="numeric" value={withdrawMin} disabled={!withdrawals} onChange={(e) => setWithdrawMin(digits(e.target.value))} className={`${input} disabled:opacity-50`} />
          </div>
          <p className="text-xs text-ink-500">
            People can only cash out what they earned from car rides, never money they topped up themselves. Needs the withdrawals table (migration 0066).
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
