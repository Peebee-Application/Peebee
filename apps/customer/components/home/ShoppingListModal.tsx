"use client";

import { roundFare, type SavedLocation } from "@tuma/shared";
import { List, Mic, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocationPicker, emptyPoint, resolvePoint, type PointState } from "../LocationPicker";
import { Modal } from "../Modal";
import { api, errorMessage } from "../../lib/api";
import { useTranslate, type TranslationKey } from "../../lib/i18n";
import { SwipeToConfirm } from "../SwipeToConfirm";
import { OrderVoiceNoteRecorder } from "./OrderVoiceNoteRecorder";

/** Uganda's everyday market units — produce and groceries are almost
 * always sold by weight or volume rather than by piece, so a plain "Qty"
 * number alone (the old UI) didn't match how people actually shop. */
type Unit = "pcs" | "kg" | "g" | "l" | "ml" | "m";
const UNIT_KEYS: Record<Unit, TranslationKey> = {
  pcs: "unit_pcs",
  kg: "unit_kg",
  g: "unit_g",
  l: "unit_l",
  ml: "unit_ml",
  m: "unit_m",
};
const UNIT_ABBR: Record<Unit, string> = { pcs: "", kg: "kg", g: "g", l: "L", ml: "ml", m: "m" };

type Item = { name: string; quantity: string; unitCost: string; unit: Unit };
/** "list": type each item with its own cost — today's flow. "voice": speak
 * the list instead (for anyone who reads numbers more easily than text) and
 * just key in the total, which is what escrow actually needs. */
type Mode = "list" | "voice";

function currency(n: number) {
  return `UGX ${n.toLocaleString("en-UG")}`;
}

/** Folds the unit into the item name (e.g. "Tomatoes (kg)") since the
 * order schema only has a plain name + quantity multiplier — this is the
 * least invasive way to carry "2 kg" through to the rider's shopping list
 * without a backend/schema change. Plain pieces need no suffix. */
function nameWithUnit(name: string, unit: Unit): string {
  return unit === "pcs" ? name : `${name} (${UNIT_ABBR[unit]})`;
}

export function ShoppingListModal({ onClose }: { onClose: () => void }) {
  const t = useTranslate();
  const router = useRouter();
  const [step, setStep] = useState<"items" | "location">("items");
  const [mode, setMode] = useState<Mode>("list");
  const [items, setItems] = useState<Item[]>([{ name: "", quantity: "1", unitCost: "", unit: "pcs" }]);
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
    setItems((prev) => [...prev, { name: "", quantity: "1", unitCost: "", unit: "pcs" }]);
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
          name: nameWithUnit(it.name.trim(), it.unit),
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
            <div className="space-y-4">
              {items.map((item, i) => (
                <div key={i} className="space-y-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-ink">{t("list_item_number", { n: i + 1 })}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="flex items-center gap-1 text-sm font-semibold text-ink-500/70 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                        {t("list_remove_item")}
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-ink-500">{t("list_item_name")}</label>
                    <input
                      value={item.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      placeholder={t("list_item_name_placeholder")}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-4 py-3.5 text-lg text-ink outline-none focus:border-gold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-ink-500">{t("list_price_per_unit")}</label>
                    <input
                      value={item.unitCost}
                      onChange={(e) => updateItem(i, { unitCost: e.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      placeholder={t("list_price_placeholder")}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-4 py-3.5 text-lg text-ink outline-none focus:border-gold"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1.5">
                      <label className="text-sm font-semibold text-ink-500">{t("list_quantity_label")}</label>
                      <input
                        value={item.quantity}
                        onChange={(e) => updateItem(i, { quantity: e.target.value.replace(/[^\d]/g, "") })}
                        inputMode="numeric"
                        className="w-full rounded-xl border border-[var(--border-faint)] px-4 py-3.5 text-lg text-ink outline-none focus:border-gold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-semibold text-ink-500">{t("list_unit_label")}</label>
                      <select
                        value={item.unit}
                        onChange={(e) => updateItem(i, { unit: e.target.value as Unit })}
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-3.5 text-lg text-ink outline-none focus:border-gold"
                      >
                        {(Object.keys(UNIT_KEYS) as Unit[]).map((u) => (
                          <option key={u} value={u}>
                            {t(UNIT_KEYS[u])}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {Number(item.quantity) > 0 && Number(item.unitCost) > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-[rgb(var(--surface-muted))] px-4 py-2.5 text-base">
                      <span className="font-semibold text-ink-500">{t("list_subtotal")}</span>
                      <span className="font-bold text-ink">{currency(Number(item.quantity) * Number(item.unitCost))}</span>
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={addItem}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border-faint)] py-4 text-base font-bold text-ink-500"
              >
                <Plus className="h-5 w-5" strokeWidth={2} aria-hidden />
                {t("list_add_item")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-ink-500">{t("list_record_desc")}</p>
              <OrderVoiceNoteRecorder blob={voiceNote} onChange={setVoiceNote} />
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-ink-500">{t("list_total_amount")}</label>
                <input
                  value={voiceTotal}
                  onChange={(e) => setVoiceTotal(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  placeholder={t("list_price_placeholder")}
                  className="w-full rounded-xl border border-[var(--border-faint)] px-4 py-3.5 text-lg text-ink outline-none focus:border-gold"
                />
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-2xl bg-[rgb(var(--surface-muted))] px-5 py-4">
            <div className="flex items-center justify-between text-base text-ink-500">
              <span>{t("list_items_total")}</span>
              <span>{currency(itemsTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-base text-ink-500">
              <span>{t("list_delivery_fee")}</span>
              <span>{currency(deliveryFee)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-2">
              <span className="text-lg font-semibold text-ink">{t("list_youll_pay")}</span>
              <span className="text-xl font-bold text-ink">{currency(total)}</span>
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            onClick={goToLocation}
            className="min-h-14 w-full rounded-full bg-gold px-4 text-lg font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)]"
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
