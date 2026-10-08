"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function VehiclePhoto({ vehicleId, photoId }: { vehicleId: string; photoId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false; let objectUrl: string | null = null;
    api.carVehiclePhotoBlob(vehicleId, photoId).then((blob) => { if (!disposed) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => undefined);
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [vehicleId, photoId]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="Vehicle" className="aspect-[4/3] w-full rounded-xl object-cover" /> : <div className="aspect-[4/3] w-full animate-pulse rounded-xl bg-[rgb(var(--surface-muted))]" aria-hidden />;
}
