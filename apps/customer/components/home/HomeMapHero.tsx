"use client";

import dynamic from "next/dynamic";
import type { SelectedRouteLocations } from "../maps/SelectedRoadRoute";

// Leaflet touches `window` at import time, so it can't render on the server.
const HomeMap = dynamic(() => import("./HomeMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[rgb(var(--surface-muted))]" aria-hidden />,
});

/** Read-only map band for the order screens (see Modal `withMap`). */
export function HomeMapHero({ className = "isolate h-[36dvh] min-h-60 w-full overflow-hidden", pickup, destination, bottomInset }: SelectedRouteLocations & { className?: string; bottomInset?: number }) {
  return (
    <div className={className}>
      <HomeMap pickup={pickup} destination={destination} bottomInset={bottomInset} />
    </div>
  );
}
