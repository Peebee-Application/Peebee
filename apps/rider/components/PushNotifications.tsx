"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { pushSupported, subscribeToPush } from "../lib/push";

const DISMISS_KEY = "peebee-push-dismissed-at";
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Two jobs: silently keep an already-granted subscription registered on
 * every load (a new device, a cleared subscription, or a service worker
 * update can all drop it without the OS-level permission itself changing),
 * and — once the app is installed, where push delivery is actually
 * reliable — ask once for permission if it's still undecided.
 */
export function PushNotifications() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user || !pushSupported()) return;
    if (typeof Notification === "undefined") return;

    if (Notification.permission === "granted") {
      void subscribeToPush();
      return;
    }
    if (Notification.permission === "denied") return;
    if (!isStandalone()) return;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 86400000) return;
    setVisible(true);
  }, [user]);

  async function enable() {
    setVisible(false);
    const permission = await Notification.requestPermission();
    if (permission === "granted") await subscribeToPush();
  }

  function dismiss() {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-[60] mx-auto max-w-lg px-4">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3 shadow-lg">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
          <Bell className="h-5 w-5" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Turn on notifications</p>
          <p className="truncate text-xs text-ink-500">Get notified the moment a new message arrives</p>
        </div>
        <button onClick={enable} className="shrink-0 rounded-full bg-gold px-3 py-2 text-xs font-bold text-ink-gold">
          Enable
        </button>
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 p-1 text-ink-500/60">
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
