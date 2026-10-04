"use client";

import { useEffect } from "react";
import { installNotificationSound } from "@peebee/shared";

export function ServiceWorkerRegister() {
  useEffect(() => {
    const stopSound = installNotificationSound();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return stopSound;
  }, []);

  return null;
}
