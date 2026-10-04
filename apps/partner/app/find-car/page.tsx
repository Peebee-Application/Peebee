"use client";

import type { DriverCar, DriverDeals } from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { AuthImage } from "../../components/AuthImage";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { describeTerms } from "../../lib/terms";

export default function FindCarPage() {
  const { me } = useAuth();
  const [cars, setCars] = useState<DriverCar[] | null>(null);
  const [mine, setMine] = useState<DriverDeals | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([api.dealsCars(), api.dealsMy()])
      .then(([c, m]) => { setCars(c.cars); setMine(m); setUnavailable(false); })
      .catch(() => setUnavailable(true));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (me?.driverStatus !== "approved") return <p className="px-4 py-5 text-sm text-ink-500">Become an approved driver first (Home), then you can ask owners for a car.</p>;
  if (unavailable) return <p className="px-4 py-5 text-sm text-ink-500">Applying to owners&apos; cars isn&apos;t available right now.</p>;
  const pending = (mine?.requests ?? []).filter((r) => r.status === "pending");
  return (
    <div className="space-y-5 px-4 py-5">
      <h1 className="text-2xl font-black text-ink">Find a car to drive</h1>
      <p className="text-sm text-ink-500">Owners set the fee: a share of each ride, or a fixed rent. Apply, and when the owner accepts the car is yours to drive while you work on Peebee.</p>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {pending.length > 0 && (
        <section className="home-card space-y-3">
          <h2 className="font-bold">Waiting for an answer</h2>
          {pending.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-3 first:border-t-0 first:pt-0">
              <span className="min-w-0 text-sm"><span className="block truncate font-semibold">{r.car}</span><span className="text-xs text-ink-500">{r.ownerName}</span></span>
              <button type="button" disabled={busy === r.id} onClick={() => act(r.id, () => api.dealsWithdraw(r.id))} className="text-xs font-bold text-red-600">Withdraw</button>
            </div>
          ))}
        </section>
      )}

      {cars && cars.length === 0 && <p className="text-sm text-ink-500">No cars are open to drivers right now. Check back soon.</p>}
      {cars?.map((car) => (
        <section key={car.id} className="home-card space-y-2">
          {car.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {car.photos.slice(0, 3).map((photoId) => <AuthImage key={photoId} vehicleId={car.id} photoId={photoId} className="block aspect-[4/3] w-full rounded-lg object-cover" />)}
            </div>
          )}
          <p className="font-bold text-ink">{car.name}</p>
          <p className="text-xs text-ink-500">{car.category}{car.seats ? ` · ${car.seats} seats` : ""} · owner {car.ownerName}</p>
          <p className="text-sm text-ink">{describeTerms(car.terms)}</p>
          {car.notes && <p className="text-xs text-ink-500">{car.notes}</p>}
          <button
            type="button"
            disabled={busy === car.id || car.applied}
            onClick={() => act(car.id, () => api.dealsApply(car.id))}
            className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50"
          >
            {car.applied ? "Applied — waiting for the owner" : busy === car.id ? "Please wait…" : "Apply to drive this car"}
          </button>
        </section>
      ))}
    </div>
  );
}
