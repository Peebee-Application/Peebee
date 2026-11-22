"use client";

import { useEffect } from "react";
import { installNotificationSound } from "@peebee/shared";

export function ServiceWorkerRegister() {
  useEffect(() => {
    const stopSound = installNotificationSound();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // The service worker shows saved data instantly and checks the server in
    // the background; when the server copy differs it says so here, and live
    // screens (see useLivePolling) reload that one piece of data.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "peebee-data-updated" || e.data?.type === "peebee-notification") window.dispatchEvent(new CustomEvent("peebee:data-updated"));
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      stopSound();
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);
  return null;
}
