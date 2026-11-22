"use client";

import { type HiveShortcutId, type HomeMenuSettings } from "@peebee/shared";

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
  Citrus,
  CookingPot,
  Croissant,
  Crown,
  Clapperboard,
  Flame,
  GraduationCap,
  Heart,
  HardHat,
  Building2,
  BedDouble,
  Warehouse,
  KeyRound,
  Home,
  ListChecks,
  MessagesSquare,
  Package,
  Pill,
  Receipt,
  Route,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Store,
  UtensilsCrossed,
  Truck,
  UsersRound,
  Wallet,
  WashingMachine,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { getWalletTab, setWalletTab, subscribeWalletTab, walletTabHref, type WalletTab } from "../lib/wallet-tab";
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
import { SPACE_PAGES, selectedMenuScroll } from "../lib/nav-layout";
import { useOrderNavContext } from "../lib/order-nav-context";
import { NavAction } from "./NavAction";
import { goBackOr, useNavBack, useNavPrimaryAction } from "../lib/nav-primary-action";

type MenuGroup = "original" | "ride" | "shopping" | "food" | "hive" | "learn" | "spotlight" | "spaces" | "wallet";
type MenuItem = { id: string; label: string; /** The Services module that shows or hides this button. */ module?: string; /** A second name that swaps with `label`. */ alt?: { label: string; seconds: number }; icon: LucideIcon; href?: string; group?: Exclude<MenuGroup, "original" | "spotlight" | "wallet">; disabled?: boolean; /** Its module is off and Admin chose to grey it out: the button stays, inactive. */ offline?: boolean; /** A Spotlight filter this button switches on. */ spotlight?: SpotlightFilter };

// Service clusters open their home page and contextual submenu.
// The names come from the admin's home menu setting; these are the buttons' icons and where they lead.
const originalMenu = (menu: HomeMenuSettings): MenuItem[] => [
  { id: "ride", label: menu.clusters.ride.label, icon: Route, group: "ride", module: "ride" },
  { id: "shopping", label: menu.clusters.shopping.label, icon: ShoppingBag, group: "shopping", module: "buy" },
  { id: "food", label: menu.clusters.food.label, icon: UtensilsCrossed, group: "food", module: "buy.food" },
  { id: "learn", label: menu.clusters.learn.label, icon: BookOpen, group: "learn", module: "learn" },
  { id: "hive", label: menu.clusters.hive.label, module: "hive", icon: BriefcaseBusiness, group: "hive" },
  ...(menu.navigation.spacesEnabled ? [{ id: "spaces", label: menu.navigation.spacesLabel, icon: Building2, group: "spaces" as const }] : []),
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
  ...(taxipress ? [{ id: "taxipress", label: "Taxi", icon: Bus, href: "/ride/taxipress", module: "ride.taxipress" }] : []),
  { id: "rideshare", label: "Share", icon: UsersRound, href: "/carpool", module: "ride.car.carpool" },
  { id: "selfdrive", label: "Drive", icon: CarFront, href: "/rent", module: "ride.car.selfdrive" },
  { id: "move", label: "Move", icon: Truck, href: "/ride/move", module: "ride.move" },
  ...(special.luxury ? [{ id: "luxury", label: "VIP", icon: Crown, href: "/ride/luxury", module: "ride.luxury" }] : []),
  { id: "parcel", label: "Parcel", icon: Package, href: "/deliver/parcel", module: "deliver.parcel" },
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
    { id: "street_food", label: "Street", icon: ChefHat, href: "/streetfood" },
    { id: "bakery", label: "Bakeries", icon: Croissant, href: "/bakeries" },
    { id: "juices", label: "Juices", icon: Citrus, href: "/juices" },
  ],
};

/** Spotlight's row: the feed's filters, in place of the Home menu while the person is in Spotlight. */
const SPOTLIGHT_ICON: Record<SpotlightFilter, LucideIcon> = { foryou: Flame, following: Heart, creators: Clapperboard, market: Store, learn: GraduationCap, other: Compass };
const spotlightItems = (menu: HomeMenuSettings): MenuItem[] => SPOTLIGHT_FILTERS.map((f) => ({ id: `sp-${f.id}`, label: f.id === "foryou" ? menu.navigation.exploreLabel : f.label, icon: SPOTLIGHT_ICON[f.id], href: "/spotlight", spotlight: f.id }));
const SPACE_ICONS = [BedDouble, Home, Building2, Warehouse, KeyRound];
const spaceItems: MenuItem[] = SPACE_PAGES.map((p, i) => ({ id: p.id, label: p.label, icon: SPACE_ICONS[i], href: `/spaces/${p.id}` }));

/** Learn's row. Levels (Sprouts, Basics, Academy, Campus, Skills) are chosen on Discover. */
const learnItems: MenuItem[] = [
  { id: "discover", label: "Discover", icon: Compass, href: "/learn" },
  { id: "classroom", label: "Classroom", icon: GraduationCap, href: "/learn/classroom", module: "learn" },
  { id: "studies", label: "Studies", icon: BookOpen, href: "/learn/studies", module: "learn" },
  { id: "review", label: "Review", icon: Receipt, href: "/learn/review", module: "learn" },
  { id: "connect", label: "Connect", icon: MessagesSquare, href: "/learn/connect" },
];

/** Which Learn item a page belongs to. Course and certificate pages sit under My Class. */
function learnItemForPath(pathname: string): string | null {
  if (pathname === "/learn") return "discover";
  if (pathname === "/learn/classroom" || pathname === "/learn/my" || pathname.startsWith("/learn/course/") || pathname.startsWith("/learn/live")) return "classroom";
  if (pathname === "/learn/studies" || pathname.startsWith("/learn/study/")) return "studies";
  if (pathname === "/learn/review" || pathname.startsWith("/learn/certificates")) return "review";
  if (pathname === "/learn/connect" || pathname.startsWith("/learn/connect/")) return "connect";
  return null;
}

function groupForPath(pathname: string): MenuGroup {
  if (pathname === "/wallet" || pathname.startsWith("/wallet/")) return "wallet";
  if (pathname === "/spaces" || pathname.startsWith("/spaces/")) return "spaces";
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

function itemForPath(pathname: string): string | null {
    if (pathname.startsWith("/spaces/")) return pathname.split("/")[2] ?? null;
    else if (pathname === "/restaurants" || pathname.startsWith("/restaurants/")) return "restaurant";
    else if (pathname === "/kitchens" || pathname.startsWith("/kitchens/")) return "kitchen";
    else if (pathname === "/food/street" || pathname === "/streetfood" || pathname.startsWith("/streetfood/")) return "street_food";
    else if (pathname === "/juices" || pathname.startsWith("/juices/")) return "juices";
    else if (pathname === "/bakeries" || pathname.startsWith("/bakeries/")) return "bakery";
    else if (pathname === "/ride/boda") return "boda";
    else if (pathname === "/ride/luxury") return "luxury";
    else if (pathname === "/ride/ambulance") return "ambulance";
    else if (pathname.startsWith("/ride/taxipress")) return "taxipress";
    else if (pathname === "/ride/car") return "car";
    else if (pathname === "/carpool") return "rideshare";
    else if (pathname === "/rent") return "selfdrive";
    else if (pathname === "/ride/move" || pathname === "/move") return "move";
    else if (pathname === "/orders/history" || pathname.startsWith("/orders/history/")) return "orders";
    else if (pathname === "/shoplist" || pathname.startsWith("/orders")) return "shoplist";
    else if (pathname === "/groceries" || pathname.startsWith("/groceries/")) return "markets";
    else if (pathname === "/stores" || pathname.startsWith("/store/")) return "stores";
    else if (pathname === "/pharmacy" || pathname.startsWith("/pharmacy/")) return "pharmacy";
    else if (pathname === "/spotlight") return null;
    else if (pathname === "/services/laundry") return "laundry";
    else if (pathname === "/services/clean") return "clean";
    else if (pathname === "/services/fix") return "fix";
    else if (pathname === "/services/hire/workers" || pathname.startsWith("/services/hire/workers/")) return "workers";
    else if (pathname === "/service" || pathname === "/services/hire" || pathname.startsWith("/services/hire/")) return "hire";
    else if (pathname === "/learn" || pathname.startsWith("/learn/")) return learnItemForPath(pathname);
    else if (pathname === "/services/learn") return null;
    else if (pathname === "/deliver" || pathname.startsWith("/deliver/")) return "parcel";
    else return null;
}

const ACTIVE_ORDER_POLL_MS = 10000;

export function BottomNav({ overlay = false }: { overlay?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [activeOrder, setActiveOrder] = useState<OrderRow | null>(null);
  const [trackerDrawerOpen, setTrackerDrawerOpen] = useState(false);
  const orderContext = useOrderNavContext();
  const resolvedOrder = orderContext?.path === pathname ? orderContext : null;
  const loadingOrder = /^\/orders\/[^/]+(?:\/pay)?$/.test(pathname) && pathname !== "/orders/history" && pathname !== "/orders/new" && !resolvedOrder;
  const menuGroup = resolvedOrder?.group ?? (loadingOrder ? "original" : groupForPath(pathname));
  const selectedItem = resolvedOrder?.group === "ride" || loadingOrder ? null : itemForPath(pathname);
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
  const inShopping = menuGroup === "shopping";
  //  A page-provided action wins (it is only registered while that page is
  //  mounted): /cart's gold Checkout, or a restaurant's own cart on food routes,
  //  which never mixes with the shopping cart.
  const rightMode: "action" | "cart" | "links" =
    primaryAction ? "action" : cartCount > 0 && inShopping ? "cart" : "links";


  // Flow-owned Back wins; ordinary submenus return Home as the design specifies.
  const onWallet = menuGroup === "wallet";
  const walletTab = useSyncExternalStore(subscribeWalletTab, getWalletTab, () => "home" as WalletTab);
  const backAction = onWallet
    ? () => goBackOr(router, "/")
    : primaryAction?.closeToHome ? () => router.push("/") : navBack ?? (rightMode !== "links"
    ? () => goBackOr(router, "/")
    : menuGroup !== "original" && menuGroup !== "spotlight" ? () => router.push("/") : null);
  const onHomeScreen = pathname === "/" && menuGroup === "original";

  const moduleOn = useModules();
  // A button whose module is switched off in Admin → Services is left out of every row, or kept greyed out (Admin chooses).
  const menuItems: MenuItem[] = filterByModule(
    menuGroup === "original" ? originalMenu(homeMenu)
    : menuGroup === "ride" ? rideItems(special, taxipress.enabled)
    : menuGroup === "hive" ? hiveItems(homeMenu, hireAvailability)
    : menuGroup === "learn" ? learnItems
    : menuGroup === "spotlight" ? spotlightItems(homeMenu)
    : menuGroup === "spaces" ? (homeMenu.navigation.spacesEnabled ? spaceItems : [])
    : menuGroup === "wallet" ? []
    : staticSubmenuItems[menuGroup], moduleOn);
  // Ride can grow to eight; past five the row scrolls sideways instead of squeezing the names.
  const selectedKey = menuGroup === "spotlight" ? `sp-${spotlightFilter}` : selectedItem;
  const itemSignature = menuItems.map((item) => item.id).join(",");
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || rightMode !== "links") return;
    const align = () => {
      const active = menu.querySelector<HTMLElement>('[aria-current="page"]');
      const itemLeft = active ? active.getBoundingClientRect().left - menu.getBoundingClientRect().left + menu.scrollLeft : 0;
      const left = active ? selectedMenuScroll(itemLeft, active.offsetWidth, menu.clientWidth, menu.scrollWidth, window.matchMedia("(min-width: 420px)").matches) : 0;
      menu.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    };
    align();
    const resize = new ResizeObserver(align);
    resize.observe(menu);
    return () => resize.disconnect();
  }, [selectedKey, menuGroup, rightMode, itemSignature]);



  useLivePolling(
    () => {
      if (!user) return;
      api
        .getActiveOrder()
        .then((res) => {
          const order = res.activeOrder;
          // Stage updates are silent; arrival and deliberate follow-up calls own the beep.
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
  const showActiveDeliveryBadge = !overlay && !!activeOrder && !isOnActiveOrderPage && !pathname.startsWith("/orders/") && pathname !== "/" && !isRideHomeWithRide;

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
        <div className="mx-auto flex max-w-[640px] flex-col items-center gap-2">
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

          <div className="customer-nav-shell pointer-events-auto flex w-full items-stretch">
            <div className="customer-nav-anchor">
              <button type="button" aria-label={onWallet ? "Back" : primaryAction?.closeToHome ? "Close and go to Home" : backAction ? primaryAction?.confirmation ? "Cancel confirmation" : navBack || rightMode !== "links" ? "Back" : "Back to Home" : onHomeScreen ? homeMenu.navigation.streamLabel : "Home"}
                onClick={backAction ?? (() => router.push(onHomeScreen ? "/spotlight" : "/"))}
                className="customer-nav-anchor-button">
                {backAction ? primaryAction?.confirmation || primaryAction?.closeToHome ? <X aria-hidden /> : <ChevronLeft aria-hidden /> : onHomeScreen ? <Flame aria-hidden /> : <Home aria-hidden />}
                {onWallet ? <span>Back</span> : !backAction && <span>{onHomeScreen ? homeMenu.navigation.streamLabel : t("nav_home")}</span>}
              </button>
            </div>
            {onWallet ? (
              <div className="customer-nav-menu-track customer-nav-swap" style={{ "--nav-count": 3 } as CSSProperties}>
                <ul
                  role="tablist"
                  aria-label={t("wallet_title")}
                  className="customer-nav-items"
                  onKeyDown={(event) => {
                    const order: WalletTab[] = ["recipients", "home", "accounts"];
                    const index = Math.max(0, order.indexOf(walletTab));
                    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? order[(index + 1) % 3]
                      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? order[(index + 2) % 3]
                      : event.key === "Home" ? order[0]
                      : event.key === "End" ? order[2]
                      : null;
                    if (!next) return;
                    event.preventDefault();
                    setWalletTab(next);
                    router.replace(walletTabHref(next));
                    event.currentTarget.querySelector<HTMLButtonElement>(`#wallet-tab-${next}`)?.focus();
                  }}
                >
                  {([
                    ["recipients", t("wallet_recipients"), UsersRound],
                    ["home", t("wallet_home_tab"), Home],
                    ["accounts", t("wallet_accounts"), Wallet],
                  ] as const).map(([id, label, Icon]) => {
                    const active = walletTab === id;
                    return (
                      <li key={id}>
                        <button
                          id={`wallet-tab-${id}`}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          aria-current={active ? "page" : undefined}
                          tabIndex={active ? 0 : -1}
                          onClick={() => { setWalletTab(id); router.replace(walletTabHref(id)); }}
                          className={`customer-nav-item ${active ? "is-active" : ""}`}
                        >
                          <Icon aria-hidden />
                          <span>{label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : rightMode === "action" && primaryAction ? <NavAction action={primaryAction} />
              : rightMode === "cart" ? <NavAction action={{ tone: "cart", label: "View cart", sublabel: `${cartCount} item${cartCount === 1 ? "" : "s"}`, detail: `UGX ${cartTotal.toLocaleString()}`, count: cartCount, onClick: () => setCartOpen(true) }} />
              : <div key="nav-links" className="customer-nav-menu-track customer-nav-swap" style={{ "--nav-count": Math.max(1, menuItems.length) } as CSSProperties}>
                <ul ref={menuRef} key={menuGroup} className="customer-nav-items" aria-label={menuGroup === "original" ? "Main menu" : `${menuGroup === "spotlight" ? "Stream" : menuGroup === "hive" ? "Work" : menuGroup} menu`}>
                  {menuItems.map((item) => {
                    const Icon = item.icon;
                    const active = item.id === selectedKey;
                    const content = <><Icon strokeWidth={active ? 2.4 : 1.8} aria-hidden /><span>{item.label}</span></>;
                    const className = `customer-nav-item ${active ? "is-active" : ""}`;
                    return <li key={item.id}>
                      {item.offline || item.disabled ? <button type="button" disabled aria-label={`${item.label}, currently unavailable`} className={className}>{content}</button>
                        : item.group ? <button type="button" aria-label={`${item.label} home and submenu`} onClick={() => router.push(({ ride: "/ride", shopping: "/shopping", food: "/food", hive: "/services", learn: "/learn", spaces: "/spaces" })[item.group!])} className={className}>{content}</button>
                        : <Link href={item.href!} onClick={() => { if (item.spotlight) setSpotlightFilter(item.spotlight); }} aria-current={active ? "page" : undefined} className={className}>{content}</Link>}
                    </li>;
                  })}
                </ul>
              </div>}
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
