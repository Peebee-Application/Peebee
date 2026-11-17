"use client";

import { useRegisterNavPrimaryAction, useRegisterNavBack } from "../../lib/nav-primary-action";
import { DEFAULT_SHOPPING_UNIT_SETTINGS, roundFare, serializeShoppingItem, shoppingItemTotal, type ShoppingUnitSettings } from "@peebee/shared";
import { List, Mic, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../Modal";
import { PlaceFlow } from "../PlaceFlow";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { placeFields, type Place } from "../../lib/places";
import { RouteSummary } from "./RouteSummary";
import { ListItemLine, blankItem, type Item } from "./ListItemLine";
import { OrderPhotosPicker, settledPhotos, type PhotoDraft } from "./OrderPhotosPicker";
import { OrderVoiceNoteRecorder } from "./OrderVoiceNoteRecorder";

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
export function ShoppingListModal({ onClose, initialItems }: { onClose: () => void; /** Items already typed on the Buy home, so the list opens filled in. */ initialItems?: Item[] }) {
  const t = useTranslate();
  const router = useRouter();
  const [step, setStep] = useState<"items" | "location">("items");
  const [mode, setMode] = useState<Mode>("list");
  const [items, setItems] = useState<Item[]>(() => (initialItems?.length ? [...initialItems, blankItem()] : [blankItem()]));
  const [voiceTotal, setVoiceTotal] = useState("");

  const [delivery, setDelivery] = useState<Place | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [unitSettings, setUnitSettings] = useState<ShoppingUnitSettings>(DEFAULT_SHOPPING_UNIT_SETTINGS);
  // Photos for the rider: uploaded as they're added, attached once the order exists.
  // Hidden until the API says the order_photos table is there.
  const [photoMax, setPhotoMax] = useState(0);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const photosRef = useRef<PhotoDraft[]>([]);
  const changePhotos = useCallback((fn: (prev: PhotoDraft[]) => PhotoDraft[]) => {
    setPhotos((prev) => {
      const next = fn(prev);
      photosRef.current = next;
      return next;
    });
  }, []);
  const uploadPhoto = useCallback((blob: Blob) => api.uploadOrderPhoto(blob), []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => { setDeliveryFee(roundFare(res.settings.shoppingDeliveryFee)); setUnitSettings(res.settings.shoppingUnits ?? DEFAULT_SHOPPING_UNIT_SETTINGS); })
      .catch(() => {});
    api
      .orderPhotosConfig()
      .then((c) => setPhotoMax(c.available ? c.maxPhotos : 0))
      .catch(() => setPhotoMax(0));
  }, []);

  const listTotal = items.reduce((sum, it) => sum + shoppingItemTotal(it), 0);
  const itemsTotal = mode === "voice" ? Number(voiceTotal) || 0 : listTotal;
  const total = itemsTotal + deliveryFee;

  function updateItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, blankItem()]);
  }
  function removeItem(i: number) {
    // Photos link to items by their place among the named items: keep links pointing at the same item.
    if (items[i]?.name.trim()) {
      const gone = namedIndex(i);
      changePhotos((prev) => prev.map((p) => (p.itemIndex == null || p.itemIndex < gone ? p : { ...p, itemIndex: p.itemIndex === gone ? null : p.itemIndex - 1 })));
    }
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  /** Position of items[i] among the items that have a name (the ones sent to the API). */
  function namedIndex(i: number) {
    return items.slice(0, i).filter((it) => it.name.trim()).length;
  }
  const namedItems = items.filter((it) => it.name.trim()).map((it) => it.name.trim());
  const linkedItems = new Set(photos.map((p) => p.itemIndex).filter((i): i is number => i != null));

  function goToLocation() {
    if (mode === "list") {
      const clean = items.filter((it) => it.name.trim().length > 0);
      if (clean.length === 0) {
        setError(t("list_add_at_least_one"));
        return;
      }
      if (clean.some((it) => (it.unit === "budget" && !(Number(it.unitCost) > 0)) || (it.unit === "other" && !it.customUnit?.trim()))) {
        setError(t("list_complete_unit_amount"));
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
    const d = placeFields(delivery);
    if (!d.area && !d.address) {
      setError(t("restaurant_choose_delivery_location"));
      throw new Error("Missing delivery location");
    }

    setBusy(true);
    setError(null);
    try {
      const cleanItems = items
        .filter((it) => it.name.trim())
        .map(serializeShoppingItem);
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
        paymentRail: "escrow",
        // The delivery fee is added server-side (see the API's shoppingDeliveryFee) —
        // this is just the items estimate, not itemsTotal + deliveryFee.
        estimatedTotal: itemsTotal || undefined,
      });
      if (voiceNote) {
        api.uploadOrderVoiceNote(order.id, voiceNote).catch(() => {});
      }
      if (photosRef.current.length) {
        // Uploads already ran while they wrote the list; wait for any still going, then attach.
        // Item links only apply to a written list (voice mode has no items).
        const ready = await settledPhotos(() => photosRef.current, (i) => (mode === "list" && i < cleanItems.length ? i : null));
        if (ready.length) await api.attachOrderPhotos(order.id, ready).catch(() => {});
      }
      onClose();
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      throw err;
    }
  }

  // Each step's primary action is the bottom nav's right capsule (white in
  // light, grey in dark): "Next: delivery" on the list, "Next: payment" once a
  // delivery place is set. While the place picker is open it owns the nav.
  useRegisterNavPrimaryAction(
    step === "items"
      ? { tone: "step", label: t("list_next_delivery"), detail: total > 0 ? currency(total) : undefined, onClick: goToLocation }
      : !choosing && delivery
        ? { tone: "step", label: busy ? "Please wait…" : "Next: payment", detail: total > 0 ? currency(total) : undefined, disabled: busy, busy, onClick: () => void submit().catch(() => {}) }
        : null,
  );

  // Delivery step: nav Back returns to the list (the picker handles its own Back).
  useRegisterNavBack(step === "location" && !choosing && !!delivery, () => setStep("items"));

  return (
    <Modal withMap heroImage={step === "items" ? "/brand/auth-illustration.webp" : undefined} title={step === "items" ? t("list_title") : t("list_delivery_location")} onClose={onClose}>
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
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <ListItemLine
                  key={i}
                  item={item}
                  unitSettings={unitSettings}
                  canRemove={items.length > 1}
                  onChange={(patch) => updateItem(i, patch)}
                  onRemove={() => removeItem(i)}
                  onComplete={() => i === items.length - 1 && addItem()}
                  hasPhoto={!!item.name.trim() && linkedItems.has(namedIndex(i))}
                />
              ))}
              {items[items.length - 1].stage === 3 && (
                <button
                  type="button"
                  onClick={addItem}
                  className="flex items-center gap-1.5 py-2 text-sm font-bold text-ink-500 hover:text-ink"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                  {t("list_add_item")}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-ink-500">{t("list_record_desc")}</p>
              <OrderVoiceNoteRecorder blob={voiceNote} onChange={setVoiceNote} onWriteInstead={() => setMode("list")} />
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

          {photoMax > 0 && (
            <OrderPhotosPicker
              photos={photos}
              onChange={changePhotos}
              maxPhotos={photoMax}
              items={mode === "list" ? namedItems : undefined}
              upload={uploadPhoto}
            />
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

        </div>
      ) : (
        <div className="space-y-4">
          {delivery && (
            <RouteSummary pickup={null} destination={delivery} destinationLabel={t("place_delivery")} onChange={() => setChoosing(true)} />
          )}
          {(choosing || !delivery) && (
            <PlaceFlow
              concept="shopping"
              initial={{ destination: delivery }}
              onClose={() => (delivery ? setChoosing(false) : setStep("items"))}
              onDone={(r) => {
                setDelivery(r.destination);
                setChoosing(false);
              }}
            />
          )}

          {/* Voice mode already recorded the list itself as this same voice note — asking again here would be redundant. */}
          {mode === "list" && <OrderVoiceNoteRecorder blob={voiceNote} onChange={setVoiceNote} />}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="space-y-3 pt-2">
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
