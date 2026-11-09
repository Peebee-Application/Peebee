"use client";

import { observeNotificationSnapshot, type HiveShortcutId, type HomeMenuSettings } from "@peebee/shared";

import type { OrderRow } from "@peebee/shared";
import {
  Ambulance,
  Bike,
  BookOpen,
  Briefcase,
  BriefcaseBusiness,
  Bus,
  Car,
  CarFront,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Compass,
  Loader2,
  Citrus,
  CookingPot,
  Croissant,
  Crown,
  Clapperboard,
  Flame,
  GraduationCap,
  Heart,
  HardHat,
  Home,
  ListChecks,
  MessagesSquare,
  Package,
  Pill,
  Receipt,
  Radio,
  Route,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Store,
  Tv,
  UtensilsCrossed,
  Truck,
  UsersRound,
  WashingMachine,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useTranslate } from "../lib/i18n";
import { orderTitle, stageLabel } from "../lib/order-display";
import { useHireAvailability, useHomeMenu, type HireAvailability } from "../lib/home-menu";
import { useSpecialCarServices, type SpecialCarServices } from "../lib/special-car";
import { useTaxipress } from "../lib/taxipress";
import { useLivePolling } from "../lib/use-live-polling";
import { BottomDrawer } from "./BottomDrawer";
import { CartDrawer } from "./CartDrawer";
import { useCart } from "../lib/cart";
import { filterByModule, useModules } from "../lib/modules";
import { SPOTLIGHT_FILTERS, setSpotlightFilter, useSpotlightFilter, type SpotlightFilter } from "../lib/spotlight-filter";
import { goBackOr, useNavBack, useNavPrimaryAction } from "../lib/nav-primary-action";

/** Two names that take turns in the same spot. Screen readers get both names from the button's own label, so this is hidden from them. */
function SwappingLabel({ first, second, seconds }: { first: string; second: string; seconds: number }) {
  const [showSecond, setShowSecond] = useState(false);
  useEffect(() => {
    const swap = () => { if (document.visibilityState === "visible") setShowSecond((s) => !s); };
    const id = window.setInterval(swap, seconds * 1000);
    return () => window.clearInterval(id);
  }, [seconds]);
  const text = showSecond ? second : first;
  return <span key={text} aria-hidden className="customer-nav-label-swap block truncate">{text}</span>;
}

type MenuGroup = "original" | "ride" | "shopping" | "food" | "hive" | "learn" | "spotlight";
type MenuItem = { id: string; label: string; /** The Services module that shows or hides this button. */ module?: string; /** A second name that swaps with `label`. */ alt?: { label: string; seconds: number }; icon: LucideIcon; href?: string; group?: Exclude<MenuGroup, "original" | "spotlight">; disabled?: boolean; /** Its module is off and Admin chose to grey it out: the button stays, inactive. */ offline?: boolean; /** A Spotlight filter this button switches on. */ spotlight?: SpotlightFilter };

// Five main buttons: Ride, Buy, Eat, Learn and Hive. Learn goes straight to its own home; the others open a row of shortcuts.
// The names come from the admin's home menu setting; these are the buttons' icons and where they lead.
const originalMenu = (menu: HomeMenuSettings): MenuItem[] => [
  { id: "ride", label: menu.clusters.ride.label, icon: Route, group: "ride", module: "ride" },
  { id: "shopping", label: menu.clusters.shopping.label, icon: ShoppingBag, group: "shopping", module: "buy" },
  { id: "food", label: menu.clusters.food.label, icon: UtensilsCrossed, group: "food", module: "buy.food" },
  { id: "learn", label: menu.clusters.learn.label, icon: BookOpen, href: "/learn", module: "learn" },
  { id: "hive", label: menu.clusters.hive.label, module: "hive", alt: menu.hive.altLabel ? { label: menu.hive.altLabel, seconds: menu.hive.labelSeconds } : undefined, icon: BriefcaseBusiness, group: "hive" },
];

const HIVE_ITEM: Record<HiveShortcutId, { icon: LucideIcon; href: string }> = {
  clean: { icon: Sparkles, href: "/services/clean" },
  laundry: { icon: WashingMachine, href: "/services/laundry" },
  fix: { icon: Wrench, href: "/services/fix" },
  // Quick odd jobs: the worker search, opened on everyday trades.
  workers: { icon: HardHat, href: "/services/hire/workers?segment=informal" },
  hire: { icon: Briefcase, href: "/services/hire" },
};

/** Hive's row of shortcuts: the admin's names and order, with any switched off left out. */
const hiveItems = (menu: HomeMenuSettings, hire: HireAvailability): MenuItem[] =>
  menu.hive.shortcuts.filter((s) => s.enabled && (s.id === "workers" ? hire.workers : s.id === "hire" ? hire.hire : true)).map((s) => ({ id: s.id, label: s.label, icon: HIVE_ITEM[s.id].icon, href: HIVE_ITEM[s.id].href, module: s.id === "workers" || s.id === "hire" ? "hive.hire" : "hive.work" }));

/** Ride's shortcuts, in the order Peebee shows them. Luxury and Ambulance appear once there is an approved vehicle of that kind. */
const rideItems = (special: SpecialCarServices, taxipress: boolean): MenuItem[] => [
  { id: "boda", label: "Boda", icon: Bike, href: "/ride/boda", module: "ride.boda" },
  { id: "car", label: "Car", icon: Car, href: "/ride/car", module: "ride.car" },
  { id: "rideshare", label: "Rideshare", icon: UsersRound, href: "/carpool", module: "ride.car.carpool" },
  { id: "selfdrive", label: "Selfdrive", icon: CarFront, href: "/rent", module: "ride.car.selfdrive" },
  { id: "move", label: "Move", icon: Truck, href: "/ride/move", module: "ride.move" },
  ...(special.luxury ? [{ id: "luxury", label: "VIP", icon: Crown, href: "/ride/luxury", module: "ride.luxury" }] : []),
  { id: "parcel", label: "Parcel", icon: Package, href: "/deliver/parcel", module: "deliver.parcel" },
  ...(taxipress ? [{ id: "taxipress", label: "Taxipress", icon: Bus, href: "/ride/taxipress", module: "ride.taxipress" }] : []),
  ...(special.ambulance ? [{ id: "ambulance", label: "Ambulance", icon: Ambulance, href: "/ride/ambulance", module: "ride.ambulance" }] : []),
];

const staticSubmenuItems: Record<"shopping" | "food", MenuItem[]> = {
  shopping: [
    { id: "shoplist", label: "List", icon: ListChecks, href: "/shoplist", module: "buy.shopping" },
    { id: "markets", label: "Groceries", icon: ShoppingBasket, href: "/groceries", module: "buy.shopping" },
    { id: "stores", label: "Stores", icon: Store, href: "/stores", module: "buy.marketplace" },
    { id: "pharmacy", label: "Pharma", icon: Pill, href: "/pharmacy", module: "buy.pharmacy" },
    // Past orders. /orders itself is the shopping lists, so those stay under List.
    { id: "orders", label: "Orders", icon: Receipt, href: "/orders/history" },
  ],
  food: [
    { id: "restaurant", label: "Restaurants", icon: UtensilsCrossed, href: "/restaurants" },
    { id: "kitchen", label: "Kitchens", icon: CookingPot, href: "/kitchens" },
    { id: "street_food", label: "Streetfood", icon: ChefHat, href: "/streetfood" },
    { id: "juices", label: "Juices", icon: Citrus, href: "/juices" },
    { id: "bakery", label: "Bakeries", icon: Croissant, href: "/bakeries" },
  ],
};

/** Spotlight's row: the feed's filters, in place of the Home menu while the person is in Spotlight. */
const SPOTLIGHT_ICON: Record<SpotlightFilter, LucideIcon> = { foryou: Flame, following: Heart, creators: Clapperboard, market: Store, learn: GraduationCap };
const spotlightItems: MenuItem[] = SPOTLIGHT_FILTERS.map((f) => ({ id: `sp-${f.id}`, label: f.label, icon: SPOTLIGHT_ICON[f.id], href: "/spotlight", spotlight: f.id }));

/** Learn's row. Levels (Sprouts, Basics, Academy, Campus, Skills) are chosen on Discover. */
const learnItems: MenuItem[] = [
  { id: "myclass", label: "My Class", icon: GraduationCap, href: "/learn/my", module: "learn" },
  { id: "live", label: "Live", icon: Radio, href: "/learn/live", module: "learn.live" },
  { id: "tv", label: "TV", icon: Tv, href: "/learn/tv", module: "learn.tv" },
  { id: "discover", label: "Discover", icon: Compass, href: "/learn" },
  { id: "connect", label: "Connect", icon: MessagesSquare, href: "/learn/connect" },
];

/** Which Learn item a page belongs to. Course and certificate pages sit under My Class. */
function learnItemForPath(pathname: string): string | null {
  if (pathname === "/learn") return "discover";
  if (pathname === "/learn/my" || pathname.startsWith("/learn/course/") || pathname.startsWith("/learn/certificates")) return "myclass";
  if (pathname === "/learn/live" || pathname.startsWith("/learn/live/")) return "live";
  if (pathname === "/learn/tv" || pathname.startsWith("/learn/tv/")) return "tv";
  if (pathname === "/learn/connect" || pathname.startsWith("/learn/connect/")) return "connect";
  return null;
}

function groupForPath(pathname: string): MenuGroup {
  if (["/food", "/restaurants", "/kitchens", "/streetfood", "/juices", "/bakeries"].some((path) => pathname === path || pathname.startsWith(`${path}/`))) return "food";
  if (pathname === "/ride" || pathname === "/rent" || pathname === "/carpool" || pathname.startsWith("/ride/") || pathname === "/move") return "ride";
  // Parcel is part of Ride now (Send is no longer its own button).
  if (pathname === "/deliver" || pathname.startsWith("/deliver/")) return "ride";
  if (pathname === "/spotlight" || pathname.startsWith("/spotlight/")) return "spotlight";
  if (["/shopping", "/shoplist", "/groceries", "/stores", "/store", "/pharmacy"].some((path) => pathname === path || pathname.startsWith(`${path}/`)) || pathname.startsWith("/orders")) return "shopping";
  if (pathname === "/learn" || pathname.startsWith("/learn/")) return "learn";
  if (["/services", "/service"].some((path) => pathname === path || pathname.startsWith(`${path}/`))) return "hive";
  return "original";
}

const ACTIVE_ORDER_POLL_MS = 10000;

export function BottomNav({ overlay = false }: { overlay?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const navRef = useRef<HTMLElement>(null);
  const menuListRef = useRef<HTMLUListElement>(null);
  const pillRef = useRef<HTMLLIElement>(null);
  const [activeOrder, setActiveOrder] = useState<OrderRow | null>(null);
  const [trackerDrawerOpen, setTrackerDrawerOpen] = useState(false);
  const [menuGroup, setMenuGroup] = useState<MenuGroup>(() => groupForPath(pathname));
  // Set when Back should land on Home with a group's sub menu open (instead of the Home menu).
  const pendingGroupRef = useRef<MenuGroup | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const t = useTranslate();
  const homeMenu = useHomeMenu();
  const special = useSpecialCarServices();
  const taxipress = useTaxipress();
  const hireAvailability = useHireAvailability();
  const { totalQuantity: cartCount, total: cartTotal } = useCart();
  const primaryAction = useNavPrimaryAction();
  // A cart/checkout or a flow step is open: Home becomes a one-step Back.
  const navBack = useNavBack();
  const [cartOpen, setCartOpen] = useState(false);
  const spotlightFilter = useSpotlightFilter();

  // Right-hand capsule mode:
  //  - "action": a page-provided primary action (the /cart page's Checkout), gold.
  //  - "cart":   shopping screens with something in the shared bag get one
  //              "View cart" button instead of the links (no floating bars).
  //  - "links":  the normal menu.
  const inShopping = groupForPath(pathname) === "shopping";
  //  A page-provided action wins (it is only registered while that page is
  //  mounted): /cart's gold Checkout, or a restaurant's own cart on food routes,
  //  which never mixes with the shopping cart.
  const rightMode: "action" | "cart" | "links" =
    primaryAction ? "action" : cartCount > 0 && inShopping ? "cart" : "links";
  const actionTone = primaryAction?.tone ?? "gold";

  // A screen that shows its own button (or the cart) in the right-hand block always gets Back instead of Home,
  // even when it never registered a step back. Back returns one level: to that group's sub menu on Home, or to the
  // previous screen for pages outside a group. A page's own step back (checkout, payment) still wins.
  const screenGroup = groupForPath(pathname);
  const defaultBack =
    !navBack && pathname !== "/" && rightMode !== "links"
      ? () => {
          if (screenGroup !== "original" && screenGroup !== "learn" && screenGroup !== "spotlight") {
            pendingGroupRef.current = screenGroup;
            router.push("/");
          } else goBackOr(router, screenGroup === "learn" ? "/learn" : screenGroup === "spotlight" ? "/spotlight" : "/");
        }
      : null;
  const backAction = navBack ?? defaultBack;
  // On the Home screen the Home button becomes Spotlight; on Spotlight it is Home again (the ordinary Home button below).
  // With a sub menu open on "/", it stays Home so the person can get back to the main menu.
  const onHomeScreen = pathname === "/" && menuGroup === "original";

  const moduleOn = useModules();
  // A button whose module is switched off in Admin → Services is left out of every row, or kept greyed out (Admin chooses).
  const menuItems: MenuItem[] = filterByModule(
    menuGroup === "original" ? originalMenu(homeMenu)
    : menuGroup === "ride" ? rideItems(special, taxipress.enabled)
    : menuGroup === "hive" ? hiveItems(homeMenu, hireAvailability)
    : menuGroup === "learn" ? learnItems
    : menuGroup === "spotlight" ? spotlightItems
    : staticSubmenuItems[menuGroup], moduleOn);
  // Ride can grow to eight; past five the row scrolls sideways instead of squeezing the names.
  const scrolls = menuItems.length > 5;

  useEffect(() => {
    const group = groupForPath(pathname);
    const pending = pathname === "/" ? pendingGroupRef.current : null;
    pendingGroupRef.current = null;
    setMenuGroup(pending ?? group);
    if (pathname === "/restaurants" || pathname.startsWith("/restaurants/")) setSelectedItem("restaurant");
    else if (pathname === "/kitchens" || pathname.startsWith("/kitchens/")) setSelectedItem("kitchen");
    else if (pathname === "/streetfood" || pathname.startsWith("/streetfood/")) setSelectedItem("street_food");
    else if (pathname === "/juices" || pathname.startsWith("/juices/")) setSelectedItem("juices");
    else if (pathname === "/bakeries" || pathname.startsWith("/bakeries/")) setSelectedItem("bakery");
    else if (pathname === "/ride/boda") setSelectedItem("boda");
    else if (pathname === "/ride/luxury") setSelectedItem("luxury");
    else if (pathname === "/ride/ambulance") setSelectedItem("ambulance");
    else if (pathname.startsWith("/ride/taxipress")) setSelectedItem("taxipress");
    else if (pathname === "/ride/car") setSelectedItem("car");
    else if (pathname === "/carpool") setSelectedItem("rideshare");
    else if (pathname === "/rent") setSelectedItem("selfdrive");
    else if (pathname === "/ride/move" || pathname === "/move") setSelectedItem("move");
    else if (pathname === "/orders/history" || pathname.startsWith("/orders/history/")) setSelectedItem("orders");
    else if (pathname === "/shoplist" || pathname.startsWith("/orders")) setSelectedItem("shoplist");
    else if (pathname === "/groceries" || pathname.startsWith("/groceries/")) setSelectedItem("markets");
    else if (pathname === "/stores" || pathname.startsWith("/store/")) setSelectedItem("stores");
    else if (pathname === "/pharmacy" || pathname.startsWith("/pharmacy/")) setSelectedItem("pharmacy");
    else if (pathname === "/spotlight") setSelectedItem(null);
    else if (pathname === "/services/laundry") setSelectedItem("laundry");
    else if (pathname === "/services/clean") setSelectedItem("clean");
    else if (pathname === "/services/fix") setSelectedItem("fix");
    else if (pathname === "/services/hire/workers" || pathname.startsWith("/services/hire/workers/")) setSelectedItem("workers");
    else if (pathname === "/service" || pathname === "/services/hire" || pathname.startsWith("/services/hire/")) setSelectedItem("hire");
    else if (pathname === "/learn" || pathname.startsWith("/learn/")) setSelectedItem(learnItemForPath(pathname));
    else if (pathname === "/services/learn") setSelectedItem(null);
    else if (pathname === "/deliver" || pathname.startsWith("/deliver/")) setSelectedItem("parcel");
    else setSelectedItem(null);
  }, [pathname]);

  useLivePolling(
    () => {
      if (!user) return;
      api
        .getActiveOrder()
        .then((res) => {
          const order = res.activeOrder;
          observeNotificationSnapshot("active-order", order ? [order.id + ":" + order.stage] : []);
          setActiveOrder(order);
        })
        .catch(() => setActiveOrder(null));
    },
    ACTIVE_ORDER_POLL_MS,
    [user],
  );

  // Skip the floating badge where it would repeat what's already on screen:
  // the active order's own tracking page, and Home (which has the Active
  // order card — the chip just sat on top of it while scrolling).
  const isOnActiveOrderPage = activeOrder ? pathname === `/orders/${activeOrder.id}` : false;
  // The Ride home shows an active ride in its own live-trip card, so the chip would repeat it.
  const isRideHomeWithRide = pathname === "/ride" && !!activeOrder?.is_ride;
  const showActiveDeliveryBadge = !overlay && !!activeOrder && !isOnActiveOrderPage && pathname !== "/" && !isRideHomeWithRide;

  useLayoutEffect(() => {
    const root = menuListRef.current;
    const pill = pillRef.current;
    if (!root || !pill) return;
    const active = root.querySelector<HTMLElement>(".customer-nav-item.is-active");
    const place = () => {
      if (!active) {
        pill.style.opacity = "0";
        return;
      }
      pill.style.opacity = "1";
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.height = `${active.offsetHeight}px`;
      pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || pill.dataset.ready !== "1") {
      pill.style.transition = "none";
      place();
      pill.dataset.ready = "1";
      requestAnimationFrame(() => { pill.style.transition = ""; });
      return;
    }
    place();
  }, [selectedItem, menuGroup, spotlightFilter, pathname, scrolls]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    // Keep the content clearance tied to the rendered footer, including its
    // optional active-order chip and the device's safe-area inset.
    const updateClearance = () => {
      const gap = Math.ceil(window.innerHeight - nav.getBoundingClientRect().top + 15);
      document.documentElement.style.setProperty("--customer-nav-content-gap", `${gap}px`);
    };

    updateClearance();
    const observer = new ResizeObserver(updateClearance);
    observer.observe(nav);
    window.addEventListener("resize", updateClearance);
    window.visualViewport?.addEventListener("resize", updateClearance);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateClearance);
      window.visualViewport?.removeEventListener("resize", updateClearance);
      document.documentElement.style.removeProperty("--customer-nav-content-gap");
    };
  }, [showActiveDeliveryBadge]);

  return (
    <>
      {/* Glass scrim behind the nav: darkest + most blurred at the screen's
          bottom edge, fading to fully clear just above the nav buttons. */}
      <div aria-hidden className="customer-nav-scrim" />
      <nav ref={navRef} aria-label="Primary navigation" className={`customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)] ${overlay ? "customer-nav-overlay" : ""}`}>
        <div className="mx-auto flex max-w-lg flex-col items-center gap-2">
          {/* Active Delivery Floating Capsule Chip */}
          {showActiveDeliveryBadge && (
            <button
              type="button"
              onClick={() => setTrackerDrawerOpen(true)}
              className="pointer-events-auto flex items-center gap-2 rounded-full glass-panel border border-gold/30 px-3.5 py-1.5 shadow-[var(--shadow-float-capsule)] animate-drawer-in active:scale-95 transition-transform"
            >
              <span className="flex h-2 w-2 rounded-full bg-green animate-pulse" />
              <ShoppingBag className="h-3.5 w-3.5 text-gold" strokeWidth={2.2} />
              <span className="text-xs font-bold text-ink truncate max-w-[170px]">
                {stageLabel(activeOrder.stage, activeOrder.type)}
              </span>
              {activeOrder.pin_code && (
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-ink tracking-wider">
                  {t("nav_tracker_pin_label", { pin: activeOrder.pin_code })}
                </span>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-ink-500" />
            </button>
          )}

          {/* Home stays separate; the wider menu changes between the four service groups. */}
          <div className="pointer-events-auto flex w-full items-center gap-1.5">
            {/* Detached Home Capsule on Left */}
            <div className="customer-nav-capsule flex w-[64px] sm:w-[72px] shrink-0 items-center justify-center rounded-[24px] p-1.5 shadow-[var(--shadow-float-capsule)]">
              {backAction ? (
              <button
                key="nav-back"
                type="button"
                aria-label="Back"
                onClick={backAction}
                className="customer-nav-item customer-nav-icon-swap relative flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-[11px] font-bold transition-all duration-200 active:scale-95"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.2} aria-hidden />
                <span className="leading-none truncate max-w-[54px]">Back</span>
              </button>
              ) : onHomeScreen ? (
              <button
                key="nav-spotlight"
                type="button"
                aria-label="Spotlight"
                onClick={() => router.push("/spotlight")}
                className="customer-nav-item customer-nav-icon-swap relative flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-[11px] font-bold transition-all duration-200 active:scale-95"
              >
                <Flame className="h-5 w-5" strokeWidth={1.8} aria-hidden />
                <span className="leading-none truncate max-w-[54px]">Spotlight</span>
              </button>
              ) : (
              <button
                key="nav-home"
                type="button"
                aria-label="Home and reset menu"
                aria-current={pathname === "/" ? "page" : undefined}
                onClick={() => {
                  setMenuGroup("original");
                  setSelectedItem(null);
                  router.push("/");
                }}
                className={`customer-nav-item customer-nav-icon-swap relative flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-[11px] font-bold transition-all duration-200 active:scale-95 ${
                  pathname === "/" ? "is-active" : ""
                }`}
              >
                <Home className="h-5 w-5" strokeWidth={pathname === "/" ? 2.4 : 1.8} aria-hidden />
                <span className="leading-none truncate max-w-[54px]">{t("nav_home")}</span>
                {pathname === "/" && (
                  <span
                    className="customer-nav-indicator absolute bottom-1.5 h-1 w-3.5 rounded-full"
                    aria-hidden
                  />
                )}
              </button>
              )}
            </div>

            {rightMode === "action" && primaryAction && actionTone === "cart" ? (
              <div key="nav-action-cart" className="customer-nav-swap customer-nav-capsule customer-nav-frame flex h-[70px] min-w-0 flex-1 rounded-[24px] p-1.5 shadow-[var(--shadow-float-capsule)]">
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                aria-label={[primaryAction.label, primaryAction.sublabel, primaryAction.detail].filter(Boolean).join(", ")}
                className="customer-nav-cart flex min-w-0 items-center gap-2 pl-2 pr-2.5 transition active:scale-[0.98] h-full w-full rounded-[18px]"
              >
                <span className="customer-nav-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] max-[380px]:h-9 max-[380px]:w-9">
                  {primaryAction.count != null ? (
                    <span className="text-[15px] font-black tabular-nums leading-none">{primaryAction.count}</span>
                  ) : (
                    <ShoppingBag className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
                  )}
                </span>
                <span className="ml-1 min-w-0 flex-1 text-left">
                  <span className="block truncate whitespace-nowrap text-sm font-bold leading-tight">{primaryAction.label}</span>
                  {primaryAction.sublabel && (
                    <span className="customer-nav-cart__muted block truncate whitespace-nowrap text-[11px] font-medium">{primaryAction.sublabel}</span>
                  )}
                </span>
                {primaryAction.detail && (
                  <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums max-[380px]:text-[13px]">{primaryAction.detail}</span>
                )}
                <ChevronRight className="customer-nav-cart__muted h-4 w-4 shrink-0 -ml-0.5 max-[380px]:hidden" aria-hidden />
              </button>
              </div>
            ) : rightMode === "action" && primaryAction && actionTone === "step" ? (
              <div key="nav-action-step" className="customer-nav-swap customer-nav-capsule customer-nav-frame flex h-[70px] min-w-0 flex-1 rounded-[24px] p-1.5 shadow-[var(--shadow-float-capsule)]">
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                aria-busy={primaryAction.busy || undefined}
                aria-label={[primaryAction.label, primaryAction.sublabel, primaryAction.detail].filter(Boolean).join(", ")}
                className="customer-nav-cart flex min-w-0 items-center gap-2 pl-4 pr-3 transition active:scale-[0.98] h-full w-full rounded-[18px]"
              >
                {primaryAction.busy && <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate whitespace-nowrap text-[15px] font-bold leading-tight max-[380px]:text-sm">{primaryAction.label}</span>
                  {primaryAction.sublabel && (
                    <span className="customer-nav-cart__muted block truncate whitespace-nowrap text-[11px] font-medium">{primaryAction.sublabel}</span>
                  )}
                </span>
                {primaryAction.detail && (
                  <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums max-[380px]:text-[13px]">{primaryAction.detail}</span>
                )}
                <ChevronRight className="customer-nav-cart__muted h-4 w-4 shrink-0" aria-hidden />
              </button>
              </div>
            ) : rightMode === "action" && primaryAction ? (
              <div key="nav-action" className="customer-nav-swap customer-nav-capsule customer-nav-frame flex h-[70px] min-w-0 flex-1 rounded-[24px] p-1.5 shadow-[var(--shadow-float-capsule)]">
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                aria-busy={primaryAction.busy || undefined}
                className="customer-nav-checkout flex min-w-0 items-center justify-between gap-2 pl-4 pr-3.5 transition active:scale-[0.98] h-full w-full rounded-[18px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {primaryAction.busy ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                  ) : primaryAction.icon ? (
                    <primaryAction.icon className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
                  ) : (
                    <ShoppingBag className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
                  )}
                  <span className="min-w-0 text-left">
                    <span className="block truncate whitespace-nowrap text-[15px] font-bold leading-tight max-[380px]:text-sm">{primaryAction.label}</span>
                    {primaryAction.sublabel && <span className="block truncate whitespace-nowrap text-[11px] font-semibold opacity-80">{primaryAction.sublabel}</span>}
                  </span>
                </span>
                {primaryAction.detail && (
                  <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums opacity-90">{primaryAction.detail}</span>
                )}
              </button>
              </div>
            ) : rightMode === "cart" ? (
              <div key="nav-cart" className="customer-nav-swap customer-nav-capsule customer-nav-frame flex h-[70px] min-w-0 flex-1 rounded-[24px] p-1.5 shadow-[var(--shadow-float-capsule)]">
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                aria-label={`View cart, ${cartCount} item${cartCount === 1 ? "" : "s"}, UGX ${cartTotal.toLocaleString()}`}
                aria-haspopup="dialog"
                className="customer-nav-cart flex min-w-0 items-center gap-2 pl-2 pr-2.5 transition active:scale-[0.98] h-full w-full rounded-[18px]"
              >
                <span className="customer-nav-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] max-[380px]:h-9 max-[380px]:w-9">
                  <span className="text-[15px] font-black tabular-nums leading-none">{cartCount}</span>
                </span>
                <span className="ml-1 min-w-0 flex-1 text-left">
                  <span className="block truncate whitespace-nowrap text-sm font-bold leading-tight">View cart</span>
                  <span className="customer-nav-cart__muted block truncate whitespace-nowrap text-[11px] font-medium">
                    {cartCount} item{cartCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums max-[380px]:text-[13px]">UGX {cartTotal.toLocaleString()}</span>
                <ChevronRight className="customer-nav-cart__muted h-4 w-4 shrink-0 -ml-0.5 max-[380px]:hidden" aria-hidden />
              </button>
              </div>
            ) : (
            <div key="nav-links" className="customer-nav-swap customer-nav-capsule flex flex-1 min-w-0 items-center justify-around rounded-[24px] p-1.5 shadow-[var(--shadow-float-capsule)]">
              <ul
                key={menuGroup}
                ref={menuListRef}
                className={`customer-nav-items flex h-full w-full items-stretch gap-1 ${scrolls ? "snap-x overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "justify-around"}`}
                aria-label={menuGroup === "original" ? "Main menu" : `${menuGroup} menu`}
              >
                <li ref={pillRef} className="customer-nav-pill" aria-hidden />
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.spotlight ? item.spotlight === spotlightFilter : item.id === selectedItem;

                  const content = (
                    <>
                      <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                      <span className={`leading-none truncate max-w-full font-bold ${menuGroup === "learn" ? "text-[9.5px] tracking-tight sm:text-[10.5px]" : "text-[10px] sm:text-[11px]"}`}>
                        {item.alt ? <SwappingLabel first={item.label} second={item.alt.label} seconds={item.alt.seconds} /> : item.label}
                      </span>
                      {active && (
                        <span
                          className="customer-nav-indicator absolute bottom-1.5 h-1 w-3.5 rounded-full"
                          aria-hidden
                        />
                      )}
                    </>
                  );

                  const btnClass = `customer-nav-item relative flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-[18px] px-0.5 sm:px-1 py-1 text-[11px] font-bold transition-all duration-200 active:scale-95 ${
                    active ? "is-active" : ""
                  } ${item.disabled || item.offline ? "opacity-40 cursor-not-allowed" : ""}`;

                  return (
                    <li key={item.id} className={scrolls ? "w-[19%] shrink-0 snap-start" : "flex-1 min-w-0"}>
                      {item.offline ? (
                        <button type="button" disabled aria-disabled="true" aria-label={`${item.label}, currently offline`} title="Currently Offline" className={btnClass}>
                          {content}
                        </button>
                      ) : item.group ? (
                        <button
                          type="button"
                          aria-label={`${item.alt ? `${item.label} or ${item.alt.label}` : item.label} home and submenu`}
                          aria-expanded={menuGroup === item.group}
                          onClick={() => {
                            setMenuGroup(item.group!);
                            setSelectedItem(null);
                            router.push(
                              {
                                ride: "/ride",
                                shopping: "/shopping",
                                food: "/food",
                                hive: "/services",
                                learn: "/learn",
                              }[item.group!]
                            );
                          }}
                          className={btnClass}
                        >
                          {content}
                        </button>
                      ) : item.disabled ? (
                        <button
                          type="button"
                          aria-disabled="true"
                          aria-label={`${item.label}, coming soon`}
                          title="Coming soon"
                          onClick={() => setSelectedItem(item.id)}
                          className={btnClass}
                        >
                          {content}
                        </button>
                      ) : (
                        <Link
                          href={item.href!}
                          onClick={() => { if (item.spotlight) setSpotlightFilter(item.spotlight); setSelectedItem(item.id); }}
                          aria-current={active ? "page" : undefined}
                          className={btnClass}
                        >
                          {content}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            )}
          </div>
        </div>
      </nav>

      {/* Shared shopping cart, opened from the nav's cart button. */}
      <CartDrawer isOpen={cartOpen} onClose={() => setCartOpen(false)} />

      {/* Mini Tracker Bottom Sheet for Active Delivery */}
      {activeOrder && (
        <BottomDrawer
          isOpen={trackerDrawerOpen}
          onClose={() => setTrackerDrawerOpen(false)}
          title={t("nav_tracker_title")}
        >
          <div className="space-y-4">
            <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  {activeOrder.type === "parcel" ? t("nav_tracker_parcel") : t("nav_tracker_shopping")}
                </span>
                <span className="rounded-full bg-green/15 px-2.5 py-0.5 text-xs font-bold text-green">
                  {stageLabel(activeOrder.stage, activeOrder.type)}
                </span>
              </div>
              <h3 className="text-base font-bold text-ink">{orderTitle(activeOrder)}</h3>
              {activeOrder.pin_code && (
                <div className="rounded-xl bg-gold/10 p-3 text-center">
                  <p className="text-xs font-semibold uppercase text-ink-500">{t("nav_tracker_handover_pin")}</p>
                  <p className="text-2xl font-bold tracking-[0.25em] text-ink">{activeOrder.pin_code}</p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setTrackerDrawerOpen(false);
                router.push(`/orders/${activeOrder.id}`);
              }}
              className="min-h-12 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] active:scale-95 transition-transform"
            >
              {t("nav_tracker_open_full")}
            </button>
          </div>
        </BottomDrawer>
      )}
    </>
  );
}
