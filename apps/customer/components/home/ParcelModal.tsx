"use client";

import { roundFare } from "@tuma/shared";
import { Route } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { PlaceFlow, type PlaceResult } from "../PlaceFlow";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { placeFields } from "../../lib/places";
import { RouteSummary } from "./RouteSummary";
import { OrderVoiceNoteRecorder } from "./OrderVoiceNoteRecorder";

/** Great-circle distance in km — mirrors apps/api/src/lib/geo.ts, used only
 * for the live fee preview here; the backend recomputes it authoritatively. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function ParcelModal({ onClose }: { onClose: () => void }) {
  const t = useTranslate();
  const router = useRouter();
  const [route, setRoute] = useState<PlaceResult | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [description, setDescription] = useState("");
  const [estimatedTotal, setEstimatedTotal] = useState("");
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null);
  const [pricing, setPricing] = useState<{ ratePerKm: number; minimum: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setPricing({ ratePerKm: res.settings.deliveryRatePerKm, minimum: res.settings.minimumDeliveryFee }))
      .catch(() => {});
  }, []);

  const p = route?.pickup;
  const d = route?.destination;
  const distanceKm = p?.lat != null && p.lng != null && d?.lat != null && d.lng != null ? haversineKm(p.lat, p.lng, d.lat, d.lng) : null;
  const liveEstimate = distanceKm != null && pricing != null ? roundFare(distanceKm * pricing.ratePerKm, pricing.minimum) : null;

  if (choosing || !route) {
    return (
      <PlaceFlow
        concept="parcel"
        initial={route ?? undefined}
        onClose={() => (route ? setChoosing(false) : onClose())}
        onDone={(r) => {
          setRoute(r);
          setChoosing(false);
        }}
      />
    );
  }

  async function submit() {
    if (!route) return;
    const pf = placeFields(route.pickup);
    const df = placeFields(route.destination);
    setBusy(true);
    setError(null);
    try {
      const list = await api.createList({ title: description.trim() || "Parcel delivery" });
      const { order } = await api.createOrder({
        listId: list.listId,
        type: "parcel",
        pickupArea: pf.area,
        pickupAddress: pf.address,
        pickupLat: pf.lat,
        pickupLng: pf.lng,
        destinationArea: df.area,
        destinationAddress: df.address,
        destinationLat: df.lat,
        destinationLng: df.lng,
        paymentRail: "escrow",
        estimatedTotal: liveEstimate ?? (estimatedTotal ? roundFare(Number(estimatedTotal), pricing?.minimum) : undefined),
      });
      if (voiceNote) {
        api.uploadOrderVoiceNote(order.id, voiceNote).catch(() => {});
      }
      onClose();
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal withMap title={t("parcel_title")} onClose={onClose}>
      <div className="space-y-4">
        <RouteSummary pickup={route.pickup} destination={route.destination} destinationLabel={t("place_delivery")} onChange={() => setChoosing(true)} />

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("parcel_whats_it")}
          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
        />

        {liveEstimate != null ? (
          <div className="flex items-center gap-2 rounded-xl border border-gold bg-gold/10 p-3">
            <Route className="h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
            <p className="text-sm text-ink">
              <span className="font-bold">UGX {liveEstimate.toLocaleString("en-UG")}</span> {t("parcel_estimated")} ·{" "}
              {distanceKm!.toFixed(1)} km
            </p>
          </div>
        ) : (
          <input
            value={estimatedTotal}
            onChange={(e) => setEstimatedTotal(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder={t("parcel_estimated_fee")}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        )}

        <OrderVoiceNoteRecorder blob={voiceNote} onChange={setVoiceNote} />

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? "Please wait…" : "Next: payment"}
        </button>
      </div>
    </Modal>
  );
}
