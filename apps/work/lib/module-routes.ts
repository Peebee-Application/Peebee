import type { ModuleRouteRule } from "@peebee/shared";

/** Which screens belong to which Services module; a screen whose module is off shows "Currently Offline" with Admin's notice instead, and links into it are inactive. */
export const MODULE_ROUTES: ModuleRouteRule[] = [
  { prefix: "/", module: "hive.work", title: "Work", exact: true },
  { prefix: "/team", module: "hive.work", title: "Team" },
  { prefix: "/jobs", module: "hive.work", title: "Jobs" },
];
