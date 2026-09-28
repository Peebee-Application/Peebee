"use client";

import { roundFare, type SavedLocation } from "@tuma/shared";
import { Route } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocationPicker, emptyPoint, resolvePoint, type PointState } from "../LocationPicker";
import { Modal } from "../Modal";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
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
  const [step, setStep] = useState<"pickup" | "delivery">("pickup");
  const [pickup, setPickup] = useState<PointState>(emptyPoint);
  const [delivery, setDelivery] = useState<PointState>(emptyPoint);
  const [description, setDescription] = useState("");
  const [estimatedTotal, setEstimatedTotal] = useState("");
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null);
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [pricing, setPricing] = useState<{ ratePerKm: number; minimum: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLocations()
      .then((res) => setLocations(res.locations))
      .catch(() => {});
    api
      .getSettings()
      .then((res) => setPricing({ ratePerKm: res.settings.deliveryRatePerKm, minimum: res.settings.minimumDeliveryFee }))
      .catch(() => {});
  }, []);

  const pickupPoint = resolvePoint(pickup, locations);
  const deliveryPoint = resolvePoint(delivery, locations);
  const distanceKm =
    pickupPoint.lat != null && pickupPoint.lng != null && deliveryPoint.lat != null && deliveryPoint.lng != null
      ? haversineKm(pickupPoint.lat, pickupPoint.lng, deliveryPoint.lat, deliveryPoint.lng)
      : null;
  const liveEstimate = distanceKm != null && pricing != null ? roundFare(distanceKm * pricing.ratePerKm, pricing.minimum) : null;

  function next() {
    const p = resolvePoint(pickup, locations);
    if (!p.area && !p.address) {
      setError(t("parcel_set_pickup"));
      return;
    }
    setError(null);
    setStep("delivery");
  }

  async function submit() {
    const p = resolvePoint(pickup, locations);
    const d = resolvePoint(delivery, locations);
    if (!d.area && !d.address) {
      setError(t("parcel_set_delivery"));
      throw new Error("Missing delivery location");
    }
    setBusy(true);
    setError(null);
    try {
      const list = await api.createList({ title: description.trim() || "Parcel delivery" });
      const { order } = await api.createOrder({
        listId: list.listId,
        type: "parcel",
        pickupArea: p.area,
        pickupAddress: p.address,
        pickupLat: p.lat,
        pickupLng: p.lng,
        destinationArea: d.area,
        destinationAddress: d.address,
        destinationLat: d.lat,
        destinationLng: d.lng,
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
      throw err;
    }
  }

  return (
    <Modal title={step === "pickup" ? t("parcel_pickup_step") : t("parcel_delivery_step")} onClose={onClose}>
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-ink-500">
        <span className={step === "pickup" ? "text-ink" : ""}>{t("parcel_step1")}</span>
        <span className="h-px flex-1 bg-[var(--border-faint)]" />
        <span className={step === "delivery" ? "text-ink" : ""}>{t("parcel_step2")}</span>
      </div>

      {step === "pickup" ? (
        <div className="space-y-4">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("parcel_whats_it")}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
          <LocationPicker point={pickup} setPoint={setPickup} locations={locations} />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            onClick={next}
            className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)]"
          >
            {t("parcel_next_delivery")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <LocationPicker point={delivery} setPoint={setDelivery} locations={locations} />

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

          <div className="space-y-3 pt-2">
            <button type="button" onClick={() => void submit().catch(() => {})} disabled={busy} className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60">{busy ? "Please wait…" : "Next: payment"}</button>
            <button
              type="button"
              onClick={() => setStep("pickup")}
              className="w-full py-2 text-center text-xs font-semibold text-ink-500 hover:text-ink transition-colors"
            >
              {t("parcel_back_to_pickup")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
