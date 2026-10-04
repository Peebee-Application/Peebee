"use client";

import type { Rental, RentalVehicle } from "@peebee/shared";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;
const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold";
const when = (iso: string) => new Date(iso).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });

export default function RentPage() {
  const router = useRouter();
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [licence, setLicence] = useState("");
  const [expiry, setExpiry] = useState("");
  const [vehicles, setVehicles] = useState<RentalVehicle[] | null>(null);
  const [days, setDays] = useState(0);
  const [mine, setMine] = useState<Rental[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadMine = useCallback(() => {
    api.myRentals().then((r) => setMine(r.rentals)).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadMine();
    const timer = window.setInterval(loadMine, 10000);
    return () => window.clearInterval(timer);
  }, [loadMine]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    setError("");
    setNotice("");
    try {
      const res = await api.rentalSearch(new Date(startsAt).toISOString(), new Date(endsAt).toISOString());
      setVehicles(res.vehicles);
      setDays(res.days);
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
      await api.rentalRequest({ vehicleId: v.id, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), licenceNumber: licence, licenceExpiry: expiry });
      setNotice("Request sent. The rent and deposit are held from your wallet until the owner answers.");
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
          <label className="text-xs font-semibold text-ink-500">Return</label>
          <input required type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} />
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
          <p className="text-xs text-ink-500">{v.category}{v.seats ? ` · ${v.seats} seats` : ""}{v.notes ? ` · ${v.notes}` : ""}</p>
          <p className="text-sm text-ink">{ugx(v.dailyPrice)} per day · {days} day{days === 1 ? "" : "s"} = <strong>{ugx(v.rent)}</strong></p>
          <p className="text-xs text-ink-500">Plus a refundable deposit of {ugx(v.deposit)}. Both are taken from your wallet and held; the deposit comes back when the car is returned undamaged.</p>
          <button disabled={busy === v.id} onClick={() => request(v)} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-60">{busy === v.id ? "Please wait…" : `Request · ${ugx(v.rent + v.deposit)} held`}</button>
        </section>
      ))}

      {mine.length > 0 && <h2 className="pt-2 text-lg font-bold text-ink">My rentals</h2>}
      {mine.map((r) => (
        <section key={r.id} className="home-card space-y-1">
          <p className="text-sm font-bold text-ink">{r.vehicle ?? r.plate} <span className="font-normal text-ink-500">· {r.status}</span></p>
          <p className="text-xs text-ink-500">{when(r.starts_at)} → {when(r.ends_at)} · owner {r.owner_name}</p>
          <p className="text-xs text-ink-500">Rent {ugx(r.rent_amount)} · deposit {ugx(r.deposit_amount)}</p>
          {r.status === "completed" && r.refund_amount != null && <p className="text-xs font-semibold text-ink">Deposit returned: {ugx(r.refund_amount)}</p>}
          {r.status === "disputed" && <p className="text-xs text-ink-500">The owner reported damage. Peebee is reviewing it before your deposit is settled.</p>}
          {(r.status === "requested" || r.status === "approved") && (
            <button type="button" onClick={() => cancel(r.id)} className="text-sm font-bold text-gold">Cancel and get my money back</button>
          )}
        </section>
      ))}
    </div>
  );
}
