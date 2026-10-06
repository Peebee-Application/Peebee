"use client";
import { usePathname } from "next/navigation";

import Image from "next/image";
import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "peebee-partner-install-dismissed-at";
const DISMISS_DAYS = 7;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 86_400_000) return;

    if (isIos()) {
      setIosHint(true);
      setVisible(true);
      return;
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDeferred(null);
    setVisible(false);
  }

  if (!visible || ["/login", "/forgot-password", "/activate", "/set-password", "/approval"].includes(pathname) || pathname.startsWith("/verify")) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-[60] mx-auto max-w-lg px-4">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface))] p-3 shadow-lg">
        <Image src="/icons/icon-192.png?v=logo-6" alt="" width={40} height={40} className="shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Install Peebee Car</p>
          <p className="truncate text-xs text-ink-500">
            {iosHint ? 'Tap Share, then "Add to Home Screen"' : "Add Peebee Car to your home screen"}
          </p>
        </div>
        {!iosHint ? (
          <button
            type="button"
            onClick={install}
            className="flex shrink-0 items-center gap-1 rounded-full bg-gold px-3 py-2 text-xs font-bold text-ink-gold"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            Install
          </button>
        ) : null}
        <button type="button" onClick={dismiss} aria-label="Dismiss install prompt" className="shrink-0 p-1 text-ink-500/60">
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
