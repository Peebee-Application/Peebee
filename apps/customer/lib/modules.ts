"use client";

import { createUseModules } from "@peebee/shared/use-modules";
import { api } from "./api";

export { filterByModule } from "@peebee/shared/use-modules";

/** Admin's Services switches as the customer app sees them: `on("ride.car")` is false while Peebee Car (or Ride) is off. */
export const useModules = createUseModules(() => api.getSettings());
