"use client";
import { FoodCover } from "@peebee/shared/food-cover";

import type { FoodItemInsight, MenuCategory, MenuItem, MenuItemBadge, MenuItemOption, Restaurant, RestaurantMenu } from "@peebee/shared";
import { foodBusinessLabel, roundFare } from "@peebee/shared";
import { demoFoodPhotoPath, demoRestaurantPhotoPath } from "@peebee/shared/demo-food";
import { ArrowUpRight, ChevronLeft, ChevronDown, Star, MessageCircle, Minus, Plus, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
       <span className={`food-item-card__category-image ${photoUrl ? "food-item-card__category-image--photo" : ""}`}>
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

function ItemDetailPage({
  item,
  restaurantId,
  isDemo = false,
  isOpen = true,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  restaurantId: string;
  isDemo?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  onAdd: (line: { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number }) => void;
}) {
  const t = useTranslate();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const photo = useMenuItemPhoto(item.id, !!item.photo_key,item.updated_at);

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
    <div className="relative min-h-dvh pb-28">
      <div className="pointer-events-none fixed inset-x-0 top-0 mx-auto h-[65dvh] max-w-lg">{photo ? <img src={photo} alt={item.name} className="h-full w-full object-cover"/> : <div className="flex h-full items-center justify-center bg-[rgb(var(--surface-muted))]"><UtensilsCrossed size={64} className="text-gold"/></div>}<div className="absolute inset-x-0 bottom-0 h-1/3" style={{background:"linear-gradient(transparent,rgb(var(--color-cream)))"}}/></div>
      <button type="button" aria-label="Back to menu" onClick={onClose} className="fixed left-[max(1rem,calc((100vw-32rem)/2+1rem))] top-[calc(1rem+env(safe-area-inset-top))] z-30 flex h-12 w-12 items-center justify-center rounded-full glass-panel"><ChevronLeft size={24}/></button>
      <div className="relative z-10 pt-[48dvh]">
      <div className="glass-panel space-y-5 !rounded-t-[2.5rem] !rounded-b-none !p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-gold">{item.is_featured ? "Featured dish" : "Made for you"}</p><h1 className="text-3xl font-bold">{item.name}</h1>

        {item.description && <details className="rounded-2xl border border-[var(--border-faint)] p-4"><summary className="flex min-h-11 cursor-pointer items-center justify-between font-bold">About this dish<ChevronDown size={18}/></summary><p className="mt-3 whitespace-pre-wrap text-sm text-ink-500">{item.description}</p></details>}

        {!isDemo && <Link
          href={`/restaurants/${restaurantId}/chat?item=${item.id}&itemName=${encodeURIComponent(item.name)}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gold"
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          {t("restaurant_ask_about_item")}
        </Link>}

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
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full glass-panel text-ink"
            >
              <Minus className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
            <span className="w-5 text-center text-sm font-bold text-ink">{quantity}</span>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQuantity((q) => Math.min(50,q + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full glass-panel text-ink"
            >
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>

        <DishReviews restaurantId={restaurantId} itemId={item.id} isDemo={isDemo}/>

      </div></div>
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-lg items-center gap-4 border-t border-[var(--border-faint)] bg-[rgb(var(--surface-card))]/90 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-2xl"><div className="shrink-0"><p className="text-xs text-ink-500">Total</p><strong className="text-lg">{formatUgx(unitPrice*quantity)}</strong></div><button
          type="button"
          disabled={missingRequired.length > 0 || !isOpen}
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
          {!isOpen ? "Business closed" : missingRequired.length > 0
            ? `${t("restaurant_choose")} ${missingRequired[0].name}`
            : "Add to order"}
        </button></div>
    </div>
  );
}

export default function RestaurantPage() {
  const t = useTranslate();
  const { id, itemId } = useParams<{ id: string; itemId?:string }>();
  const {user}=useAuth();
  const cartKey=`peebee-food-cart:${user?.id??"guest"}:${id}`;
  const router = useRouter();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insights,setInsights]=useState<Record<string,FoodItemInsight>>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  useEffect(()=>{try{const rows=JSON.parse(sessionStorage.getItem(cartKey)??"[]");setCart(Array.isArray(rows)?rows.filter((line:CartLine)=>typeof line.key==="string"&&typeof line.menuItemId==="string"&&typeof line.name==="string"&&Number.isInteger(line.quantity)&&line.quantity>0&&line.quantity<=50&&Number.isFinite(line.unitPrice)&&line.unitPrice>=0&&Array.isArray(line.choiceIds)&&line.choiceIds.every(id=>typeof id==="string")):[]);}catch{setCart([]);}},[cartKey]);
  function updateCart(next:CartLine[]){setCart(next);try{sessionStorage.setItem(cartKey,JSON.stringify(next));}catch{}}
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
    let disposed=false;setRestaurant(null);setMenu(null);setInsights({});setError(null);
    api.foodMenuInsights(id).then(result=>{if(!disposed)setInsights(result.items);}).catch(()=>{});
    Promise.all([api.getRestaurant(id), api.getRestaurantMenu(id)])
      .then(([r, m]) => {
        if(disposed)return;
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
    return()=>{disposed=true;};
  }, [id]);

  function addToCart(item: MenuItem, line: { unitPrice: number; choiceIds: string[]; choiceNames: string[]; quantity: number }) {
    const key = `${item.id}:${[...line.choiceIds].sort().join(",")}`;
    const name = line.choiceNames.length > 0 ? `${item.name} (${line.choiceNames.join(", ")})` : item.name;
    const existing=cart.find(l=>l.key===key);
    const next=existing?cart.map(l=>l.key===key?{...l,quantity:Math.min(50,l.quantity+line.quantity)}:l):[...cart,{key,menuItemId:item.id,name,unitPrice:line.unitPrice,quantity:line.quantity,choiceIds:line.choiceIds}];
    updateCart(next);
    if(itemId)router.push(`/restaurants/${id}`);
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
      updateCart([]);
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

  const allItems=[...menu.categories.flatMap(category=>category.items),...menu.uncategorizedItems];
  const featuredItems=allItems.filter(item=>item.is_featured);
  if(itemId){const item=allItems.find(item=>item.id===itemId);return item?<ItemDetailPage key={item.id} item={item} restaurantId={id} isDemo={restaurant.is_demo} isOpen={!!restaurant.is_open} onClose={()=>router.push(`/restaurants/${id}`)} onAdd={line=>addToCart(item,line)}/>:<div className="p-6"><p>This dish is currently unavailable.</p><Link href={`/restaurants/${id}`} className="inline-flex min-h-12 items-center font-bold text-gold">Back to menu</Link></div>;}
  if (step === "checkout") {
    return (
      <div className="space-y-6 px-4 pb-28">
        <div className="flex items-center gap-3"><button aria-label="Back to menu" onClick={() => setStep("menu")} className="flex h-11 w-11 items-center justify-center rounded-full glass-panel"><ChevronLeft size={22}/></button><h1 className="text-2xl font-bold text-ink">Your cart</h1></div>
        <ul className="space-y-3">{cart.map(line => <li key={line.key} className="food-menu-card flex items-center gap-3"><MenuItemThumb itemId={line.menuItemId}/><div className="min-w-0 flex-1"><h2 className="font-bold">{line.name}</h2><p className="mt-1 text-sm text-ink-500">{formatUgx(line.unitPrice)}</p><div className="mt-3 flex items-center gap-3"><button aria-label={`Decrease ${line.name} quantity`} className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))]" onClick={() => updateCart(cart.flatMap(row => row.key !== line.key ? [row] : row.quantity > 1 ? [{...row, quantity: row.quantity - 1}] : []))}><Minus size={16}/></button><span>{line.quantity}</span><button aria-label={`Increase ${line.name} quantity`} className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))]" onClick={() => updateCart(cart.map(row => row.key === line.key ? {...row, quantity: Math.min(50,row.quantity + 1)} : row))}><Plus size={16}/></button><button className="ml-auto text-xs text-ink-500 underline" onClick={() => removeLine(line.key)}>Remove</button></div></div></li>)}</ul>
        {!delivery && !choosing && <button onClick={() => setChoosing(true)} className="food-menu-card w-full text-left font-semibold">Choose delivery location →</button>}

        {delivery && (
          <RouteSummary pickup={null} destination={delivery} destinationLabel={t("place_delivery")} onChange={() => setChoosing(true)} />
        )}
        {choosing && (
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



        <div className="food-menu-card space-y-3 px-4 py-5">
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
            <span>{estimatedDeliveryFee != null ? formatUgx(itemsTotal + estimatedDeliveryFee) : t("loading")}</span>
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
    <div className="space-y-6 px-4 pb-28">
      <div className="-mx-4"><FoodCover id={restaurant.id} name={restaurant.name} description={restaurant.cuisine} coverKey={restaurant.cover_key} loadCover={api.restaurantCoverBlob} revision={allItems.find(item=>item.photo_key)?.updated_at} previewUrl={restaurant.is_demo?demoRestaurantPhotoPath(restaurant.id)??undefined:undefined} edgeToEdge placeholder={<Store size={64} className="text-gold"/>} overlay={<div className="absolute inset-x-0 top-4 z-10 flex items-start justify-between px-4"><Link href="/restaurants" aria-label="Back to food businesses" className="flex h-12 w-12 items-center justify-center rounded-full glass-panel"><ChevronLeft size={24}/></Link><BusinessLogo id={id} name={restaurant.name} logoKey={restaurant.logo_key}/></div>}/></div>
      <div id="food-menu" className="scroll-mt-16"/>
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-ink-500">{foodBusinessLabel(restaurant.business_type)} · {restaurant.is_open?'Open now':'Closed'}</p>{!restaurant.is_demo&&<Link href={`/restaurants/${id}/chat`} className="flex min-h-11 items-center gap-2 rounded-full glass-panel px-4 text-sm font-bold"><MessageCircle size={16}/>{t('restaurant_chat')}</Link>}</div>
      {restaurant.is_demo && <p className="rounded-2xl border border-gold/20 bg-gold/10 px-4 py-3 text-sm text-ink">{restaurant.demo_checkout_enabled
        ? "Sandbox demo restaurant · payments are simulated. Riders in Sandbox can pick up and deliver your order."
        : "Demo restaurant · explore the menu, options, and cart. No order or payment is placed."}</p>}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {featuredItems.length>0&&<section className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-2xl font-bold">Featured</h2><span className="text-xs text-ink-500">Selected by the kitchen</span></div><DishRail label="Featured dishes">{featuredItems.map(item=><FoodItemCard key={item.id} featured item={item} insight={insights[item.id]} onOpen={()=>router.push(`/restaurants/${id}/items/${item.id}`)}/>)}</DishRail></section>}
      {allItems.length>0&&<section className="space-y-4"><h2 className="text-2xl font-bold">Main dishes</h2><DishRail label="Main dishes">{allItems.map(item=><FoodItemCard key={item.id} item={item} insight={insights[item.id]} onOpen={()=>router.push(`/restaurants/${id}/items/${item.id}`)}/>)}</DishRail></section>}
      {menu.categories.length === 0 && menu.uncategorizedItems.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-500">{t("restaurant_no_menu_yet")}</p>
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 px-4 pb-3">
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
