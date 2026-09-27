"use client";

import { roundFare, type SavedLocation } from "@tuma/shared";
import { Calculator, List, Mic, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocationPicker, emptyPoint, resolvePoint, type PointState } from "../LocationPicker";
import { Modal } from "../Modal";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { InlineMathInput } from "../InlineMathInput";
import { SwipeToConfirm } from "../SwipeToConfirm";
import { OrderVoiceNoteRecorder } from "./OrderVoiceNoteRecorder";

type Item = { name: string; quantity: string; unitCost: string };
/** "list": type each item with its own cost — today's flow. "voice": speak
 * the list instead (for anyone who reads numbers more easily than text) and
 * just key in the total, which is what escrow actually needs. */
type Mode = "list" | "voice";

function currency(n: number) {
  return `UGX ${n.toLocaleString("en-UG")}`;
}

export function ShoppingListModal({ onClose }: { onClose: () => void }) {
  const t = useTranslate();
  const router = useRouter();
  const [step, setStep] = useState<"items" | "location">("items");
  const [mode, setMode] = useState<Mode>("list");
  const [items, setItems] = useState<Item[]>([{ name: "", quantity: "1", unitCost: "" }]);
  const [calcIndex, setCalcIndex] = useState<number | null>(null);
  const [voiceTotal, setVoiceTotal] = useState("");

  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [delivery, setDelivery] = useState<PointState>(emptyPoint);
  const [paymentRail, setPaymentRail] = useState<"escrow" | "float">("escrow");
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLocations()
      .then((res) => setLocations(res.locations))
      .catch(() => {});
    api
      .getSettings()
      .then((res) => setDeliveryFee(roundFare(res.settings.shoppingDeliveryFee)))
      .catch(() => {});
  }, []);

  const listTotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0), 0);
  const itemsTotal = mode === "voice" ? Number(voiceTotal) || 0 : listTotal;
  const total = itemsTotal + deliveryFee;

  function updateItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { name: "", quantity: "1", unitCost: "" }]);
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function goToLocation() {
    if (mode === "list") {
      const clean = items.filter((it) => it.name.trim().length > 0);
      if (clean.length === 0) {
        setError(t("list_add_at_least_one"));
        return;
      }
    } else {
      if (!voiceNote) {
        setError(t("list_record_voice"));
        return;
      }
      if (!voiceTotal || Number(voiceTotal) <= 0) {
        setError(t("list_enter_total"));
        return;
      }
    }
    setError(null);
    setStep("location");
  }

  async function submit() {
    // Thrown, not just set as an error string — this runs inside
    // SwipeToConfirm's onConfirm, which only shows its "confirmed"
    // checkmark once this promise resolves. Returning normally here would
    // make it show success on a validation failure nobody actually fixed.
    const d = resolvePoint(delivery, locations);
    if (!d.area && !d.address) {
      setError(t("restaurant_choose_delivery_location"));
      throw new Error("Missing delivery location");
    }

    setBusy(true);
    setError(null);
    try {
      const cleanItems = items
        .filter((it) => it.name.trim())
        .map((it) => ({
          name: it.name.trim(),
          quantity: Math.max(1, Number(it.quantity) || 1),
          unitCost: Number(it.unitCost) || 0,
        }));
      const list = await api.createList({
        items: cleanItems.map((it) => ({ name: it.name, quantity: it.quantity, unitCost: it.unitCost })),
      });
      const { order } = await api.createOrder({
        listId: list.listId,
        type: "shopping",
        destinationArea: d.area,
        destinationAddress: d.address,
        destinationLat: d.lat,
        destinationLng: d.lng,
        paymentRail,
        // The delivery fee is added server-side (see the API's shoppingDeliveryFee) —
        // this is just the items estimate, not itemsTotal + deliveryFee.
        estimatedTotal: itemsTotal || undefined,
      });
      if (voiceNote) {
        api.uploadOrderVoiceNote(order.id, voiceNote).catch(() => {});
      }
      onClose();
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      throw err;
    }
  }

  return (
    <Modal title={step === "items" ? t("list_title") : t("list_delivery_location")} onClose={onClose}>
      {step === "items" ? (
        <div className="space-y-4">
          <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1">
            {(["list", "voice"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-bold transition-colors ${
                  mode === m ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500"
                }`}
              >
                {m === "list" ? (
                  <List className="h-4 w-4" strokeWidth={2} aria-hidden />
                ) : (
                  <Mic className="h-4 w-4" strokeWidth={2} aria-hidden />
                )}
                {m === "list" ? t("list_write_list") : t("list_voice_note")}
              </button>
            ))}
          </div>

          {mode === "list" ? (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="space-y-1.5 rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-xs font-bold text-ink-500">
                      {i + 1}
                    </span>
                    <input
                      value={item.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      placeholder={t("list_item_name")}
                      className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                    />
                    <input
                      value={item.quantity}
                      onChange={(e) => updateItem(i, { quantity: e.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      placeholder={t("list_qty")}
                      className="w-12 shrink-0 rounded-lg border border-[var(--border-faint)] bg-transparent px-1.5 py-1 text-center text-sm text-ink outline-none"
                    />
                    <input
                      value={item.unitCost}
                      onChange={(e) => updateItem(i, { unitCost: e.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      placeholder={t("list_unit_cost")}
                      className="w-20 shrink-0 rounded-lg border border-[var(--border-faint)] bg-transparent px-1.5 py-1 text-right text-sm text-ink outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setCalcIndex(calcIndex === i ? null : i)}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg active:scale-95 transition-all ${
                        calcIndex === i
                          ? "bg-gold text-ink-gold shadow-sm"
                          : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink"
                      }`}
                      title="Math calculator (e.g. 2500 × 4)"
                    >
                      <Calculator className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeItem(i)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-500/60 hover:text-red-600"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>

                  {calcIndex === i && (
                    <div className="pt-2 border-t border-[var(--border-faint)]">
                      <InlineMathInput
                        label={`Calculate cost for ${item.name || "Item " + (i + 1)}`}
                        value={item.unitCost ? Number(item.unitCost) : undefined}
                        onChange={(val) => {
                          updateItem(i, { unitCost: val != null ? String(val) : "" });
                        }}
                        placeholder="e.g. 2500 × 4 or 3000 + 1500"
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={addItem}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-faint)] py-2.5 text-sm font-semibold text-ink-500"
              >
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                {t("list_add_item")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-ink-500">{t("list_record_desc")}</p>
              <OrderVoiceNoteRecorder blob={voiceNote} onChange={setVoiceNote} />
              <InlineMathInput
                label={t("list_total_amount")}
                value={voiceTotal ? Number(voiceTotal) : undefined}
                onChange={(val) => setVoiceTotal(val != null ? String(val) : "")}
                placeholder="e.g. 25000 or 15000 + 4000 × 2"
              />
            </div>
          )}

          <div className="space-y-1.5 rounded-xl bg-[rgb(var(--surface-muted))] px-4 py-3">
            <div className="flex items-center justify-between text-sm text-ink-500">
              <span>{t("list_items_total")}</span>
              <span>{currency(itemsTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-ink-500">
              <span>{t("list_delivery_fee")}</span>
              <span>{currency(deliveryFee)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-1.5">
              <span className="text-sm font-semibold text-ink">{t("list_youll_pay")}</span>
              <span className="text-base font-bold text-ink">{currency(total)}</span>
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            onClick={goToLocation}
            className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)]"
          >
            {t("list_next_delivery")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <LocationPicker point={delivery} setPoint={setDelivery} locations={locations} />

          {/* Voice mode already recorded the list itself as this same voice note — asking again here would be redundant. */}
          {mode === "list" && <OrderVoiceNoteRecorder blob={voiceNote} onChange={setVoiceNote} />}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("restaurant_payment")}</p>
            <div className="flex gap-2">
              {(["escrow", "float"] as const).map((rail) => (
                <button
                  key={rail}
                  onClick={() => setPaymentRail(rail)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold ${
                    paymentRail === rail ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
                  }`}
                >
                  {rail === "float" ? t("restaurant_cash") : t("restaurant_escrow")}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-500">
              {paymentRail === "float" ? t("restaurant_pay_rider_direct") : t("restaurant_pay_upfront")}
            </p>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="space-y-3 pt-2">
            <SwipeToConfirm
              label={t("list_slide_to_send")}
              confirmedLabel={t("list_order_sent")}
              onConfirm={submit}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => setStep("items")}
              className="w-full py-2 text-center text-xs font-semibold text-ink-500 hover:text-ink transition-colors"
            >
              {t("list_back_to_items")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
