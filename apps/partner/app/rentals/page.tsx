"use client";

import type { OwnerRentalVehicle, Rental } from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;
const field = "min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3";
const when = (iso: string) => new Date(iso).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });
const suggestedDayRate = (make: string | null, model: string | null) => {
  const name = `${make ?? ""} ${model ?? ""}`.toLowerCase();
  return name.includes("hiace") ? 200_000 : name.includes("noah") ? 150_000 : name.includes("corolla") || name.includes("saloon") || name.includes("sedan") ? 100_000 : 180_000;
};

export default function RentalsPage() {
  const { me, mode } = useAuth();
  const [vehicles, setVehicles] = useState<OwnerRentalVehicle[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [draft, setDraft] = useState<Record<string, { price: string; deposit: string; hourly: boolean; halfDay: boolean; fullDay: boolean }>>({});
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    api.ownerRentals().then((r) => { setVehicles(r.vehicles); setRentals(r.rentals); setUnavailable(false); }).catch(() => setUnavailable(true));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10000);
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { window.clearInterval(timer); window.clearInterval(clock); };
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
        const d = draft[v.id] ?? { price: String(v.daily_price ?? v.standard_daily_price ?? suggestedDayRate(v.make, v.model)), deposit: v.deposit_amount != null ? String(v.deposit_amount) : "", hourly: v.hourly_enabled !== 0, halfDay: v.half_day_enabled !== 0, fullDay: v.full_day_enabled !== 0 };
        const set = (patch: Partial<typeof d>) => setDraft((x) => ({ ...x, [v.id]: { ...d, ...patch } }));
        return (
          <section key={v.id} className="home-card space-y-3">
            <p className="font-bold text-ink">{v.plate} <span className="font-normal text-ink-500">· {[v.make, v.model].filter(Boolean).join(" ")}</span></p>
            <p className="text-xs text-ink-500">{v.service_class === "comfort" ? "Comfort" : "Convenient"}{v.condition_grade ? ` · ${v.condition_grade} condition` : ""}{v.seat_capacity ? ` · ${v.seat_capacity} seats` : ""}{v.standard_daily_price ? ` · reference ${ugx(v.standard_daily_price)}/day` : ""}. Set your own competitive rate below.</p>
            <p className="text-xs text-ink-500">{v.daily_price ? (v.active ? `Listed at ${ugx(v.daily_price)}/day` : "Listing paused") : "Not listed for hire"}</p>
            <div className="grid grid-cols-2 gap-3">
              <input inputMode="numeric" value={d.price} onChange={(e) => set({ price: e.target.value.replace(/\D/g, "") })} placeholder="Price per day (UGX)" className={field} />
              <input inputMode="numeric" value={d.deposit} onChange={(e) => set({ deposit: e.target.value.replace(/\D/g, "") })} placeholder="Deposit (UGX)" className={field} />
            </div>
            <div className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
              <p className="text-xs font-semibold text-ink-500">Rental options (derived from your daily price)</p>
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={d.hourly} onChange={(e) => set({ hourly: e.target.checked })} />Hourly · {ugx(Math.round((Number(d.price) || 0) * 1.2 / 24)}/hour</label>
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={d.halfDay} onChange={(e) => set({ halfDay: e.target.checked })} />Half-day · 6 hours · {ugx(Math.round((Number(d.price) || 0) * 0.6))}</label>
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={d.fullDay} onChange={(e) => set({ fullDay: e.target.checked })} />Full day · 24 hours · {ugx(Number(d.price) || 0)}</label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!d.price}
                disabled={!d.price || (!d.hourly && !d.halfDay && !d.fullDay)}
                onClick={() => act(() => api.saveRentalListing(v.id, { dailyPrice: Number(d.price), depositAmount: Number(d.deposit) || 0, active: true, hourlyEnabled: d.hourly, halfDayEnabled: d.halfDay, fullDayEnabled: d.fullDay }))}
                className="min-h-11 flex-1 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-50"
              >
                {v.daily_price ? "Update listing" : "List for hire"}
              </button>
              {v.daily_price != null && v.active === 1 && (
                <button type="button" onClick={() => act(() => api.saveRentalListing(v.id, { dailyPrice: v.daily_price!, depositAmount: v.deposit_amount ?? 0, active: false, hourlyEnabled: d.hourly, halfDayEnabled: d.halfDay, fullDayEnabled: d.fullDay }))} className="min-h-11 rounded-full bg-gold/15 px-4 text-sm font-bold text-ink">Pause</button>
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
          <p className="text-xs text-ink-500">{when(r.starts_at)} → {when(r.ends_at)} · {r.period_type?.replace("_", " ") ?? `${r.days} day${r.days === 1 ? "" : "s"}`}</p>
          {r.status === "active" && r.handed_over_at && <p className="text-xs font-semibold text-ink">Timer: {Math.max(0, Math.floor((now - new Date(r.handed_over_at).getTime()) / 3_600_000))} hours elapsed since handover {when(r.handed_over_at)}. Due {when(r.ends_at)}; configured grace, then {ugx(r.hourly_price ?? 0)} per started extra hour.</p>}
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
          {r.status === "completed" && <p className="text-xs font-semibold text-ink">You received {ugx(r.owner_amount)}{Number(r.overtime_amount ?? 0) > 0 ? `, including ${ugx(Number(r.overtime_amount))} overtime` : ""}</p>}
        </section>
      ))}
    </div>
  );
}
