"use client";

import { Select } from "@peebee/shared/select";

import type { CarConfig, OwnerDeals } from "@peebee/shared";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";

const field = "min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3";
type Vehicle = OwnerDeals["vehicles"][number];

/** The owner decides whether drivers can apply to this car, and on what fee: a share of each ride, or a fixed rent. */
export function TermsEditor({ vehicle, limits, onSaved }: { vehicle: Vehicle; limits: NonNullable<CarConfig["deals"]>; onSaved: () => void }) {
  const t = vehicle.terms;
  const firstType = t?.feeType ?? (limits.shareEnabled ? "share" : "rent");
  const [open, setOpen] = useState(t?.open ?? false);
  const [feeType, setFeeType] = useState<"share" | "rent">(firstType as "share" | "rent");
  const [share, setShare] = useState(String(t?.ownerSharePercent ?? Math.min(limits.maxOwnerSharePercent, Math.max(limits.minOwnerSharePercent, 60))));
  const [rent, setRent] = useState(t?.rentAmount ? String(t.rentAmount) : "");
  const [period, setPeriod] = useState<"day" | "week">(t?.rentPeriod ?? "day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(next: boolean) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api.dealsSetTerms(vehicle.id, {
        open: next,
        feeType,
        ...(feeType === "share" ? { ownerSharePercent: Number(share) } : { rentAmount: Number(rent), rentPeriod: period }),
      });
      setOpen(next);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const types = [...(limits.shareEnabled ? (["share"] as const) : []), ...(limits.rentEnabled ? (["rent"] as const) : [])];
  if (vehicle.status !== "approved") return <p className="text-xs text-ink-500">Once Peebee approves this car you can offer it to drivers.</p>;
  if (vehicle.driver) return null;
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-faint)] p-3">
      <p className="text-sm font-bold text-ink">Let drivers apply to drive this car</p>
      {types.length > 1 && (
        <div role="tablist" className="flex gap-2">
          {types.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={feeType === x} onClick={() => setFeeType(x)} className={`min-h-9 flex-1 rounded-full px-3 text-xs font-bold ${feeType === x ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>
              {x === "share" ? "Share of each ride" : "Fixed rent"}
            </button>
          ))}
        </div>
      )}
      {feeType === "share" ? (
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Your share of each ride after Peebee&apos;s cut (%), {limits.minOwnerSharePercent}–{limits.maxOwnerSharePercent}</label>
          <input inputMode="numeric" value={share} onChange={(e) => setShare(e.target.value.replace(/\D/g, ""))} className={field} />
          <p className="text-xs text-ink-500">The driver gets the other {100 - (Number(share) || 0)}%.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <input inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value.replace(/\D/g, ""))} placeholder="Rent (UGX)" className={field} />
          <Select value={period} onValueChange={(value) => setPeriod(value as "day" | "week")} className={field} aria-label="Per">
            <option value="day">per day</option>
            <option value="week">per week</option>
          </Select>
          <p className="col-span-2 text-xs text-ink-500">The driver keeps their ride earnings and pays you this rent, taken from their rides or paid from their wallet.{limits.maxRentPerDay > 0 ? ` At most UGX ${limits.maxRentPerDay.toLocaleString("en-UG")} a day.` : ""}</p>
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {saved && <p className="text-xs font-medium text-green">Saved.</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => save(true)} className="min-h-11 flex-1 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-50">{open ? "Update offer" : "Offer to drivers"}</button>
        {open && <button type="button" disabled={busy} onClick={() => save(false)} className="min-h-11 rounded-full bg-gold/15 px-4 text-sm font-bold text-ink disabled:opacity-50">Close</button>}
      </div>
      {open && <p className="text-xs text-green">Open — drivers can see and apply.</p>}
    </div>
  );
}
