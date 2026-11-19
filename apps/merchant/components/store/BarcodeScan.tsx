"use client";

import { ScanBarcode, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Detected = { rawValue: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detected[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code"];

function detectorCtor(): DetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return ctor && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia ? ctor : null;
}

const noop = () => () => {};
/** True only on phones and browsers that can read barcodes with the camera. */
export function useBarcodeSupport(): boolean {
  return useSyncExternalStore(noop, () => detectorCtor() !== null, () => false);
}

/** Big "Scan" button that opens the camera and fills in the barcode it reads. Hidden where scanning is not supported. */
export function BarcodeScanButton({ onScan, label = "Scan" }: { onScan: (code: string) => void; label?: string }) {
  const supported = useBarcodeSupport();
  const [open, setOpen] = useState(false);
  if (!supported) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[60px] min-w-[104px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-black px-4 text-lg font-black text-white active:scale-95 dark:bg-gold dark:text-ink-gold"
      >
        <ScanBarcode className="h-6 w-6" /> {label}
      </button>
      {open && <BarcodeCamera onClose={() => setOpen(false)} onScan={(code) => { setOpen(false); onScan(code); }} />}
    </>
  );
}

function BarcodeCamera({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; });

  useEffect(() => {
    const Ctor = detectorCtor();
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    if (!Ctor) return;
    let detector: Detector;
    try { detector = new Ctor({ formats: FORMATS }); } catch { detector = new Ctor(); }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const el = video.current;
        if (!el) return;
        el.srcObject = s;
        await el.play().catch(() => undefined);
        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(el);
            const code = found.find((f) => f.rawValue)?.rawValue;
            if (code) { onScanRef.current(code.slice(0, 40)); return; }
          } catch { /* frame not ready */ }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      })
      .catch(() => setError("Camera not available. Type the barcode instead."));
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/95 p-4 text-white" role="dialog" aria-modal="true" aria-label="Scan barcode" style={{ paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
      <div className="flex items-center justify-between pb-3">
        <h2 className="flex items-center gap-2 text-xl font-black"><ScanBarcode className="h-6 w-6 text-gold" /> Scan barcode</h2>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><X className="h-7 w-7" /></button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-3xl bg-black">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-[80%] rounded-2xl border-4 border-gold/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
        </div>
      </div>
      <p className="pt-4 text-center text-lg font-bold text-white/85">{error || "Point the camera at the barcode"}</p>
    </div>
  );
}
