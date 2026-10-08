"use client";
import { FoodCover } from "@peebee/shared/food-cover";

import type { FoodItemInsight, FoodRestaurantTrust, MenuCategory, MenuItem, MenuItemBadge, MenuItemOption, Restaurant, RestaurantMenu } from "@peebee/shared";
import { foodBusinessLabel, roundFare } from "@peebee/shared";
import { demoFoodPhotoPath, demoRestaurantPhotoPath } from "@peebee/shared/demo-food";
import { ArrowUpRight, ChevronLeft, ChevronDown, ChevronRight, Star, MessageCircle, Minus, Plus, ShoppingBag, ShoppingCart, Store, UtensilsCrossed, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PlaceFlow } from "../../../components/PlaceFlow";
import { RouteSummary } from "../../../components/home/RouteSummary";
import { placeFields, type Place } from "../../../lib/places";
import { DishReviews } from "../../../components/DishReviews";
import { BusinessLogo } from "../../../components/BusinessLogo";
import { useAuth } from "../../../lib/auth-context";
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

function MenuItemThumb({ itemId, size = "row" }: { itemId: string; size?: "row" | "modal" }) {
  const url = useMenuItemPhoto(itemId);

  const dims = size === "row" ? "h-16 w-16" : "h-64 w-full";
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

/** Grid-card presentation for a menu item — image on a tinted backdrop
 * (visible around/behind a photo with transparency, or as the whole
 * background when there's no photo yet), a badge pill top-left when the
 * restaurant's set one, and price + "Order Now" bottom-right. */
function DishRail({children,label}:{children:React.ReactNode;label:string}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const node=ref.current;if(!node)return;if(!('IntersectionObserver' in window)){node.classList.add('rail-visible');return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){node.classList.add('rail-visible');observer.disconnect();}},{threshold:.1});observer.observe(node);return()=>observer.disconnect();},[]);
  return <div ref={ref} aria-label={label} dir="ltr" className="edge-carousel food-dish-rail flex snap-x snap-mandatory gap-3 overflow-x-auto pb-10 pt-3">{children}</div>;
}
function FoodItemCard({item,onOpen,featured=false,insight}:{item:MenuItem;onOpen:()=>void;featured?:boolean;insight?:FoodItemInsight}){
 const t=useTranslate();
 const photoUrl=useMenuItemPhoto(item.id,!!item.photo_key,item.updated_at);
 const rating=insight?.averageRating==null?'New':insight.averageRating.toFixed(1);
 return <button
   type="button"
   onClick={onOpen}
   aria-label={`View ${item.name}`}
   className={`food-item-card ${featured?'food-item-card--featured':'food-item-card--category'}`}
 >
   {featured ? (
     <>
       <span className="food-item-card__image-base" aria-hidden="true">
         {photoUrl && <img src={photoUrl} alt="" />}
       </span>
       <span className={`food-item-card__photo ${photoUrl ? "" : "food-item-card__photo--empty"}`} aria-hidden="true">
         {photoUrl ? <img src={photoUrl} alt="" /> : <UtensilsCrossed size={48} className="text-gold" />}
       </span>
       <span className="food-item-card__topline">
         {item.badge
           ? <span className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold uppercase ${BADGE_STYLES[item.badge]}`}>{t(BADGE_KEYS[item.badge])}</span>
           : <span />}
         <span title="Orders recorded since dish tracking was enabled" className="food-item-card__orders">
           {insight ? `${insight.orderCount} orders` : "Orders —"}
         </span>
       </span>
       <span className="food-item-card__glass">
         <span className="block truncate text-base font-bold leading-tight" title={item.name}>{item.name}</span>
         {item.description && <span className="food-item-card__description text-xs text-ink-500">{item.description}</span>}
         <span className="food-item-card__details">
           <span className="flex min-w-0 items-center gap-1 text-xs text-ink-500">
             <Star size={13} className="shrink-0 text-gold" />{rating}
             {insight?.ratingCount ? ` · ${insight.ratingCount}` : ""}
           </span>
           <span className="food-item-card__price">{formatUgx(item.price)}</span>
         </span>
       </span>
     </>
   ) : (
     <>
       <span className="food-item-card__category-image">
         {photoUrl
           ? <img src={photoUrl} alt={item.name} />
           : <UtensilsCrossed size={40} className="text-gold" />}
         {item.badge && <span className={`absolute left-3 top-3 rounded-full px-2 py-1 text-[11px] font-bold uppercase ${BADGE_STYLES[item.badge]}`}>{t(BADGE_KEYS[item.badge])}</span>}
       </span>
       <span className="food-item-card__category-copy">
         <span className="block truncate text-base font-bold" title={item.name}>{item.name}</span>
         {item.description && <span className="food-item-card__description text-xs text-ink-500">{item.description}</span>}
         <span className="food-item-card__details">
           <span className="flex min-w-0 items-center gap-1 text-xs text-ink-500">
             <Star size={13} className="shrink-0 text-gold" />{rating}
             {insight?.ratingCount ? ` · ${insight.ratingCount}` : ""}
           </span>
           <span className="food-item-card__price">{formatUgx(item.price)}</span>
         </span>
       </span>
     </>
   )}
 </button>;
}
type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  choiceIds: string[];
};

function MenuOrderList({
  cart,
  itemsTotal,
  cartCount,
  isOpen,
  onClose,
  onRemoveLine,
  onViewCart,
}: {
  cart: CartLine[];
  itemsTotal: number;
  cartCount: number;
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
          {cart.length > 0 ? (
            <ul className="menu-item-order-list__lines">
              {cart.map((line) => (
                <li className="menu-item-order-list__line" key={line.key}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{line.quantity}× {line.name}</span>
                    <span className="block text-xs text-ink-500">{formatUgx(line.unitPrice * line.quantity)}</span>
                  </span>
                  <button type="button" className="menu-item-order-list__remove" onClick={() => onRemoveLine(line.key)}>
                    {t("restaurant_remove")}
                  </button>
                </li>
              ))}
            </ul>
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
  onAdd: (item: MenuItem, line: { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number }) => void;
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
    onAdd(item, { unitPrice, choiceIds, choiceNames: choices.map((choice) => choice.name), quantity });
    setAddedItemId(item.id);
    setTimeout(() => setAddedItemId((current) => current === item.id ? null : current), 1400);
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
  restaurantId: string;
  onBack: () => void;
  isDemo?: boolean;
  isOpen?: boolean;
  onRemoveLine: (key: string) => void;
  onViewCart: () => void;
  onAdd: (item: MenuItem, line: { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number }) => void;
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
          <button ref={cartTriggerRef} type="button" className="menu-item-cart-trigger" aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`} aria-expanded={cartOpen} onClick={() => setCartOpen(true)}>
            <ShoppingCart size={21} strokeWidth={2} aria-hidden="true" />
            <span className="menu-item-cart-trigger__count" aria-live="polite">{cartCount}</span>
          </button>
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

export default function RestaurantPage() {
  const t = useTranslate();
  const { id, itemId } = useParams<{ id: string; itemId?:string }>();
  const {user}=useAuth();
  const cartKey=`peebee-food-cart:${user?.id??"guest"}:${id}`;
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutRequested = searchParams.get("checkout") === "1";

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insights,setInsights]=useState<Record<string,FoodItemInsight>>({});
  const [restaurantTrust,setRestaurantTrust]=useState<FoodRestaurantTrust|null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  useEffect(()=>{try{const rows=JSON.parse(sessionStorage.getItem(cartKey)??"[]");setCart(Array.isArray(rows)?rows.filter((line:CartLine)=>typeof line.key==="string"&&typeof line.menuItemId==="string"&&typeof line.name==="string"&&Number.isInteger(line.quantity)&&line.quantity>0&&line.quantity<=50&&Number.isFinite(line.unitPrice)&&line.unitPrice>=0&&Array.isArray(line.choiceIds)&&line.choiceIds.every(id=>typeof id==="string")):[]);}catch{setCart([]);}},[cartKey]);
  function updateCart(next:CartLine[]){setCart(next);try{sessionStorage.setItem(cartKey,JSON.stringify(next));}catch{}}
  const [step, setStep] = useState<"menu" | "checkout">(checkoutRequested ? "checkout" : "menu");

  const [delivery, setDelivery] = useState<Place | null>(null);
  const [choosing, setChoosing] = useState(checkoutRequested);
  const [busy, setBusy] = useState(false);
  const [bundleCandidates, setBundleCandidates] = useState<Array<{id:string;restaurant_name:string|null;pickup_address:string|null;pickup_lat:number;pickup_lng:number;destination_lat:number;destination_lng:number;delivery_fee:number|null}>>([]);
  const [selectedBundleOrderId, setSelectedBundleOrderId] = useState<string | null>(null);
  const [deliverySettings, setDeliverySettings] = useState<{
    deliveryRatePerKm: number;
    minimumDeliveryFee: number;
    shoppingDeliveryFee: number;
  } | null>(null);

  useEffect(() => {
    if (checkoutRequested) {
      setStep("checkout");
      setChoosing(true);
    } else {
      setStep("menu");
      setChoosing(false);
    }
  }, [checkoutRequested]);

  function openCheckout() {
    setStep("checkout");
    setChoosing(true);
    router.push(`/restaurants/${id}?checkout=1`, { scroll: false });
  }

  function backToMenu() {
    setStep("menu");
    setChoosing(false);
    router.replace(`/restaurants/${id}`, { scroll: false });
  }

  useEffect(() => {
    let disposed=false;setRestaurant(null);setMenu(null);setInsights({});setRestaurantTrust(null);setError(null);
    api.foodMenuInsights(id).then(result=>{if(!disposed)setInsights(result.items);}).catch(()=>{});
    Promise.all([api.getRestaurant(id), api.getRestaurantMenu(id)])
      .then(([r, m]) => {
        if(disposed)return;
        setRestaurant(r.restaurant);
        setMenu(m);
        if(!r.restaurant.is_demo)api.foodRestaurantTrust(id).then(result=>{if(!disposed)setRestaurantTrust(result);}).catch(()=>{});
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
    const name = line.choiceNames.length > 0 ? `${item.name} (${line.choiceNames.join(", ")})` : item.name;
    const existing=cart.find(l=>l.key===key);
    const next=existing?cart.map(l=>l.key===key?{...l,quantity:Math.min(50,l.quantity+line.quantity)}:l):[...cart,{key,menuItemId:item.id,name,unitPrice:line.unitPrice,quantity:line.quantity,choiceIds:line.choiceIds}];
    updateCart(next);
  }

  function removeLine(key: string) {
    updateCart(cart.filter(l=>l.key!==key));
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

  const selectedBundle = bundleCandidates.find((candidate) => candidate.id === selectedBundleOrderId) ?? null;
  const bundleExtraDeliveryFee = useMemo(() => {
    const d = placeFields(delivery);
    if (!selectedBundle || !restaurant || !deliverySettings || restaurant.lat == null || restaurant.lng == null || d.lat == null || d.lng == null) return null;
    const sameDestination = haversineKm(selectedBundle.destination_lat, selectedBundle.destination_lng, d.lat, d.lng) <= 0.2;
    if (!sameDestination) return null;
    const routeKm = haversineKm(selectedBundle.pickup_lat, selectedBundle.pickup_lng, restaurant.lat, restaurant.lng) + haversineKm(restaurant.lat, restaurant.lng, d.lat, d.lng);
    return Math.max(0, roundFare(routeKm * deliverySettings.deliveryRatePerKm, deliverySettings.minimumDeliveryFee) - Number(selectedBundle.delivery_fee ?? 0));
  }, [selectedBundle, restaurant, delivery, deliverySettings]);



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
        ...(selectedBundleOrderId ? { bundleWithOrderId: selectedBundleOrderId } : {}),
      });
      updateCart([]);
      router.push(`/orders/${selectedBundleOrderId ?? order.id}/pay`);
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

  const allItems=[...menu.categories.flatMap(category=>category.items),...menu.uncategorizedItems];
  const featuredItems=allItems.filter(item=>item.is_featured);
  if (itemId) {
    const item = allItems.find((row) => row.id === itemId);
    if (!item) {
      return <div className="p-6"><p>This dish is currently unavailable.</p><Link href={`/restaurants/${id}`} className="inline-flex min-h-12 items-center font-bold text-gold">Back to menu</Link></div>;
    }
    const category = menu.categories.find((row) => row.items.some((rowItem) => rowItem.id === item.id));
    const categoryItems = category?.items ?? (menu.uncategorizedItems.some((r) => r.id === item.id) ? menu.uncategorizedItems : [item]);
    return (
      <ItemDetailPage
        item={item}
        items={categoryItems}
        categoryName={category?.name ?? t("restaurant_menu_items")}
        cart={cart}
        itemsTotal={itemsTotal}
        cartCount={cartCount}
        restaurantId={id}
        onBack={() => router.push(`/restaurants/${id}`)}
        isDemo={restaurant.is_demo}
        isOpen={!!restaurant.is_open}
        onRemoveLine={removeLine}
        onViewCart={openCheckout}
        onAdd={(targetItem, line) => addToCart(targetItem, line)}
      />
    );
  }
  if (checkoutRequested || step === "checkout") {
    return (
      <div className="space-y-6 px-4 pb-28">
        <div className="flex items-center gap-3"><button aria-label="Back to menu" onClick={backToMenu} className="flex h-11 w-11 items-center justify-center rounded-full glass-panel"><ChevronLeft size={22}/></button><h1 className="text-2xl font-bold text-ink">Delivery and payment</h1></div>
        <div className="food-menu-card flex items-center justify-between gap-3 px-4 py-3">
          <span className="font-semibold">{cartCount} item{cartCount === 1 ? "" : "s"} in your order</span>
          <span className="font-bold">{formatUgx(itemsTotal)}</span>
        </div>
        {!delivery && !choosing && <button onClick={() => setChoosing(true)} className="food-menu-card w-full text-left font-semibold">Choose delivery location →</button>}

        {delivery && (
          <RouteSummary pickup={null} destination={delivery} destinationLabel={t("place_delivery")} onChange={() => setChoosing(true)} />
        )}
        {bundleCandidates.length > 0 && delivery && (
          <section className="food-menu-card space-y-3 px-4 py-4" aria-label="Combine delivery">
            <div><h2 className="font-bold text-ink">Already have an order?</h2><p className="mt-1 text-sm text-ink-500">Combine one unpaid order with this pickup. One rider collects both, then delivers to the same address.</p></div>
            {bundleCandidates.map((candidate) => {
              const d = placeFields(delivery);
              const sameDestination = d.lat != null && d.lng != null && haversineKm(candidate.destination_lat,candidate.destination_lng,d.lat,d.lng) <= 0.2;
              const chosen = selectedBundleOrderId === candidate.id;
              const routeKm = restaurant.lat != null && restaurant.lng != null && d.lat != null && d.lng != null
                ? haversineKm(candidate.pickup_lat,candidate.pickup_lng,restaurant.lat,restaurant.lng) + haversineKm(restaurant.lat,restaurant.lng,d.lat,d.lng)
                : null;
              const addedFee = sameDestination && routeKm != null && deliverySettings
                ? Math.max(0,roundFare(routeKm*deliverySettings.deliveryRatePerKm,deliverySettings.minimumDeliveryFee)-Number(candidate.delivery_fee??0))
                : null;
              return <button type="button" key={candidate.id} disabled={!sameDestination || restaurant.lat == null || restaurant.lng == null} onClick={() => setSelectedBundleOrderId(chosen ? null : candidate.id)} className={`w-full rounded-2xl border p-3 text-left ${chosen ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"} disabled:opacity-50`}>
                <span className="flex items-center justify-between gap-3"><span className="font-semibold">{chosen ? "✓ " : "＋ "}{candidate.restaurant_name ?? "Your existing pickup"}</span><span className="shrink-0 text-sm font-bold text-gold">{sameDestination ? `${chosen ? "Added · " : "Add · "}+${addedFee != null ? formatUgx(addedFee) : "…"}` : "Choose same address"}</span></span>
                <span className="mt-1 block text-xs text-ink-500">{candidate.pickup_address ?? "Pickup location saved"}</span>
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



        <div className="food-menu-card space-y-3 px-4 py-5">
          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>{t("restaurant_items_total")}</span>
            <span>{formatUgx(itemsTotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>{t("restaurant_delivery_fee")}</span>
            <span>{selectedBundle ? (bundleExtraDeliveryFee != null ? `+${formatUgx(bundleExtraDeliveryFee)}` : "—") : estimatedDeliveryFee != null ? `~${formatUgx(estimatedDeliveryFee)}` : t("loading")}</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-1.5 text-sm font-bold text-ink">
            <span>{t("restaurant_estimated_total")}</span>
            <span>{(selectedBundle ? bundleExtraDeliveryFee : estimatedDeliveryFee) != null ? formatUgx(itemsTotal + (selectedBundle ? bundleExtraDeliveryFee! : estimatedDeliveryFee!)) : t("loading")}</span>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={backToMenu}
            className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
          >
            {t("restaurant_back_to_menu")}
          </button>
          <button
            onClick={checkout}
            disabled={busy || !delivery || cart.length === 0 || !restaurant.is_open || (restaurant.is_demo && !restaurant.demo_checkout_enabled)}
            className="min-h-12 flex-[2] rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
          >
            {restaurant.is_demo && !restaurant.demo_checkout_enabled ? "Demo preview · no payment" : busy ? "Please wait…" : "Next: payment"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative -mx-4 pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <div className="restaurant-cover-pin sticky top-16 z-0 -mb-[calc(100svh-4rem)] h-[calc(100svh-4rem)]">
        <FoodCover id={restaurant.id} name={restaurant.name} description={restaurant.cuisine} coverKey={restaurant.cover_key} loadCover={api.restaurantCoverBlob} revision={allItems.find(item=>item.photo_key)?.updated_at} previewUrl={restaurant.is_demo?demoRestaurantPhotoPath(restaurant.id)??undefined:undefined} parallax showCaption={false} placeholder={<Store size={64} className="text-gold"/>} overlay={<div className="absolute inset-x-0 top-4 z-10 flex items-start justify-between px-4"><Link href="/restaurants" aria-label="Back to food businesses" className="flex h-12 w-12 items-center justify-center rounded-full glass-panel"><ChevronLeft size={24}/></Link><BusinessLogo id={id} name={restaurant.name} logoKey={restaurant.logo_key} businessType={foodBusinessLabel(restaurant.business_type)} isOpen={!!restaurant.is_open} isDemo={!!restaurant.is_demo} createdAt={restaurant.created_at} trust={restaurantTrust}/></div>}/>
      </div>
      <div className="restaurant-profile-content relative z-10 px-4">
        <div id="food-menu" className="restaurant-profile-intro">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-bold leading-tight tracking-tight text-white drop-shadow-lg">{restaurant.name}</h1>
              <p className="mt-2 truncate text-sm text-white/80">{foodBusinessLabel(restaurant.business_type)}{restaurant.cuisine ? ` · ${restaurant.cuisine}` : ""} · {restaurant.is_open ? "Open now" : "Closed"}</p>
            </div>
            {!restaurant.is_demo&&<Link href={`/restaurants/${id}/chat`} aria-label={`${t('restaurant_chat')} ${restaurant.name}`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full glass-panel text-white"><MessageCircle size={20}/></Link>}
          </div>
        </div>
        {restaurant.is_demo && <p className="mb-6 rounded-2xl border border-gold/20 bg-[rgb(var(--surface-card))]/95 px-4 py-3 text-sm text-ink">{restaurant.demo_checkout_enabled
        ? "Sandbox demo restaurant · payments are simulated. Riders in Sandbox can pick up and deliver your order."
        : "Demo restaurant · explore the menu, options, and cart. No order or payment is placed."}</p>}

        {error && <p className="mb-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {featuredItems.length>0&&<section className="mb-6 space-y-4"><div className="flex items-center justify-between"><h2 className="text-2xl font-bold text-white drop-shadow-md">Featured</h2><span className="text-xs text-white/75">Selected by the kitchen</span></div><DishRail label="Featured dishes">{featuredItems.map(item=><FoodItemCard key={item.id} featured item={item} insight={insights[item.id]} onOpen={()=>router.push(`/restaurants/${id}/items/${item.id}`)}/>)}</DishRail></section>}
        {allItems.length>0&&<section className="mb-6 space-y-4"><h2 className="text-2xl font-bold text-white drop-shadow-md">Main dishes</h2><DishRail label="Main dishes">{allItems.map(item=><FoodItemCard key={item.id} item={item} insight={insights[item.id]} onOpen={()=>router.push(`/restaurants/${id}/items/${item.id}`)}/>)}</DishRail></section>}
        {menu.categories.length === 0 && menu.uncategorizedItems.length === 0 && (
          <p className="py-10 text-center text-sm text-white/75">{t("restaurant_no_menu_yet")}</p>
        )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 px-4 pb-3">
          <button
            onClick={openCheckout}
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
    </div>
  );
}
