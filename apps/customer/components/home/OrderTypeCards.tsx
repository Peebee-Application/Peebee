"use client";

import { useEffect, useState } from "react";
import { loadMapTiles } from "../../lib/map-tiles";
import { useTranslate } from "../../lib/i18n";
import { loadPlaces } from "../../lib/places";
import { SearchPill } from "../ui/SearchPill";
import { ParcelModal } from "./ParcelModal";
import { RideModal } from "./RideModal";
import { ServiceTiles } from "./ServiceTiles";
import { ShoppingListModal } from "./ShoppingListModal";

/** "Where to?" bar plus the four service tiles. Ride, shopping and parcel
 * open their existing modals; food goes to the restaurants list. */
export function OrderTypeCards() {
  const [open, setOpen] = useState<"shopping" | "parcel" | "ride" | null>(null);
  const t = useTranslate();

  // Warm up everything the place picker needs while the customer is still
  // looking at Home, so tapping an order type opens it already populated:
  // saved/recent places, the map provider, and the map code itself.
  useEffect(() => {
    void loadPlaces();
    void loadMapTiles();
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 600));
    idle(() => {
      void import("../maps/PlaceMap");
      void import("../PlaceFlow");
    });
  }, []);

  return (
    <>
      <div className="space-y-4">
        <SearchPill label={t("where_to")} onClick={() => setOpen("ride")} />
        <ServiceTiles
          onRide={() => setOpen("ride")}
          onShopping={() => setOpen("shopping")}
          onParcel={() => setOpen("parcel")}
        />
      </div>
      {open === "shopping" && <ShoppingListModal onClose={() => setOpen(null)} />}
      {open === "parcel" && <ParcelModal onClose={() => setOpen(null)} />}
      {open === "ride" && <RideModal onClose={() => setOpen(null)} />}
    </>
  );
}
