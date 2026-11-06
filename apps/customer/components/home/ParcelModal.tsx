"use client";

import { roundFare, type RelayQuote } from "@peebee/shared";
import { Route } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { useRegisterNavPrimaryAction, useRegisterNavBack, goBackOr } from "../../lib/nav-primary-action";
import { PlaceFlow, type PlaceResult } from "../PlaceFlow";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { placeFields } from "../../lib/places";
import { RouteSummary } from "./RouteSummary";
import { LastMileChoice, pickMeetStageId, type LastMileChoiceValue } from "../LastMileChoice";
import { OrderVoiceNoteRecorder } from "./OrderVoiceNoteRecorder";
import { deliveryModeName, deliveryModeSubtitle } from "../../lib/delivery-modes";

type BodaQuote = { distanceKm: number; fee: number };
type DeliveryMode = "relay" | "rider";

export function ParcelModal({ onClose }: { onClose: () => void }) {
  const t = useTranslate();
  const router = useRouter();
  const [route, setRoute] = useState<PlaceResult | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [description, setDescription] = useState("");
  const [estimatedTotal, setEstimatedTotal] = useState("");
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null);
  // Only the minimum fee is needed, to round a typed estimate when the map has no pins.
  const [minimumFee, setMinimumFee] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setMinimumFee(res.settings.minimumDeliveryFee))
      .catch(() => {});
  }, []);

  const p = route?.pickup;
  const d = route?.destination;

  // The server prices the trip along the road: one boda all the way, and for
  // long parcels a boda -> matatu -> boda relay. Both totals are exactly what
  // the order will charge, so submit waits for the quote.
  const quoteKey = p?.lat != null && p.lng != null && d?.lat != null && d.lng != null ? `${p.lat},${p.lng}|${d.lat},${d.lng}` : null;
  const [relayQuote, setRelayQuote] = useState<{ key: string; relay: RelayQuote | null; boda: BodaQuote | null; directMaxHours?: number; failed?: boolean } | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  useEffect(() => {
    if (!quoteKey || !p || !d) return;
    let cancelled = false;
    api
      .getRelayQuote({
        pickupLat: p.lat as number,
        pickupLng: p.lng as number,
        destinationLat: d.lat as number,
        destinationLng: d.lng as number,
        pickupName: p.area ?? undefined,
        destinationName: d.area ?? undefined,
      })
      .then((res) => !cancelled && setRelayQuote({ key: quoteKey, relay: res.relay, boda: res.boda ?? null, directMaxHours: res.directMaxHours }))
      .catch(() => !cancelled && setRelayQuote({ key: quoteKey, relay: null, boda: null, failed: true }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, quoteRetry]);
  const quoteFailed = quoteKey != null && relayQuote?.key === quoteKey && relayQuote.failed === true;
  const quoteLoading = quoteKey != null && (relayQuote?.key !== quoteKey || quoteFailed);
  const relay = !quoteLoading && relayQuote ? relayQuote.relay : null;
  const boda = !quoteLoading && relayQuote ? relayQuote.boda : null;
  // When both are offered the customer picks; the relay is the default for each new route.
  const [modeChoice, setModeChoice] = useState<{ key: string; mode: DeliveryMode } | null>(null);
  const canChoose = relay != null && boda != null;
  const mode: DeliveryMode = canChoose && modeChoice?.key === quoteKey && modeChoice.mode === "rider" ? "rider" : "relay";
  const relayed = relay != null && mode === "relay";
  // Station drops: the matatu leaves it at a petrol station near the customer.
  const [lastMile, setLastMile] = useState<LastMileChoiceValue>("door");
  const [meetStageId, setMeetStageId] = useState<string | null>(null);
  const station = relay?.dropMode === "station" && relay.station && relay.collectTotal != null ? relay.station : null;
  const choiceAtOrder = relay?.choiceAtOrder === true;
  const meetStages = station ? relay?.meetStages ?? [] : [];
  const stationChoice = station != null && (choiceAtOrder || meetStages.length > 0);
  const meeting = stationChoice && lastMile === "meet" && meetStages.length > 0;
  const toDoor = !station || (stationChoice && choiceAtOrder && lastMile === "door");
  const relayFare = relay ? (toDoor ? relay.total : (relay.collectTotal as number)) : null;
  const relayLegs = relay ? relay.legs.filter((leg) => toDoor || leg.leg < 3) : [];
  const fare = relayed ? relayFare : boda ? boda.fee : null;

  // "Next: payment" is the bottom nav's right capsule (intermediate step).
  const navFare = quoteLoading ? null : fare ?? (estimatedTotal ? Number(estimatedTotal) : null);
  useRegisterNavPrimaryAction(!choosing && route ? {
    tone: "step",
    label: busy || quoteLoading ? "Please wait…" : "Next: payment",
    detail: navFare != null && Number.isFinite(navFare) && navFare > 0 ? `UGX ${navFare.toLocaleString("en-UG")}` : undefined,
    disabled: busy || quoteLoading,
    busy,
    onClick: () => void submit(),
  } : null);

  useRegisterNavBack(!choosing && !!route, () => setChoosing(true));

  if (choosing || !route) {
    return (
      <PlaceFlow
        concept="parcel"
        initial={route ?? undefined}
        onClose={() => (route ? setChoosing(false) : onClose())}
        onBack={() => (route ? setChoosing(false) : goBackOr(router, "/deliver"))}
        onDone={(r) => {
          setRoute(r);
          setChoosing(false);
        }}
      />
    );
  }

  async function submit() {
    if (!route || quoteLoading) return;
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
        ...(relay ? { deliveryMode: relayed ? ("relay" as const) : ("rider" as const) } : {}),
        ...(!relayed
          ? {}
          : meeting
            ? { relayLastMile: "meet" as const, relayMeetStageId: pickMeetStageId(meetStages, meetStageId) }
            : { relayLastMile: stationChoice ? (lastMile === "meet" ? "door" : lastMile) : undefined }),
        estimatedTotal: fare ?? (estimatedTotal ? roundFare(Number(estimatedTotal), minimumFee) : undefined),
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
    <Modal withMap mapRoute={route} title={t("parcel_title")} onClose={onClose}>
      <div className="space-y-4">
        <RouteSummary pickup={route.pickup} destination={route.destination} destinationLabel={t("place_delivery")} onChange={() => setChoosing(true)} />

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("parcel_whats_it")}
          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
        />

        {quoteFailed ? (
          <div className="flex items-center gap-2 rounded-xl border border-gold bg-gold/10 p-3">
            <p className="flex-1 text-sm text-ink-500">Couldn&apos;t get the price.</p>
            <button
              type="button"
              onClick={() => { setRelayQuote(null); setQuoteRetry((n) => n + 1); }}
              className="text-sm font-bold text-gold"
            >
              Retry
            </button>
          </div>
        ) : quoteLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-gold bg-gold/10 p-3">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gold border-t-transparent" aria-hidden />
            <p className="text-sm text-ink-500">Getting price…</p>
          </div>
        ) : relay ? (
          <div className="space-y-2">
            {canChoose && (
              <div role="radiogroup" aria-label="How it travels" className="grid grid-cols-2 gap-2">
                {([
                  { value: "relay", label: deliveryModeName("relay"), note: deliveryModeSubtitle("relay"), total: relayFare ?? relay.total },
                  { value: "rider", label: deliveryModeName("rider"), note: deliveryModeSubtitle("rider", relayQuote?.directMaxHours), total: boda.fee },
                ] as const).map((option) => {
                  const selected = mode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => quoteKey && setModeChoice({ key: quoteKey, mode: option.value })}
                      className="select-card gap-0.5 text-left"
                    >
                      <span className="select-card__title text-sm text-ink">{option.label}</span>
                      <span className="select-card__sub">{option.note}</span>
                      <span className="select-card__title mt-1 text-sm text-ink">UGX {option.total.toLocaleString("en-UG")}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {relayed ? (
              <div className="space-y-2 rounded-xl border border-gold bg-gold/10 p-3">
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
                  <p className="flex-1 text-sm font-bold text-ink">Delivery · {deliveryModeName("relay")}</p>
                  <p className="text-sm font-bold text-ink">Total UGX {(relayFare ?? relay.total).toLocaleString("en-UG")}</p>
                </div>
                {station && stationChoice ? (
                  <LastMileChoice
                    value={lastMile}
                    onChange={setLastMile}
                    stationName={station.name}
                    doorTotal={relay.total}
                    collectTotal={relay.collectTotal as number}
                    choiceAtOrder={choiceAtOrder}
                    meetStages={meetStages}
                    meetStageId={meetStageId}
                    onMeetStageChange={setMeetStageId}
                    disabled={busy}
                  />
                ) : station ? (
                  <p className="text-xs text-ink-500">Collect at {station.name}, or send a rider when it arrives.</p>
                ) : null}
                <ul className="space-y-1 border-t border-[var(--border-faint)] pt-2">
                  {relayLegs.map((leg) => (
                    <li key={leg.leg} className="flex justify-between gap-3 text-xs text-ink">
                      <span className="min-w-0">
                        <span className="font-semibold">{leg.kind === "matatu" ? `Matatu${relay.direction ? ` ${relay.direction}` : ""}` : "Boda"}:</span> {leg.fromName} to{" "}
                        {leg.leg === 3 ? "door" : leg.toName}
                      </span>
                      <span className="shrink-0 font-semibold">{leg.fee.toLocaleString("en-UG")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : boda ? (
              <BodaPrice boda={boda} label={`Delivery · ${deliveryModeName("rider")}`} />
            ) : null}
          </div>
        ) : boda ? (
          <BodaPrice boda={boda} />
        ) : quoteKey ? (
          <p className="text-sm text-ink-500">The delivery price is shown on the next step.</p>
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

      </div>
    </Modal>
  );
}

/** The server's price for one boda carrying the parcel all the way, along the road. */
function BodaPrice({ boda, label = "Delivery" }: { boda: BodaQuote; label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-gold bg-gold/10 p-3">
      <Route className="h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
      <p className="text-sm text-ink">
        {label} <span className="font-bold">UGX {boda.fee.toLocaleString("en-UG")}</span> · {boda.distanceKm.toFixed(1)} km
      </p>
    </div>
  );
}
