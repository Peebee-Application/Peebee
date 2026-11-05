"use client";

import { DEFAULT_RIDE_TRACKING_SETTINGS, type OrderRow } from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth-context";
import { useLivePolling } from "./use-live-polling";

/** Stages in which a passenger ride is under way: heading to pickup, waiting, on the trip, waiting for the passenger to confirm. */
export const RIDE_MODE_STAGES = ["Deliver", "Arrived", "PickedUp", "Handover"];

const dismissKey = (orderId: string) => `peebee-ride-mode-left-${orderId}`;

/** A rider can leave ride mode for one ride only when it is stuck at the end (the passenger never confirmed). */
export function rideModeLeft(orderId: string): boolean {
  try { return localStorage.getItem(dismissKey(orderId)) === "1"; } catch { return false; }
}

export function leaveRideMode(orderId: string) {
  try { localStorage.setItem(dismissKey(orderId), "1"); } catch { /* storage unavailable: the rider just stays in ride mode */ }
}

export function inRideMode(order: Pick<OrderRow, "id" | "is_ride" | "stage">, rideModeOn: boolean): boolean {
  return rideModeOn && !!order.is_ride && RIDE_MODE_STAGES.includes(order.stage) && !rideModeLeft(order.id);
}

/**
 * The ride this rider is moving on right now, or null.
 * Polls the rider's orders; a rider with no moving ride, or with ride mode switched off, gets null.
 * Admin → Ride tracking switches ride mode on or off for everyone.
 */
export function useMovingRide(): OrderRow | null {
  const { user } = useAuth();
  const isRider = user?.role === "rider";
  const [rideModeOn, setRideModeOn] = useState<boolean>(DEFAULT_RIDE_TRACKING_SETTINGS.rideMode);
  const [ride, setRide] = useState<OrderRow | null>(null);

  useEffect(() => {
    if (!isRider) return;
    api.getSettings().then(({ settings }) => setRideModeOn(settings.rideTracking?.rideMode ?? DEFAULT_RIDE_TRACKING_SETTINGS.rideMode)).catch(() => {});
  }, [isRider]);

  const refresh = useCallback(() => {
    if (!isRider) return;
    api.myRiderOrders().then(({ orders }) => setRide(orders.find((o) => inRideMode(o, rideModeOn)) ?? null)).catch(() => {});
  }, [isRider, rideModeOn]);
  useLivePolling(refresh, 5000, [refresh]);

  return isRider && rideModeOn ? ride : null;
}
