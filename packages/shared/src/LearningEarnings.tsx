"use client";
import { useEffect, useState } from "react";
import type { learningCreatorMethods } from "./learn-creator.js";
type Api = ReturnType<typeof learningCreatorMethods>;
type Purchase = Awaited<
  ReturnType<Api["learningEarnings"]>
>["purchases"][number];
export function LearningEarnings({ api }: { api: Api }) {
  const [rows, setRows] = useState<Purchase[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api
      .learningEarnings()
      .then((r) => active && setRows(r.purchases))
      .catch(
        (e) =>
          active &&
          setError(
            e instanceof Error ? e.message : "Sales could not be loaded.",
          ),
      );
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4">
      <h2 className="font-semibold">Course sales and refunds</h2>
      <p className="text-sm text-ink-500">
        Payouts follow the existing Learn or Merchant Elite payment settings.
        Sandbox transactions are shown separately on each receipt.
      </p>
      {error && <p role="alert">{error}</p>}
      {rows.length === 0 && <p className="text-sm">No course sales yet.</p>}
      {rows.map((r) => (
        <article
          key={r.id}
          className="space-y-2 border-t border-[var(--border-faint)] pt-3 text-sm"
        >
          <h3 className="font-semibold">{r.title}</h3>
          <p>
            {r.environment} · {r.status} · Receipt {r.id}
          </p>
          <p>
            Sale: UGX {r.price_ugx.toLocaleString()} · Commission: UGX{" "}
            {r.commission_ugx.toLocaleString()} · Payout: UGX{" "}
            {(r.price_ugx - r.commission_ugx).toLocaleString()}
          </p>
          {r.status === "settled" &&
            (selected === r.id ? (
              <div className="space-y-2">
                <p>
                  This refunds UGX {r.price_ugx.toLocaleString()} to the buyer
                  and reverses the original payout. Access follows the platform
                  refund policy.
                </p>
                <button
                  disabled={busy}
                  className="min-h-11 rounded-xl border border-[var(--border-faint)] px-4"
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api.refundLearningPurchase(r.id);
                      setRows((await api.learningEarnings()).purchases);
                      setSelected(null);
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Refund failed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirm refund
                </button>
                <button
                  className="min-h-11 px-4"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="min-h-11 rounded-xl border border-[var(--border-faint)] px-4"
                disabled={busy}
                onClick={() => setSelected(r.id)}
              >
                Review refund
              </button>
            ))}
        </article>
      ))}
    </section>
  );
}
