"use client";

import { useRouter } from "next/navigation";
import { ParcelModal } from "./home/ParcelModal";
import { RideModal } from "./home/RideModal";
import { ShoppingListModal } from "./home/ShoppingListModal";

export function StandaloneRideBooking({ mode }: { mode: "boda" | "car" }) {
  const router = useRouter();
  return <RideModal initialMode={mode} serviceLocked onClose={() => router.push("/")} />;
}

export function StandaloneShoplist() {
  const router = useRouter();
  return <ShoppingListModal onClose={() => router.push("/")} />;
}

export function StandaloneParcelBooking() {
  const router = useRouter();
  return <ParcelModal onClose={() => router.push("/")} />;
}
