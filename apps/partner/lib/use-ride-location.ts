"use client";

import { useEffect } from "react";
import { api } from "./api";

/**
 * While a ride is in progress, share the driver's position every few seconds:
 * it powers the customer's live map and the "is the driver on the way" check
 * for scheduled rides. Quietly does nothing if location is blocked.
 */
export function useRideLocation(orderId: string | null) {
  useEffect(() => {
    if (!orderId || typeof navigator === "undefined" || !navigator.geolocation) return;
    const send = () =>
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const { latitude: lat, longitude: lng } = p.coords;
          void api.postOrderLocation(orderId, lat, lng).catch(() => undefined);
          void api.carDriverLocation(lat, lng).catch(() => undefined);
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 },
      );
    send();
    const timer = window.setInterval(send, 6000);
    return () => window.clearInterval(timer);
  }, [orderId]);
}
