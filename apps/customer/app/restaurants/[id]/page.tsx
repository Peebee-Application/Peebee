"use client";
import { FoodCover } from "@peebee/shared/food-cover";

import type { FoodItemInsight, FoodRestaurantTrust, MenuCategory, MenuItem, MenuItemBadge, MenuItemOption, Restaurant, RestaurantMenu } from "@peebee/shared";
import { foodBusinessLabel } from "@peebee/shared";
import { demoFoodPhotoPath, demoRestaurantPhotoPath } from "@peebee/shared/demo-food";
import { ArrowUpRight, BadgeCheck, ChevronLeft, ChevronDown, ChevronRight, Clock, Star, MessageCircle, Minus, Plus, ShoppingBag, ShoppingCart, Store, Trash2, UtensilsCrossed, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShareButton } from "../../../components/ShareButton";
import { PlaceFlow } from "../../../components/PlaceFlow";
import { RouteSummary } from "../../../components/home/RouteSummary";
import { placeFields, type Place } from "../../../lib/places";
import { DishReviews } from "../../../components/DishReviews";
import { BusinessLogo } from "../../../components/BusinessLogo";
import { useAuth } from "../../../lib/auth-context";
import { api, errorMessage } from "../../../lib/api";
import { useRegisterNavPrimaryAction, useRegisterNavBack } from "../../../lib/nav-primary-action";
import { useTranslate } from "../../../lib/i18n";
import { formatUgx } from "../../../lib/order-display";
import { DeliveryLines, ItemsBreakdown } from "../../../components/OrderBreakdown";
import { menuItemPricing } from "../../../lib/product-pricing";
import { formatCartDate, useCartExpiryHours } from "../../../lib/cart";
import {
  FOOD_EARLIER_EVENT,
  deleteFoodEarlierCart,
  foodEarlierCartDate,
  isFoodCartFresh,
  loadFoodEarlierCarts,
  nameFoodEarlierCarts,
  readFoodCart,
  removeFoodCart,
  setAsideFoodCart,
  writeFoodCart,
  type FoodEarlierCart,
} from "../../../lib/food-carts";

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
function useMenuItemPhoto(itemId: string, hasPhoto = true, revision?:string) {
  const demoPhoto = demoFoodPhotoPath(itemId);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (demoPhoto || !hasPhoto) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .menuItemPhotoBlob(itemId,revision?Date.parse(revision.includes("T")?revision:revision.replace(" ","T")+"Z"):undefined)
      .then((blob) => {
        if (cancelled || !blob.type.startsWith("image/")) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, demoPhoto, hasPhoto, revision]);

  return demoPhoto ?? (hasPhoto ? url : null);
}

function MenuItemThumb({ itemId, photoKey, revision, size = "row" }: { itemId: string; photoKey?: string | null; revision?: string; size?: "row" | "modal" }) {
  const url = useMenuItemPhoto(itemId, photoKey === undefined ? true : !!photoKey, revision);

  const dims = size === "row" ? "h-14 w-14 rounded-xl" : "h-64 w-full rounded-3xl";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url ?? "/brand/food-hero.webp"}
      alt={url ? "Menu item photo" : "Food illustration"}
      className={`${dims} shrink-0 rounded-3xl object-cover ${size === "modal" ? "mb-1" : ""}`}
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

/** Horizontal, snap-scrolling rail for the featured dish cards. */
function DishRail({children,label}:{children:React.ReactNode;label:string}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const node=ref.current;if(!node)return;if(!('IntersectionObserver' in window)){node.classList.add('rail-visible');return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){node.classList.add('rail-visible');observer.disconnect();}},{threshold:.1});observer.observe(node);return()=>observer.disconnect();},[]);
  return <div ref={ref} aria-label={label} dir="ltr" className="edge-carousel food-dish-rail flex snap-x snap-mandatory gap-3 overflow-x-auto pb-8 pt-2">{children}</div>;
}

/** Short, calm labels for the small gold badge beside a dish name. */
const DISH_BADGE_LABEL: Record<MenuItemBadge, string> = { trending: "Popular", new: "New", sale: "Offer" };

type DishCardProps = {
  item: MenuItem;
  insight?: FoodItemInsight;
  /** How many of this dish (any options) are in the restaurant cart. */
  quantity: number;
  restaurantOpen: boolean;
  onOpen: () => void;
  /** Adds one plain portion; only called for dishes with no required choices. */
  onAdd: () => void;
};

function DishMeta({ item, insight, showPrep = true }: { item: MenuItem; insight?: FoodItemInsight; showPrep?: boolean }) {
  const rating = insight?.averageRating != null ? insight.averageRating.toFixed(1) : null;
  return (
    <span className="fc-meta">
      {showPrep && item.prep_time_minutes ? <span className="fc-meta__item"><Clock size={13} aria-hidden="true" />{item.prep_time_minutes} min</span> : null}
      {rating ? (
        <span className="fc-meta__item fc-meta__extra" aria-label={`Rated ${rating} out of 5`}><Star size={13} aria-hidden="true" />{rating}</span>
      ) : insight?.orderCount ? (
        <span className="fc-meta__item fc-meta__extra"><ShoppingBag size={13} aria-hidden="true" />{insight.orderCount.toLocaleString()}</span>
      ) : null}
    </span>
  );
}

function DishPrice({ item }: { item: MenuItem }) {
  const pricing = menuItemPricing(item);
  return (
    <span className="fc-price">
      {pricing.from && <span className="fc-price__from">from</span>}
      <span className="fc-price__ccy">UGX</span>
      <span className="fc-price__amount">{pricing.price.toLocaleString("en-UG")}</span>
    </span>
  );
}

/** "Add +" pill: adds a plain portion, or opens the dish when it needs a
 * choice first (e.g. Size). Once in the cart it shows the quantity. */
function DishAddButton({ item, quantity, restaurantOpen, onOpen, onAdd }: Omit<DishCardProps, "insight">) {
  const needsChoice = item.options.some((option) => option.required && option.choices.length > 0);
  const soldOut = item.available !== 1;
  const [pop, setPop] = useState(0);
  if (!restaurantOpen || soldOut) {
    return <button type="button" className="fc-add" disabled>{soldOut ? "Sold out" : "Closed"}</button>;
  }
  return (
    <button
      type="button"
      className={`fc-add ${quantity > 0 ? "is-in" : ""}`}
      data-direct={needsChoice ? undefined : ""}
      data-choose={needsChoice ? "" : undefined}
      aria-label={needsChoice ? `Choose options for ${item.name}${quantity ? `, ${quantity} in cart` : ""}` : quantity ? `Add another ${item.name}, ${quantity} in cart` : `Add ${item.name}`}
      onClick={() => { if (needsChoice) { onOpen(); return; } onAdd(); setPop((n) => n + 1); }}
    >
      {quantity > 0 ? <span key={pop} className="fc-add__qty">{quantity}</span> : <span>Add</span>}
      <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
    </button>
  );
}

function DishName({ item }: { item: MenuItem }) {
  return <h3 className="fc-name" title={item.name}>{item.name}</h3>;
}

/** Small gold badge pill overlaid on a dish photo corner. */
function DishBadge({ label, corner }: { label: string; corner: "left" | "right" }) {
  return <span className={`fc-badge fc-overlay fc-overlay--${corner}`}><BadgeCheck size={12} strokeWidth={2.4} aria-hidden="true" />{label}</span>;
}

/** Featured dish: the photo fills the card and its lower part is frosted
 * (a progressive blur under a soft tint), carrying white copy and a white
 * "Add +" pill. Frame, tint and shadow are tuned per theme in globals.css. */
function FeaturedDishCard(props: DishCardProps) {
  const { item, insight, onOpen } = props;
  const photoUrl = useMenuItemPhoto(item.id, !!item.photo_key, item.updated_at);
  const badge = item.badge ? DISH_BADGE_LABEL[item.badge] : "Chef's pick";
  return (
    <article className="fc-card fc-card--featured">
      <button type="button" className="fc-hit" onClick={onOpen} aria-label={`View ${item.name}`} />
      <span className={`fc-feature__media ${photoUrl ? "" : "is-empty"}`} aria-hidden="true">
        {photoUrl ? <img src={photoUrl} alt="" loading="lazy" decoding="async" /> : <UtensilsCrossed size={44} />}
        <span className="fc-feature__blur" />
        <span className="fc-feature__tint" />
      </span>
      {item.prep_time_minutes ? <span className="fc-glass-pill fc-overlay fc-overlay--left"><Clock size={13} aria-hidden="true" />{item.prep_time_minutes} min</span> : null}
      <DishBadge label={badge} corner="right" />
      <span className="fc-feature__body">
        <DishName item={item} />
        {item.description && <span className="fc-desc">{item.description}</span>}
        <span className="fc-row">
          <span className="fc-feature__left">
            <DishPrice item={item} />
            <DishMeta item={item} insight={insight} showPrep={false} />
          </span>
          <DishAddButton {...props} />
        </span>
      </span>
    </article>
  );
}

/** General menu dish: photo inset in the top of the card, then name, short
 * muted description, price, and a meta row with a subtle "Add +" pill. */
function GeneralDishCard(props: DishCardProps) {
  const { item, insight, onOpen } = props;
  const photoUrl = useMenuItemPhoto(item.id, !!item.photo_key, item.updated_at);
  return (
    <article className="fc-card fc-card--general">
      <button type="button" className="fc-hit" onClick={onOpen} aria-label={`View ${item.name}`} />
      <span className={`fc-general__media ${photoUrl ? "" : "is-empty"}`}>
        {photoUrl ? <img src={photoUrl} alt="" loading="lazy" decoding="async" /> : <UtensilsCrossed size={34} />}
        {item.badge && <DishBadge label={DISH_BADGE_LABEL[item.badge]} corner="left" />}
      </span>
      <span className="fc-general__body">
        <DishName item={item} />
        {item.description && <span className="fc-desc">{item.description}</span>}
        <DishPrice item={item} />
        <span className="fc-row">
          <DishMeta item={item} insight={insight} />
          <DishAddButton {...props} />
        </span>
      </span>
    </article>
  );
}
type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  choiceNames?: string[];
  photoKey?: string | null;
  photoRevision?: string;
  unitPrice: number;
  quantity: number;
  choiceIds: string[];
};

type CartAddLine = { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number };

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<CartLine>;
  return typeof line.key === "string"
    && typeof line.menuItemId === "string"
    && typeof line.name === "string"
    && Number.isInteger(line.quantity)
    && Number(line.quantity) > 0
    && Number(line.quantity) <= 50
    && Number.isFinite(line.unitPrice)
    && Number(line.unitPrice) >= 0
    && Array.isArray(line.choiceIds)
    && line.choiceIds.every((choiceId) => typeof choiceId === "string");
}

function otherRestaurantCartKeys(storagePrefix: string, currentCartKey: string): string[] {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .filter((key): key is string => !!key && key.startsWith(storagePrefix) && key !== currentCartKey);
    return keys.filter((key) => readFoodCart(key, isCartLine).lines.length > 0);
  } catch {
    return [];
  }
}

function MenuOrderList({
  cart,
  itemsTotal,
  cartCount,
  thisName,
  otherGroup,
  isOpen,
  onClose,
  onRemoveLine,
  onViewCart,
}: {
  cart: CartLine[];
  itemsTotal: number;
  cartCount: number;
  /** With another restaurant combined into the same delivery, its items are listed too, under its name. */
  thisName?: string;
  otherGroup?: { name: string; lines: CartLine[] } | null;
  isOpen: boolean;
  onClose: () => void;
  onRemoveLine: (key: string) => void;
  onViewCart: () => void;
}) {
  const t = useTranslate();
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!portalReady || typeof document === "undefined") return null;

  const renderLine = (line: CartLine, removable: boolean) => (
    <li className="menu-item-order-list__line" key={line.key}>
      <MenuItemThumb itemId={line.menuItemId} photoKey={line.photoKey} revision={line.photoRevision} />
      <span className="menu-item-order-list__copy">
        <span className="menu-item-order-list__name" title={line.name}>{line.name}</span>
        <span className="menu-item-order-list__meta">{line.quantity} × {formatUgx(line.unitPrice)} {t("order_each")}{line.choiceNames?.length ? ` · ${line.choiceNames.join(", ")}` : ""}</span>
        <span className="menu-item-order-list__subtotal">{t("restaurant_subtotal")} · {formatUgx(line.unitPrice * line.quantity)}</span>
      </span>
      {removable && (
        <button type="button" className="menu-item-order-list__remove" aria-label={`${t("restaurant_remove")} ${line.name}`} onClick={() => onRemoveLine(line.key)}>
          <Trash2 size={17} strokeWidth={1.9} aria-hidden="true" />
        </button>
      )}
    </li>
  );

  return createPortal(
    <div className={`menu-item-cart-layer${isOpen ? " is-open" : ""}`} aria-hidden={!isOpen}>
      <button type="button" className="menu-item-cart-layer__backdrop" aria-label="Close cart" tabIndex={isOpen ? 0 : -1} onClick={onClose} />
      <aside
        className="menu-item-cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-item-cart-title"
        inert={!isOpen}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-item-cart-drawer__header">
          <div>
            <h2 id="menu-item-cart-title" className="menu-item-cart-drawer__title">{t("restaurant_your_cart")}</h2>
            <p className="menu-item-cart-drawer__count" aria-live="polite">{t("restaurant_order_list_item_count", { count: cartCount })}</p>
          </div>
          <button type="button" className="menu-item-cart-drawer__close" aria-label="Close cart" onClick={onClose}>
            <X size={21} aria-hidden="true" />
          </button>
        </div>
        <div className="menu-item-cart-drawer__body">
          {cart.length > 0 || otherGroup?.lines.length ? (
            <>
              {otherGroup?.lines.length ? <p className="restaurant-cart-group__name">{otherGroup.name}</p> : null}
              {otherGroup?.lines.length ? (
                <ul className="menu-item-order-list__lines">
                  {otherGroup.lines.map((line) => renderLine(line, false))}
                </ul>
              ) : null}
              {otherGroup?.lines.length && cart.length > 0 ? <hr className="restaurant-cart-group__divider" /> : null}
              {otherGroup?.lines.length && cart.length > 0 && thisName ? <p className="restaurant-cart-group__name">{thisName}</p> : null}
              {cart.length > 0 && (
                <ul className="menu-item-order-list__lines">
                  {cart.map((line) => renderLine(line, true))}
                </ul>
              )}
            </>
          ) : (
            <p className="px-1 py-3 text-sm text-ink-500">{t("restaurant_order_list_empty")}</p>
          )}
        </div>
        <div className="menu-item-cart-drawer__footer">
          <div className="menu-item-cart-drawer__total">
            <span>{t("restaurant_items_total")}</span>
            <strong>{formatUgx(itemsTotal)}</strong>
          </div>
          <button type="button" className="menu-item-order-list__checkout" onClick={onViewCart} disabled={cart.length === 0}>
            <span>{t("restaurant_checkout")}</span>
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function MenuItemDeckCard({ item, position, isActive, dragOffset = 0, isDragging = false, onSelect }: {
  item: MenuItem;
  position: "far-previous" | "previous" | "active" | "next" | "far-next";
  isActive: boolean;
  dragOffset?: number;
  isDragging?: boolean;
  onSelect: (item: MenuItem) => void;
}) {
  const t = useTranslate();
  const photo = useMenuItemPhoto(item.id, !!item.photo_key, item.updated_at);
  const dragStyle: React.CSSProperties = isDragging && dragOffset !== 0 ? {
    transition: "none",
    transform: isActive
      ? `translateX(calc(-50% + ${dragOffset}px)) translateY(-50%) scale(${1 - Math.min(0.08, Math.abs(dragOffset) * 0.0003)}) translateZ(0)`
      : position === "next"
      ? `translateX(calc(-50% + 102% + ${dragOffset}px)) translateY(-50%) scale(${0.88 + (dragOffset < 0 ? Math.min(0.08, -dragOffset * 0.0003) : 0)}) rotateY(${-5 + (dragOffset < 0 ? 5 : 0)}deg) translateZ(-40px)`
      : position === "previous"
      ? `translateX(calc(-50% - 102% + ${dragOffset}px)) translateY(-50%) scale(${0.88 + (dragOffset > 0 ? Math.min(0.08, dragOffset * 0.0003) : 0)}) rotateY(${5 - (dragOffset > 0 ? 5 : 0)}deg) translateZ(-40px)`
      : undefined,
  } : {};

  return (
    <div
      className="menu-item-deck__card"
      data-position={position}
      style={dragStyle}
      aria-current={isActive ? "true" : undefined}
      aria-label={t("restaurant_menu_show_item", { item: item.name })}
      role="button"
      tabIndex={isActive ? 0 : -1}
      onKeyDown={(event) => {
        if (!isActive && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect(item);
        }
      }}
      onClick={() => {
        if (!isActive) onSelect(item);
      }}
    >
      <div className="menu-item-deck__photo-box" aria-hidden="true">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="menu-item-deck__photo" src={photo} alt="" />
        ) : (
          <div className="menu-item-deck__photo--empty">
            <UtensilsCrossed size={48} />
          </div>
        )}
        {item.badge && (
          <span className={`menu-item-deck__badge ${BADGE_STYLES[item.badge]}`}>
            {t(BADGE_KEYS[item.badge])}
          </span>
        )}
      </div>
    </div>
  );
}

function MenuItemDetailPanel({ item, isOpen = true, isDemo = false, restaurantId, onAdd }: {
  item: MenuItem;
  isOpen?: boolean;
  isDemo?: boolean;
  restaurantId: string;
  onAdd: (item: MenuItem, line: CartAddLine) => boolean;
}) {
  const t = useTranslate();
  const [configuration, setConfiguration] = useState<{ itemId: string; selected: Record<string, string[]>; quantity: number }>({
    itemId: item.id,
    selected: {},
    quantity: 1,
  });
  const [addedItemId, setAddedItemId] = useState<string | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
  const selected = configuration.itemId === item.id ? configuration.selected : {};
  const quantity = configuration.itemId === item.id ? configuration.quantity : 1;
  const addedAnim = addedItemId === item.id;
  const itemAvailable = item.available === 1;
  const unavailableMessage = !isOpen
    ? t("restaurant_restaurant_closed")
    : !itemAvailable
      ? t("restaurant_item_unavailable")
      : null;

  useEffect(() => {
    if (!availabilityMessage) return;
    const timeout = window.setTimeout(() => setAvailabilityMessage(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [availabilityMessage]);

  function updateConfiguration(update: (current: { selected: Record<string, string[]>; quantity: number }) => { selected: Record<string, string[]>; quantity: number }) {
    setConfiguration((previous) => {
      const current = previous.itemId === item.id ? previous : { itemId: item.id, selected: {}, quantity: 1 };
      return { itemId: item.id, ...update(current) };
    });
  }

  function toggleChoice(option: MenuItemOption, choiceId: string) {
    updateConfiguration((configuration) => {
      const current = configuration.selected[option.id] ?? [];
      const updated = option.multi_select
        ? current.includes(choiceId) ? current.filter((id) => id !== choiceId) : [...current, choiceId]
        : current.includes(choiceId) ? [] : [choiceId];
      return { ...configuration, selected: { ...configuration.selected, [option.id]: updated } };
    });
  }

  const missingRequired = item.options.filter((option) => option.required && (selected[option.id] ?? []).length === 0);
  const choiceIds = Object.values(selected).flat();
  const choices = item.options.flatMap((option) => option.choices).filter((choice) => choiceIds.includes(choice.id));
  const unitPrice = item.price + choices.reduce((sum, choice) => sum + choice.price_delta, 0);
  const configuredTotal = unitPrice * quantity;

  function handleAdd() {
    if (unavailableMessage) {
      setAvailabilityMessage(unavailableMessage);
      return;
    }
    if (missingRequired.length > 0) return;
    if (onAdd(item, { unitPrice, choiceIds, choiceNames: choices.map((choice) => choice.name), quantity })) {
      setAddedItemId(item.id);
      setTimeout(() => setAddedItemId((current) => current === item.id ? null : current), 1400);
    }
  }

  return (
    <>
      <section className="menu-item-detail-card" aria-live="polite">
        <div className="menu-item-detail-card__scroll">
          <div key={item.id} className="menu-item-detail-card__content">
          <h1 className="menu-item-deck__title">{item.name}</h1>
          {item.description && <p className="menu-item-deck__desc">{item.description}</p>}
          {item.options.length > 0 && (
            <div className="menu-item-deck__options">
              {item.options.map((option) => (
                <fieldset className="menu-item-deck__option" key={option.id}>
                  <legend className="menu-item-deck__option-title">
                    {option.name} {option.required ? t("restaurant_required") : t("restaurant_optional")}
                  </legend>
                  <div className="menu-item-deck__pills">
                    {option.choices.map((choice) => {
                      const activeChoice = (selected[option.id] ?? []).includes(choice.id);
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          className="menu-item-deck__pill"
                          data-selected={activeChoice ? "true" : undefined}
                          aria-pressed={activeChoice}
                          onClick={() => toggleChoice(option, choice.id)}
                        >
                          <span>{choice.name}</span>
                          <span className="menu-item-deck__pill-price">
                            {activeChoice ? "✓" : choice.price_delta > 0 ? `+${formatUgx(choice.price_delta)}` : "+"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
          <div className="menu-item-deck__qty">
            <span className="text-xs font-semibold text-ink">{t("restaurant_quantity")}</span>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Decrease quantity" onClick={() => updateConfiguration((current) => ({ ...current, quantity: Math.max(1, current.quantity - 1) }))} className="flex h-9 w-9 items-center justify-center rounded-full glass-panel text-ink">
                <Minus size={15} strokeWidth={2.2} />
              </button>
              <span className="w-5 text-center text-sm font-bold text-ink">{quantity}</span>
              <button type="button" aria-label="Increase quantity" onClick={() => updateConfiguration((current) => ({ ...current, quantity: Math.min(50, current.quantity + 1) }))} className="flex h-9 w-9 items-center justify-center rounded-full glass-panel text-ink">
                <Plus size={15} strokeWidth={2.2} />
              </button>
            </div>
          </div>
          {!isDemo && (
            <Link href={`/restaurants/${restaurantId}/chat?item=${item.id}&itemName=${encodeURIComponent(item.name)}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-gold hover:underline">
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
              {t("restaurant_ask_about_item")}
            </Link>
          )}
          <div className="pt-3"><DishReviews restaurantId={restaurantId} itemId={item.id} isDemo={isDemo} /></div>
          </div>
        </div>
      </section>
      <div className="menu-item-deck__footer">
        {availabilityMessage && (
          <p className="menu-item-deck__availability-note" role="status" aria-live="polite">
            {availabilityMessage}
          </p>
        )}
        <button
          type="button"
          disabled={missingRequired.length > 0 && !unavailableMessage}
          onClick={handleAdd}
          className="menu-item-deck__add-btn"
          data-added={addedAnim ? "true" : undefined}
          data-unavailable={unavailableMessage ? "true" : undefined}
          aria-label={unavailableMessage ? `${unavailableMessage}, ${formatUgx(configuredTotal)}` : missingRequired.length > 0 ? `${t("restaurant_choose")} ${missingRequired[0].name}` : `${t("restaurant_add_to_list")} ${item.name}, ${formatUgx(configuredTotal)}`}
        >
          <span id="menu-item-current-price" className="menu-item-deck__add-price" aria-live="polite">{formatUgx(configuredTotal)}</span>
          <span className="menu-item-deck__add-icon" aria-hidden="true"><Plus size={22} strokeWidth={2.5} /></span>
          <span className="sr-only">{unavailableMessage ?? (missingRequired.length > 0 ? `${t("restaurant_choose")} ${missingRequired[0].name}` : t("restaurant_add_to_list"))}</span>
        </button>
      </div>
    </>
  );
}

function MenuItemDeck({
  items,
  categoryName,
  activeItemId,
  onSelect,
}: {
  items: MenuItem[];
  categoryName: string;
  activeItemId: string;
  onSelect: (item: MenuItem) => void;
}) {
  const t = useTranslate();
  const index = Math.max(0, items.findIndex((item) => item.id === activeItemId));
  const wheelLocked = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const dragAxis = useRef<"x" | "y" | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => {
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
  }, []);

  function move(delta: -1 | 1) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= items.length) return false;
    onSelect(items[nextIndex]);
    return true;
  }

  function handleWheel(event: React.WheelEvent<HTMLElement>) {
    const delta = event.shiftKey && Math.abs(event.deltaX) < 12 ? event.deltaY : event.deltaX;
    if (Math.abs(delta) < 12 || (delta > 0 && index >= items.length - 1) || (delta < 0 && index === 0)) return;
    if (wheelLocked.current) return;
    wheelLocked.current = true;
    move(delta > 0 ? 1 : -1);
    wheelTimer.current = setTimeout(() => { wheelLocked.current = false; }, 480);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return;
    const delta = event.key === "ArrowRight" ? 1 : -1;
    move(delta as -1 | 1);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    dragAxis.current = null;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!pointerStart.current) return;
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;

    if (dragAxis.current === null) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        dragAxis.current = "x";
        setIsDragging(true);
        try {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {}
      } else if (Math.abs(dy) > 8) {
        dragAxis.current = "y";
      }
    }

    if (dragAxis.current === "x") {
      setDragOffset(dx);
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    if (!pointerStart.current) return;
    const dx = event.clientX - pointerStart.current.x;
    pointerStart.current = null;

    if (dragAxis.current === "x") {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {}
      setIsDragging(false);
      setDragOffset(0);
      dragAxis.current = null;

      if (dx < -40 && index < items.length - 1) {
        move(1);
      } else if (dx > 40 && index > 0) {
        move(-1);
      }
    } else {
      dragAxis.current = null;
    }
  }

  function handlePointerCancel() {
    pointerStart.current = null;
    dragAxis.current = null;
    setIsDragging(false);
    setDragOffset(0);
  }

  const firstVisible = Math.max(0, index - 2);
  const lastVisible = Math.min(items.length, index + 3);

  return (
    <section
      className="menu-item-deck"
      aria-label={t("restaurant_menu_browse_category", { category: categoryName })}
      aria-roledescription="item carousel"
      tabIndex={0}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="menu-item-deck__stage">
        {items.slice(firstVisible, lastVisible).map((menuItem) => {
          const distance = items.findIndex((row) => row.id === menuItem.id) - index;
          const position =
            distance === 0
              ? "active"
              : distance === -1
              ? "previous"
              : distance === 1
              ? "next"
              : distance < 0
              ? "far-previous"
              : "far-next";

          return (
            <MenuItemDeckCard
              key={menuItem.id}
              item={menuItem}
              position={position}
              isActive={distance === 0}
              dragOffset={dragOffset}
              isDragging={isDragging}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </section>
  );
}

function ItemDetailPage({
  item,
  items,
  categoryName,
  cart,
  itemsTotal,
  cartCount,
  thisName,
  otherGroup,
  restaurantId,
  onBack,
  isDemo = false,
  isOpen = true,
  onRemoveLine,
  onViewCart,
  onAdd,
}: {
  item: MenuItem;
  items: MenuItem[];
  categoryName: string;
  cart: CartLine[];
  itemsTotal: number;
  cartCount: number;
  thisName?: string;
  otherGroup?: { name: string; lines: CartLine[] } | null;
  restaurantId: string;
  onBack: () => void;
  isDemo?: boolean;
  isOpen?: boolean;
  onRemoveLine: (key: string) => void;
  onViewCart: () => void;
  onAdd: (item: MenuItem, line: CartAddLine) => boolean;
}) {
  const t = useTranslate();
  const [activeItemId, setActiveItemId] = useState(item.id);
  const [cartOpen, setCartOpen] = useState(false);
  const cartTriggerRef = useRef<HTMLButtonElement>(null);
  const activeItem = items.find((row) => row.id === activeItemId) ?? item;
  const activePhoto = useMenuItemPhoto(activeItem.id, !!activeItem.photo_key, activeItem.updated_at);
  const closeCart = useCallback(() => {
    setCartOpen(false);
    cartTriggerRef.current?.focus();
  }, []);

  return (
    <div className="menu-item-detail-page">
      <main className={`menu-item-detail-page__content${cartOpen ? " is-shifted" : ""}`}>
        <div className="menu-item-floating-controls">
          <button type="button" className="menu-item-back-trigger" aria-label={t("restaurant_back_to_menu")} onClick={onBack}>
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2">
            <ShareButton
              target={{
                url: `/restaurants/${encodeURIComponent(restaurantId)}/items/${encodeURIComponent(activeItem.id)}`,
                title: `${activeItem.name}${thisName ? ` from ${thisName}` : ""}`,
                text: `${activeItem.name}${thisName ? ` from ${thisName}` : ""}, ${formatUgx(activeItem.price)} on Peebee Food`,
              }}
              label={`Share ${activeItem.name}`}
              className="menu-item-back-trigger"
            />
            <button ref={cartTriggerRef} type="button" className="menu-item-cart-trigger" aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`} aria-expanded={cartOpen} onClick={() => setCartOpen(true)}>
              <ShoppingCart size={21} strokeWidth={2} aria-hidden="true" />
              <span className="menu-item-cart-trigger__count" aria-live="polite">{cartCount}</span>
            </button>
          </div>
        </div>
        <div
          key={activeItem.id}
          className="menu-item-detail-page__ambient"
          aria-hidden="true"
          style={activePhoto ? { backgroundImage: `url("${activePhoto}")` } : undefined}
        />
        <MenuItemDeck
          items={items}
          categoryName={categoryName}
          activeItemId={activeItem.id}
          onSelect={(nextItem) => setActiveItemId(nextItem.id)}
        />
        <MenuItemDetailPanel item={activeItem} isOpen={isOpen} isDemo={isDemo} restaurantId={restaurantId} onAdd={onAdd} />
      </main>
      <MenuOrderList
        cart={cart}
        itemsTotal={itemsTotal}
        cartCount={cartCount}
        thisName={thisName}
        otherGroup={otherGroup}
        isOpen={cartOpen}
        onClose={closeCart}
        onRemoveLine={onRemoveLine}
        onViewCart={() => {
          setCartOpen(false);
          onViewCart();
        }}
      />
    </div>
  );
}

type SharedDelivery = { firstPickup: { name: string; fee: number }; addedStop: { name: string; fee: number } };

function RestaurantCartSwitchDialog({ cartCount, combine, onCombine, onKeep, onDiscard, onCancel }: {
  cartCount: number;
  /** Set when exactly one other restaurant cart exists: explains what a shared delivery means. */
  combine?: { otherName: string; thisName: string } | null;
  onCombine?: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const t = useTranslate();
  const [portalReady, setPortalReady] = useState(false);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const cancelActionRef = useRef(onCancel);
  useEffect(() => { cancelActionRef.current = onCancel; }, [onCancel]);

  useEffect(() => setPortalReady(true), []);
  useEffect(() => {
    if (!portalReady) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    keepButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") cancelActionRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [portalReady]);

  if (!portalReady || typeof document === "undefined") return null;
  const plural = cartCount !== 1;
  return createPortal(
    <div className="restaurant-cart-switch-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="restaurant-cart-switch-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restaurant-cart-switch-title" aria-describedby="restaurant-cart-switch-copy" onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}>
        <span className="restaurant-cart-switch-dialog__icon" aria-hidden="true"><ShoppingCart size={22} /></span>
        <h2 id="restaurant-cart-switch-title" className="restaurant-cart-switch-dialog__title">
          {t(plural ? "restaurant_switch_cart_title_plural" : "restaurant_switch_cart_title")}
        </h2>
        <p id="restaurant-cart-switch-copy" className="restaurant-cart-switch-dialog__copy">
          {combine
            ? `One rider collects from ${combine.otherName.replace(/\.+$/, "")} and ${combine.thisName.replace(/\.+$/, "")} and delivers both together. You pay once; checkout shows each restaurant's items and delivery.`
            : t(plural ? "restaurant_switch_cart_copy_plural" : "restaurant_switch_cart_copy")}
        </p>
        <div className="restaurant-cart-switch-dialog__actions">
          {combine && onCombine && (
            <button ref={keepButtonRef} type="button" className="restaurant-cart-switch-dialog__keep" onClick={onCombine}>
              Combine into one delivery
            </button>
          )}
          <button ref={combine && onCombine ? undefined : keepButtonRef} type="button" className={combine && onCombine ? "restaurant-cart-switch-dialog__discard" : "restaurant-cart-switch-dialog__keep"} onClick={onKeep}>
            {combine && onCombine ? "Order separately" : t(plural ? "restaurant_switch_cart_keep_plural" : "restaurant_switch_cart_keep")}
          </button>
          <button type="button" className="restaurant-cart-switch-dialog__discard" onClick={onDiscard}>
            <Trash2 size={16} aria-hidden="true" />
            {t(plural ? "restaurant_switch_cart_discard_plural" : "restaurant_switch_cart_discard")}
          </button>
          <button type="button" className="restaurant-cart-switch-dialog__cancel" onClick={onCancel}>
            {t("restaurant_switch_cart_cancel")}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/**
 * The food checkout opens only from a tap on "View cart" (this page or a dish page), never from a
 * `?checkout=1` URL that Back, Forward or a reload brings up again. Otherwise the phone's Back during
 * another checkout (the shopping bag's) landed here and pulled this unpaid food cart up for payment.
 * Set by the tap, taken once by the page that opens; only good for a few seconds.
 */
let foodCheckoutTap: { restaurantId: string; at: number } | null = null;
const FOOD_CHECKOUT_TAP_MS = 5000;
function takeFoodCheckoutTap(restaurantId: string): boolean {
  const tap = foodCheckoutTap;
  foodCheckoutTap = null;
  return !!tap && tap.restaurantId === restaurantId && Date.now() - tap.at < FOOD_CHECKOUT_TAP_MS;
}

export default function RestaurantPage() {
  const t = useTranslate();
  const { id, itemId } = useParams<{ id: string; itemId?:string }>();
  const {user}=useAuth();
  const cartStoragePrefix=`peebee-food-cart:${user?.id??"guest"}:`;
  const cartKey=`${cartStoragePrefix}${id}`;
  const cartOwner=user?.id??"guest";
  // Admin setting: a restaurant cart left longer than this is set aside as an earlier cart, never pulled into a new checkout.
  const expiryHours=useCartExpiryHours();
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutRequested = searchParams.get("checkout") === "1";

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insights,setInsights]=useState<Record<string,FoodItemInsight>>({});
  const [restaurantTrust,setRestaurantTrust]=useState<FoodRestaurantTrust|null>(null);
  const [restaurantTrustStatus,setRestaurantTrustStatus]=useState<"loading"|"ready"|"unavailable">("loading");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pendingRestaurantCartSwitch, setPendingRestaurantCartSwitch] = useState<{ item: MenuItem; line: CartAddLine; otherCartKeys: string[] } | null>(null);
  const combineStorageKey=`peebee-food-combine:${user?.id??"guest"}:${id}`;
  const [combineOtherId, setCombineOtherId] = useState<string | null>(null);
  const [combineOther, setCombineOther] = useState<{ id: string; name: string; lat: number | null; lng: number | null; lines: CartLine[] } | null>(null);
  const [switchOther, setSwitchOther] = useState<{ name: string; lat: number | null; lng: number | null } | null>(null);
  useEffect(()=>{setCart(readFoodCart(cartKey,isCartLine).lines);setPendingRestaurantCartSwitch(null);let saved:string|null=null;try{saved=sessionStorage.getItem(combineStorageKey);}catch{}setCombineOtherId(saved);},[cartKey,combineStorageKey]);
  function chooseCombine(otherId: string | null){setCombineOtherId(otherId);try{if(otherId)sessionStorage.setItem(combineStorageKey,otherId);else sessionStorage.removeItem(combineStorageKey);}catch{}}
  /** Moves another restaurant's cart out of this session into the food earlier carts (it stays restorable there). */
  function setAsideOtherCart(otherId: string){
    const key=`${cartStoragePrefix}${otherId}`;
    const saved=readFoodCart(key,isCartLine);
    removeFoodCart(key);
    if(!saved.lines.length)return;
    setAsideFoodCart(cartOwner,otherId,"",saved);
    api.getRestaurant(otherId).then(({restaurant:r})=>nameFoodEarlierCarts(cartOwner,otherId,r.name)).catch(()=>{});
  }
  // This restaurant's newest earlier cart: offered (Restore / Dismiss) while its current cart is empty.
  const [earlierHere,setEarlierHere]=useState<FoodEarlierCart<CartLine>|null>(null);
  useEffect(()=>{
    const refresh=()=>setEarlierHere(loadFoodEarlierCarts(cartOwner,isCartLine).find(row=>row.restaurantId===id)??null);
    refresh();
    window.addEventListener(FOOD_EARLIER_EVENT,refresh);
    return()=>window.removeEventListener(FOOD_EARLIER_EVENT,refresh);
  },[cartOwner,id]);
  // The other restaurant's saved cart, loaded only while a shared delivery is chosen.
  useEffect(()=>{
    if(!combineOtherId){setCombineOther(null);return;}
    let live=true;
    const saved=readFoodCart(`${cartStoragePrefix}${combineOtherId}`,isCartLine);
    // The sticky combine choice never pulls in a stale (or empty) cart: drop it, and the old cart goes to earlier carts.
    if(!isFoodCartFresh(saved,expiryHours)){setAsideOtherCart(combineOtherId);chooseCombine(null);return;}
    const lines=saved.lines;
    api.getRestaurant(combineOtherId).then(({restaurant:r})=>{if(live)setCombineOther({id:combineOtherId,name:r.name,lat:r.lat??null,lng:r.lng??null,lines});}).catch(()=>{if(live)setCombineOther(null);});
    return()=>{live=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[combineOtherId,cartStoragePrefix,expiryHours]);
  function updateCart(next:CartLine[]){setCart(next);writeFoodCart(cartKey,next,undefined,restaurant?.name);}
  // Never opened from the URL alone (see foodCheckoutTap): an unpaid cart stays a kept, inactive cart.
  const [step, setStep] = useState<"menu" | "checkout">("menu");
  const checkoutOpenedHere = useRef(false);

  const [delivery, setDelivery] = useState<Place | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bundleCandidates, setBundleCandidates] = useState<Array<{id:string;restaurant_name:string|null;pickup_address:string|null;pickup_lat:number;pickup_lng:number;destination_lat:number;destination_lng:number;delivery_fee:number|null;estimated_total:number|null}>>([]);
  const [selectedBundleOrderId, setSelectedBundleOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (checkoutRequested) {
      if (checkoutOpenedHere.current) {
        foodCheckoutTap = null;
        return;
      }
      // Tapped on a dish page: this page opens the checkout it asked for.
      if (takeFoodCheckoutTap(id)) {
        checkoutOpenedHere.current = true;
        setStep("checkout");
        setChoosing(true);
        return;
      }
      // Brought back by Back/Forward or a reload: show the menu with the cart kept as it was.
      router.replace(`/restaurants/${id}`, { scroll: false });
    }
    checkoutOpenedHere.current = false;
    setStep("menu");
    setChoosing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutRequested, id]);

  function openCheckout() {
    checkoutOpenedHere.current = true;
    foodCheckoutTap = { restaurantId: id, at: Date.now() };
    setStep("checkout");
    setChoosing(true);
    router.push(`/restaurants/${id}?checkout=1`, { scroll: false });
  }

  function backToMenu() {
    checkoutOpenedHere.current = false;
    setStep("menu");
    setChoosing(false);
    router.replace(`/restaurants/${id}`, { scroll: false });
  }

  useEffect(() => {
    let disposed=false;setRestaurant(null);setMenu(null);setInsights({});setRestaurantTrust(null);setRestaurantTrustStatus("loading");setError(null);
    api.foodMenuInsights(id).then(result=>{if(!disposed)setInsights(result.items);}).catch(()=>{});
    Promise.all([api.getRestaurant(id), api.getRestaurantMenu(id)])
      .then(([r, m]) => {
        if(disposed)return;
        setRestaurant(r.restaurant);
        setMenu(m);
        api.foodRestaurantTrust(id).then(result=>{if(!disposed){setRestaurantTrust(result);setRestaurantTrustStatus("ready");}}).catch(()=>{if(!disposed)setRestaurantTrustStatus("unavailable");});
      })
      .catch((err) => setError(errorMessage(err)));
    return()=>{disposed=true;};
  }, [id]);

  useEffect(() => {
    if (step !== "checkout") return;
    let cancelled = false;
    api.getDeliveryBundleCandidates().then(({orders}) => { if (!cancelled) setBundleCandidates(orders); }).catch(() => { if (!cancelled) setBundleCandidates([]); });
    return () => { cancelled = true; };
  }, [step]);

  function addToCart(item: MenuItem, line: { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number }) {
    const key = `${item.id}:${[...line.choiceIds].sort().join(",")}`;
    let base=cart;
    // This restaurant's own cart, left longer than the expiry: set aside (restorable), and start fresh.
    const saved=base.length?readFoodCart(cartKey,isCartLine):null;
    if(saved&&saved.lines.length&&!isFoodCartFresh(saved,expiryHours)){setAsideFoodCart(cartOwner,id,restaurant?.name??"",saved);base=[];}
    const existing=base.find(l=>l.key===key);
    const next=existing?base.map(l=>l.key===key?{...l,name:item.name,choiceNames:line.choiceNames,photoKey:item.photo_key,photoRevision:item.updated_at,quantity:Math.min(50,l.quantity+line.quantity)}:l):[...base,{key,menuItemId:item.id,name:item.name,choiceNames:line.choiceNames,photoKey:item.photo_key,photoRevision:item.updated_at,unitPrice:line.unitPrice,quantity:line.quantity,choiceIds:line.choiceIds}];
    updateCart(next);
  }

  function requestAddToCart(item: MenuItem, line: CartAddLine): boolean {
    if (cart.length === 0) {
      // Only fresh carts are offered; one left longer than the expiry goes to earlier carts instead.
      const otherCartKeys = otherRestaurantCartKeys(cartStoragePrefix, cartKey).filter((key) => isFoodCartFresh(readFoodCart(key, isCartLine), expiryHours));
      otherRestaurantCartKeys(cartStoragePrefix, cartKey)
        .filter((key) => !otherCartKeys.includes(key))
        .forEach((key) => {
          const otherId = key.slice(cartStoragePrefix.length);
          setAsideOtherCart(otherId);
          if (combineOtherId === otherId) chooseCombine(null);
        });
      if (otherCartKeys.length > 0) {
        setPendingRestaurantCartSwitch({ item, line, otherCartKeys });
        setSwitchOther(null);
        if (otherCartKeys.length === 1) {
          const otherId = otherCartKeys[0].slice(cartStoragePrefix.length);
          api.getRestaurant(otherId).then(({ restaurant: r }) => setSwitchOther({ name: r.name, lat: r.lat ?? null, lng: r.lng ?? null })).catch(() => setSwitchOther(null));
        }
        return false;
      }
    }
    addToCart(item, line);
    return true;
  }

  function keepOtherCartsAndAdd() {
    if (!pendingRestaurantCartSwitch) return;
    chooseCombine(null);
    addToCart(pendingRestaurantCartSwitch.item, pendingRestaurantCartSwitch.line);
    setPendingRestaurantCartSwitch(null);
  }

  function combineOtherCartAndAdd() {
    if (!pendingRestaurantCartSwitch || pendingRestaurantCartSwitch.otherCartKeys.length !== 1) return;
    const otherKey = pendingRestaurantCartSwitch.otherCartKeys[0];
    // Choosing to combine is using that cart: it counts as fresh from now.
    const other = readFoodCart(otherKey, isCartLine);
    if (other.lines.length) writeFoodCart(otherKey, other.lines);
    chooseCombine(otherKey.slice(cartStoragePrefix.length));
    addToCart(pendingRestaurantCartSwitch.item, pendingRestaurantCartSwitch.line);
    setPendingRestaurantCartSwitch(null);
  }

  function discardOtherCartsAndAdd() {
    if (!pendingRestaurantCartSwitch) return;
    // "Discard" keeps them under earlier carts (restorable from each restaurant's page), never deletes them.
    pendingRestaurantCartSwitch.otherCartKeys.forEach((key) => setAsideOtherCart(key.slice(cartStoragePrefix.length)));
    chooseCombine(null);
    addToCart(pendingRestaurantCartSwitch.item, pendingRestaurantCartSwitch.line);
    setPendingRestaurantCartSwitch(null);
  }

  // An earlier cart set aside from another restaurant's page may not know this name yet.
  useEffect(() => {
    if (!restaurant) return;
    nameFoodEarlierCarts(cartOwner, restaurant.id, restaurant.name);
    // The cart carries its restaurant's name, so the header's cart list can show it.
    const saved = readFoodCart(cartKey, isCartLine);
    if (saved.lines.length && saved.restaurantName !== restaurant.name) writeFoodCart(cartKey, saved.lines, saved.updatedAt, restaurant.name);
  }, [cartOwner, cartKey, restaurant]);
  const earlierHereCount = earlierHere ? earlierHere.lines.reduce((n, l) => n + l.quantity, 0) : 0;
  function restoreEarlierHere() {
    if (!earlierHere) return;
    updateCart(earlierHere.lines);
    deleteFoodEarlierCart(cartOwner, earlierHere.id);
  }

  function removeLine(key: string) {
    updateCart(cart.filter(l=>l.key!==key));
  }

  const itemsTotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  // The delivery fee is asked of the server (the same distance price the order is charged with), so what
  // checkout shows is final. Checkout stays off until it arrives.
  const placeForFee = placeFields(delivery);
  const joinOrderId = combineOther ? null : selectedBundleOrderId;
  const feeKey = delivery ? `${id}|${combineOther?.id ?? ""}|${joinOrderId ?? ""}|${placeForFee.lat ?? ""},${placeForFee.lng ?? ""}` : null;
  const [feeQuote, setFeeQuote] = useState<{ key: string; fee: number; shared: SharedDelivery | null } | null>(null);
  const [feeQuoteError, setFeeQuoteError] = useState<string | null>(null);
  const [feeRetry, setFeeRetry] = useState(0);
  useEffect(() => {
    if (!feeKey || step !== "checkout" || cart.length === 0) return;
    if (combineOtherId && !combineOther) return;
    let live = true;
    setFeeQuoteError(null);
    api.getRestaurantDeliveryQuote(id, { lat: placeForFee.lat, lng: placeForFee.lng, alsoFrom: combineOther?.id ?? null, bundleWith: joinOrderId })
      .then((r) => { if (live) setFeeQuote({ key: feeKey, fee: r.deliveryFee, shared: r.shared ?? null }); })
      .catch((err) => { if (live) setFeeQuoteError(errorMessage(err)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeKey, combineOtherId, combineOther?.id, step, feeRetry, cart.length]);
  const confirmedFee = feeQuote && feeQuote.key === feeKey ? feeQuote.fee : null;
  const confirmedShared = feeQuote && feeQuote.key === feeKey ? feeQuote.shared : null;

  const selectedBundle = combineOther ? null : bundleCandidates.find((candidate) => candidate.id === selectedBundleOrderId) ?? null;

  const combineOtherItemsTotal = combineOther ? combineOther.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0) : 0;
  const sharedDelivery = combineOther != null && confirmedFee != null;



  async function checkout() {
    if (!deliveryFeeKnown) return;
    const d = placeFields(delivery);
    if (!d.area && !d.address) {
      setError(t("restaurant_choose_delivery_location"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (sharedDelivery && combineOther) {
        // Only a fresh combined cart joins this checkout; re-checked here, at the moment of ordering.
        if (!isFoodCartFresh(readFoodCart(`${cartStoragePrefix}${combineOther.id}`, isCartLine), expiryHours)) {
          setAsideOtherCart(combineOther.id);
          chooseCombine(null);
          setError(`Your ${combineOther.name} cart was left too long, so it was saved as an earlier cart. Check the total and try again.`);
          setBusy(false);
          return;
        }
        const shared = { destinationArea: d.area, destinationAddress: d.address, destinationLat: d.lat, destinationLng: d.lng, paymentRail: "escrow" as const };
        // First pickup (the other restaurant), then this restaurant joins it: one rider, one trip.
        const first = await api.orderFromRestaurant(combineOther.id, {
          items: combineOther.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, choiceIds: l.choiceIds })),
          ...shared,
        });
        removeFoodCart(`${cartStoragePrefix}${combineOther.id}`);
        chooseCombine(null);
        try {
          await api.orderFromRestaurant(id, {
            items: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, choiceIds: l.choiceIds })),
            ...shared,
            bundleWithOrderId: first.order.id,
          });
        } catch (err) {
          // The first order exists already; keep this cart so nothing is lost, and say so.
          setError(`${combineOther.name} was ordered, but ${restaurant?.name ?? "this restaurant"} could not be added to the same delivery: ${errorMessage(err)}`);
          setBusy(false);
          router.push(`/orders/${first.order.id}/pay`);
          return;
        }
        updateCart([]);
        router.push(`/orders/${first.order.id}/pay`);
        return;
      }
      const { order } = await api.orderFromRestaurant(id, {
        items: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, choiceIds: l.choiceIds })),
        destinationArea: d.area,
        destinationAddress: d.address,
        destinationLat: d.lat,
        destinationLng: d.lng,
        paymentRail: "escrow",
        ...(selectedBundleOrderId ? { bundleWithOrderId: selectedBundleOrderId } : {}),
      });
      updateCart([]);
      chooseCombine(null);
      router.push(`/orders/${selectedBundleOrderId ?? order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  // The restaurant's own cart drives the bottom nav's right capsule (it never
  // mixes with the shopping cart): on the menu, a "View cart" button that
  // opens checkout (what the old floating bar did); on the checkout step, the
  // gold "Checkout" button wired to checkout() with the same guards.
  const onCheckoutStep = step === "checkout";
  const orderingUnavailable = !!restaurant && !!restaurant.is_demo && !restaurant.demo_checkout_enabled;
  // The whole delivery for everything paid together: for a shared delivery, both orders' parts.
  const estimatedFee = confirmedFee;
  // Checkout stays off until the delivery fee is worked out, so the customer never pays an unconfirmed amount.
  const deliveryFeeKnown = !!delivery && estimatedFee != null && Number.isFinite(estimatedFee) && (!selectedBundle || !!confirmedShared);
  // Joining an unpaid order: it is paid together with this one, so its items are in the total too.
  const joinedItemsTotal = selectedBundle ? Math.max(0, Number(selectedBundle.estimated_total ?? 0) - Number(selectedBundle.delivery_fee ?? 0)) : 0;
  const checkoutItemsTotal = itemsTotal + (combineOther ? combineOtherItemsTotal : 0) + joinedItemsTotal;
  const orderItemCount = cart.reduce((n, l) => n + l.quantity, 0) + (combineOther ? combineOther.lines.reduce((n, l) => n + l.quantity, 0) : 0);
  // Checkout's item lines, the other restaurant's first when two share the delivery.
  const lineOf = (storeName: string | null) => (l: CartLine) => ({
    key: l.key, storeName, name: l.name, quantity: l.quantity, price: l.unitPrice * l.quantity,
    detail: l.choiceNames?.length ? l.choiceNames.join(", ") : null,
  });
  const twoPickups = !!combineOther || !!selectedBundle;
  const checkoutLines = [
    ...(combineOther ? combineOther.lines.map(lineOf(combineOther.name)) : []),
    ...(selectedBundle ? [{ key: `order-${selectedBundle.id}`, storeName: selectedBundle.restaurant_name ?? "Your earlier order", name: "Items already ordered", quantity: 0, price: joinedItemsTotal }] : []),
    ...cart.map(lineOf(twoPickups ? restaurant?.name ?? "This restaurant" : null)),
  ];
  // Where the one rider collects, in pickup order.
  const checkoutPickups = confirmedShared
    ? [confirmedShared.firstPickup.name, confirmedShared.addedStop.name]
    : twoPickups
      ? [combineOther?.name ?? selectedBundle?.restaurant_name ?? "Your earlier order", restaurant?.name ?? "This restaurant"]
      : [];
  // Checkout step: nav Back returns to the menu (the place picker has its own Back).
  useRegisterNavBack(!!restaurant && onCheckoutStep, backToMenu);
  useRegisterNavPrimaryAction(
    !restaurant || !menu || itemId || cart.length === 0
      ? null
      : onCheckoutStep
        ? {
            tone: "gold",
            label: orderingUnavailable ? "Unavailable" : busy ? "Please wait…" : "Checkout",
            detail: deliveryFeeKnown ? formatUgx(checkoutItemsTotal + estimatedFee!) : "—",
            disabled: busy || !delivery || !deliveryFeeKnown || cart.length === 0 || !restaurant.is_open || orderingUnavailable,
            busy,
            onClick: () => void checkout(),
          }
        : {
            tone: "cart",
            label: "View cart",
            sublabel: `${cartCount} item${cartCount === 1 ? "" : "s"}`,
            count: cartCount,
            detail: formatUgx(itemsTotal),
            onClick: openCheckout,
          },
  );

  if (error && !restaurant) {
    return <p className="px-4 py-10 text-center text-sm text-red-700">{error}</p>;
  }
  if (!restaurant || !menu) {
    return <p className="px-4 py-10 text-center text-sm text-ink-500">{t("loading")}</p>;
  }

  const allItems=[...menu.categories.flatMap(category=>category.items),...menu.uncategorizedItems];
  const featuredItems=allItems.filter(item=>item.is_featured);
  const menuSections=[...menu.categories.filter(category=>category.items.length>0).map(category=>({key:category.id,name:category.name,items:category.items})),...(menu.uncategorizedItems.length?[{key:"more",name:menu.categories.length?"More":t("restaurant_menu_items"),items:menu.uncategorizedItems}]:[])];
  const quantityByItem=cart.reduce<Record<string,number>>((acc,line)=>{acc[line.menuItemId]=(acc[line.menuItemId]??0)+line.quantity;return acc;},{});
  const dishProps=(item:MenuItem)=>({item,insight:insights[item.id],quantity:quantityByItem[item.id]??0,restaurantOpen:!!restaurant.is_open,onOpen:()=>router.push(`/restaurants/${id}/items/${item.id}`),onAdd:()=>{requestAddToCart(item,{unitPrice:item.price,choiceIds:[],choiceNames:[],quantity:1});}});
  const restaurantRating=restaurantTrustStatus==="loading"?"…":restaurantTrustStatus==="unavailable"?"—":restaurantTrust?.averageMenuRating==null?"New":`${restaurantTrust.averageMenuRating.toFixed(1)}/5`;
  const restaurantRatingDetail=restaurantTrustStatus==="loading"?"Loading":restaurantTrustStatus==="unavailable"?"Unavailable":restaurantTrust?.menuReviewCount?`${restaurantTrust.menuReviewCount.toLocaleString()} dish ratings`:"No dish ratings yet";
  const completedOrderCount=restaurantTrustStatus==="ready"&&restaurantTrust?restaurantTrust.completedOrderCount.toLocaleString():restaurantTrustStatus==="loading"?"…":"—";
  // Shown on both the menu and a dish page: adding the first item while another restaurant has a saved cart asks how to deliver.
  const cartSwitchDialog = pendingRestaurantCartSwitch && (
          <RestaurantCartSwitchDialog
            cartCount={pendingRestaurantCartSwitch.otherCartKeys.length}
            combine={pendingRestaurantCartSwitch.otherCartKeys.length === 1 && switchOther ? {
              otherName: switchOther.name,
              thisName: restaurant?.name ?? "this restaurant",
            } : null}
            onCombine={combineOtherCartAndAdd}
            onKeep={keepOtherCartsAndAdd}
            onDiscard={discardOtherCartsAndAdd}
            onCancel={() => setPendingRestaurantCartSwitch(null)}
          />
        );

  if (itemId) {
    const item = allItems.find((row) => row.id === itemId);
    if (!item) {
      return <div className="p-6"><p>This dish is currently unavailable.</p><Link href={`/restaurants/${id}`} className="inline-flex min-h-12 items-center font-bold text-gold">Back to menu</Link></div>;
    }
    const category = menu.categories.find((row) => row.items.some((rowItem) => rowItem.id === item.id));
    const categoryItems = category?.items ?? (menu.uncategorizedItems.some((r) => r.id === item.id) ? menu.uncategorizedItems : [item]);
    return (
      <>
        <ItemDetailPage
          item={item}
          items={categoryItems}
          categoryName={category?.name ?? t("restaurant_menu_items")}
          cart={cart}
          itemsTotal={checkoutItemsTotal}
          cartCount={orderItemCount}
          thisName={restaurant.name}
          otherGroup={combineOther ? { name: combineOther.name, lines: combineOther.lines } : null}
          restaurantId={id}
          onBack={() => router.push(`/restaurants/${id}`)}
          isDemo={restaurant.is_demo}
          isOpen={!!restaurant.is_open}
          onRemoveLine={removeLine}
          onViewCart={openCheckout}
          onAdd={requestAddToCart}
        />
        {cartSwitchDialog}
      </>
    );
  }
  if (onCheckoutStep) {
    return (
      <div className="space-y-6 px-4">
        <div className="flex items-center gap-3"><button aria-label="Back to menu" onClick={backToMenu} className="flex h-11 w-11 items-center justify-center rounded-full glass-panel"><ChevronLeft size={22}/></button><h1 className="text-2xl font-bold text-ink">Delivery and payment</h1></div>
        {orderItemCount === 0 && (
          <div className="food-menu-card px-4 py-5 text-center text-sm text-ink-500">Your cart is empty. Add items from the menu to check out.</div>
        )}
        {!delivery && !choosing && <button onClick={() => setChoosing(true)} className="food-menu-card w-full text-left font-semibold">Choose delivery location →</button>}

        {delivery && (
          <RouteSummary pickup={null} destination={delivery} destinationLabel={t("place_delivery")} onChange={() => setChoosing(true)} />
        )}
        {bundleCandidates.length > 0 && delivery && !combineOther && (
          <section className="food-menu-card space-y-3 px-4 py-4" aria-label="Combine delivery">
            <div><h2 className="font-bold text-ink">Already have an order?</h2><p className="mt-1 text-sm text-ink-500">Combine one unpaid order with this pickup. One rider collects both, then delivers to the same address.</p></div>
            {bundleCandidates.map((candidate) => {
              const d = placeFields(delivery);
              const sameDestination = d.lat != null && d.lng != null && haversineKm(candidate.destination_lat,candidate.destination_lng,d.lat,d.lng) <= 0.2;
              const chosen = selectedBundleOrderId === candidate.id;
              return <button type="button" key={candidate.id} disabled={!sameDestination || restaurant.lat == null || restaurant.lng == null} onClick={() => setSelectedBundleOrderId(chosen ? null : candidate.id)} aria-pressed={chosen} className="select-card text-left">
                <span className="flex w-full min-w-0 items-center justify-between gap-3"><span className="select-card__title min-w-0 flex-1 text-sm text-ink">{chosen ? "✓ " : "＋ "}{candidate.restaurant_name ?? "Your existing pickup"}</span><span className="shrink-0 text-sm font-bold text-gold">{sameDestination ? (chosen ? "Added" : "Add") : "Choose same address"}</span></span>
                <span className="select-card__sub">{candidate.pickup_address ?? "Pickup location saved"}</span>
              </button>;
            })}
          </section>
        )}
        {choosing && (
          <PlaceFlow
            concept="food"
            initial={{ destination: delivery }}
            onClose={() => (delivery ? setChoosing(false) : backToMenu())}
            onDone={(r) => {
              setDelivery(r.destination);
              setChoosing(false);
            }}
          />
        )}



        {orderItemCount > 0 && <section className="food-menu-card space-y-3 px-4 py-5" aria-label="Your order">
          {/* Items (by restaurant when there are two), their subtotal, a faint line, the delivery, the total. */}
          <ItemsBreakdown items={checkoutLines} itemsSubtotal={checkoutItemsTotal} />
          <hr className="border-[var(--border-faint)]" />
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm text-ink">
              <span>Delivery</span>
              <span>{confirmedFee != null ? formatUgx(confirmedFee) : feeQuoteError ? "Couldn't confirm" : !delivery ? "Choose location" : "Calculating…"}</span>
            </div>
            {checkoutPickups.length > 1 && <DeliveryLines delivery={{ mode: "rider", pickups: checkoutPickups }} />}
          </div>
          <hr className="border-[var(--border-faint)]" />
          <div className="flex items-center justify-between text-lg font-bold text-ink">
            <span>Total</span>
            <span>{deliveryFeeKnown ? formatUgx(checkoutItemsTotal + estimatedFee!) : "—"}</span>
          </div>
          {(combineOther || selectedBundle) && <p className="text-xs text-ink-500">You pay this total once.</p>}
        </section>}

        {feeQuoteError && delivery && <button type="button" onClick={() => setFeeRetry((n) => n + 1)} className="min-h-11 w-full rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink">Couldn&apos;t confirm the delivery fee. Try again</button>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!delivery && <p className="text-center text-xs text-ink-500">Choose a delivery location to check out.</p>}

        <div className="flex gap-2">
          <button
            onClick={backToMenu}
            className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
          >
            {t("restaurant_back_to_menu")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="restaurant-cover-pin sticky top-16 z-0 -mb-[calc(100svh-4rem)] h-[calc(100svh-4rem)]">
        <FoodCover id={restaurant.id} name={restaurant.name} description={restaurant.cuisine} coverKey={restaurant.cover_key} loadCover={api.restaurantCoverBlob} revision={allItems.find(item=>item.photo_key)?.updated_at} previewUrl={restaurant.is_demo?demoRestaurantPhotoPath(restaurant.id)??undefined:undefined} parallax showCaption={false} placeholder={<Store size={64} className="text-gold"/>}/>
      </div>
      <div className="restaurant-profile-content relative z-10 px-4">
        {/* Back + business badge ride with the content (not the pinned cover) so they scroll away and never sit over the headings below. */}
        <div className="restaurant-cover-actions absolute inset-x-0 top-4 z-20 flex items-start justify-between px-4"><Link href="/restaurants" aria-label="Back to food businesses" className="flex h-12 w-12 items-center justify-center rounded-full glass-panel"><ChevronLeft size={24}/></Link><BusinessLogo id={id} name={restaurant.name} logoKey={restaurant.logo_key} businessType={foodBusinessLabel(restaurant.business_type)} isOpen={!!restaurant.is_open} isDemo={!!restaurant.is_demo} createdAt={restaurant.created_at} trust={restaurantTrust}/></div>
        <div id="food-menu" className="restaurant-profile-intro">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-bold leading-tight tracking-tight text-ink">{restaurant.name}</h1>
              <p className="mt-2 truncate text-sm text-ink-500">{foodBusinessLabel(restaurant.business_type)}{restaurant.cuisine ? ` · ${restaurant.cuisine}` : ""} · {restaurant.is_open ? "Open now" : "Closed"}</p>
            </div>
            {!restaurant.is_demo&&<Link href={`/restaurants/${id}/chat`} aria-label={`${t('restaurant_chat')} ${restaurant.name}`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full glass-panel text-white transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"><MessageCircle size={20}/></Link>}
          </div>
          {restaurant.description?.trim()&&<p className="restaurant-profile-intro__bio mt-2 text-sm leading-snug text-ink-500">{restaurant.description}</p>}
          <div className="restaurant-profile-intro__stats">
            <div className="restaurant-profile-stat" aria-label={`Restaurant food rating: ${restaurantRating}, ${restaurantRatingDetail}`}>
              <Star size={14} className="shrink-0 text-gold" aria-hidden="true"/>
              <span className="restaurant-profile-stat__value">{restaurantRating}</span>
              <span className="restaurant-profile-stat__detail">{restaurantRatingDetail}</span>
            </div>
            <div className="restaurant-profile-stat" aria-label={`${completedOrderCount} completed orders`}>
              <ShoppingBag size={14} className="shrink-0 text-ink-500" aria-hidden="true"/>
              <span className="restaurant-profile-stat__value">{completedOrderCount}</span>
              <span className="restaurant-profile-stat__detail">completed orders</span>
            </div>
          </div>
        </div>
        {error && <p className="mb-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {earlierHere && cart.length === 0 && (
          <div role="status" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3.5 py-3">
            <p className="min-w-0 flex-1 text-sm text-ink">
              You have an earlier cart here from {formatCartDate(foodEarlierCartDate(earlierHere))} · {earlierHereCount} item{earlierHereCount === 1 ? "" : "s"}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={restoreEarlierHere} className="rounded-full bg-gold px-3.5 py-1.5 text-xs font-bold text-ink-gold transition active:scale-95">Restore</button>
              <button type="button" onClick={() => deleteFoodEarlierCart(cartOwner, earlierHere.id)} className="px-1 text-xs font-semibold text-ink-500 hover:text-ink">Dismiss</button>
            </div>
          </div>
        )}

        {featuredItems.length>0&&<section className="mb-7 space-y-3"><div className="flex items-baseline justify-between"><h2 className="text-2xl font-bold tracking-tight text-ink">Featured</h2><span className="text-xs text-ink-500">Selected by the kitchen</span></div><DishRail label="Featured dishes">{featuredItems.map(item=><FeaturedDishCard key={item.id} {...dishProps(item)}/>)}</DishRail></section>}
        {menuSections.length>0&&<section className="mb-6 space-y-3" aria-label="Menu"><h2 className="text-2xl font-bold tracking-tight text-ink">Menu</h2>{menuSections.map(section=><div key={section.key} className="fc-section"><h3 className="fc-section__title">{section.name}</h3><div className="fc-grid">{section.items.map(item=><GeneralDishCard key={item.id} {...dishProps(item)}/>)}</div></div>)}</section>}
        {menu.categories.length === 0 && menu.uncategorizedItems.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-500">{t("restaurant_no_menu_yet")}</p>
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
      {cartSwitchDialog}
      </div>
    </div>
  );
}
