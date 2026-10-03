"use client";

import type { DriverDeals } from "@tuma/shared";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { describeTerms } from "../lib/terms";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;

/** The cars a driver is connected to on agreed terms, with rent owed and a way to pay it. */
export function DriverConnections() {
  const [data, setData] = useState<DriverDeals | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.dealsMy().then(setData).catch(() => setData(null));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rows = (data?.connections ?? []).filter((c) => !c.ownCar && c.terms);
  if (rows.length === 0) return null;

  async function pay(assignmentId: string) {
    setBusy(assignmentId);
    setError("");
    try {
      await api.dealsPayRent(assignmentId);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="home-card space-y-3">
      <h2 className="font-bold">Cars you drive for owners</h2>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {rows.map((c) => (
        <div key={c.assignmentId} className="space-y-1 border-t border-[var(--border-faint)] pt-3 first:border-t-0 first:pt-0">
          <p className="text-sm font-semibold text-ink">{c.car} <span className="font-normal text-ink-500">· {c.plate} · owner {c.ownerName}</span></p>
          <p className="text-xs text-ink-500">{describeTerms(c.terms)}</p>
          {c.terms?.feeType === "rent" && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink">Rent owed: <strong>{ugx(c.rentOwed)}</strong></p>
              {c.rentOwed > 0 && (
                <button type="button" disabled={busy === c.assignmentId} onClick={() => pay(c.assignmentId)} className="min-h-9 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold disabled:opacity-50">
                  {busy === c.assignmentId ? "Paying…" : "Pay from wallet"}
                </button>
              )}
            </div>
          )}
          {c.terms?.feeType === "rent" && <p className="text-xs text-ink-500">Rent is also taken from your next ride earnings.</p>}
        </div>
      ))}
    </section>
  );
}
