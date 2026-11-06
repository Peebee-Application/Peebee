"use client";

import { Select } from "@peebee/shared/select";
import { ApiError, type TaxipressBoardingResult, type TaxipressDriverView, type TaxipressLineEntry } from "@peebee/shared";
import { ArrowLeft, Bus, Minus, Plus, QrCode, Users } from "lucide-react";
import Link from "next/link";
import { Accordion } from "../../components/Accordion";
import { useCallback, useEffect, useRef, useState } from "react";
import { QrScanner } from "../../components/QrScanner";
import { api, errorMessage } from "../../lib/api";

const REFRESH_MS = 10_000;
const LOCATION_MS = 30_000;
const errorBox = "rounded-xl bg-red-50 p-3 text-lg text-red-700 dark:bg-red-950/40 dark:text-red-300";
const primary = "min-h-14 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50";
const secondary = "min-h-14 w-full rounded-full border border-[var(--border-faint)] font-bold text-ink disabled:opacity-50";

/** The phone's position, or nothing when it is off or refused (the server says if a location is needed). */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10_000 },
    );
  });
}

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

export default function TaxipressPage() {
  const [view, setView] = useState<TaxipressDriverView | null>(null);
  const [error, setError] = useState("");

  // Bumping the version reloads the screen after any action and on a timer while in a line.
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => { setVersion((v) => v + 1); }, []);

  useEffect(() => {
    let live = true;
    api.getTaxipressTaxiMe()
      .then((next) => { if (live) { setView(next); setError(""); } })
      .catch((err) => { if (live) setError(errorMessage(err)); });
    return () => { live = false; };
  }, [version]);

  const inLine = !!view?.entry;
  useEffect(() => {
    if (!inLine) return;
    const id = window.setInterval(() => setVersion((v) => v + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [inLine]);

  // While in a line or on the road, the taxi's position goes up so passengers and parcels can follow it.
  const status = view?.entry?.status;
  useEffect(() => {
    if (!status) return;
    let live = true;
    const send = async () => {
      const at = await currentPosition();
      if (live && at) await api.taxipressSendLocation(at.lat, at.lng).catch(() => {});
    };
    void send();
    const id = window.setInterval(send, LOCATION_MS);
    return () => { live = false; window.clearInterval(id); };
  }, [status]);

  return (
    <div className="space-y-5 px-4 py-5">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="Back to home" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface))] text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-ink">Taxipress</h1>
          <p className="truncate text-lg text-ink-500">{view?.taxi ? `${view.taxi.plate} · ${view.taxi.seats} seats` : "Seats on your taxi, booked in the app"}</p>
        </div>
      </header>

      {error && <p className={errorBox}>{error}</p>}

      {!view ? null : !view.ready ? (
        <p className="home-card text-lg text-ink-500">Taxipress isn&apos;t set up yet.</p>
      ) : !view.taxi ? (
        <Apply view={view} onDone={load} />
      ) : view.taxi.status === "pending" ? (
        <section className="home-card space-y-1">
          <h2 className="font-bold text-ink">Waiting for approval</h2>
          <p className="text-lg text-ink-500">Peebee is checking {view.taxi.plate}. You will be able to join the line once it is approved.</p>
        </section>
      ) : view.taxi.status === "suspended" ? (
        <p className="home-card text-lg text-ink-500">Your taxi is suspended. Contact Peebee support.</p>
      ) : !view.taxi.passengersEnabled ? (
        <p className="home-card text-lg text-ink-500">Your taxi isn&apos;t set up to take passengers yet. It can still carry parcels.</p>
      ) : (
        <Board view={view} onChange={load} />
      )}
    </div>
  );
}

function Apply({ view, onDone }: { view: TaxipressDriverView; onDone: () => Promise<void> }) {
  const [routeId, setRouteId] = useState("");
  const [plate, setPlate] = useState("");
  const [layout, setLayout] = useState<"14" | "18">("14");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.applyTaxipressTaxi({ relayRouteId: routeId, plate, seatLayout: layout });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (view.applyRoutes.length === 0) return <p className="home-card text-lg text-ink-500">No Taxipress route is open for taxis yet.</p>;

  return (
    <form onSubmit={submit} className="home-card space-y-4">
      <p className="text-lg text-ink-500">Register your taxi once. When Peebee approves it you can join the line and take seats, and carry relay parcels.</p>
      <label className="block space-y-1.5">
        <span className="text-base font-bold text-ink-500">Route</span>
        <Select value={routeId} onValueChange={setRouteId} aria-label="Route" sizing="stretch" className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3 text-lg">
          <option value="">Choose your route</option>
          {view.applyRoutes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-base font-bold text-ink-500">Number plate</span>
        <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="e.g. UAX 123K" autoCapitalize="characters" className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] font-mono font-bold text-ink outline-none focus:ring-2 focus:ring-gold" />
      </label>
      <div className="space-y-1.5">
        <span className="text-base font-bold text-ink-500">Seats for passengers</span>
        <div className="grid grid-cols-2 gap-2">
          {(["14", "18"] as const).map((n) => (
            <button key={n} type="button" aria-pressed={layout === n} onClick={() => setLayout(n)} className={`min-h-14 rounded-xl font-bold ${layout === n ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>{n} seats</button>
          ))}
        </div>
      </div>
      {error && <p className={errorBox}>{error}</p>}
      <button type="submit" disabled={busy || !routeId || plate.trim().length < 3} className={primary}>{busy ? "Sending…" : "Apply"}</button>
    </form>
  );
}

function Board({ view, onChange }: { view: TaxipressDriverView; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [routeId, setRouteId] = useState(view.routes[0]?.id ?? "");
  const [ticket, setTicket] = useState("");
  const [scanning, setScanning] = useState(false);
  const [boarded, setBoarded] = useState<TaxipressBoardingResult | null>(null);
  const entry = view.entry;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  const boardingSince = entry?.status === "boarding" && entry.boardingAt ? Date.parse(`${entry.boardingAt.replace(" ", "T")}Z`) : NaN;
  const noShowOpen = now > 0 && Number.isFinite(boardingSince) && now - boardingSince >= view.noShowMinutes * 60_000;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (!entry) {
    const chosen = view.routes.find((r) => r.id === routeId) ?? view.routes[0];
    return (
      <section className="home-card space-y-4">
        {!view.enabled && <p className="text-lg text-ink-500">Taxipress isn&apos;t running right now.</p>}
        {view.owingBlocked && <p className={errorBox}>You owe Peebee too much to join the line. Top up your wallet first.</p>}
        {view.routes.length === 0 ? (
          <p className="text-lg text-ink-500">No route is running for your taxi right now.</p>
        ) : (
          <>
            <p className="text-lg text-ink-500">Join the line at your stage. Passengers can then book seats on your taxi.</p>
            <div className="grid gap-2">
              {view.routes.map((r) => (
                <button key={r.id} type="button" aria-pressed={chosen?.id === r.id} onClick={() => setRouteId(r.id)} className={`min-h-14 rounded-xl px-3 text-left text-lg font-bold ${chosen?.id === r.id ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>
                  {r.fromName} → {r.toName}
                </button>
              ))}
            </div>
            {error && <p className={errorBox}>{error}</p>}
            <button
              type="button"
              disabled={busy || !view.enabled || !chosen}
              onClick={() => run(async () => { const at = await currentPosition(); await api.taxipressJoinLine({ routeId: chosen!.id, ...(at ?? {}) }); })}
              className={primary}
            >
              {busy ? "Joining…" : `Join the line at ${chosen?.fromName ?? "the stage"}`}
            </button>
          </>
        )}
      </section>
    );
  }

  const route = view.routes.find((r) => r.id === entry.taxipressRouteId);
  const onRoad = entry.status === "on_road";
  const front = entry.position === 1;

  return (
    <div className="space-y-4">
      <section className="home-card space-y-3">
        <p className="text-base font-bold uppercase tracking-wide text-ink-500">{route ? `${route.fromName} → ${route.toName}` : "Your route"}</p>
        <h2 className="text-xl font-black text-ink">
          {onRoad ? "On the road" : entry.status === "boarding" ? "Boarding now" : front ? "You're next" : `${ordinal(entry.position ?? 0)} in the line`}
        </h2>
        <SeatCounter entry={entry} />
        <PartyCounts bookings={view.bookings} walkUps={entry.walkUpSeats} />
        {!onRoad && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
            <div className="min-w-0">
              <p className="text-lg font-bold text-ink">Seats sold at the stage</p>
              <p className="text-sm text-ink-500">Paid you directly.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" aria-label="One fewer walk-up seat" disabled={busy || entry.walkUpSeats <= 0} onClick={() => run(() => api.taxipressWalkUp(-1))} className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink disabled:opacity-40"><Minus className="h-4 w-4" aria-hidden /></button>
              <span className="w-6 text-center font-bold text-ink" aria-live="polite">{entry.walkUpSeats}</span>
              <button type="button" aria-label="One more walk-up seat" disabled={busy || entry.fullyBooked} onClick={() => run(() => api.taxipressWalkUp(1))} className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden /></button>
            </div>
          </div>
        )}
        {error && <p className={errorBox}>{error}</p>}

        {entry.status === "in_line" && (
          <>
            <button type="button" disabled={busy || !front} onClick={() => run(() => api.taxipressStartBoarding())} className={primary}>Boarding now</button>
            {!front && <p className="text-base text-ink-500">Start when you reach the front.</p>}
          </>
        )}
        {entry.status === "boarding" && (
          <div className="space-y-2 rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
            <p className="text-lg font-bold text-ink">Confirm a passenger</p>
            <p className="text-sm text-ink-500">Ticket code or QR.</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => { setBoarded(await api.taxipressBoard(ticket)); setTicket(""); });
              }}
            >
              <input value={ticket} onChange={(e) => setTicket(e.target.value.toUpperCase())} placeholder="TXP-ABC123" autoCapitalize="characters" aria-label="Ticket code" className="min-h-14 min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] font-mono font-bold text-ink outline-none focus:ring-2 focus:ring-gold" />
              <button type="submit" disabled={busy || ticket.trim().length < 6} className="min-h-14 rounded-xl bg-gold px-4 font-bold text-ink-gold disabled:opacity-50">Confirm</button>
              <button type="button" aria-label="Scan a ticket" disabled={busy} onClick={() => setScanning(true)} className="flex min-h-14 w-12 items-center justify-center rounded-xl border border-[var(--border-faint)] text-ink disabled:opacity-50"><QrCode className="h-5 w-5" aria-hidden /></button>
            </form>
            {boarded && (
              <p role="status" className="rounded-xl bg-gold/15 p-3 text-lg font-bold text-ink">
                {boarded.passengerName ?? "Passenger"} is on board ({boarded.seats} seat{boarded.seats === 1 ? "" : "s"}).{" "}
                {boarded.paymentMethod === "cash"
                  ? `Cash: you keep UGX ${boarded.driverAmount.toLocaleString("en-UG")}; UGX ${boarded.takenFromDriver.toLocaleString("en-UG")} commission came out of your wallet${boarded.driverBalance != null && boarded.driverBalance < 0 ? ` (you owe UGX ${(-boarded.driverBalance).toLocaleString("en-UG")})` : ""}.`
                  : `UGX ${boarded.driverAmount.toLocaleString("en-UG")} was added to your wallet.`}
              </p>
            )}
          </div>
        )}
        {entry.status === "boarding" && (
          <>
            <button type="button" disabled={busy || !view.canGoOnRoad} onClick={() => run(() => api.taxipressGoOnRoad())} className={primary}>On road</button>
            {!view.canGoOnRoad && view.onRoadReason && <p className="text-base text-ink-500">{view.onRoadReason}</p>}
          </>
        )}
        {onRoad && <button type="button" disabled={busy} onClick={() => run(() => api.taxipressArrive())} className={primary}>Arrived</button>}
        {!onRoad && <button type="button" disabled={busy} onClick={() => run(() => api.taxipressLeaveLine())} className={secondary}>Leave the line</button>}
      </section>

      {view.bookings.length > 0 && (
        <Accordion title="Passengers" icon={Users} summary={view.bookings.length} defaultOpen>
          <ul className="space-y-1.5">
            {view.bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-bold text-ink">{b.travellerName ?? b.passengerName ?? "Passenger"} · {b.seats} seat{b.seats === 1 ? "" : "s"}</span>
                  {(b.children ?? 0) + (b.bags ?? 0) > 0 && (
                    <span className="block truncate text-sm text-ink-500">{b.adults ?? b.seats} adult{(b.adults ?? b.seats) === 1 ? "" : "s"}{b.children ? `, ${b.children} child${b.children === 1 ? "" : "ren"}` : ""}{b.bags ? ` · ${b.bags} bag${b.bags === 1 ? "" : "s"}` : ""}</span>
                  )}
                  {b.passengerPhone && <a href={`tel:${b.passengerPhone}`} className="block text-sm text-ink-500 underline-offset-2 hover:underline">{b.passengerPhone}</a>}
                </span>
                <span className={`shrink-0 text-right text-base font-bold ${b.paymentStatus === "paid" ? "text-green" : b.paymentStatus === "pay_driver" ? "text-gold" : "text-ink-500"}`}>
                  {b.status === "boarded" || b.status === "completed" ? "On board ✓" : b.paymentStatus === "paid" ? "Paid" : b.paymentStatus === "pay_driver" ? `Collect UGX ${b.amount.toLocaleString("en-UG")}` : "Payment due"}
                  {b.status === "booked" && noShowOpen && (
                    <button type="button" disabled={busy} onClick={() => run(() => api.taxipressNoShow(b.id))} className="mt-1 block min-h-14 w-full rounded-lg border border-[var(--border-faint)] px-2 text-sm font-bold text-ink disabled:opacity-50">No-show</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Accordion>
      )}

      {!onRoad && view.line.length > 0 && (
        <Accordion title="The line" icon={Bus} summary={view.line.length}>
          <ol className="space-y-1.5">
            {view.line.map((e) => <LineRow key={e.id} entry={e} mine={e.id === entry.id} />)}
          </ol>
        </Accordion>
      )}
      {scanning && (
        <QrScanner
          title="Scan passenger's ticket"
          placeholder="Ticket code"
          onScan={(value) => { setScanning(false); void run(async () => { setBoarded(await api.taxipressBoard(value)); }); }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}

/** Who is on this taxi's bookings: adults, children and bags (shown once a booking carries them), and stage sales. */
function PartyCounts({ bookings, walkUps }: { bookings: TaxipressDriverView["bookings"]; walkUps: number }) {
  const live = bookings.filter((b) => b.status === "booked" || b.status === "boarded");
  if (!live.some((b) => b.adults != null)) return null;
  const adults = live.reduce((n, b) => n + (b.adults ?? b.seats), 0);
  const children = live.reduce((n, b) => n + (b.children ?? 0), 0);
  const bags = live.reduce((n, b) => n + (b.bags ?? 0), 0);
  const tiles = [["Adults", adults], ["Children", children], ["Bags", bags], ["Sold at the stage", walkUps]] as const;
  return (
    <dl className="grid grid-cols-2 gap-2">
      {tiles.map(([label, n]) => (
        <div key={label} className="rounded-2xl bg-[rgb(var(--surface-muted))] px-3 py-2">
          <dt className="text-sm font-semibold text-ink-500">{label}</dt>
          <dd className="text-lg font-black text-ink">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function SeatCounter({ entry }: { entry: TaxipressLineEntry }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-lg font-bold text-ink">{entry.seatsTaken} of {entry.seatsTotal} seats booked</p>
        <p className="text-base text-ink-500">{entry.fullyBooked ? "Fully booked" : `${entry.seatsLeft} free`}</p>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]" role="presentation">
        <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, Math.round((entry.seatsTaken / Math.max(1, entry.seatsTotal)) * 100))}%` }} />
      </div>
    </div>
  );
}

function LineRow({ entry, mine }: { entry: TaxipressLineEntry; mine: boolean }) {
  return (
    <li className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${mine ? "bg-gold/15" : "bg-[rgb(var(--surface-muted))]"}`}>
      <span className="min-w-0">
        <span className="block text-lg font-bold text-ink">{entry.position}. {entry.plate}{mine ? " (you)" : ""}</span>
        <span className="block text-sm text-ink-500">{entry.status === "boarding" ? "Boarding now" : "In line"} · {entry.seatsTaken}/{entry.seatsTotal} seats</span>
      </span>
    </li>
  );
}
