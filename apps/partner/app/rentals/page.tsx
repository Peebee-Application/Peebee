"use client";

import type { OwnerRentalVehicle, Rental } from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;
const field = "min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3";
const when = (iso: string) => new Date(iso).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });

export default function RentalsPage() {
  const { me, mode } = useAuth();
  const [vehicles, setVehicles] = useState<OwnerRentalVehicle[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [draft, setDraft] = useState<Record<string, { price: string; deposit: string }>>({});
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.ownerRentals().then((r) => { setVehicles(r.vehicles); setRentals(r.rentals); setUnavailable(false); }).catch(() => setUnavailable(true));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (mode !== "owner") return <p className="px-4 py-5 text-sm text-ink-500">Switch to Owner (top right) to manage rentals.</p>;
  if (me?.ownerStatus !== "approved") return <p className="px-4 py-5 text-sm text-ink-500">Become an approved owner first (Home).</p>;
  if (unavailable) return <p className="px-4 py-5 text-sm text-ink-500">Self-drive hire isn&apos;t available right now.</p>;

  return (
    <div className="space-y-5 px-4 py-5">
      <h1 className="text-2xl font-black text-ink">Self-drive rentals</h1>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {vehicles.length === 0 && <p className="text-sm text-ink-500">Once a vehicle is approved you can offer it for hire here.</p>}
      {vehicles.map((v) => {
        const d = draft[v.id] ?? { price: v.daily_price ? String(v.daily_price) : "", deposit: v.deposit_amount != null ? String(v.deposit_amount) : "" };
        const set = (patch: Partial<typeof d>) => setDraft((x) => ({ ...x, [v.id]: { ...d, ...patch } }));
        return (
          <section key={v.id} className="home-card space-y-3">
            <p className="font-bold text-ink">{v.plate} <span className="font-normal text-ink-500">· {[v.make, v.model].filter(Boolean).join(" ")}</span></p>
            <p className="text-xs text-ink-500">{v.daily_price ? (v.active ? `Listed at ${ugx(v.daily_price)}/day` : "Listing paused") : "Not listed for hire"}</p>
            <div className="grid grid-cols-2 gap-3">
              <input inputMode="numeric" value={d.price} onChange={(e) => set({ price: e.target.value.replace(/\D/g, "") })} placeholder="Price per day (UGX)" className={field} />
              <input inputMode="numeric" value={d.deposit} onChange={(e) => set({ deposit: e.target.value.replace(/\D/g, "") })} placeholder="Deposit (UGX)" className={field} />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!d.price}
                onClick={() => act(() => api.saveRentalListing(v.id, { dailyPrice: Number(d.price), depositAmount: Number(d.deposit) || 0, active: true }))}
                className="min-h-11 flex-1 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-50"
              >
                {v.daily_price ? "Update listing" : "List for hire"}
              </button>
              {v.daily_price != null && v.active === 1 && (
                <button type="button" onClick={() => act(() => api.saveRentalListing(v.id, { dailyPrice: v.daily_price!, depositAmount: v.deposit_amount ?? 0, active: false }))} className="min-h-11 rounded-full bg-gold/15 px-4 text-sm font-bold text-ink">Pause</button>
              )}
            </div>
          </section>
        );
      })}

      <h2 className="text-lg font-bold text-ink">Requests and rentals</h2>
      {rentals.length === 0 && <p className="text-sm text-ink-500">None yet.</p>}
      {rentals.map((r) => (
        <section key={r.id} className="home-card space-y-2">
          <p className="text-sm font-bold text-ink">{r.plate} · {r.renter_name} <span className="font-normal text-ink-500">· {r.status}</span></p>
          <p className="text-xs text-ink-500">{when(r.starts_at)} → {when(r.ends_at)} · {r.days} day{r.days === 1 ? "" : "s"}</p>
          <p className="text-xs text-ink-500">Rent {ugx(r.rent_amount)} · deposit {ugx(r.deposit_amount)} · licence {r.licence_number} (to {r.licence_expiry})</p>
          {r.status === "requested" && (
            <div className="flex gap-2">
              <button type="button" onClick={() => act(() => api.decideRental(r.id, true))} className="min-h-10 flex-1 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">Approve</button>
              <button type="button" onClick={() => act(() => api.decideRental(r.id, false))} className="min-h-10 rounded-full bg-gold/15 px-4 text-sm font-bold text-ink">Decline</button>
            </div>
          )}
          {r.status === "approved" && (
            <button type="button" onClick={() => act(() => api.handoverRental(r.id))} className="min-h-10 w-full rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">Car handed over</button>
          )}
          {r.status === "active" && (
            <div className="space-y-2">
              <input inputMode="numeric" value={claims[r.id] ?? ""} onChange={(e) => setClaims((x) => ({ ...x, [r.id]: e.target.value.replace(/\D/g, "") }))} placeholder="Damage claim (UGX), leave empty if none" className={field} />
              <button type="button" onClick={() => act(() => api.returnRental(r.id, claims[r.id] ? Number(claims[r.id]) : undefined))} className="min-h-10 w-full rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">Car returned</button>
            </div>
          )}
          {r.status === "disputed" && <p className="text-xs text-ink-500">Peebee is reviewing your damage claim of {ugx(r.damage_claim)}.</p>}
          {r.status === "completed" && <p className="text-xs font-semibold text-ink">You received {ugx(r.owner_amount)}</p>}
        </section>
      ))}
    </div>
  );
}
