"use client";

import type { StoreDigitalFulfillment } from "@peebee/shared";

/** Subscription expiry must not hide the tools needed to service an existing purchase. */
export function ExistingDigitalPurchases({ purchases, canRefund, onRefund, onRevoke }: {
  purchases: StoreDigitalFulfillment[];
  canRefund: boolean;
  onRefund: (id: string) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
}) {
  if (!purchases.length) return null;
  return <section className="home-card space-y-4" aria-labelledby="existing-digital-purchases">
    <div>
      <h2 id="existing-digital-purchases" className="text-lg font-bold">Existing digital purchases</h2>
      <p className="text-sm text-ink-500">Your plan does not accept new digital sales. You can still service purchases made before expiry.</p>
    </div>
    {purchases.map(purchase => <div key={purchase.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-3">
      <div className="min-w-0">
        <h3 className="font-bold">{purchase.digital_product_title || "Digital purchase"}</h3>
        <p className="text-sm text-ink-500">{purchase.customer_name || "Customer"} · {purchase.refunded_at ? "Refund recorded" : purchase.status}</p>
      </div>
      {canRefund && !purchase.refunded_at && <div className="flex flex-wrap gap-2">
        {Number(purchase.price_paid_ugx) > 0 && <button type="button" className="min-h-11 rounded-full border border-gold px-4 text-sm font-bold" onClick={() => void onRefund(purchase.id)}>Refund purchase</button>}
        {purchase.status === "active" && <button type="button" className="min-h-11 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold" onClick={() => void onRevoke(purchase.id)}>Revoke access</button>}
      </div>}
    </div>)}
  </section>;
}
