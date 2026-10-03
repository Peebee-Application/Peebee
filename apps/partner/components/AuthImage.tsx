"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** A vehicle photo. The image needs the sign-in header, so it's fetched as a blob. */
export function AuthImage({ vehicleId, photoId, className }: { vehicleId: string; photoId: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    api
      .carVehiclePhotoBlob(vehicleId, photoId)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vehicleId, photoId]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className={className} /> : <span className={`${className ?? ""} bg-[rgb(var(--surface-muted))]`} aria-hidden />;
}
