"use client";

import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth, type PartnerMode } from "../lib/auth-context";

/** Shown while the person isn't yet an approved owner/driver. */
export function ApplyCard({ mode }: { mode: PartnerMode }) {
  const { me, refreshMe } = useAuth();
  const status = (mode === "owner" ? me?.ownerStatus : me?.driverStatus) ?? "none";
  const [licence, setLicence] = useState("");
  const [hasCar, setHasCar] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const noun = mode === "owner" ? "a car owner" : "a driver";
  if (status === "pending") {
    return (
      <section className="home-card space-y-1">
        <p className="text-xl font-bold text-ink">Application received</p>
        <p className="text-base text-ink-500">Peebee is reviewing it.</p>
      </section>
    );
  }
  if (status === "suspended") {
    return (
      <section className="home-card">
        <p className="text-xl font-bold text-ink">Account paused</p>
        <p className="text-base text-ink-500">Contact Peebee support.</p>
      </section>
    );
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.carApply(mode, mode === "driver" && licence ? licence : undefined, mode === "driver" ? hasCar === false : undefined);
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={apply} className="home-card space-y-3">
      <div>
        <p className="text-2xl font-black text-ink">Become {noun}</p>
        <p className="text-base text-ink-500">
          {mode === "owner"
            ? "Put your car to work and earn on every ride."
            : "Drive and earn on every ride."}
        </p>
        {status === "rejected" && <p className="mt-1 text-base font-semibold text-red-600">Not approved last time. You can apply again.</p>}
      </div>
      {mode === "driver" && (
        <div role="radiogroup" aria-label="Do you have a car?" className="space-y-2">
          <p className="text-base font-semibold text-ink-500">Do you have a car to drive?</p>
          {[
            [true, "I have a car", "Add it, we check it."],
            [false, "I need a car", "Drive an owner's car."],
          ].map(([value, label, hint]) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={hasCar === value}
              onClick={() => setHasCar(value as boolean)}
              className="select-card min-h-16 text-left"
            >
              <span className="select-card__title text-lg text-ink">{label as string}</span>
              <span className="select-card__sub !text-base">{hint as string}</span>
            </button>
          ))}
        </div>
      )}
      {mode === "driver" && (
        <input value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="Licence expiry (YYYY-MM-DD)" className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3 text-lg" />
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-lg text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <button disabled={busy || (mode === "driver" && hasCar === null)} className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : "Apply"}</button>
    </form>
  );
}
