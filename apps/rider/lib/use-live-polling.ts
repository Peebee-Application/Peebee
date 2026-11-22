import { useEffect, useRef } from "react";

/** Network Information API isn't in TS's default DOM lib, and only Chromium
 * browsers support it — everywhere else this is just undefined and the
 * base interval is used unchanged. */
type NetworkInformation = { effectiveType?: string; saveData?: boolean };

function scaledIntervalMs(base: number): number {
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!conn) return base;
  if (conn.saveData) return base * 3;
  if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") return base * 3;
  if (conn.effectiveType === "3g") return base * 1.5;
  return base;
}

/**
 * Polls `callback` on a fixed cadence — but only while the tab is actually
 * visible and the device is online, and backs off further on a detected
 * slow connection. A plain `setInterval` used to keep firing at full rate
 * forever, including a backgrounded tab or a phone with the screen off,
 * which on Uganda's data prices is pure waste for zero benefit (nobody's
 * looking at a screen that isn't visible). Catches up immediately when the
 * tab regains visibility or the connection comes back, so returning to the
 * app never shows stale data for a full cycle.
 */
export function useLivePolling(callback: () => void, intervalMs: number, deps: unknown[]): void {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function runIfActive() {
      if (document.visibilityState === "visible" && navigator.onLine) {
        callbackRef.current();
      }
    }

    function schedule() {
      if (stopped) return;
      timer = setTimeout(() => {
        runIfActive();
        schedule();
      }, scaledIntervalMs(intervalMs));
    }

    runIfActive();
    schedule();

    document.addEventListener("visibilitychange", runIfActive);
    window.addEventListener("online", runIfActive);
    window.addEventListener("focus", runIfActive);
    window.addEventListener("pageshow", runIfActive);
    window.addEventListener("peebee:data-updated", runIfActive);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", runIfActive);
      window.removeEventListener("online", runIfActive);
      window.removeEventListener("focus", runIfActive);
      window.removeEventListener("pageshow", runIfActive);
      window.removeEventListener("peebee:data-updated", runIfActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
