"use client";
import { useEffect, useRef, useState } from "react";
import { fetchDrivingRoute, type OsrmRoute } from "./navTiles";

export function useRoadRoute(fromLat: number | null | undefined, fromLng: number | null | undefined, toLat: number | null | undefined, toLng: number | null | undefined, refreshSeconds?: number) {
  const key = fromLat != null && fromLng != null && toLat != null && toLng != null ? `${refreshSeconds ? "live" : `${fromLat},${fromLng}`}:${toLat},${toLng}` : null;
  const coordinates = useRef({ fromLat, fromLng, toLat, toLng });
  useEffect(() => { coordinates.current = { fromLat, fromLng, toLat, toLng }; }, [fromLat, fromLng, toLat, toLng]);
  const [result, setResult] = useState<{ key: string; route: OsrmRoute; updatedAt: number } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let loading = false;
    let controller: AbortController | null = null;
    async function refresh() {
      if (loading) return;
      loading = true; controller = new AbortController();
      try {
        const { fromLat, fromLng, toLat, toLng } = coordinates.current;
        const route = await fetchDrivingRoute({ lat: fromLat!, lng: fromLng! }, { lat: toLat!, lng: toLng! }, controller.signal);
        if (!cancelled) setResult(route ? { key: key!, route, updatedAt: Date.now() } : null);
      } catch { if (!cancelled) setResult(null); }
      finally { loading = false; }
    }
    void refresh();
    const timer = refreshSeconds ? setInterval(() => void refresh(), refreshSeconds * 1000) : null;
    return () => { cancelled = true; controller?.abort(); if (timer) clearInterval(timer); };
  }, [key, refreshSeconds]);
  return result?.key === key ? result : null;
}
