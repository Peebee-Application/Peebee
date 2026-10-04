"use client";

import type { ListItem, OrderRow } from "@peebee/shared";
import { ChevronDown, MapPin } from "lucide-react";
import { useState } from "react";
import { formatUgx, orderTitle, stageLabel } from "../lib/order-display";

/**
 * A collapsed order card at the top of the chat thread — tap to expand
 * into the full item list (shopping) or pickup/destination detail
 * (parcel), without leaving the conversation to check what's actually in
 * this order.
 */
export function OrderSummaryCard({ order, items }: { order: OrderRow; items: ListItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0 border-b border-[var(--border-faint)] bg-[rgb(var(--surface-card))]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-ink">{orderTitle(order)}</span>
          <span className="block text-[11px] text-ink-500">
            {stageLabel(order.stage, order.type, !!order.is_ride)}
            {order.final_total != null || order.estimated_total != null
              ? ` · ${formatUgx(order.final_total ?? order.estimated_total)}`
              : ""}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-500 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-[var(--border-faint)] px-4 py-3">
          {order.type === "shopping" && !order.restaurant_id && (
            <ul className="space-y-1.5">
              {items.length === 0 && <li className="text-xs text-ink-500">No items listed.</li>}
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink">
                    {item.quantity}× {item.name}
                  </span>
                  {item.unit_price != null && <span className="text-ink-500">{formatUgx(item.unit_price)}</span>}
                </li>
              ))}
            </ul>
          )}

          {(order.type === "parcel" || !!order.restaurant_id) && (
            <div className="space-y-1.5">
              {order.pickup_area && (
                <p className="flex items-start gap-1.5 text-xs text-ink">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={2} aria-hidden />
                  <span>
                    {order.is_ride ? "Pickup point: " : "Pickup: "}
                    {order.pickup_area}
                    {order.pickup_address ? ` · ${order.pickup_address}` : ""}
                  </span>
                </p>
              )}
              {order.destination_area && (
                <p className="flex items-start gap-1.5 text-xs text-ink">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={2} aria-hidden />
                  <span>
                    {order.is_ride ? "Destination: " : "Deliver to: "}
                    {order.destination_area}
                    {order.destination_address ? ` · ${order.destination_address}` : ""}
                  </span>
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-2 text-xs">
            <span className="text-ink-500">Delivery fee</span>
            <span className="font-semibold text-ink">{formatUgx(order.delivery_fee)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
