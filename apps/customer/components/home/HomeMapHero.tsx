"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` at import time, so it can't render on the server.
const HomeMap = dynamic(() => import("./HomeMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[rgb(var(--surface-muted))]" aria-hidden />,
});

/** Map band at the top of Home. The content below overlaps its lower edge
 * as a rounded sheet (see app/page.tsx). */
export function HomeMapHero() {
  return (
    <div className="isolate h-[36dvh] min-h-60 w-full overflow-hidden">
      <HomeMap />
    </div>
  );
}
