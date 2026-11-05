import type { ModuleRouteRule } from "@peebee/shared";

/** Which screens belong to which Services module; opening one whose module is off shows "Currently Offline", and every link into it is hidden or greyed out as Admin chose. */
export const MODULE_ROUTES: ModuleRouteRule[] = [
  { prefix: "/fuel", module: "buy.gas", title: "Fuel" },
  { prefix: "/spotlight", module: "channels", title: "Spotlight" },
];
