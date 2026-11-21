"use client";

import { Download, Navigation, X } from "lucide-react";
import { useEffect, useState } from "react";
import { InAppNavigation } from "./InAppNavigation";
import { JobAction } from "./JobAction";
import { Modal } from "./Modal";
import { api } from "../lib/api";
import { mapsStoreUrl, openMapsNavigation } from "../lib/navigation";

function storageKey(orderId: string) {
  return `peebee-nav-started-${orderId}`;
}

/** The "on the way" stage's navigation + delivery-confirmation flow.
 *
 * "Started navigation" is persisted per order so the UI stays on the
 * Resume/Confirm step rather than resetting back to "Start Navigation"
 * if the rider's browser tab gets reloaded or killed in the background
 * while Google Maps has focus — a real risk on low-memory Android phones. */
export function DeliveryNavigation({
  orderId,
  destinationLat,
  destinationLng,
  busy,
  onConfirmDelivery,
  arrivalOnClose = false,
  navigationLabel = "Navigate to customer",
  confirmTitle = "Confirm arrival",
  onBeforeNavigate,
  navigationKey = orderId,
  confirmButtonLabel = "Confirm Delivery",
  confirmModalDescription = "Confirms you've reached the customer and marks this job as arrived. They'll be notified to confirm handover on their end.",
}: {
  orderId: string;
  destinationLat: number | null;
  destinationLng: number | null;
  busy: boolean;
  onConfirmDelivery: () => void;
  arrivalOnClose?: boolean;
  navigationLabel?: string;
  confirmTitle?: string;
  onBeforeNavigate?: () => Promise<unknown>;
  navigationKey?: string;
  confirmButtonLabel?: string;
  confirmModalDescription?: string;
}) {
  const [starting, setStarting] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [navStarted, setNavStarted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [inAppNav, setInAppNav] = useState(false);
  const [navMode, setNavMode] = useState<"external" | "in_app">("external");
  const hasDestination = destinationLat != null && destinationLng != null;
  const storeUrl = mapsStoreUrl();

  useEffect(() => {
    try {
      // Restore the external navigation session for this order after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNavStarted(localStorage.getItem(storageKey(navigationKey)) === "1");
    } catch {}
  }, [navigationKey]);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setNavMode(res.settings.navMode))
      .catch(() => {});
  }, []);

  async function startNavigation() {
    if (busy || starting) return;
    setStarting(true);
    setNavigationError("");
    try {
      await onBeforeNavigate?.();
      if (!hasDestination) { setConfirming(true); return; }
      if (navMode === "in_app") setInAppNav(true);
      else openMapsNavigation(destinationLat as number, destinationLng as number, () => {
        if (storeUrl) setShowInstallPrompt(true);
      });
      setNavStarted(true);
      try { localStorage.setItem(storageKey(navigationKey), "1"); } catch {}
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : "Could not start navigation. Try again.");
    } finally { setStarting(false); }
  }

  function confirmDelivery() {
    setConfirming(false);
    try {
      localStorage.removeItem(storageKey(navigationKey));
    } catch {}
    onConfirmDelivery();
  }

  return (
    <div className="space-y-4">
      {navigationError && <p role="alert" className="text-base text-red-600">{navigationError}</p>}
      {!hasDestination && <p role="status" className="text-base text-ink-500">Coordinates unavailable. Use the address above to reach this stop.</p>}
      {inAppNav && hasDestination && (
        <InAppNavigation
          orderId={orderId}
          destinationLat={destinationLat as number}
          destinationLng={destinationLng as number}
          confirmButtonLabel={confirmButtonLabel}
          onArrived={() => {
            setInAppNav(false);
            if (arrivalOnClose) confirmDelivery();
            else setConfirming(true);
          }}
          onClose={() => setInAppNav(false)}
        />
      )}
      <JobAction>
      {!navStarted ? (
        <button
          type="button"
          onClick={startNavigation}
          disabled={busy || starting}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
        >
          <Navigation className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          {starting ? "Preparing…" : hasDestination ? navigationLabel : confirmButtonLabel}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => arrivalOnClose ? confirmDelivery() : setConfirming(true)}
            disabled={busy || starting}
            className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
          >
            {arrivalOnClose ? "Close navigation" : confirmButtonLabel}
          </button>

        </>
      )}

      </JobAction>
      {navStarted && <button type="button" disabled={!hasDestination || busy || starting} onClick={startNavigation} className="min-h-14 w-full rounded-full border border-[var(--border-faint)] text-base font-bold text-ink disabled:opacity-60">Resume navigation</button>}
      {showInstallPrompt && storeUrl && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-3">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs text-ink-500">
              Opened directions in your browser — install Google Maps for faster, turn-by-turn navigation next time.
            </p>
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-bold text-gold underline"
            >
              Get Google Maps
            </a>
          </div>
          <button
            type="button"
            onClick={() => setShowInstallPrompt(false)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-500/60"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

      {confirming && (
        <Modal title={confirmTitle} onClose={() => setConfirming(false)}>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">{confirmModalDescription}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-full border border-[var(--border-faint)] py-2.5 text-sm font-bold text-ink"
              >
                Not yet
              </button>
              <button
                type="button"
                disabled={busy || starting}
                onClick={confirmDelivery}
                className="flex-[2] rounded-full bg-gold py-2.5 text-sm font-bold text-ink-gold disabled:opacity-60"
              >
                {confirmButtonLabel}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
