import type { ModuleRouteRule } from "@peebee/shared";

/** Which screens belong to which Services module; a screen whose module is off shows "Currently Offline" with Admin's notice instead, and links into it are inactive. */
export const MODULE_ROUTES: ModuleRouteRule[] = [
  { prefix: "/", module: "buy.marketplace", title: "Store", exact: true },
  { prefix: "/outlets", module: "buy.marketplace", title: "Outlets" },
  { prefix: "/reports", module: "buy.marketplace", title: "Reports" },
  { prefix: "/store", module: "buy.marketplace", title: "Products" },
];
