"use client";

import { useEffect } from "react";
import { installNotificationSound } from "@peebee/shared";

export function ServiceWorkerRegister() {
  useEffect(() => {
    const stopSound = installNotificationSound();
    // Development chunks reuse URLs; caching them can mix incompatible builds.
    if (process.env.NODE_ENV !== "development" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return stopSound;
  }, []);
  return null;
}
