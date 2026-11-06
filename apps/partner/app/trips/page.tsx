"use client";

import type { CarpoolMyTrip } from "@peebee/shared";
import { Bus, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TabBar } from "../../components/TabBar";
import { ActiveRide } from "../../components/ActiveRide";
import { PlaceSearch, type FoundPlace } from "../../components/PlaceSearch";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;
const field = "min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3";

export default function TripsPage() {
  const { me, mode } = useAuth();
  const [config, setConfig] = useState<{ maxRepeatWeeks: number } | null | undefined>(undefined);
  const [trips, setTrips] = useState<CarpoolMyTrip[]>([]);
  const [origin, setOrigin] = useState<FoundPlace | null>(null);
  const [dest, setDest] = useState<FoundPlace | null>(null);
  const [departAt, setDepartAt] = useState("");
  const [seats, setSeats] = useState("3");
  const [price, setPrice] = useState("");
  const [repeat, setRepeat] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"trips" | "publish">("trips");

  const load = useCallback(() => {
    api.carpoolMyTrips().then((r) => setTrips(r.trips)).catch(() => undefined);
  }, []);
  useEffect(() => {
    api.getCarConfig().then((c) => setConfig(c.carpool)).catch(() => setConfig(null));
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (mode !== "driver") return <p className="px-4 py-5 text-lg text-ink-500">Switch to Driver (top right) to publish carpool trips.</p>;
  if (config === undefined) return null;
  if (config === null) return <p className="px-4 py-5 text-lg text-ink-500">Carpool isn&apos;t available right now.</p>;
  if (me?.driverStatus !== "approved") return <p className="px-4 py-5 text-lg text-ink-500">Become an approved driver first (Home).</p>;

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!origin || !dest) {
      setError("Choose where from and where to.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api.carpoolPublish({
        originLabel: origin.label,
        originLat: origin.lat,
        originLng: origin.lng,
        destLabel: dest.label,
        destLat: dest.lat,
        destLng: dest.lng,
        departAt: new Date(departAt).toISOString(),
        seats: Number(seats),
        seatPrice: Number(price),
        repeatWeeks: Number(repeat) || undefined,
      });
      setNotice(res.ids.length > 1 ? `${res.ids.length} trips published.` : "Trip published.");
      setTab("trips");
      setPrice("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "departed" | "completed" | "cancelled") {
    setError("");
    try {
      await api.carpoolSetStatus(id, status);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5 px-4 py-5">
      <TabBar label="Carpool" active={tab} onChange={setTab} tabs={[{ id: "trips", label: "My trips", icon: Bus, count: trips.length }, { id: "publish", label: "Publish", icon: Plus }]} />
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p className="text-lg font-medium text-green">{notice}</p>}

      {tab === "publish" && <form onSubmit={publish} className="home-card space-y-3">
        <PlaceSearch label="From" value={origin} onPick={setOrigin} />
        <PlaceSearch label="To" value={dest} onPick={setDest} />
        <div className="space-y-1">
          <label className="text-base font-semibold text-ink-500">Departure</label>
          <input required type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)} className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-base font-semibold text-ink-500">Seats offered</label>
            <input required inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} className={field} />
          </div>
          <div className="space-y-1">
            <label className="text-base font-semibold text-ink-500">Price per seat (UGX)</label>
            <input required inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} className={field} />
          </div>
        </div>
        {config.maxRepeatWeeks > 0 && (
          <div className="space-y-1">
            <label className="text-base font-semibold text-ink-500">Repeat every week for (up to {config.maxRepeatWeeks} more weeks)</label>
            <input inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value.replace(/\D/g, ""))} className={field} />
          </div>
        )}
        <button disabled={busy || !departAt || !price} className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : "Publish"}</button>
      </form>}

      {tab === "trips" && trips.length === 0 && <p className="home-card py-8 text-center text-lg text-ink-500">No trips yet</p>}
      {tab === "trips" && trips.map((t) => (
        <section key={t.id} className="home-card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xl font-bold text-ink">{t.origin_label} → {t.dest_label}</p>
              <p className="text-base text-ink-500">{new Date(t.depart_at).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })} · {t.seats_taken}/{t.seats_total} seats · {ugx(t.seat_price)} each</p>
            </div>
            <span className="shrink-0 rounded-full bg-gold/15 px-3 py-1 text-sm font-black uppercase text-ink">{t.status}</span>
          </div>
          {t.passengers.map((p) => (
            <div key={p.order_id} className="border-t border-[var(--border-faint)] pt-3">
              <p className="mb-2 text-base text-ink-500">{p.seats} seat{p.seats === 1 ? "" : "s"}</p>
              <ActiveRide
                onChange={load}
                ride={{
                  id: p.order_id,
                  stage: p.stage,
                  estimated_total: p.estimated_total,
                  final_total: null,
                  pickup_address: p.pickup_address,
                  pickup_lat: p.pickup_lat,
                  pickup_lng: p.pickup_lng,
                  destination_address: p.destination_address,
                  destination_lat: p.destination_lat,
                  destination_lng: p.destination_lng,
                  customer_name: p.name,
                }}
              />
            </div>
          ))}
          <div className="flex gap-2">
            {(t.status === "open" || t.status === "full") && (
              <button type="button" onClick={() => setStatus(t.id, "departed")} className="min-h-14 flex-1 rounded-full bg-gold px-3 text-lg font-bold text-ink-gold">We&apos;ve left</button>
            )}
            {t.status === "departed" && (
              <button type="button" onClick={() => setStatus(t.id, "completed")} className="min-h-14 flex-1 rounded-full bg-gold px-3 text-lg font-bold text-ink-gold">Trip finished</button>
            )}
            {(t.status === "open" || t.status === "full") && t.seats_taken === 0 && (
              <button type="button" onClick={() => setStatus(t.id, "cancelled")} className="min-h-14 rounded-full bg-gold/15 px-4 text-lg font-bold text-ink">Cancel trip</button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
