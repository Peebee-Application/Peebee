"use client";

import type { CarpoolTrip } from "@peebee/shared";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlaceSearch, type FoundPlace } from "../../components/PlaceSearch";
import { api, errorMessage } from "../../lib/api";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;
const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold";

export default function CarpoolPage() {
  const router = useRouter();
  const [from, setFrom] = useState<FoundPlace | null>(null);
  const [to, setTo] = useState<FoundPlace | null>(null);
  const [date, setDate] = useState("");
  const [trips, setTrips] = useState<CarpoolTrip[] | null>(null);
  const [maxSeats, setMaxSeats] = useState(4);
  const [seats, setSeats] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to) {
      setError("Choose where from and where to.");
      return;
    }
    setBusy("search");
    setError("");
    try {
      const res = await api.carpoolSearch({ fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng, date: date || undefined });
      setTrips(res.trips);
      setMaxSeats(res.maxSeatsPerBooking);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function book(trip: CarpoolTrip) {
    setBusy(trip.id);
    setError("");
    try {
      const { order } = await api.carpoolBook(trip.id, seats[trip.id] ?? 1);
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 px-4 pb-24 pt-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => router.back()} aria-label="Back" className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full text-ink-500">
          <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <h1 className="text-xl font-bold text-ink">Carpool</h1>
      </div>
      <form onSubmit={search} className="home-card space-y-3">
        <PlaceSearch label="From" value={from} onPick={setFrom} />
        <PlaceSearch label="To" value={to} onPick={setTo} />
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Date (optional)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </div>
        <button disabled={busy === "search"} className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60">{busy === "search" ? "Searching…" : "Find trips"}</button>
      </form>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {trips && trips.length === 0 && <p className="text-sm text-ink-500">No trips on that route yet. Try another date or check back later.</p>}
      {trips?.map((t) => {
        const n = Math.min(seats[t.id] ?? 1, t.seatsLeft, maxSeats);
        return (
          <section key={t.id} className="home-card space-y-2">
            <p className="text-sm font-bold text-ink">{t.originLabel} → {t.destLabel}</p>
            <p className="text-xs text-ink-500">
              {new Date(t.departAt).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })} · {t.driverName} · {t.vehicle}
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink"><strong>{ugx(t.seatPrice)}</strong> per seat · {t.seatsLeft} left</p>
              <select value={n} onChange={(e) => setSeats((s) => ({ ...s, [t.id]: Number(e.target.value) }))} aria-label="Seats" className="rounded-xl border border-[var(--border-faint)] px-2 py-2 text-sm">
                {Array.from({ length: Math.min(t.seatsLeft, maxSeats) }, (_, i) => i + 1).map((k) => (
                  <option key={k} value={k}>{k} seat{k === 1 ? "" : "s"}</option>
                ))}
              </select>
            </div>
            <button disabled={busy === t.id} onClick={() => book(t)} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-60">
              {busy === t.id ? "Please wait…" : `Book ${n} seat${n === 1 ? "" : "s"} · ${ugx(t.seatPrice * n)}`}
            </button>
          </section>
        );
      })}
    </div>
  );
}
