"use client";

import { observeNotificationSnapshot } from "@peebee/shared";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useLivePolling } from "../lib/use-live-polling";

/** Keep discovering jobs away from Home too; Home owns its visible feed. */
export function JobAvailabilityWatcher() {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const pending = useRef(false);
  useLivePolling(() => {
    if (!ready || !user || pathname === "/" || pending.current) return;
    pending.current = true;
    void api.availableJobs()
      .then(({ jobs }) => observeNotificationSnapshot("rider-jobs", jobs.map((job) => job.id)))
      .catch(() => {}) // The next scan retries; the current page keeps working.
      .finally(() => { pending.current = false; });
  }, 6000, [ready, user?.id, pathname]);
  return null;
}
