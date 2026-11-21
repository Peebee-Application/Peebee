"use client";

import type { OrderRow } from "@peebee/shared";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

type Context = { path: string; group: "ride" | "shopping" };
let current: Context | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(value: Context | null) { current = value; listeners.forEach((listener) => listener()); }

/** Resolve /orders/:id from the actual order, rather than assuming all orders are shopping. */
export function useRegisterOrderNavContext(order: Pick<OrderRow, "is_ride"> | null | undefined) {
  const path = usePathname();
  const group = order ? order.is_ride ? "ride" : "shopping" : null;
  useEffect(() => {
    if (!group) return;
    const value: Context = { path, group };
    publish(value);
    return () => { if (current === value) publish(null); };
  }, [path, group]);
}
export function useOrderNavContext() { return useSyncExternalStore(subscribe, () => current, () => null); }
