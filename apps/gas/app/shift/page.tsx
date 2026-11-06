"use client";

import type { FuelReceipt } from "@peebee/shared";
import { AlertCircle, CheckCircle, Clock, Fuel, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function ShiftPage() {
  const { attendant, outlet, shiftSummary, refreshShift } = useAuth();
  const [dispenses, setDispenses] = useState<FuelReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [closedNotice, setClosedNotice] = useState(false);

  const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

  async function loadDispenses() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.gasDispenses(outlet?.id);
      setDispenses(res.dispenses);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDispenses();
  }, [outlet?.id]);

  function handleCloseShift() {
    setClosedNotice(true);
    setTimeout(() => setClosedNotice(false), 5000);
  }

  const shown = showAll ? dispenses : dispenses.slice(0, 8);
  return (
    <div className="space-y-4 pb-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-black text-ink">
          <Clock className="h-7 w-7 text-gold" aria-hidden /> Shift
        </h1>
        <button
          type="button"
          onClick={() => {
            void refreshShift();
            void loadDispenses();
          }}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] text-ink active:scale-95"
          aria-label="Refresh"
        >
          <RefreshCw className="h-6 w-6" aria-hidden />
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-50 p-3 text-base font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {closedNotice && (
        <div className="flex items-center gap-2 rounded-2xl border border-green/30 bg-green/10 p-3 text-base font-semibold text-green dark:bg-green/20">
          <CheckCircle className="h-5 w-5 shrink-0" aria-hidden />
          <span>Shift saved.</span>
        </div>
      )}

      <section className="home-card space-y-3 !bg-black-700 text-white dark:!bg-black">
        <p className="text-4xl font-black tabular-nums">{ugx(shiftSummary?.total_ugx ?? 0)}</p>
        <p className="text-lg text-white/80">
          {(shiftSummary?.total_litres ?? 0).toFixed(1)} L · {shiftSummary?.total_dispenses ?? 0} refuels
        </p>
        <button
          type="button"
          onClick={handleCloseShift}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gold text-lg font-bold text-ink-gold active:scale-95"
        >
          <CheckCircle className="h-6 w-6" aria-hidden /> Close shift
        </button>
      </section>

      <section className="home-card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-ink"><Fuel className="h-6 w-6 text-gold" aria-hidden /> Refuels</h2>
          <span className="text-lg font-semibold text-ink-500">{dispenses.length}</span>
        </div>

        {dispenses.length === 0 ? (
          <div className="py-8 text-center text-lg text-ink-500">
            <Fuel className="mx-auto mb-2 h-10 w-10 text-ink-500/40" aria-hidden />
            <p>None yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-faint)]">
            {shown.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <span className="rounded-md border border-black/40 bg-[#FFD700] px-2 py-0.5 font-mono text-base font-black text-black">
                    {d.vehicle_plate}
                  </span>
                  <p className="mt-1 truncate text-base text-ink-500">{d.product_name} · {d.litres_dispensed} L</p>
                </div>
                <div className="shrink-0 text-right">
                  <strong className="text-xl font-black text-ink">{ugx(d.total_ugx)}</strong>
                  <span className="block text-base text-ink-500">
                    {new Date(d.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {dispenses.length > 8 && !showAll && (
          <button type="button" onClick={() => setShowAll(true)} className="flex min-h-14 w-full items-center justify-center text-lg font-bold text-gold">
            Show all {dispenses.length}
          </button>
        )}
      </section>
    </div>
  );
}
