import type { ModuleRouteRule } from "@peebee/shared";

/** Which screens belong to which Services module; a screen whose module is off shows "Currently Offline" with Admin's notice instead, and links into it are inactive. */
export const MODULE_ROUTES: ModuleRouteRule[] = [
  { prefix: "/", module: "learn", title: "Learn", exact: true },
  { prefix: "/schools", module: "learn", title: "Schools" },
  { prefix: "/courses", module: "learn", title: "Courses" },
  { prefix: "/classes", module: "learn", title: "Classes" },
  { prefix: "/streams", module: "learn", title: "Streams" },
  { prefix: "/classroom", module: "learn.live", title: "Live classes" },
  { prefix: "/live", module: "learn.live", title: "Live classes" },
];
