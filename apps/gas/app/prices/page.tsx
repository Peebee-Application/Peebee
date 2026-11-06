"use client";

import type { FuelOutletPrice } from "@peebee/shared";
import { AlertCircle, CheckCircle2, Fuel, Pencil, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function PricesPage() {
  const { outlet, refreshOutlets } = useAuth();
  const [prices, setPrices] = useState<FuelOutletPrice[]>([]);
  const [editing, setEditing] = useState(false);
  const [editedPrices, setEditedPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

  useEffect(() => {
    if (outlet?.prices) {
      setPrices(outlet.prices);
      const map: Record<string, string> = {};
      for (const p of outlet.prices) {
        map[p.product_id] = String(p.price_per_unit);
      }
      setEditedPrices(map);
    }
  }, [outlet]);

  async function handleSave() {
    if (!outlet) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const updates = prices.map((p) => ({
        product_id: p.product_id,
        price_per_unit: Number(editedPrices[p.product_id]) || p.price_per_unit,
      }));

      await api.updateGasOutletPrices(outlet.id, updates);
      await refreshOutlets();
      setEditing(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-black text-ink">
          <Fuel className="h-7 w-7 text-gold" aria-hidden /> Prices
        </h1>
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="flex min-h-14 items-center gap-2 rounded-2xl bg-gold px-5 text-lg font-bold text-ink-gold active:scale-95">
            <Pencil className="h-5 w-5" aria-hidden /> Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="min-h-14 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4 text-lg font-bold text-ink active:scale-95">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={handleSave} className="flex min-h-14 items-center gap-2 rounded-2xl bg-gold px-5 text-lg font-bold text-ink-gold disabled:opacity-60 active:scale-95">
              <Save className="h-5 w-5" aria-hidden /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-50 p-3 text-base font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-2xl border border-green/30 bg-green/10 p-3 text-base font-semibold text-green dark:bg-green/20">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <span>Saved. Live for riders.</span>
        </div>
      )}

      <section className="space-y-3">
        {prices.map((item) => (
          <div key={item.product_id} className="home-card flex min-h-20 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <Fuel className="h-6 w-6" aria-hidden />
              </div>
              <h3 className="truncate text-xl font-bold text-ink">{item.product_name}</h3>
            </div>
            {editing ? (
              <div className="field-box flex items-center gap-1 px-3 py-2">
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={`${item.product_name} price per litre`}
                  value={editedPrices[item.product_id] ?? ""}
                  onChange={(e) => setEditedPrices((prev) => ({ ...prev, [item.product_id]: e.target.value }))}
                  className="w-28 text-right text-xl font-black text-ink outline-none"
                />
                <span className="text-base text-ink-500">/L</span>
              </div>
            ) : (
              <div className="shrink-0 text-right">
                <strong className="text-2xl font-black tabular-nums text-ink">{Number(item.price_per_unit).toLocaleString()}</strong>
                <span className="block text-base text-ink-500">UGX /L</span>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
