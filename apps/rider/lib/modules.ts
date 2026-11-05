"use client";

import { createUseModules } from "@peebee/shared/use-modules";
import { api } from "./api";

export { filterByModule } from "@peebee/shared/use-modules";

/** Admin's Services switches as the rider app sees them: `on("buy.gas")` is false while Fuel (or Buy) is off. */
export const useModules = createUseModules(() => api.getSettings());
