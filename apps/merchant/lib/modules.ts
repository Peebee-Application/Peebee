"use client";

import { createUseModules } from "@peebee/shared/use-modules";
import { api } from "./api";

export { filterByModule } from "@peebee/shared/use-modules";

/** Admin's Services switches as this app sees them: `on("buy.food")` is false while that module (or its cluster) is off. */
export const useModules = createUseModules(() => api.getSettings());
