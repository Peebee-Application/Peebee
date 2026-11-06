"use client";

import { Select } from "@peebee/shared/select";
import { ApiError, type RelayLegStatus, type RelayOperator, type RelayOperatorParcels, type RelayRoute, type RelayTrack } from "@peebee/shared";
import { ArrowLeft, ArrowRight, Bus, ChevronDown, ChevronRight, Clock, MapPin, Package, Phone, PhoneCall, QrCode, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Accordion } from "../../components/Accordion";
import { useCallback, useEffect, useRef, useState } from "react";
import { QrCodeImage } from "../../components/QrCodeImage";
import { QrScanner } from "../../components/QrScanner";
import { RelayTimeline } from "../../components/RelayTimeline";
import { api, errorMessage } from "../../lib/api";
import { useCalls } from "../../lib/calls-context";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;
const REFRESH_MS = 15_000;
const LOCATION_MS = 30_000;

type RouteOption = Pick<RelayRoute, "id" | "name" | "stage_a_name" | "stage_b_name" | "route_code">;

const statusLabel: Record<RelayLegStatus, string> = {
  waiting: "Waiting",
  open: "Finding a rider",
  assigned: "Rider coming",
  in_transit: "On the way",
  arrived: "At the stage",
  done: "Collected",
};

const errorBox = "rounded-xl bg-red-50 p-3 text-lg text-red-700 dark:bg-red-950/40 dark:text-red-300";

export default function RelayPage() {
  const [loaded, setLoaded] = useState(false);
  const [operator, setOperator] = useState<RelayOperator | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");

  const loadMe = useCallback(async () => {
    try {
      const res = await api.getRelayOperatorMe();
      setOperator(res.operator);
      setRoutes(res.routes);
      setEnabled(res.enabled);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  return (
    <div className="space-y-5 px-4 py-5">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Back to home"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface))] text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-ink">Parcels</h1>
          <p className="truncate text-lg text-ink-500">
            {operator?.status === "approved" ? `${operator.vehicle_plate} · ${operator.route_code ?? operator.route_name ?? "Your route"}` : "Carry parcels on your matatu"}
          </p>
        </div>
      </header>

      {error && <p className={errorBox}>{error}</p>}

      {!loaded ? null : operator?.status === "approved" ? (
        <OperatorBoard />
      ) : operator?.status === "pending" ? (
        <section className="home-card space-y-1">
          <h2 className="flex items-center gap-2 font-bold text-ink">
            <Clock className="h-4 w-4 text-gold" /> Waiting for approval
          </h2>
          <p className="text-lg text-ink-500">
            {operator.vehicle_plate} · {operator.route_code ?? operator.route_name ?? "Route"}. We&apos;ll notify you once you&apos;re approved.
          </p>
        </section>
      ) : operator?.status === "suspended" ? (
        <section className="home-card space-y-1">
          <h2 className="font-bold text-ink">Account suspended</h2>
          <p className="text-lg text-ink-500">You can&apos;t carry relay parcels right now. Contact Peebee support.</p>
        </section>
      ) : !enabled ? (
        <section className="home-card">
          <p className="text-lg text-ink-500">Relay parcels aren&apos;t available yet.</p>
        </section>
      ) : (
        <ApplyForm routes={routes} onDone={loadMe} />
      )}
    </div>
  );
}

function ApplyForm({ routes, onDone }: { routes: RouteOption[]; onDone: () => Promise<void> }) {
  const [routeId, setRouteId] = useState("");
  const [plate, setPlate] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!routeId || !plate.trim()) {
      setError("Choose a route and enter the number plate.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.applyRelayOperator({ routeId, vehiclePlate: plate.trim().toUpperCase(), phone: phone.trim() || undefined });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!routes.length) {
    return (
      <section className="home-card">
        <p className="text-lg text-ink-500">No matatu routes are open yet.</p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="home-card space-y-4">
      <div>
        <h2 className="font-bold text-ink">Carry parcels on your matatu</h2>
        <p className="text-lg text-ink-500">Riders bring parcels to your stage. You carry them and get paid per parcel.</p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-base font-bold text-ink-500">Route</span>
        <Select value={routeId} onValueChange={setRouteId} aria-label="Route" className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3">
          <option value="">Choose your route…</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.route_code ? `${r.route_code} · ` : ""}{r.stage_a_name} – {r.stage_b_name}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-base font-bold text-ink-500">Number plate</span>
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
          placeholder="e.g. UAX 123K"
          autoCapitalize="characters"
          className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] font-mono font-bold text-ink outline-none focus:ring-2 focus:ring-gold"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-base font-bold text-ink-500">Phone (optional)</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Number riders can call"
          className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] text-ink outline-none focus:ring-2 focus:ring-gold"
        />
      </label>
      {error && <p className={errorBox}>{error}</p>}
      <button type="submit" disabled={busy} className="min-h-14 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">
        {busy ? "Sending…" : "Apply"}
      </button>
    </form>
  );
}

function OperatorBoard() {
  const [data, setData] = useState<RelayOperatorParcels | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getRelayOperatorParcels());
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const carryingIds = (data?.carrying ?? []).filter((l) => l.status === "in_transit" || l.status === "arrived").map((l) => l.id);
  useShareLocation(carryingIds);

  return (
    <>
      {error && <p className={errorBox}>{error}</p>}
      <ReceiveCard onReceived={load} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black text-ink">On board</h2>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh"
            className="flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface))] text-ink"
          >
            <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {data && data.carrying.length === 0 && <p className="home-card text-lg text-ink-500">None on board</p>}
        {data?.carrying.map((leg) => <CarryingCard key={leg.id} leg={leg} onChange={load} />)}
        {carryingIds.length > 0 && <p className="text-base text-ink-500">Your location is shared while this page is open.</p>}
      </section>

      {data && data.incoming.length > 0 && (
        <Accordion title="Coming to you" icon={Package} summary={data.incoming.length}>
          {data.incoming.map((p) => (
            <div key={p.order_id} className="flex items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-3 text-lg first:border-t-0 first:pt-0">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">To {p.stage_name}</span>
                <span className="text-base text-ink-500">{p.rider_name ? `Rider: ${p.rider_name}` : "Finding a rider"}</span>
              </span>
              <Package className="h-5 w-5 shrink-0 text-gold" />
            </div>
          ))}
        </Accordion>
      )}

      {data && data.recent.length > 0 && (
        <Accordion title="Recent" icon={RotateCcw} summary={data.recent.length}>
          {data.recent.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-3 text-lg first:border-t-0 first:pt-0">
              <span className="min-w-0">
                <span className="block truncate text-ink">
                  {r.direction ? <strong className="mr-1.5">{r.direction}</strong> : null}
                  {r.from_name} → {r.to_name}
                </span>
                <span className="text-base text-ink-500">{formatWhen(r.handed_over_at)}</span>
              </span>
              <strong className="shrink-0 text-ink">{r.paid_amount != null ? ugx(r.paid_amount) : "Pending"}</strong>
            </div>
          ))}
        </Accordion>
      )}
    </>
  );
}

function ReceiveCard({ onReceived }: { onReceived: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const busyRef = useRef(false);

  const receive = useCallback(
    async (raw: string) => {
      const value = raw.replace(/\D/g, "").slice(-6);
      if (value.length !== 6) {
        setMessage({ ok: false, text: "Enter the rider's 6-digit code." });
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setMessage(null);
      try {
        await api.receiveRelayParcel(value);
        setCode("");
        setMessage({ ok: true, text: "Parcel received." });
        await onReceived();
      } catch (err) {
        setMessage({ ok: false, text: errorMessage(err) });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onReceived],
  );

  const onScan = useCallback(
    (value: string) => {
      setScanning(false);
      void receive(value);
    },
    [receive],
  );
  const closeScanner = useCallback(() => setScanning(false), []);

  return (
    <section className="home-card space-y-3">
      <div>
        <h2 className="text-xl font-black text-ink">Receive parcel</h2>
        <p className="text-lg text-ink-500">Scan the rider&apos;s QR or type their code.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void receive(code);
        }}
        className="flex gap-2"
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="Rider's code"
          className="min-h-14 min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] text-center font-mono text-lg font-bold tracking-[0.3em] text-ink outline-none focus:ring-2 focus:ring-gold"
        />
        <button type="submit" disabled={busy || code.length !== 6} className="min-h-14 rounded-xl bg-gold px-5 font-bold text-ink-gold disabled:opacity-50">
          {busy ? "…" : "Receive"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setScanning(true)}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] font-bold text-ink"
      >
        <QrCode className="h-4 w-4 text-gold" /> Scan QR
      </button>
      {message && <p className={message.ok ? "text-lg font-semibold text-green" : errorBox}>{message.text}</p>}
      {scanning && <QrScanner title="Scan rider's QR" onScan={onScan} onClose={closeScanner} />}
    </section>
  );
}

function CarryingCard({ leg, onChange }: { leg: RelayOperatorParcels["carrying"][number]; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missedStation, setMissedStation] = useState<string | null>(null);
  const arrived = leg.status === "arrived";

  async function markArrived() {
    setBusy(true);
    setError("");
    try {
      await api.markRelayMatatuArrived(leg.id);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const spaced = leg.handoff_code.replace(/^(\d{3})(\d{3})$/, "$1 $2");

  return (
    <article className="home-card space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Bus className="h-4 w-4 shrink-0 text-gold" />
        {leg.direction && <span className="shrink-0 font-bold">{leg.direction}</span>}
        <span className="truncate">{leg.from_name}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-500" />
        <span className="truncate">{leg.to_name}</span>
      </div>
      <p className="text-base text-ink-500">
        Last rider: {leg.last_rider_name ?? "not yet assigned"}
        {leg.last_mile_status ? ` · ${statusLabel[leg.last_mile_status]}` : ""}
      </p>
      {leg.meet_stage_name ? (
        <MeetCustomer leg={leg} onChange={onChange} onMissed={setMissedStation} />
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-sm font-bold uppercase tracking-wider text-ink-500">Handoff code</span>
          <span className="font-mono text-4xl font-black tracking-widest text-ink">{spaced}</span>
          <QrCodeImage value={leg.handoff_code} size={168} label="Handoff QR code" />
          <span className="text-base text-ink-500">Show this code to the rider or pump attendant at {leg.to_name}.</span>
        </div>
      )}
      {missedStation && <p className="text-center text-lg font-semibold text-green">Leave it at {missedStation} instead.</p>}
      {error && <p className={errorBox}>{error}</p>}
      {arrived ? (
        <p className="text-center text-lg font-semibold text-green">
          Arrived at {leg.to_name} — {leg.meet_stage_name ? "waiting for the customer." : "waiting for the rider."}
        </p>
      ) : (
        <button type="button" onClick={markArrived} disabled={busy} className="min-h-14 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">
          {busy ? "Please wait…" : `Arrived at ${leg.to_name}`}
        </button>
      )}
      <FollowParcel orderId={leg.order_id} />
    </article>
  );
}

/** The customer meets the matatu at a stage: take their code, or send the parcel on to the station if they don't come. */
function MeetCustomer({ leg, onChange, onMissed }: { leg: RelayOperatorParcels["carrying"][number]; onChange: () => Promise<void>; onMissed: (station: string) => void }) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmMissed, setConfirmMissed] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const busyRef = useRef(false);
  const { startCall } = useCalls();

  const handover = useCallback(
    async (raw: string) => {
      const value = raw.replace(/\D/g, "").slice(-6);
      if (value.length !== 6) {
        setMessage({ ok: false, text: "Enter the customer's 6-digit code." });
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setMessage(null);
      try {
        await api.relayOperatorHandover(value);
        setCode("");
        setMessage({ ok: true, text: "Handed to the customer." });
        await onChange();
      } catch (err) {
        setMessage({ ok: false, text: errorMessage(err) });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onChange],
  );

  async function missed() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.relayOperatorMissed(leg.id);
      setConfirmMissed(false);
      onMissed(res.station);
      await onChange();
    } catch (err) {
      setConfirmMissed(false);
      setMessage({
        ok: false,
        text: err instanceof ApiError && err.code === "fallback_off" ? "Call the customer — leaving it at the station is switched off." : errorMessage(err),
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const onScan = useCallback(
    (value: string) => {
      setScanning(false);
      void handover(value);
    },
    [handover],
  );
  const closeScanner = useCallback(() => setScanning(false), []);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-bold text-ink">
          <MapPin className="h-4 w-4 shrink-0 text-gold" /> Customer meets you at {leg.meet_stage_name}
        </p>
        <p className="truncate text-lg text-ink-500">{leg.customer_name ?? "Customer"}</p>
      </div>
      {(leg.customer_phone || leg.customer_id) && (
        <div className="flex flex-wrap gap-2">
          {leg.customer_phone && (
            <a
              href={`tel:${leg.customer_phone}`}
              className="flex min-h-14 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gold px-3 text-lg font-bold text-ink-gold"
            >
              <Phone className="h-4 w-4 shrink-0" /> Call {leg.customer_phone}
            </a>
          )}
          {leg.customer_id && (
            <button
              type="button"
              onClick={() => startCall({ calleeId: leg.customer_id!, orderId: leg.order_id })}
              className="flex min-h-14 flex-1 items-center justify-center gap-1.5 rounded-xl border border-gold px-3 text-lg font-bold text-gold"
            >
              <PhoneCall className="h-4 w-4 shrink-0" /> Call in app
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handover(code);
        }}
        className="flex gap-2"
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="Customer's code"
          className="min-h-14 min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] text-center font-mono text-lg font-bold tracking-[0.3em] text-ink outline-none focus:ring-2 focus:ring-gold"
        />
        <button type="submit" disabled={busy || code.length !== 6} className="min-h-14 rounded-xl bg-gold px-4 font-bold text-ink-gold disabled:opacity-50">
          {busy ? "…" : "Hand to customer"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setScanning(true)}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] font-bold text-ink"
      >
        <QrCode className="h-4 w-4 text-gold" /> Scan QR
      </button>
      {confirmMissed ? (
        <div className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
          <p className="text-lg text-ink">Customer not here? The parcel goes on to the petrol station.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmMissed(false)} disabled={busy} className="min-h-14 flex-1 rounded-full border border-[var(--border-faint)] text-lg font-bold text-ink">
              Cancel
            </button>
            <button type="button" onClick={missed} disabled={busy} className="min-h-14 flex-1 rounded-full bg-gold text-lg font-bold text-ink-gold disabled:opacity-50">
              {busy ? "Please wait…" : "Confirm"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmMissed(true)}
          disabled={busy}
          className="min-h-14 w-full rounded-full border border-[var(--border-faint)] text-lg font-bold text-ink disabled:opacity-50"
        >
          Customer not here
        </button>
      )}
      {message && <p className={message.ok ? "text-lg font-semibold text-green" : errorBox}>{message.text}</p>}
      {scanning && <QrScanner title="Scan customer's QR" onScan={onScan} onClose={closeScanner} />}
    </div>
  );
}

/** Expands to the parcel's whole journey: every leg, the station stop and the event log. */
function FollowParcel({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<RelayTrack | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const load = () =>
      api
        .trackRelayOrder(orderId)
        .then((res) => {
          if (stopped) return;
          setTrack(res);
          setError("");
        })
        .catch((err) => {
          if (!stopped) setError(errorMessage(err));
        });
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, orderId]);

  return (
    <div className="border-t border-[var(--border-faint)] pt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between text-lg font-bold text-gold">
        Follow
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="pt-3">
          {error && <p className={errorBox}>{error}</p>}
          {!track && !error && <p className="text-lg text-ink-500">Loading…</p>}
          {track && <RelayTimeline track={track} />}
        </div>
      )}
    </div>
  );
}

/** Sends the phone's position for each on-board leg every ~30s while the page is open. */
function useShareLocation(legIds: string[]) {
  const key = legIds.join(",");
  useEffect(() => {
    if (!key || typeof navigator === "undefined" || !navigator.geolocation) return;
    const ids = key.split(",");
    let stopped = false;
    let denied = false;

    const send = () => {
      if (stopped || denied) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (stopped) return;
          const { latitude, longitude } = pos.coords;
          for (const id of ids) void api.sendRelayMatatuLocation(id, latitude, longitude).catch(() => {});
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) denied = true;
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      );
    };

    send();
    const timer = window.setInterval(send, LOCATION_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [key]);
}

function formatWhen(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-UG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
