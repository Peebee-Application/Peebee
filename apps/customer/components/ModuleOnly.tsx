"use client";

import type { ReactNode } from "react";
import { useModules } from "../lib/modules";

/**
 * Shows its children only while at least one of the named Services modules is on. For a sentence, card or button that
 * refers to a service: when Admin switches that service off, nothing that mentions it is left on the screen.
 */
export function ModuleOnly({ any, children }: { any: readonly string[]; children: ReactNode }) {
  const on = useModules();
  return any.some((key) => on(key)) ? <>{children}</> : null;
}
