"use client";

import { DEFAULT_RIDE_TRACKING_SETTINGS, type RideTrackingSettings } from "@peebee/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";

/** One location watch across the rider app, independent of the navigation screen. */
export function ActiveJourneyTracking() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<RideTrackingSettings | null>(null);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const userId = user?.role === "rider" ? user.id : null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    function refresh() {
      api.getSettings().then(({ settings }) => {
        if (!cancelled) setSettings(settings.rideTracking ?? DEFAULT_RIDE_TRACKING_SETTINGS);
      }).catch(() => { /* Keep the latest known settings during a connection failure. */ });
    }
    refresh();
    const timer = setInterval(refresh, (settings?.routeRefreshSeconds ?? DEFAULT_RIDE_TRACKING_SETTINGS.routeRefreshSeconds) * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [userId, settings?.routeRefreshSeconds]);

  const intervalSeconds = settings?.locationIntervalSeconds ?? DEFAULT_RIDE_TRACKING_SETTINGS.locationIntervalSeconds;
  useEffect(() => {
    if (!userId || !settings?.enabled) { setOrderIds([]); return; }
    let cancelled = false;
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const { orders } = await api.myRiderOrders();
        if (!cancelled) setOrderIds(orders.filter((order) => !["Create", "Settle", "Cancelled", "Handover"].includes(order.stage)).map((order) => order.id).sort());
      } catch { if (!cancelled) setOrderIds([]); }
      finally { loading = false; }
    }
    void refresh();
    const id = setInterval(() => void refresh(), intervalSeconds * 1000);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener("focus", refresh); };
  }, [userId, settings?.enabled, intervalSeconds]);

  const ordersKey = orderIds.join(",");
  useEffect(() => {
    if (!userId || !settings?.enabled || !ordersKey) { setStatus(null); return; }
    if (!navigator.geolocation) { setStatus("Location is unavailable. Customers cannot see your live position."); return; }
    let cancelled = false;
    let sending = false;
    let lastSent = 0;
    const ids = ordersKey.split(",");
    setStatus("Sharing your location with customers during active journeys. Keep Peebee open for live tracking.");
    const watch = navigator.geolocation.watchPosition(async (position) => {
      if (cancelled || sending || Date.now() - lastSent < intervalSeconds * 1000) return;
      lastSent = Date.now();
      sending = true;
      const results = await Promise.allSettled(ids.map((id) => api.postOrderLocation(id, position.coords.latitude, position.coords.longitude)));
      sending = false;
      if (cancelled) return;
      if (results.some((result) => result.status === "fulfilled")) {
        lastSent = Date.now();
        setStatus("Live location is shared with customers. Keep Peebee open while travelling.");
      } else setStatus("Location update failed. Check your connection to resume live tracking.");
    }, () => {
      if (!cancelled) setStatus("Allow location access so customers can follow your journey. Keep Peebee open while travelling.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    return () => { cancelled = true; navigator.geolocation.clearWatch(watch); };
  }, [userId, ordersKey, intervalSeconds, settings?.enabled]);

  return userId && status ? <p role="status" className="mx-auto max-w-lg border-b border-[var(--border-faint)] px-4 py-2 text-xs text-ink-500">{status}</p> : null;
}
