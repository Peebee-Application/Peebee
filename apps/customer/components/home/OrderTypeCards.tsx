"use client";

import { useState } from "react";
import { useTranslate } from "../../lib/i18n";
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
