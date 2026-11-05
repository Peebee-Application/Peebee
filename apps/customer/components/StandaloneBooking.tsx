"use client";

import { useRouter } from "next/navigation";
import { ParcelModal } from "./home/ParcelModal";
import { RideModal } from "./home/RideModal";
import { ShoppingListModal } from "./home/ShoppingListModal";

export function StandaloneRideBooking({ mode, cargo = false, service }: { mode: "boda" | "car"; cargo?: boolean; service?: "luxury" | "ambulance" }) {
  const router = useRouter();
  return (
    <RideModal
      initialMode={mode}
      initialCargo={cargo}
      initialService={service}
      serviceLocked
      // Boda and Car shortcuts already know the ride: pick a destination and go straight to payment.
      autoBook={!cargo && !service}
      onClose={() => router.push("/")}
    />
  );
}

export function StandaloneShoplist() {
  const router = useRouter();
  return <ShoppingListModal onClose={() => router.push("/")} />;
}

export function StandaloneParcelBooking() {
  const router = useRouter();
  return <ParcelModal onClose={() => router.push("/")} />;
}
