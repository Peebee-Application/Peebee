"use client";

import { AlertCircle, Briefcase, Camera, ChevronRight, Fuel } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Accordion } from "../components/Accordion";
import { Numpad } from "../components/Numpad";
import { QrScanner } from "../components/QrScanner";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";

export default function PumpHomePage() {
  const router = useRouter();
  const { attendant, manager, isManager, outlet, shiftSummary, ready } = useAuth();
  const [code, setCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !attendant) {
      router.replace("/login");
    }
  }, [ready, attendant, router]);

  async function handleVerify(codeToVerify: string) {
    const trimmed = codeToVerify.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter or scan a code first.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const res = await api.verifyGasCode(trimmed, outlet?.id);
      if (res.valid) {
        // Navigate to dispense screen with validated code
        router.push(`/dispense?code=${encodeURIComponent(trimmed)}`);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function handleQrScan(scannedValue: string) {
    setScannerOpen(false);
    setCode(scannedValue);
    void handleVerify(scannedValue);
  }

  const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

  return (
    <div className="space-y-4">
      {isManager && (
        <Link href="/manager" className="home-card flex min-h-14 items-center gap-3 !bg-gold/15 text-lg font-bold text-ink">
          <Briefcase className="h-6 w-6 shrink-0 text-gold" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Manager</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-500" aria-hidden />
        </Link>
      )}

      {/* Today at a glance: one line, tap for the log */}
      <Link href="/shift" className="home-card flex items-center gap-3 !bg-black-700 text-white dark:!bg-black">
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-black tabular-nums">{ugx(shiftSummary?.total_ugx ?? 0)}</p>
          <p className="mt-1 text-base text-white/70">
            {(shiftSummary?.total_litres ?? 0).toFixed(1)} L · {shiftSummary?.total_dispenses ?? 0} refuels
          </p>
        </div>
        <ChevronRight className="h-6 w-6 shrink-0 text-white/70" aria-hidden />
      </Link>

      <section className="home-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex min-w-0 items-center gap-2 text-xl font-black text-ink">
            <Fuel className="h-6 w-6 shrink-0 text-gold" aria-hidden />
            <span className="truncate">{attendant?.pump_lane ?? "Pump 1"}</span>
          </h1>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex min-h-14 items-center gap-2 rounded-2xl bg-gold px-5 text-lg font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] transition active:scale-95"
          >
            <Camera className="h-6 w-6" aria-hidden />
            <span>Scan</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-50 p-3 text-base font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-center gap-2" aria-label="Voucher code">
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const char = code.replace(/^PBGAS-/, "")[index] ?? "";
            return (
              <div
                key={index}
                className={`flex h-16 w-12 items-center justify-center rounded-xl border text-3xl font-black transition ${
                  char
                    ? "border-gold bg-gold/10 text-ink shadow-sm"
                    : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))] text-ink-500"
                }`}
              >
                {char || "·"}
              </div>
            );
          })}
        </div>

        <Numpad
          value={code.replace(/^PBGAS-/, "")}
          onChange={(val) => {
            setCode(val);
            if (error) setError(null);
            if (val.length === 6) {
              void handleVerify(val);
            }
          }}
          maxLength={6}
          confirmLabel={busy ? "Checking…" : "Verify"}
          confirmDisabled={busy || code.replace(/^PBGAS-/, "").length < 6}
          onConfirm={() => handleVerify(code)}
        />
      </section>

      <Accordion title="Pump prices" icon={Fuel}>
        <div className="grid grid-cols-2 gap-2">
          {(outlet?.prices ?? []).slice(0, 4).map((price) => (
            <div key={price.product_id} className="rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-3 text-center">
              <span className="block truncate text-base font-semibold text-ink-500">{price.product_name}</span>
              <strong className="text-xl font-black text-ink">{Number(price.price_per_unit).toLocaleString()}</strong>
              <span className="text-sm text-ink-500"> /{price.unit}</span>
            </div>
          ))}
        </div>
        <Link href="/prices" className="flex min-h-12 items-center justify-center text-lg font-bold text-gold">All prices</Link>
      </Accordion>

      {/* Live Camera Scanner Modal */}
      {scannerOpen && (
        <QrScanner
          onScan={handleQrScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}
