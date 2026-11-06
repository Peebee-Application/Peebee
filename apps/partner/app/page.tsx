"use client";

import { Select } from "@peebee/shared/select";

import type { CarDriverActive, CarOwnerRides } from "@peebee/shared";
import { Bus, CarFront, Clock, Fuel, Package, Power, Search, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Accordion } from "../components/Accordion";
import { ActiveRide } from "../components/ActiveRide";
import { ApplyCard } from "../components/ApplyCard";
import { KycCard } from "../components/KycCard";
import { DriverConnections } from "../components/DriverConnections";
import { OwnerDealsPanel } from "../components/OwnerDeals";
import { CarPracticeDemo } from "../components/CarPracticeDemo";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;

export default function HomePage() {
  const { me, meReady, mode } = useAuth();
  if (!meReady) return null;
  return (
    <div className="space-y-4 px-4 py-5">
      {mode === "driver" ? <DriverHome /> : <OwnerHome />}
      {me && !me.vehicles.length && mode === "owner" && me.ownerStatus === "approved" && null}
    </div>
  );
}


function Tile({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link href={href} className="home-card flex min-h-24 flex-col items-center justify-center gap-2 !p-3 text-center active:scale-[0.98]">
      <Icon className="h-8 w-8 text-gold" aria-hidden />
      <span className="text-lg font-bold text-ink">{label}</span>
    </Link>
  );
}

function Earned({ label, amount }: { label: string; amount: number }) {
  return (
    <section className="home-card !bg-black-700 text-white dark:!bg-black">
      <p className="text-base text-white/70">{label}</p>
      <p className="text-4xl font-black tabular-nums">{ugx(amount)}</p>
    </section>
  );
}

function DriverHome() {
  const { me, refreshMe } = useAuth();
  const [data, setData] = useState<CarDriverActive | null>(null);
  const [vehicleChoice, setVehicleChoice] = useState("");
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

  if (me?.driverStatus !== "approved") {
    return (
      <>
        <CarPracticeDemo mode="driver" />
        <ApplyCard mode="driver" />
        <KycCard mode="driver" />
        {me?.driverStatus === "pending" && me.needsVehicle && (
          <p className="home-card text-base text-ink-500">You told us you don&apos;t have a car. Once you&apos;re approved you can ask owners to drive theirs, or Peebee can assign you one.</p>
        )}
        {me?.driverStatus === "pending" && !me.needsVehicle && (
          <Link href="/vehicles" className="home-card flex min-h-16 items-center gap-3 text-xl font-bold text-ink"><CarFront className="h-7 w-7 text-gold" aria-hidden /> Add your car</Link>
        )}
      </>
    );
  }

  async function toggle() {
    if (!me) return;
    setBusy(true);
    setError("");
    try {
      const position = me.online ? undefined : await currentPosition();
      await api.carDriverOnline(!me.online, position, vehicleChoice || undefined);
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
      <CarPracticeDemo mode="driver" />
      <KycCard mode="driver" />
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {data?.active && <ActiveRide ride={data.active} onChange={load} />}

      {!data?.active && (
        <section className="home-card space-y-4 text-center">
          <p className="flex items-center justify-center gap-2 text-xl font-bold text-ink">
            <CarFront className="h-6 w-6 text-gold" aria-hidden />
            {vehicle ? `${vehicle.plate} · ${vehicle.category_name}` : "No car yet"}
          </p>
          {!me.online && me.assignedVehicles.length > 1 && (
            <Select value={vehicleChoice} onValueChange={(value) => setVehicleChoice(value)} aria-label="Which car" className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3 text-lg">
              <option value="">Which car?</option>
              {me.assignedVehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.category_name}</option>)}
            </Select>
          )}
          <button
            disabled={busy || !vehicle}
            onClick={toggle}
            className={`flex min-h-20 w-full items-center justify-center gap-3 rounded-full text-2xl font-extrabold disabled:opacity-50 ${me.online ? "bg-green/15 text-green" : "bg-gold text-ink-gold shadow-[0_6px_16px_rgba(201,162,39,0.35)]"}`}
          >
            <Power className="h-7 w-7" aria-hidden />
            {busy ? "Please wait…" : me.online ? "Online · tap to stop" : "Go online"}
          </button>
          {me.online && (
            <Link href="/jobs" className="flex min-h-14 items-center justify-center gap-2 text-xl font-bold text-gold">
              <Search className="h-6 w-6" aria-hidden /> Ride requests
            </Link>
          )}
        </section>
      )}

      <Earned label="Earned" amount={data?.totalEarned ?? 0} />

      <div className="grid grid-cols-2 gap-3">
        <Tile href="/fuel" icon={Fuel} label="Fuel" />
        <Tile href="/taxipress" icon={Bus} label="Taxipress" />
        <Tile href="/relay" icon={Package} label="Parcels" />
        <Tile href="/find-car" icon={Search} label={vehicle ? "Other car" : "Find a car"} />
      </div>
      <Link href="/vehicles" className="home-card flex min-h-16 items-center gap-3 text-xl font-bold text-ink">
        <CarFront className="h-7 w-7 text-gold" aria-hidden /> My cars
      </Link>

      <DriverConnections />

      {data && data.recent.length > 0 && (
        <Accordion title="Recent rides" icon={Clock} summary={data.recent.length}>
          <div className="divide-y divide-[var(--border-faint)]">
            {data.recent.slice(0, 5).map((r) => (
              <div key={r.order_id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0 flex-1 truncate text-lg text-ink">{r.destination_address ?? "Ride"}</span>
                <strong className="shrink-0 text-lg tabular-nums">{ugx(r.driver_amount)}</strong>
              </div>
            ))}
          </div>
        </Accordion>
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

  if (me?.ownerStatus !== "approved") {
    return (
      <>
        <CarPracticeDemo mode="owner" />
        <ApplyCard mode="owner" />
        <KycCard mode="owner" />
        {me?.ownerStatus === "pending" && <Link href="/vehicles" className="home-card flex min-h-16 items-center gap-3 text-xl font-bold text-ink"><CarFront className="h-7 w-7 text-gold" aria-hidden /> Add your car</Link>}
      </>
    );
  }

  const live = data?.rides.filter((r) => r.status === "requested") ?? [];
  const past = data?.rides.filter((r) => r.status !== "requested") ?? [];
  return (
    <>
      <CarPracticeDemo mode="owner" />
      <KycCard mode="owner" />
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <Earned label={`Earned · ${me.vehicles.length} car${me.vehicles.length === 1 ? "" : "s"}`} amount={data?.totalEarned ?? 0} />

      <div className="grid grid-cols-2 gap-3">
        <Tile href="/vehicles" icon={CarFront} label="My cars" />
        <Tile href="/fuel" icon={Fuel} label="Fuel" />
      </div>

      <OwnerDealsPanel />

      <Accordion title="Rides now" icon={Search} summary={live.length} defaultOpen={live.length > 0}>
        {live.length === 0 && <p className="py-2 text-lg text-ink-500">None right now</p>}
        <div className="divide-y divide-[var(--border-faint)]">
          {live.map((r) => (
            <div key={r.id} className="py-3">
              <p className="text-lg font-bold text-ink">{r.plate ?? "Waiting for a driver"} · {r.stage}</p>
              <p className="text-base text-ink-500">{r.driver_name ? `${r.driver_name} · ` : ""}{r.pickup_address ?? "—"} → {r.destination_address ?? "—"}</p>
            </div>
          ))}
        </div>
      </Accordion>

      {data?.drivers && data.drivers.length > 0 && (
        <Accordion title="Drivers" icon={Users} summary={data.drivers.length}>
          <div className="divide-y divide-[var(--border-faint)]">
            {data.drivers.map((d) => (
              <div key={d.driverId} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0"><span className="block truncate text-lg font-bold text-ink">{d.name}</span><span className="text-base text-ink-500">{d.rides} ride{d.rides === 1 ? "" : "s"} · you {ugx(d.ownerEarned)}</span></span>
                <strong className="shrink-0 text-lg tabular-nums">{ugx(d.driverEarned)}</strong>
              </div>
            ))}
          </div>
        </Accordion>
      )}

      {past.length > 0 && (
        <Accordion title="Past rides" icon={Clock} summary={past.length}>
          <div className="divide-y divide-[var(--border-faint)]">
            {past.slice(0, 8).map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-lg text-ink">{r.plate} · {r.destination_address ?? "Ride"}</span>
                  <strong className="shrink-0 text-lg tabular-nums">{ugx(r.owner_amount ?? 0)}</strong>
                </div>
                <p className="text-base text-ink-500">{r.driver_name ? `${r.driver_name} ${ugx(r.driver_amount ?? 0)} · ` : ""}Peebee {ugx(r.platform_amount ?? 0)}</p>
              </div>
            ))}
          </div>
        </Accordion>
      )}
    </>
  );
}
