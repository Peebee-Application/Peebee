import type { OrderRow } from "@peebee/shared";
let snapshot: { scope: string; order: OrderRow | null } | null = null;
const listeners = new Set<() => void>();
export function publishActiveOrder(scope: string, order: OrderRow | null) { snapshot = { scope, order }; listeners.forEach(listener => listener()); }
export function readActiveOrder(scope: string): OrderRow | null | undefined { return snapshot?.scope === scope ? snapshot.order : undefined; }
export function subscribeActiveOrder(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
