"use client";

import type { CarDriverActive, CarOwnerRides } from "@tuma/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ActiveRide } from "../components/ActiveRide";
import { ApplyCard } from "../components/ApplyCard";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;

export default function HomePage() {
  const { me, meReady, mode } = useAuth();
  if (!meReady) return null;
  return (
    <div className="space-y-5 px-4 py-5">
      {mode === "driver" ? <DriverHome /> : <OwnerHome />}
      {me && !me.vehicles.length && mode === "owner" && me.ownerStatus === "approved" && null}
    </div>
  );
}

function DriverHome() {
  const { me, refreshMe } = useAuth();
  const [data, setData] = useState<CarDriverActive | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.carDriverActive().then(setData).catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(() => {
    if (me?.driverStatus !== "approved") return;
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load, me?.driverStatus]);

  if (me?.driverStatus !== "approved") return <ApplyCard mode="driver" />;

  async function toggle() {
    if (!me) return;
    setBusy(true);
    setError("");
    try {
      const position = me.online ? undefined : await currentPosition();
      await api.carDriverOnline(!me.online, position);
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const vehicle = me.assignedVehicles[0];
  return (
    <>
      <header>
        <h1 className="text-2xl font-black text-ink">Driver</h1>
        <p className="text-sm text-ink-500">{vehicle ? `${vehicle.plate} · ${vehicle.category_name}` : "No vehicle assigned yet — Tuma will assign one."}</p>
      </header>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {data?.active && <ActiveRide ride={data.active} onChange={load} />}
      <button
        disabled={busy || !vehicle}
        onClick={toggle}
        className={`min-h-14 w-full rounded-full text-base font-bold disabled:opacity-50 ${me.online ? "bg-gold/15 text-ink" : "bg-gold text-ink-gold"}`}
      >
        {busy ? "Please wait…" : me.online ? "You're online — tap to go offline" : "Go online"}
      </button>
      {me.online && !data?.active && (
        <Link href="/jobs" className="home-card block text-sm font-semibold text-ink">See ride requests →</Link>
      )}
      <section className="home-card">
        <p className="text-xs text-ink-500">Earned from rides</p>
        <p className="text-2xl font-black text-ink">{ugx(data?.totalEarned ?? 0)}</p>
      </section>
      {data && data.recent.length > 0 && (
        <section className="home-card space-y-3">
          <h2 className="font-bold">Recent rides</h2>
          {data.recent.slice(0, 5).map((r) => (
            <div key={r.order_id} className="flex justify-between border-t border-[var(--border-faint)] pt-3 text-sm">
              <span className="min-w-0 pr-3"><span className="block truncate">{r.destination_address ?? "Ride"}</span></span>
              <strong>{ugx(r.driver_amount)}</strong>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function currentPosition(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

function OwnerHome() {
  const { me } = useAuth();
  const [data, setData] = useState<CarOwnerRides | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (me?.ownerStatus !== "approved") return;
    const load = () => api.carOwnerRides().then(setData).catch((err) => setError(errorMessage(err)));
    void load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [me?.ownerStatus]);

  if (me?.ownerStatus !== "approved") return <ApplyCard mode="owner" />;

  const live = data?.rides.filter((r) => r.status === "requested") ?? [];
  const past = data?.rides.filter((r) => r.status !== "requested") ?? [];
  return (
    <>
      <header>
        <h1 className="text-2xl font-black text-ink">Owner</h1>
        <p className="text-sm text-ink-500">{me.vehicles.length} vehicle{me.vehicles.length === 1 ? "" : "s"} with Tuma</p>
      </header>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <section className="home-card">
        <p className="text-xs text-ink-500">Your earnings from rides</p>
        <p className="text-2xl font-black text-ink">{ugx(data?.totalEarned ?? 0)}</p>
      </section>
      <section className="home-card space-y-3">
        <h2 className="font-bold">Rides being taken now</h2>
        {live.length === 0 && <p className="text-sm text-ink-500">None right now.</p>}
        {live.map((r) => (
          <div key={r.id} className="border-t border-[var(--border-faint)] pt-3 text-sm">
            <p className="font-semibold">{r.plate ?? "Awaiting driver"} · {r.stage}</p>
            <p className="text-xs text-ink-500">{r.driver_name ? `Driver ${r.driver_name} · ` : ""}{r.pickup_address ?? "—"} → {r.destination_address ?? "—"}</p>
          </div>
        ))}
      </section>
      {past.length > 0 && (
        <section className="home-card space-y-3">
          <h2 className="font-bold">Past rides</h2>
          {past.slice(0, 10).map((r) => (
            <div key={r.id} className="flex justify-between border-t border-[var(--border-faint)] pt-3 text-sm">
              <span className="min-w-0 pr-3"><span className="block truncate">{r.plate} · {r.destination_address ?? "Ride"}</span></span>
              <strong>{ugx(r.owner_amount ?? 0)}</strong>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
