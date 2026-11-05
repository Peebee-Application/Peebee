import type { ModuleRouteRule } from "@peebee/shared";

/** Which screens belong to which Services module; a screen whose module is off shows "Currently Offline" with Admin's notice instead, and links into it are inactive. */
export const MODULE_ROUTES: ModuleRouteRule[] = [
  { prefix: "/", module: "buy.pharmacy", title: "Pharmacy", exact: true },
  { prefix: "/prescriptions", module: "buy.pharmacy", title: "Rx Review" },
  { prefix: "/inventory", module: "buy.pharmacy", title: "Medicines" },
];
