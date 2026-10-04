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
        <p className="font-bold text-ink">Application received</p>
        <p className="text-xs text-ink-500">A Peebee manager is reviewing your application to be {noun}. We&apos;ll open this screen up once it&apos;s approved.</p>
      </section>
    );
  }
  if (status === "suspended") {
    return (
      <section className="home-card">
        <p className="font-bold text-ink">Account paused</p>
        <p className="text-xs text-ink-500">Your {mode} access is paused. Please contact Peebee support.</p>
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
        <p className="font-bold text-ink">Become {noun}</p>
        <p className="text-xs text-ink-500">
          {mode === "owner"
            ? "Put your car, van or truck up for service. Peebee approves it and assigns a driver, and you earn your share of every ride."
            : "Drive a vehicle that Peebee assigns to you and earn your share of every ride."}
        </p>
        {status === "rejected" && <p className="mt-1 text-xs font-semibold text-red-600">Your last application wasn&apos;t approved. You can apply again.</p>}
      </div>
      {mode === "driver" && (
        <div role="radiogroup" aria-label="Do you have a car?" className="space-y-2">
          <p className="text-xs font-semibold text-ink-500">Do you have a car to drive?</p>
          {[
            [true, "Yes, I have my own car", "You'll add it and have it approved."],
            [false, "No, I need a car", "Apply to owners to drive their car, or Peebee can assign you one."],
          ].map(([value, label, hint]) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={hasCar === value}
              onClick={() => setHasCar(value as boolean)}
              className={`block w-full rounded-xl border p-3 text-left ${hasCar === value ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"}`}
            >
              <span className="block text-sm font-bold text-ink">{label as string}</span>
              <span className="block text-xs text-ink-500">{hint as string}</span>
            </button>
          ))}
        </div>
      )}
      {mode === "driver" && (
        <input value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="Driving licence expiry (YYYY-MM-DD)" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3" />
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <button disabled={busy || (mode === "driver" && hasCar === null)} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : "Apply"}</button>
    </form>
  );
}
