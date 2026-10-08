"use client";

import type { Rental, RentalVehicle } from "@peebee/shared";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;
const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold";
const when = (iso: string) => new Date(iso).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });
const rentalQuote = (v: RentalVehicle, period: "hourly" | "half_day" | "full_day", hours: number) => period === "hourly" ? (v.hourlyPrice ?? Math.round(v.dailyPrice * 1.2 / 24)) * hours : period === "half_day" ? v.halfDayPrice ?? Math.round(v.dailyPrice * 0.6) : v.dailyPrice;

export default function RentPage() {
  const router = useRouter();
  const [startsAt, setStartsAt] = useState("");
  const [licence, setLicence] = useState("");
  const [expiry, setExpiry] = useState("");
  const [vehicles, setVehicles] = useState<RentalVehicle[] | null>(null);
  const [periodType, setPeriodType] = useState<"hourly" | "half_day" | "full_day">("full_day");
  const [hourCount, setHourCount] = useState(1);
  const [mine, setMine] = useState<Rental[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const rentalEnd = () => {
    const start = new Date(startsAt);
    return new Date(start.getTime() + (periodType === "hourly" ? hourCount : periodType === "half_day" ? 6 : 24) * 3_600_000);
  };

  const loadMine = useCallback(() => {
    api.myRentals().then((r) => setMine(r.rentals)).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadMine();
    const timer = window.setInterval(loadMine, 10000);
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { window.clearInterval(timer); window.clearInterval(clock); };
  }, [loadMine]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    setError("");
    setNotice("");
    try {
      const end = rentalEnd();
      const res = await api.rentalSearch(new Date(startsAt).toISOString(), end.toISOString());
      setVehicles(res.vehicles);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function request(v: RentalVehicle) {
    setBusy(v.id);
    setError("");
    try {
      const end = rentalEnd();
      const created = await api.rentalRequest({ vehicleId: v.id, startsAt: new Date(startsAt).toISOString(), endsAt: end.toISOString(), licenceNumber: licence, licenceExpiry: expiry, periodType });
      setNotice(created.status === "active" ? "Rental confirmed. The demo owner has handed over the car and the rental clock is running." : "Rental request sent. Rent and deposit are held from your wallet until the owner responds.");
      setVehicles(null);
      loadMine();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    setError("");
    try {
      await api.cancelRental(id);
      loadMine();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function finishDemo(id: string) {
    setError("");
    try { await api.finishDemoRental(id); setNotice("Demo car returned. Rental settlement and deposit return are complete."); loadMine(); }
    catch (err) { setError(errorMessage(err)); }
  }

  return (
    <div className="space-y-4 px-4 pb-24 pt-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => router.back()} aria-label="Back" className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full text-ink-500">
          <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <h1 className="text-xl font-bold text-ink">Rent a car</h1>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm font-medium text-green">{notice}</p>}

      <form onSubmit={search} className="home-card space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Pickup</label>
          <input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Rental period</label>
          <select value={periodType} onChange={(e) => setPeriodType(e.target.value as typeof periodType)} className={field}>
            <option value="hourly">Hourly</option><option value="half_day">Half-day · 6 hours</option><option value="full_day">Full day · 24 hours</option>
          </select>
          {periodType === "hourly" && <input aria-label="Number of rental hours" type="number" min={1} max={24} value={hourCount} onChange={(e) => setHourCount(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} className={field} />}
          <p className="text-xs text-ink-500">Scheduled return: {startsAt ? when(rentalEnd().toISOString()) : "Choose a pickup time"}. Time starts when the owner hands over the car.</p>
        </div>
        <input required value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="Driving licence number" className={field} />
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Licence expiry</label>
          <input required type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={field} />
        </div>
        <button disabled={busy === "search"} className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60">{busy === "search" ? "Searching…" : "Find cars"}</button>
      </form>

      {vehicles && vehicles.length === 0 && <p className="text-sm text-ink-500">No cars are free for those dates.</p>}
      {vehicles?.map((v) => (
        <section key={v.id} className="home-card space-y-2">
          <p className="text-sm font-bold text-ink">{v.name}</p>
          <p className="text-xs text-ink-500">{v.category}{v.seats ? ` · ${v.seats} seats` : ""} · Owner: {v.ownerName ?? "Vehicle owner"}{v.notes ? ` · ${v.notes}` : ""}</p>
          <div className="grid grid-cols-3 gap-2 text-xs text-ink-500"><span className={v.hourlyEnabled === false ? "opacity-40" : ""}>Hourly<br/><strong className="text-ink">{ugx(v.hourlyPrice ?? Math.round(v.dailyPrice * 1.2 / 24))}/hr</strong></span><span className={v.halfDayEnabled === false ? "opacity-40" : ""}>6 hours<br/><strong className="text-ink">{ugx(v.halfDayPrice ?? Math.round(v.dailyPrice * 0.6))}</strong></span><span className={v.fullDayEnabled === false ? "opacity-40" : ""}>24 hours<br/><strong className="text-ink">{ugx(v.dailyPrice)}</strong></span></div>
          <p className="text-sm text-ink">Selected {periodType.replace("_", " ")} = <strong>{ugx(rentalQuote(v, periodType, hourCount))}</strong></p>
          <p className="text-xs text-ink-500">Plus a refundable deposit of {ugx(v.deposit)}. Both are taken from your wallet and held; the deposit comes back when the car is returned undamaged.</p>
          <button disabled={busy === v.id || (periodType === "hourly" && v.hourlyEnabled === false) || (periodType === "half_day" && v.halfDayEnabled === false) || (periodType === "full_day" && v.fullDayEnabled === false)} onClick={() => request(v)} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-60">{busy === v.id ? "Please wait…" : `Request · ${ugx(rentalQuote(v, periodType, hourCount) + v.deposit)} held`}</button>
        </section>
      ))}

      {mine.length > 0 && <h2 className="pt-2 text-lg font-bold text-ink">My rentals</h2>}
      {mine.map((r) => (
        <section key={r.id} className="home-card space-y-1">
          <p className="text-sm font-bold text-ink">{r.vehicle ?? r.plate} <span className="font-normal text-ink-500">· {r.status}</span></p>
          <p className="text-xs text-ink-500">{when(r.starts_at)} → {when(r.ends_at)} · owner {r.owner_name} · {r.period_type?.replace("_", " ") ?? "full day"}</p>
          {r.handed_over_at && r.status === "active" && <p className="text-xs font-semibold text-ink">Timer: {Math.max(0, Math.floor((now - new Date(r.handed_over_at).getTime()) / 3_600_000))} hours elapsed since handover at {when(r.handed_over_at)}. Due {when(r.ends_at)}; the configured grace period applies{r.hourly_price ? `, then ${ugx(r.hourly_price)} per started hour.` : "."}</p>}
          {r.status === "active" && (r.vehicle_id.startsWith("demo-rent-") || r.vehicle_id.startsWith("practice-rent-")) && <button type="button" onClick={() => finishDemo(r.id)} className="min-h-10 w-full rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">Return demo car and settle rental</button>}
          <p className="text-xs text-ink-500">Rent {ugx(r.rent_amount)} · deposit {ugx(r.deposit_amount)}</p>
          {r.status === "completed" && r.refund_amount != null && <p className="text-xs font-semibold text-ink">Deposit returned: {ugx(r.refund_amount)}</p>}
          {r.status === "completed" && Number(r.overtime_amount ?? 0) > 0 && <p className="text-xs text-ink-500">Overtime fee settled: {ugx(Number(r.overtime_amount))}</p>}
          {r.status === "disputed" && <p className="text-xs text-ink-500">The owner reported damage. Peebee is reviewing it before your deposit is settled.</p>}
          {(r.status === "requested" || r.status === "approved") && (
            <button type="button" onClick={() => cancel(r.id)} className="text-sm font-bold text-gold">Cancel and get my money back</button>
          )}
        </section>
      ))}
    </div>
  );
}
