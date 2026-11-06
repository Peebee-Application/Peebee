"use client";

import type { OwnerRentalVehicle, Rental, RentalInspection } from "@peebee/shared";
import { CarFront, KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { TabBar } from "../../components/TabBar";
import { InspectionWalkaroundModal } from "../../components/InspectionWalkaroundModal";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;
const field = "min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3 text-lg";
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
  const [tab, setTab] = useState<"rentals" | "cars">("rentals");
  const [now, setNow] = useState(Date.now());
  const [inspectionModal, setInspectionModal] = useState<{
    rentalId: string;
    plate?: string | null;
    renterName?: string | null;
    phase: "pickup" | "return";
    readOnly?: boolean;
    existing?: RentalInspection | null;
    comparison?: RentalInspection | null;
  } | null>(null);

  const openInspection = async (r: Rental, phase: "pickup" | "return") => {
    try {
      const res = await api.getRentalInspections(r.id);
      const existing = phase === "pickup" ? res.pickup : res.return;
      const comparison = phase === "return" ? res.pickup : null;
      setInspectionModal({
        rentalId: r.id,
        plate: r.plate,
        renterName: r.renter_name,
        phase,
        existing,
        comparison,
        readOnly: r.status === "completed",
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

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

  if (mode !== "owner") return <p className="px-4 py-5 text-lg text-ink-500">Switch to Owner (top right) to manage rentals.</p>;
  if (me?.ownerStatus !== "approved") return <p className="px-4 py-5 text-lg text-ink-500">Become an approved owner first (Home).</p>;
  if (unavailable) return <p className="px-4 py-5 text-lg text-ink-500">Self-drive hire isn&apos;t available right now.</p>;

  return (
    <div className="space-y-5 px-4 py-5">
      <TabBar label="Rentals" active={tab} onChange={setTab} tabs={[{ id: "rentals", label: "Rentals", icon: KeyRound, count: rentals.filter((r) => r.status === "requested").length }, { id: "cars", label: "My cars", icon: CarFront }]} />
      {error && <p className="rounded-xl bg-red-50 p-3 text-lg text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {tab === "cars" && vehicles.length === 0 && <p className="text-lg text-ink-500">Once a car is approved you can offer it for hire here.</p>}
      {tab === "cars" && vehicles.map((v) => {
        const d = draft[v.id] ?? { price: String(v.daily_price ?? v.standard_daily_price ?? suggestedDayRate(v.make, v.model)), deposit: v.deposit_amount != null ? String(v.deposit_amount) : "", hourly: v.hourly_enabled !== 0, halfDay: v.half_day_enabled !== 0, fullDay: v.full_day_enabled !== 0 };
        const set = (patch: Partial<typeof d>) => setDraft((x) => ({ ...x, [v.id]: { ...d, ...patch } }));
        return (
          <section key={v.id} className="home-card space-y-3">
            <p className="font-bold text-ink">{v.plate} <span className="font-normal text-ink-500">· {[v.make, v.model].filter(Boolean).join(" ")}</span></p>
            <p className="text-base text-ink-500">{v.service_class === "comfort" ? "Comfort" : "Convenient"}{v.condition_grade ? ` · ${v.condition_grade} condition` : ""}{v.seat_capacity ? ` · ${v.seat_capacity} seats` : ""}{v.standard_daily_price ? ` · reference ${ugx(v.standard_daily_price)}/day` : ""}</p>
            <p className="text-base text-ink-500">{v.daily_price ? (v.active ? `Listed at ${ugx(v.daily_price)}/day` : "Listing paused") : "Not listed for hire"}</p>
            <div className="grid grid-cols-2 gap-3">
              <input inputMode="numeric" value={d.price} onChange={(e) => set({ price: e.target.value.replace(/\D/g, "") })} placeholder="Price per day (UGX)" className={field} />
              <input inputMode="numeric" value={d.deposit} onChange={(e) => set({ deposit: e.target.value.replace(/\D/g, "") })} placeholder="Deposit (UGX)" className={field} />
            </div>
            <div className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
              <p className="text-base font-semibold text-ink-500">Options</p>
              <label className="flex items-center gap-2 text-lg text-ink"><input type="checkbox" checked={d.hourly} onChange={(e) => set({ hourly: e.target.checked })} />Hourly · {ugx(Math.round((Number(d.price) || 0) * 1.2 / 24))}/hour</label>
              <label className="flex items-center gap-2 text-lg text-ink"><input type="checkbox" checked={d.halfDay} onChange={(e) => set({ halfDay: e.target.checked })} />Half-day · 6 hours · {ugx(Math.round((Number(d.price) || 0) * 0.6))}</label>
              <label className="flex items-center gap-2 text-lg text-ink"><input type="checkbox" checked={d.fullDay} onChange={(e) => set({ fullDay: e.target.checked })} />Full day · 24 hours · {ugx(Number(d.price) || 0)}</label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!d.price || (!d.hourly && !d.halfDay && !d.fullDay)}
                onClick={() => act(() => api.saveRentalListing(v.id, { dailyPrice: Number(d.price), depositAmount: Number(d.deposit) || 0, active: true, hourlyEnabled: d.hourly, halfDayEnabled: d.halfDay, fullDayEnabled: d.fullDay }))}
                className="min-h-14 flex-1 rounded-full bg-gold px-3 text-lg font-extrabold text-ink-gold disabled:opacity-50"
              >
                {v.daily_price ? "Update" : "List for hire"}
              </button>
              {v.daily_price != null && v.active === 1 && (
                <button type="button" onClick={() => act(() => api.saveRentalListing(v.id, { dailyPrice: v.daily_price!, depositAmount: v.deposit_amount ?? 0, active: false, hourlyEnabled: d.hourly, halfDayEnabled: d.halfDay, fullDayEnabled: d.fullDay }))} className="min-h-14 rounded-full bg-gold/15 px-4 text-lg font-bold text-ink">Pause</button>
              )}
            </div>
          </section>
        );
      })}

      {tab === "rentals" && rentals.length === 0 && <p className="text-lg text-ink-500">None yet</p>}
      {tab === "rentals" && rentals.map((r) => (
        <section key={r.id} className="home-card space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 basis-full">
              <p className="text-2xl font-black text-ink">{r.plate}</p>
              <p className="text-lg text-ink">{r.renter_name} · <span className="capitalize text-ink-500">{r.status}</span></p>
              <p className="text-base text-ink-500">{when(r.starts_at)} → {when(r.ends_at)}</p>
            </div>
            {r.deposit_status && (
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${
                r.deposit_status === "held"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  : r.deposit_status === "released"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
              }`}>
                Deposit {r.deposit_status === "held" ? "in escrow" : r.deposit_status.replace("_", " ")}
              </span>
            )}
          </div>
          {r.status === "active" && r.handed_over_at && <p className="text-base font-semibold text-ink">Timer: {Math.max(0, Math.floor((now - new Date(r.handed_over_at).getTime()) / 3_600_000))} hours elapsed since handover {when(r.handed_over_at)}. Due {when(r.ends_at)}; configured grace, then {ugx(r.hourly_price ?? 0)} per started extra hour.</p>}
          <p className="text-base text-ink-500">Rent {ugx(r.rent_amount)} · deposit {ugx(r.deposit_amount)} · licence {r.licence_number} (to {r.licence_expiry})</p>
          {r.status === "requested" && (
            <div className="flex gap-2">
              <button type="button" onClick={() => act(() => api.decideRental(r.id, true))} className="min-h-14 flex-1 rounded-full bg-gold px-3 text-lg font-bold text-ink-gold">Approve</button>
              <button type="button" onClick={() => act(() => api.decideRental(r.id, false))} className="min-h-14 rounded-full bg-gold/15 px-4 text-lg font-bold text-ink">Decline</button>
            </div>
          )}
          {r.status === "approved" && (
            <div className="space-y-2">
              <button type="button" onClick={() => openInspection(r, "pickup")} className="min-h-14 w-full rounded-full bg-gold/15 px-3 text-lg font-bold text-ink hover:bg-gold/25">
                📸 Pickup photos
              </button>
              <button type="button" onClick={() => act(() => api.handoverRental(r.id))} className="min-h-14 w-full rounded-full bg-gold px-3 text-lg font-bold text-ink-gold">
                Hand over
              </button>
            </div>
          )}
          {r.status === "active" && (
            <div className="space-y-2">
              <button type="button" onClick={() => openInspection(r, "return")} className="min-h-14 w-full rounded-full bg-gold/15 px-3 text-lg font-bold text-ink hover:bg-gold/25">
                📸 Return photos
              </button>
              <input inputMode="numeric" value={claims[r.id] ?? ""} onChange={(e) => setClaims((x) => ({ ...x, [r.id]: e.target.value.replace(/\D/g, "") }))} placeholder="Damage claim (UGX), if any" className={field} />
              <button type="button" onClick={() => act(() => api.returnRental(r.id, claims[r.id] ? Number(claims[r.id]) : undefined))} className="min-h-14 w-full rounded-full bg-gold px-3 text-lg font-bold text-ink-gold">Car returned</button>
            </div>
          )}
          {(r.status === "completed" || r.status === "disputed") && (
            <div className="pt-1">
              <button type="button" onClick={() => openInspection(r, "return")} className="min-h-14 rounded-full bg-gold/15 px-3 text-base font-bold text-ink hover:bg-gold/25">
                🔍 Photos
              </button>
            </div>
          )}
          {r.status === "disputed" && <p className="text-base text-ink-500">Peebee is reviewing your damage claim of {ugx(r.damage_claim)}.</p>}
          {r.status === "completed" && <p className="text-base font-semibold text-ink">You received {ugx(r.owner_amount)}{Number(r.overtime_amount ?? 0) > 0 ? `, including ${ugx(Number(r.overtime_amount))} overtime` : ""}</p>}
        </section>
      ))}

      {inspectionModal && (
        <InspectionWalkaroundModal
          rentalId={inspectionModal.rentalId}
          plate={inspectionModal.plate}
          renterName={inspectionModal.renterName}
          phase={inspectionModal.phase}
          readOnly={inspectionModal.readOnly}
          existingInspection={inspectionModal.existing}
          comparisonInspection={inspectionModal.comparison}
          onClose={() => setInspectionModal(null)}
          onSuccess={() => {
            load();
          }}
        />
      )}
    </div>
  );
}
