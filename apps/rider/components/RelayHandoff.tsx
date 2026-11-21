"use client";

import type { OrderRelay } from "@peebee/shared";
import { Navigation, QrCode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openMapsNavigation } from "../lib/navigation";
import { formatUgx } from "../lib/order-display";
import { JobAction } from "./JobAction";
import { Modal } from "./Modal";
import { CodeQr } from "./CodeQr";
import { QrScanner } from "./QrScanner";

type Leg = OrderRelay["legs"][number];

function DirectionsButton({ lat, lng }: { lat: number | null; lng: number | null }) {
  if (lat == null || lng == null) return null;
  return (
    <button
      type="button"
      onClick={() => openMapsNavigation(lat, lng)}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-gold px-4 text-sm font-bold text-gold"
    >
      <Navigation className="h-4 w-4" aria-hidden /> Directions
    </button>
  );
}

/** Leg-1 rider: take the parcel to the matatu stage and show the code. */
export function RelayHandToMatatu({ leg, matatu }: { leg: Leg; matatu?: Leg }) {
  const code = leg.handoffCode ?? "";
  const [showCode, setShowCode] = useState(false);
  return (
    <div className="space-y-6">
      <p className="text-base text-ink-500">The taxi driver confirms receipt using your handoff code.</p>
      {matatu?.vehiclePlate && <p className="text-xl font-bold">Taxi · {matatu.vehiclePlate}</p>}
      <DirectionsButton lat={leg.toLat} lng={leg.toLng} />
      <JobAction><button type="button" disabled={!code} className="job-primary" onClick={() => setShowCode(true)}><QrCode aria-hidden />Show handoff code</button></JobAction>
      {showCode && <Modal title="Handoff code" onClose={() => setShowCode(false)}><div className="space-y-6 text-center"><p className="text-base text-ink-500">Show the taxi driver</p><p className="font-mono text-4xl font-extrabold tracking-[0.25em]">{code}</p><div className="flex justify-center"><CodeQr value={code} size={200} /></div></div></Modal>}
    </div>
  );
}

/** Last-mile rider: meet the matatu and collect the parcel with its code. */
export function RelayCollectFromMatatu({
  leg,
  matatu,
  station,
  busy,
  onCollect,
}: {
  leg: Leg;
  matatu?: Leg;
  /** Set when the matatu dropped it at a petrol station: the rider collects from the pump attendant. */
  station?: OrderRelay["station"];
  busy: boolean;
  onCollect: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  // The page re-renders on every poll; keep the scanner callback stable so the camera doesn't restart.
  const onCollectRef = useRef(onCollect);
  useEffect(() => {
    onCollectRef.current = onCollect;
  }, [onCollect]);
  const handleScan = useCallback(
    (value: string) => {
      setScanning(false);
      const digits = value.replace(/\D/g, "").slice(0, 6);
      setCode(digits);
      if (digits.length === 6) onCollectRef.current(digits);
    },
    [],
  );
  const closeScanner = useCallback(() => setScanning(false), []);

  return (
    <div className="space-y-6">
      {station ? (
        <div>
          <p className="font-bold text-ink">Collect at {station.name}</p>
          {station.address && <p className="mt-0.5 text-sm text-ink-500">{station.address}</p>}
          <p className="mt-0.5 text-sm text-ink-500">
            Enter the code the pump attendant shows you. Then deliver {leg.distanceKm != null ? `${leg.distanceKm} km ` : ""}for {formatUgx(leg.fee)}.
          </p>
        </div>
      ) : (
        <div>
          <p className="font-bold text-ink">
            Meet matatu{matatu?.vehiclePlate ? ` ${matatu.vehiclePlate}` : ""} at {leg.fromName ?? "the stage"}
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            {matatu?.status === "arrived" ? "The matatu is at the stage. " : ""}
            Enter the code they show you. Then deliver {leg.distanceKm != null ? `${leg.distanceKm} km ` : ""}for {formatUgx(leg.fee)}.
          </p>
        </div>
      )}
      <form id="relay-collection"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) onCollect(code);
        }}
        className="space-y-2"
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          aria-label="Handoff code"
          className="min-h-16 w-full rounded-2xl px-3 text-center font-mono text-xl font-bold tracking-[0.3em] text-ink outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-gold px-3 text-sm font-bold text-gold"
          >
            <QrCode className="h-4 w-4" aria-hidden /> Scan QR
          </button>
          <JobAction><button type="submit" form="relay-collection" disabled={busy || code.length !== 6} className="job-primary">{busy ? "Processing…" : "Confirm collection"}</button></JobAction>
        </div>
      </form>
      <DirectionsButton lat={station?.lat ?? leg.fromLat} lng={station?.lng ?? leg.fromLng} />
      {scanning && <QrScanner title={station ? "Scan attendant code" : "Scan matatu code"} onScan={handleScan} onClose={closeScanner} />}
    </div>
  );
}
