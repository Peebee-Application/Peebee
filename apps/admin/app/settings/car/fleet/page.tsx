"use client";

import type { AdminCarBooking, AdminCarCategory, AdminCarPartner, AdminCarVehicle, AdminRental } from "@tuma/shared";
import { useCallback, useEffect, useState } from "react";
import { SettingsPageShell } from "../../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../../lib/api";

type Tab = "categories" | "people" | "vehicles" | "rides" | "rentals";
const TABS: [Tab, string][] = [
  ["categories", "Car types"],
  ["people", "Owners & drivers"],
  ["vehicles", "Vehicles"],
  ["rides", "Rides"],
  ["rentals", "Rentals"],
];
const digits = (v: string) => v.replace(/[^\d]/g, "");
const ugx = (n: number | null) => (n == null ? "—" : `UGX ${n.toLocaleString("en-UG")}`);
const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold";
const smallBtn = "min-h-9 rounded-full px-3 text-xs font-bold";

export default function CarFleetPage() {
  const [tab, setTab] = useState<Tab>("categories");
  const [categories, setCategories] = useState<AdminCarCategory[]>([]);
  const [partners, setPartners] = useState<AdminCarPartner[]>([]);
  const [vehicles, setVehicles] = useState<AdminCarVehicle[]>([]);
  const [bookings, setBookings] = useState<AdminCarBooking[]>([]);
  const [rentals, setRentals] = useState<AdminRental[]>([]);
  const [rulings, setRulings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, p, v, b] = await Promise.all([api.adminCarCategories(), api.adminCarPartners(), api.adminCarVehicles(), api.adminCarBookings()]);
      setCategories(c.categories);
      setPartners(p.partners);
      setVehicles(v.vehicles);
      setBookings(b.bookings);
      api.adminCarRentals().then((r) => setRentals(r.rentals)).catch(() => setRentals([]));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <SettingsPageShell title="Car fleet" loading={loading}>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`${smallBtn} shrink-0 ${tab === id ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "categories" && <Categories categories={categories} act={act} />}

      {tab === "people" && (
        <ul className="space-y-2">
          {partners.length === 0 && <li className="text-sm text-ink-500">Nobody has applied yet.</li>}
          {partners.map((p) =>
            (["owner", "driver"] as const)
              .filter((r) => p[`${r}_status`] !== "none")
              .map((r) => {
                const status = p[`${r}_status`];
                return (
                  <li key={`${p.user_id}-${r}`} className="home-card space-y-2">
                    <p className="text-sm font-semibold text-ink">
                      {p.name} <span className="font-normal text-ink-500">· {r} · {status}</span>
                    </p>
                    <p className="text-xs text-ink-500">{p.phone}{r === "driver" && p.licence_expiry ? ` · licence to ${p.licence_expiry}` : ""}</p>
                    <div className="flex gap-2">
                      {status !== "approved" && (
                        <button type="button" className={`${smallBtn} bg-gold text-ink-gold`} onClick={() => act(() => api.adminDecideCarPartner(p.user_id, r, "approved"))}>Approve</button>
                      )}
                      {status === "pending" && (
                        <button type="button" className={`${smallBtn} bg-gold/15 text-ink`} onClick={() => act(() => api.adminDecideCarPartner(p.user_id, r, "rejected"))}>Reject</button>
                      )}
                      {status === "approved" && (
                        <button type="button" className={`${smallBtn} bg-gold/15 text-ink`} onClick={() => act(() => api.adminDecideCarPartner(p.user_id, r, "suspended"))}>Suspend</button>
                      )}
                    </div>
                  </li>
                );
              }),
          )}
        </ul>
      )}

      {tab === "vehicles" && (
        <ul className="space-y-2">
          {vehicles.length === 0 && <li className="text-sm text-ink-500">No vehicles have been put up for service yet.</li>}
          {vehicles.map((v) => {
            const drivers = partners.filter((p) => p.driver_status === "approved");
            return (
              <li key={v.id} className="home-card space-y-2">
                <p className="text-sm font-semibold text-ink">
                  {v.plate} <span className="font-normal text-ink-500">· {v.category_name} · {v.status}</span>
                </p>
                <p className="text-xs text-ink-500">{[v.make, v.model].filter(Boolean).join(" ")} · owner {v.owner_name}</p>
                <div className="flex flex-wrap gap-2">
                  {v.status !== "approved" && (
                    <button type="button" className={`${smallBtn} bg-gold text-ink-gold`} onClick={() => act(() => api.adminDecideCarVehicle(v.id, "approved"))}>Approve</button>
                  )}
                  {v.status === "pending" && (
                    <button type="button" className={`${smallBtn} bg-gold/15 text-ink`} onClick={() => act(() => api.adminDecideCarVehicle(v.id, "rejected"))}>Reject</button>
                  )}
                  {v.status === "approved" && (
                    <button type="button" className={`${smallBtn} bg-gold/15 text-ink`} onClick={() => act(() => api.adminDecideCarVehicle(v.id, "suspended"))}>Suspend</button>
                  )}
                </div>
                {v.status === "approved" && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-500" htmlFor={`drv-${v.id}`}>Driver</label>
                    <select
                      id={`drv-${v.id}`}
                      value={v.driver_id ?? ""}
                      onChange={(e) => act(() => api.adminAssignCarDriver(v.id, e.target.value || null))}
                      className={field}
                    >
                      <option value="">No driver</option>
                      {drivers.map((d) => (
                        <option key={d.user_id} value={d.user_id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "rides" && (
        <ul className="space-y-2">
          {bookings.length === 0 && <li className="text-sm text-ink-500">No car rides yet.</li>}
          {bookings.map((b) => (
            <li key={b.id} className="home-card space-y-1">
              <p className="text-sm font-semibold text-ink">
                {b.category_name} <span className="font-normal text-ink-500">· {b.stage}</span>
              </p>
              <p className="text-xs text-ink-500">
                {b.customer_name} → {b.driver_name ?? "no driver yet"} · {ugx(b.final_total ?? b.estimated_total)}
              </p>
              {b.status === "completed" && (
                <p className="text-xs text-ink-500">
                  Owner {ugx(b.owner_amount)} · driver {ugx(b.driver_amount)} · Tuma {ugx(b.platform_amount)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {tab === "rentals" && (
        <ul className="space-y-2">
          {rentals.length === 0 && <li className="text-sm text-ink-500">No rentals yet.</li>}
          {rentals.map((r) => (
            <li key={r.id} className="home-card space-y-2">
              <p className="text-sm font-semibold text-ink">{r.plate} <span className="font-normal text-ink-500">· {r.status}</span></p>
              <p className="text-xs text-ink-500">Owner {r.owner_name} · renter {r.renter_name} · rent {ugx(r.rent_amount)} · deposit {ugx(r.deposit_amount)}</p>
              {r.status === "disputed" && (
                <div className="space-y-2 border-t border-[var(--border-faint)] pt-2">
                  <p className="text-xs text-ink">Owner claims {ugx(r.damage_claim)} for damage. How much of the deposit does the owner keep?</p>
                  <input
                    inputMode="numeric"
                    value={rulings[r.id] ?? ""}
                    onChange={(e) => setRulings((x) => ({ ...x, [r.id]: digits(e.target.value) }))}
                    placeholder={`0 – ${r.damage_claim}`}
                    className={field}
                  />
                  <button
                    type="button"
                    disabled={(rulings[r.id] ?? "") === ""}
                    onClick={() => act(() => api.adminResolveRental(r.id, Number(rulings[r.id])))}
                    className={`${smallBtn} bg-gold text-ink-gold disabled:opacity-50`}
                  >
                    Settle
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsPageShell>
  );
}

function Categories({ categories, act }: { categories: AdminCarCategory[]; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const empty = { kind: "passenger" as "passenger" | "cargo", name: "", seats: "", cargoType: "", sizeLabel: "", rate: "", min: "", o: "", d: "", p: "", active: true };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const set = (patch: Partial<typeof empty>) => setForm((f) => ({ ...f, ...patch }));

  function edit(c: AdminCarCategory) {
    setEditing(c.id);
    setForm({
      kind: c.kind,
      name: c.name,
      seats: c.seats != null ? String(c.seats) : "",
      cargoType: c.cargo_type ?? "",
      sizeLabel: c.size_label ?? "",
      rate: String(c.rate_per_km),
      min: String(c.minimum_fare),
      o: c.owner_share_percent != null ? String(c.owner_share_percent) : "",
      d: c.driver_share_percent != null ? String(c.driver_share_percent) : "",
      p: c.platform_share_percent != null ? String(c.platform_share_percent) : "",
      active: c.active === 1,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const num = (v: string) => (v === "" ? null : Number(v));
    await act(() =>
      api.adminSaveCarCategory(
        {
          kind: form.kind,
          name: form.name.trim(),
          seats: form.kind === "passenger" ? num(form.seats) : null,
          cargoType: form.kind === "cargo" ? form.cargoType.trim() || null : null,
          sizeLabel: form.sizeLabel.trim() || null,
          ratePerKm: Number(form.rate) || 0,
          minimumFare: Number(form.min) || 0,
          ownerSharePercent: num(form.o),
          driverSharePercent: num(form.d),
          platformSharePercent: num(form.p),
          active: form.active,
          sort: categories.length,
        },
        editing ?? undefined,
      ),
    );
    setForm(empty);
    setEditing(null);
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {categories.length === 0 && <li className="text-sm text-ink-500">No car types yet — add the first one below.</li>}
        {categories.map((c) => (
          <li key={c.id} className="home-card flex items-center gap-3">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => edit(c)}>
              <span className="block text-sm font-semibold text-ink">
                {c.name} {c.active === 0 && <span className="font-normal text-ink-500">(hidden)</span>}
              </span>
              <span className="block text-xs text-ink-500">
                {c.kind === "passenger" ? `${c.seats ?? "?"} seats` : c.cargo_type ?? "cargo"} · UGX {c.rate_per_km.toLocaleString("en-UG")}/km · min UGX {c.minimum_fare.toLocaleString("en-UG")}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={save} className="home-card space-y-3">
        <p className="text-sm font-bold text-ink">{editing ? "Edit car type" : "Add a car type"}</p>
        <select value={form.kind} onChange={(e) => set({ kind: e.target.value as "passenger" | "cargo" })} className={field} aria-label="Kind">
          <option value="passenger">Passenger car (by seats)</option>
          <option value="cargo">Cargo van / truck</option>
        </select>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name, e.g. Sedan or 3-ton truck" className={field} required />
        {form.kind === "passenger" ? (
          <input inputMode="numeric" value={form.seats} onChange={(e) => set({ seats: digits(e.target.value) })} placeholder="Seats" className={field} />
        ) : (
          <input value={form.cargoType} onChange={(e) => set({ cargoType: e.target.value })} placeholder="Cargo type, e.g. Pickup, Van, Truck" className={field} />
        )}
        <input value={form.sizeLabel} onChange={(e) => set({ sizeLabel: e.target.value })} placeholder="Size note (optional)" className={field} />
        <div className="grid grid-cols-2 gap-3">
          <input inputMode="numeric" value={form.rate} onChange={(e) => set({ rate: digits(e.target.value) })} placeholder="UGX per km" className={field} />
          <input inputMode="numeric" value={form.min} onChange={(e) => set({ min: digits(e.target.value) })} placeholder="Minimum fare" className={field} />
        </div>
        <p className="text-xs font-semibold text-ink-500">Own profit share (leave all three empty to use the default)</p>
        <div className="grid grid-cols-3 gap-3">
          <input inputMode="numeric" value={form.o} onChange={(e) => set({ o: digits(e.target.value) })} placeholder="Owner %" className={field} />
          <input inputMode="numeric" value={form.d} onChange={(e) => set({ d: digits(e.target.value) })} placeholder="Driver %" className={field} />
          <input inputMode="numeric" value={form.p} onChange={(e) => set({ p: digits(e.target.value) })} placeholder="Tuma %" className={field} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} className="h-4 w-4 accent-gold" />
          Customers can book this type
        </label>
        <div className="flex gap-2">
          <button type="submit" className="min-h-11 flex-1 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold">{editing ? "Save changes" : "Add car type"}</button>
          {editing && (
            <button type="button" onClick={() => { setEditing(null); setForm(empty); }} className="min-h-11 rounded-full bg-gold/15 px-4 text-sm font-bold text-ink">Cancel</button>
          )}
        </div>
      </form>
    </div>
  );
}
