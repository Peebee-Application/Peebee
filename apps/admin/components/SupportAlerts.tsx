"use client";

import { hasPermission, playNotificationSound } from "@peebee/shared";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { adminRequest } from "../lib/admin-request";
import { useAuth } from "../lib/auth-context";
import { pushState, subscribeToPush } from "../lib/push";
import { toast } from "./shell/Toaster";

type Summary = { ready: boolean; waiting: number; mine: number; newestWaitingAt: string | null; agentsOnline: number | null; alertsEnabled?: boolean };
type Value = { enabled: boolean; waiting: number; mine: number; agentsOnline: number | null };

const SupportAlertsContext = createContext<Value>({ enabled: false, waiting: 0, mine: 0, agentsOnline: null });
export const useSupportAlerts = () => useContext(SupportAlertsContext);

const POLL_MS = 15_000;

/**
 * For staff who can answer support chats: keeps count of chats waiting for a person anywhere in the admin app, plays a sound
 * and shows a message when a new one arrives, puts the count in the tab title, and quietly keeps this device's push
 * subscription alive when it has already been allowed. (Push is what reaches staff when the app is closed.)
 */
export function SupportAlertsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const allowed = hasPermission(user?.adminRole ?? null, "chat.view_support");
  const [summary, setSummary] = useState<Summary | null>(null);
  const lastNewest = useRef<string | null | undefined>(undefined);
  const baseTitle = useRef<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await adminRequest<Summary>("/admin/support-chats/summary");
        if (stopped) return;
        setSummary(s);
        // The first answer is a baseline, not news. After that, a newer waiting chat is.
        if (lastNewest.current !== undefined && s.newestWaitingAt && s.newestWaitingAt !== lastNewest.current && s.alertsEnabled !== false) {
          playNotificationSound();
          toast("A visitor is asking for support", "success");
        }
        lastNewest.current = s.newestWaitingAt;
      } catch { /* a dropped connection waits for the next poll */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    // Allowed on this device before? Make sure the subscription is still registered (a browser update can drop it).
    void pushState().then((state) => { if (state === "on") void subscribeToPush(); }).catch(() => undefined);
    return () => { stopped = true; clearTimeout(timer); };
  }, [allowed]);

  const waiting = allowed ? summary?.waiting ?? 0 : 0;
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    const base = document.title.replace(/^\(\d+\)\s*/, "") || baseTitle.current;
    document.title = waiting > 0 ? `(${waiting}) ${base}` : base;
  }, [waiting]);

  const value = useMemo<Value>(() => ({ enabled: allowed, waiting, mine: allowed ? summary?.mine ?? 0 : 0, agentsOnline: summary?.agentsOnline ?? null }), [allowed, waiting, summary]);
  return <SupportAlertsContext.Provider value={value}>{children}</SupportAlertsContext.Provider>;
}
