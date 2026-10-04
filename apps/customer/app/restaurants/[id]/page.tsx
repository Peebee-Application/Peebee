"use client";

import type { MenuCategory, MenuItem, MenuItemBadge, MenuItemOption, Restaurant, RestaurantMenu } from "@peebee/shared";
import { roundFare } from "@peebee/shared";
import { ArrowUpRight, MessageCircle, Minus, Plus, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PlaceFlow } from "../../../components/PlaceFlow";
import { RouteSummary } from "../../../components/home/RouteSummary";
import { placeFields, type Place } from "../../../lib/places";
import { Modal } from "../../../components/Modal";
import { api, errorMessage } from "../../../lib/api";
import { useTranslate } from "../../../lib/i18n";
import { formatUgx } from "../../../lib/order-display";

/** Matches the server's own haversine — see apps/api/src/lib/geo.ts. Used
 * here only for a live estimate before checkout; the actual delivery fee
 * charged is always computed server-side at order creation. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** A menu item's photo, fetched lazily since it's not inlined in the menu
 * response (mirrors ItemEditor's own photo fetch in apps/restaurant). */
function MenuItemThumb({ itemId, size = "row" }: { itemId: string; size?: "row" | "modal" }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .menuItemPhotoBlob(itemId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId]);

  if (!url) return null;
  const dims = size === "row" ? "h-16 w-16" : "h-40 w-full";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={`${dims} shrink-0 rounded-xl object-cover ${size === "modal" ? "mb-1" : ""}`}
    />
  );
}

const BADGE_STYLES: Record<MenuItemBadge, string> = {
  sale: "bg-red-600 text-white",
  new: "bg-blue-600 text-white",
  trending: "bg-purple-600 text-white",
};
const BADGE_KEYS: Record<MenuItemBadge, "restaurant_badge_sale" | "restaurant_badge_new" | "restaurant_badge_trending"> = {
  sale: "restaurant_badge_sale",
  new: "restaurant_badge_new",
  trending: "restaurant_badge_trending",
};

/** Grid-card presentation for a menu item — image on a tinted backdrop
 * (visible around/behind a photo with transparency, or as the whole
 * background when there's no photo yet), a badge pill top-left when the
 * restaurant's set one, and price + "Order Now" bottom-right. */
function FoodItemCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  const t = useTranslate();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!item.photo_key) {
      setPhotoUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .menuItemPhotoBlob(item.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.photo_key]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col overflow-hidden rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-left shadow-sm"
    >
      <div className="relative flex h-32 w-full items-center justify-center bg-green/10">
        {item.badge && (
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_STYLES[item.badge]}`}
          >
            {t(BADGE_KEYS[item.badge])}
          </span>
        )}
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <UtensilsCrossed className="h-9 w-9 text-green" strokeWidth={1.5} aria-hidden />
        )}
      </div>
      <div className="flex items-end justify-between gap-2 p-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-ink">{item.name}</span>
          {item.description && (
            <span className="mt-0.5 block truncate text-xs text-ink-500">{item.description}</span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-sm font-bold text-ink">{formatUgx(item.price)}</span>
          <span className="flex items-center gap-0.5 text-[11px] font-bold text-gold">
            {t("restaurant_order_now")}
            <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} aria-hidden />
          </span>
        </span>
      </div>
    </button>
  );
}

type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  choiceIds: string[];
};

function ItemDetailModal({
  item,
  restaurantId,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  restaurantId: string;
  onClose: () => void;
  onAdd: (line: { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number }) => void;
}) {
  const t = useTranslate();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);

  function toggleChoice(option: MenuItemOption, choiceId: string) {
    setSelected((prev) => {
      const current = prev[option.id] ?? [];
      if (option.multi_select) {
        return { ...prev, [option.id]: current.includes(choiceId) ? current.filter((c) => c !== choiceId) : [...current, choiceId] };
      }
      return { ...prev, [option.id]: current.includes(choiceId) ? [] : [choiceId] };
    });
  }

  const missingRequired = item.options.filter((o) => o.required && (selected[o.id] ?? []).length === 0);
  const allChoiceIds = Object.values(selected).flat();
  const allChoices = item.options.flatMap((o) => o.choices).filter((c) => allChoiceIds.includes(c.id));
  const unitPrice = item.price + allChoices.reduce((sum, c) => sum + c.price_delta, 0);

  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="space-y-4 pb-2">
        {item.photo_key && <MenuItemThumb itemId={item.id} size="modal" />}
        {item.description && <p className="text-sm text-ink-500">{item.description}</p>}
        <p className="text-lg font-bold text-ink">{formatUgx(item.price)}</p>
        <Link
          href={`/restaurants/${restaurantId}/chat?item=${item.id}&itemName=${encodeURIComponent(item.name)}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gold"
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          {t("restaurant_ask_about_item")}
        </Link>

        {item.options.map((option) => (
          <div key={option.id} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {option.name}{" "}
              {option.required ? t("restaurant_required") : t("restaurant_optional")}
            </p>
            <div className="space-y-1.5">
              {option.choices.map((choice) => {
                const active = (selected[option.id] ?? []).includes(choice.id);
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => toggleChoice(option, choice.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${
                      active ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
                    }`}
                  >
                    <span>{choice.name}</span>
                    <span>{choice.price_delta > 0 ? `+${formatUgx(choice.price_delta)}` : "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2">
          <span className="text-sm font-semibold text-ink">{t("restaurant_quantity")}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink"
            >
              <Minus className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
            <span className="w-5 text-center text-sm font-bold text-ink">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => q + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink"
            >
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={missingRequired.length > 0}
          onClick={() =>
            onAdd({
              unitPrice,
              choiceIds: allChoiceIds,
              choiceNames: allChoices.map((c) => c.name),
              quantity,
            })
          }
          className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
        >
          {missingRequired.length > 0
            ? `${t("restaurant_choose")} ${missingRequired[0].name}`
            : `${t("restaurant_add")} ${quantity} · ${formatUgx(unitPrice * quantity)}`}
        </button>
      </div>
    </Modal>
  );
}

export default function RestaurantPage() {
  const t = useTranslate();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<"menu" | "checkout">("menu");

  const [delivery, setDelivery] = useState<Place | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deliverySettings, setDeliverySettings] = useState<{
    deliveryRatePerKm: number;
    minimumDeliveryFee: number;
    shoppingDeliveryFee: number;
  } | null>(null);

  useEffect(() => {
    Promise.all([api.getRestaurant(id), api.getRestaurantMenu(id)])
      .then(([r, m]) => {
        setRestaurant(r.restaurant);
        setMenu(m);
      })
      .catch((err) => setError(errorMessage(err)));
    api
      .getSettings()
      .then((res) =>
        setDeliverySettings({
          deliveryRatePerKm: res.settings.deliveryRatePerKm,
          minimumDeliveryFee: res.settings.minimumDeliveryFee,
          shoppingDeliveryFee: res.settings.shoppingDeliveryFee,
        }),
      )
      .catch(() => {});
  }, [id]);

  function addToCart(item: MenuItem, line: { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number }) {
    const key = `${item.id}:${[...line.choiceIds].sort().join(",")}`;
    const name = line.choiceNames.length > 0 ? `${item.name} (${line.choiceNames.join(", ")})` : item.name;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l));
      }
      return [...prev, { key, menuItemId: item.id, name, unitPrice: line.unitPrice, quantity: line.quantity, choiceIds: line.choiceIds }];
    });
    setActiveItem(null);
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  const itemsTotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  // Mirrors the server's own formula (apps/api/src/restaurants/customer.ts)
  // so this is a real estimate, not just a placeholder — distance-priced
  // when both the restaurant and the destination have coordinates, else the
  // same flat fee the server falls back to. Only null before settings load.
  const estimatedDeliveryFee = useMemo(() => {
    if (!deliverySettings) return null;
    const resolved = placeFields(delivery);
    if (restaurant?.lat != null && restaurant?.lng != null && resolved.lat != null && resolved.lng != null) {
      const km = haversineKm(restaurant.lat, restaurant.lng, resolved.lat, resolved.lng);
      return roundFare(km * deliverySettings.deliveryRatePerKm, deliverySettings.minimumDeliveryFee);
    }
    return roundFare(deliverySettings.shoppingDeliveryFee);
  }, [restaurant, delivery, deliverySettings]);

  // Checkout starts with where to deliver.
  useEffect(() => {
    if (step === "checkout" && !delivery) setChoosing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function checkout() {
    const d = placeFields(delivery);
    if (!d.area && !d.address) {
      setError(t("restaurant_choose_delivery_location"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { order } = await api.orderFromRestaurant(id, {
        items: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, choiceIds: l.choiceIds })),
        destinationArea: d.area,
        destinationAddress: d.address,
        destinationLat: d.lat,
        destinationLng: d.lng,
        paymentRail: "escrow",
      });
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (error && !restaurant) {
    return <p className="px-4 py-10 text-center text-sm text-red-700">{error}</p>;
  }
  if (!restaurant || !menu) {
    return <p className="px-4 py-10 text-center text-sm text-ink-500">{t("loading")}</p>;
  }

  if (step === "checkout") {
    return (
      <div className="space-y-5 px-4 pb-28 pt-4">
        <h1 className="text-xl font-bold text-ink">{t("restaurant_delivery_details")}</h1>

        {delivery && (
          <RouteSummary pickup={null} destination={delivery} destinationLabel={t("place_delivery")} onChange={() => setChoosing(true)} />
        )}
        {(choosing || !delivery) && (
          <PlaceFlow
            concept="food"
            initial={{ destination: delivery }}
            onClose={() => (delivery ? setChoosing(false) : setStep("menu"))}
            onDone={(r) => {
              setDelivery(r.destination);
              setChoosing(false);
            }}
          />
        )}



        <div className="space-y-1.5 rounded-xl bg-[rgb(var(--surface-muted))] px-4 py-3">
          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>{t("restaurant_items_total")}</span>
            <span>{formatUgx(itemsTotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>{t("restaurant_delivery_fee")}</span>
            <span>{estimatedDeliveryFee != null ? `~${formatUgx(estimatedDeliveryFee)}` : t("loading")}</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-1.5 text-sm font-bold text-ink">
            <span>{t("restaurant_estimated_total")}</span>
            <span>{formatUgx(itemsTotal + (estimatedDeliveryFee ?? 0))}</span>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => setStep("menu")}
            className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
          >
            {t("restaurant_back_to_menu")}
          </button>
          <button
            onClick={checkout}
            disabled={busy}
            className="min-h-12 flex-[2] rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
          >
            {busy ? "Please wait…" : "Next: payment"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 pb-28 pt-4">
      <section className="home-card flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <Store className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold text-ink">{restaurant.name}</span>
          {(restaurant.cuisine || restaurant.description) && (
            <span className="block text-sm text-ink-500">{restaurant.cuisine ?? restaurant.description}</span>
          )}
        </span>
        {!restaurant.is_open && (
          <span className="shrink-0 rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 text-xs font-semibold text-ink-500">
            {t("restaurant_closed")}
          </span>
        )}
        <Link
          href={`/restaurants/${id}/chat`}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs font-bold text-ink"
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {t("restaurant_chat")}
        </Link>
      </section>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {menu.categories.map((cat: MenuCategory) => (
        <section key={cat.id} className="space-y-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{cat.name}</h2>
          <div className="grid grid-cols-2 gap-3">
            {cat.items.map((item: MenuItem) => (
              <FoodItemCard
                key={item.id}
                item={item}
                onOpen={() =>
                  item.options.length > 0
                    ? setActiveItem(item)
                    : addToCart(item, { unitPrice: item.price, choiceIds: [], choiceNames: [], quantity: 1 })
                }
              />
            ))}
          </div>
        </section>
      ))}

      {menu.uncategorizedItems.length > 0 && (
        <section className="space-y-2.5">
          <div className="grid grid-cols-2 gap-3">
            {menu.uncategorizedItems.map((item: MenuItem) => (
              <FoodItemCard
                key={item.id}
                item={item}
                onOpen={() =>
                  item.options.length > 0
                    ? setActiveItem(item)
                    : addToCart(item, { unitPrice: item.price, choiceIds: [], choiceNames: [], quantity: 1 })
                }
              />
            ))}
          </div>
        </section>
      )}

      {menu.categories.length === 0 && menu.uncategorizedItems.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-500">{t("restaurant_no_menu_yet")}</p>
      )}

      {activeItem && (
        <ItemDetailModal
          item={activeItem}
          restaurantId={id}
          onClose={() => setActiveItem(null)}
          onAdd={(line) => addToCart(activeItem, line)}
        />
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-14 z-40 px-4 pb-3">
          <button
            onClick={() => setStep("checkout")}
            className="mx-auto flex min-h-12 w-full max-w-lg items-center justify-between rounded-full bg-gold px-5 text-sm font-bold text-ink-gold shadow-[0_4px_16px_rgba(201,162,39,0.4)]"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
              {cartCount} item{cartCount === 1 ? "" : "s"}
            </span>
            <span>{formatUgx(itemsTotal)}</span>
          </button>
        </div>
      )}

      {cart.length > 0 && step === "menu" && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("restaurant_your_cart")}</h2>
          <ul className="space-y-2">
            {cart.map((l) => (
              <li key={l.key} className="home-card flex items-center justify-between !rounded-2xl !px-3 !py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {l.quantity}× {l.name}
                  </span>
                  <span className="block text-xs text-ink-500">{formatUgx(l.unitPrice * l.quantity)}</span>
                </span>
                <button onClick={() => removeLine(l.key)} className="shrink-0 text-xs font-semibold text-red-500">
                  {t("restaurant_remove")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
