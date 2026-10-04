"use client";

import type { OwnerDeals } from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { describeTerms } from "../lib/terms";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;

/** On the owner's home: drivers asking for a car, and the drivers currently using their cars. */
export function OwnerDealsPanel() {
  const [data, setData] = useState<OwnerDeals | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.dealsOwner().then(setData).catch(() => setData(null));
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

  if (!data) return null;
  const withDriver = data.vehicles.filter((v) => v.driver);
  if (data.requests.length === 0 && withDriver.length === 0) return null;
  return (
    <>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {data.requests.length > 0 && (
        <section className="home-card space-y-3 border-l-4 border-l-gold">
          <h2 className="font-bold">Drivers asking to drive your car</h2>
          {data.requests.map((r) => (
            <div key={r.id} className="space-y-2 border-t border-[var(--border-faint)] pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm font-semibold text-ink">{r.driverName} <span className="font-normal text-ink-500">· {r.plate}</span></p>
              <p className="text-xs text-ink-500">{r.ridesDone} completed ride{r.ridesDone === 1 ? "" : "s"} on Peebee{r.licenceExpiry ? ` · licence to ${r.licenceExpiry}` : ""}</p>
              <p className="text-xs text-ink">{describeTerms(r.terms)}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => act(() => api.dealsDecide(r.id, true))} className="min-h-10 flex-1 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">Accept</button>
                <button type="button" onClick={() => act(() => api.dealsDecide(r.id, false))} className="min-h-10 rounded-full bg-gold/15 px-4 text-sm font-bold text-ink">Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}
      {withDriver.length > 0 && (
        <section className="home-card space-y-3">
          <h2 className="font-bold">Drivers using your cars</h2>
          {withDriver.map((v) => (
            <div key={v.id} className="space-y-1 border-t border-[var(--border-faint)] pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm font-semibold text-ink">{v.driver!.name} <span className="font-normal text-ink-500">· {v.plate}</span></p>
              <p className="text-xs text-ink-500">{describeTerms(v.driver!.deal)}</p>
              {v.driver!.deal?.feeType === "rent" && <p className="text-xs text-ink">Rent owed so far: <strong>{ugx(v.driver!.rentOwed)}</strong></p>}
              <button type="button" onClick={() => act(() => api.dealsEnd(v.id))} className="text-xs font-bold text-red-600">End this agreement</button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
