"use client";

import { useState, useEffect, useCallback } from "react";

export interface CartItem {
  id: string; // `${productId}:${variantId || "default"}`
  productId: string;
  storeId: string;
  storeName?: string;
  storeSlug?: string;
  title: string;
  variantId?: string;
  variantTitle?: string;
  price: number;
  compareAtPrice?: number;
  imageUrl?: string;
  category?: string;
  quantity: number;
  selected: boolean;
}

/** Why a cart was set aside as an earlier cart. */
export type EarlierCartReason = "expired" | "left_after_checkout" | "replaced";

/** A cart set aside (not deleted): it stays retrievable, but never joins a checkout until restored. */
export interface EarlierCart {
  id: string;
  /** When it was set aside. */
  savedAt: number;
  reason: EarlierCartReason;
  items: CartItem[];
  /** When it was last changed before being set aside (0 = unknown). */
  updatedAt?: number;
}

interface StoredCart {
  items: CartItem[];
  updatedAt: number;
}

/** The bag, per signed-in user (or "guest"): `{ items, updatedAt }`. */
const CART_PREFIX = "peebee_marketplace_cart:";
/** The old single-key bag (a plain item array, shared by every account on the device). Migrated once. */
const LEGACY_CART_KEY = "peebee_marketplace_cart";
const EARLIER_PREFIX = "peebee_earlier_carts:";
/** Set when a stale bag was set aside; the bag UI shows a one-off notice, then clears it. */
const NOTICE_PREFIX = "peebee_earlier_cart_notice:";
/** Same key as USER_KEY in lib/api.ts (not imported, so this module stays free of the API client). */
const USER_KEY = "peebee_customer_user";
const CART_EVENT = "peebee:cart_change";
/** Dispatched by AuthProvider when the signed-in user changes. */
export const AUTH_CHANGE_EVENT = "peebee:auth_change";
const MAX_EARLIER_CARTS = 10;

/** Admin setting `marketplace.cartExpiryHours`; this default holds until settings load. */
export const DEFAULT_CART_EXPIRY_HOURS = 12;
let cartExpiryHours = DEFAULT_CART_EXPIRY_HOURS;

export function setCartExpiryHours(hours: unknown): void {
  const n = Number(hours);
  if (hours != null && Number.isFinite(n) && n >= 1 && n <= 720) cartExpiryHours = Math.round(n);
}

export function getCartExpiryHours(): number {
  return cartExpiryHours;
}

/** True when a cart last changed at `updatedAt` has been left longer than the admin's expiry (0 = unknown = stale). */
export function isCartStale(updatedAt: number, now = Date.now(), hours = cartExpiryHours): boolean {
  return !(updatedAt > 0) || now - updatedAt > hours * 3_600_000;
}

let settingsPromise: Promise<number> | null = null;
/** Loads the admin's cart expiry once per page load (imported lazily, so tests never load the API client). */
export function ensureCartSettings(): Promise<number> {
  if (typeof window === "undefined") return Promise.resolve(cartExpiryHours);
  if (!settingsPromise) {
    settingsPromise = import("./api")
      .then(({ api }) => api.getSettings())
      .then((res) => {
        setCartExpiryHours(res.settings.marketplace?.cartExpiryHours);
        return cartExpiryHours;
      })
      .catch(() => {
        settingsPromise = null;
        return cartExpiryHours;
      });
  }
  return settingsPromise;
}

/** The admin's cart expiry in hours, for components (default until settings load). */
export function useCartExpiryHours(): number {
  const [hours, setHours] = useState(cartExpiryHours);
  useEffect(() => {
    let live = true;
    void ensureCartSettings().then((h) => {
      if (live) setHours(h);
    });
    return () => {
      live = false;
    };
  }, []);
  return hours;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore local storage errors
  }
}

function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(CART_EVENT));
  } catch {
    // ignore
  }
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const it = value as Partial<CartItem>;
  return (
    typeof it.id === "string" &&
    typeof it.productId === "string" &&
    typeof it.storeId === "string" &&
    typeof it.title === "string" &&
    Number.isFinite(it.price) &&
    Number.isFinite(it.quantity) &&
    Number(it.quantity) > 0
  );
}

function cleanItems(value: unknown): CartItem[] {
  return Array.isArray(value) ? value.filter(isCartItem).map((it) => ({ ...it, selected: it.selected !== false })) : [];
}

/** The signed-in customer's id from the stored session, or "guest". Read on every call, so signing in/out switches carts. */
export function cartOwnerId(): string {
  const user = readJson(USER_KEY) as { id?: unknown } | null;
  return user && typeof user.id === "string" && user.id ? user.id : "guest";
}

function readCartRaw(owner: string): StoredCart {
  const saved = readJson(CART_PREFIX + owner) as Partial<StoredCart> | unknown[] | null;
  if (Array.isArray(saved)) return { items: cleanItems(saved), updatedAt: 0 };
  if (!saved || typeof saved !== "object") return { items: [], updatedAt: 0 };
  return { items: cleanItems(saved.items), updatedAt: Number(saved.updatedAt) || 0 };
}

function writeCartRaw(owner: string, items: CartItem[], updatedAt = Date.now()): void {
  if (items.length === 0) removeKey(CART_PREFIX + owner);
  else writeJson(CART_PREFIX + owner, { items, updatedAt });
}

function readEarlierRaw(owner: string): EarlierCart[] {
  const saved = readJson(EARLIER_PREFIX + owner);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((c): c is EarlierCart => !!c && typeof c === "object" && typeof (c as EarlierCart).id === "string")
    .map((c) => ({ ...c, savedAt: Number(c.savedAt) || 0, items: cleanItems(c.items) }))
    .filter((c) => c.items.length > 0);
}

function writeEarlierRaw(owner: string, carts: EarlierCart[]): void {
  const kept = [...carts].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_EARLIER_CARTS);
  if (kept.length === 0) removeKey(EARLIER_PREFIX + owner);
  else writeJson(EARLIER_PREFIX + owner, kept);
}

function newEarlierId(): string {
  return `ec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function setAside(owner: string, items: CartItem[], reason: EarlierCartReason, updatedAt: number): void {
  if (items.length === 0) return;
  const entry: EarlierCart = { id: newEarlierId(), savedAt: Date.now(), reason, items, updatedAt };
  writeEarlierRaw(owner, [entry, ...readEarlierRaw(owner)]);
}

/**
 * Brings older storage up to date, then returns the current owner:
 * - the legacy single-key bag moves into this owner's cart with `updatedAt: 0` (so it counts as stale), once;
 * - a guest bag built just before signing in becomes the signed-in user's current bag (it is the newer one),
 *   and the user's own older bag is set aside ("replaced") rather than mixed in.
 */
function prepareOwner(): string {
  const owner = cartOwnerId();
  const legacy = readJson(LEGACY_CART_KEY);
  if (legacy !== null) {
    const items = cleanItems(legacy);
    if (items.length > 0) {
      const current = readCartRaw(owner);
      if (current.items.length === 0) writeCartRaw(owner, items, 0);
      else setAside(owner, items, "expired", 0);
    }
    removeKey(LEGACY_CART_KEY);
  }
  if (owner !== "guest") {
    const guest = readCartRaw("guest");
    if (guest.items.length > 0) {
      const mine = readCartRaw(owner);
      if (mine.items.length > 0) setAside(owner, mine.items, "replaced", mine.updatedAt);
      writeCartRaw(owner, guest.items, guest.updatedAt || Date.now());
      removeKey(CART_PREFIX + "guest");
    }
    const guestEarlier = readEarlierRaw("guest");
    if (guestEarlier.length > 0) {
      writeEarlierRaw(owner, [...guestEarlier, ...readEarlierRaw(owner)]);
      removeKey(EARLIER_PREFIX + "guest");
    }
  }
  return owner;
}

export function loadCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  return readCartRaw(prepareOwner()).items;
}

export function saveCart(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  writeCartRaw(prepareOwner(), items);
  notify();
}

export function addToCart(
  item: Omit<CartItem, "id" | "quantity" | "selected"> & {
    quantity?: number;
    selected?: boolean;
  }
): void {
  if (typeof window === "undefined") return;
  const owner = prepareOwner();
  const stored = readCartRaw(owner);
  let current = stored.items;
  // A bag left longer than the admin's expiry is set aside (still retrievable under Earlier carts),
  // so it never rides along into the new bag's checkout.
  if (current.length > 0 && isCartStale(stored.updatedAt)) {
    setAside(owner, current, "expired", stored.updatedAt);
    writeJson(NOTICE_PREFIX + owner, { at: stored.updatedAt || Date.now() });
    current = [];
  }
  const id = `${item.productId}:${item.variantId || "default"}`;
  const qtyToAdd = Math.max(1, item.quantity ?? 1);

  const existingIndex = current.findIndex((i) => i.id === id);
  if (existingIndex >= 0) {
    current[existingIndex].quantity += qtyToAdd;
    current[existingIndex].price = item.price; // sync latest price
    if (item.variantTitle) current[existingIndex].variantTitle = item.variantTitle;
    if (item.imageUrl) current[existingIndex].imageUrl = item.imageUrl;
  } else {
    current.push({
      ...item,
      id,
      quantity: qtyToAdd,
      selected: item.selected ?? true,
    });
  }

  writeCartRaw(owner, current);
  notify();
}

export function updateQuantity(id: string, delta: number): void {
  const current = loadCart();
  const index = current.findIndex((i) => i.id === id);
  if (index === -1) return;

  const nextQty = current[index].quantity + delta;
  if (nextQty <= 0) {
    current.splice(index, 1);
  } else {
    current[index].quantity = nextQty;
  }

  saveCart(current);
}

export function removeItem(id: string): void {
  const current = loadCart().filter((i) => i.id !== id);
  saveCart(current);
}

/** Switches a line to another variant of the same product. If the bag already has that variant, the quantities join. */
export function swapVariant(
  id: string,
  next: { variantId: string; variantTitle: string; price: number; compareAtPrice?: number; imageUrl?: string },
): void {
  const current = loadCart();
  const index = current.findIndex((i) => i.id === id);
  if (index === -1) return;
  const line = current[index];
  const nextId = `${line.productId}:${next.variantId}`;
  if (nextId === id) return;
  const twin = current.findIndex((i, n) => n !== index && i.id === nextId);
  const moved = { ...line, id: nextId, variantId: next.variantId, variantTitle: next.variantTitle, price: next.price, compareAtPrice: next.compareAtPrice, imageUrl: next.imageUrl || line.imageUrl };
  if (twin >= 0) {
    current[twin] = { ...current[twin], quantity: current[twin].quantity + line.quantity, price: next.price, variantTitle: next.variantTitle };
    current.splice(index, 1);
  } else {
    current[index] = moved;
  }
  saveCart(current);
}

export function toggleItemSelection(id: string): void {
  const current = loadCart();
  const item = current.find((i) => i.id === id);
  if (item) {
    item.selected = !item.selected;
    saveCart(current);
  }
}

export function selectAll(selected: boolean): void {
  const current = loadCart().map((i) => ({ ...i, selected }));
  saveCart(current);
}

export function clearCart(): void {
  saveCart([]);
}

/**
 * After a successful checkout: the checked-out lines leave the bag, and anything left unselected
 * is set aside as an earlier cart ("left_after_checkout"), so the next bag starts empty.
 */
export function completeCheckout(checkedOutIds: string[]): void {
  if (typeof window === "undefined") return;
  const owner = prepareOwner();
  const done = new Set(checkedOutIds);
  const stored = readCartRaw(owner);
  setAside(owner, stored.items.filter((i) => !done.has(i.id)), "left_after_checkout", stored.updatedAt);
  writeCartRaw(owner, []);
  notify();
}

export function loadEarlierCarts(): EarlierCart[] {
  if (typeof window === "undefined") return [];
  return readEarlierRaw(prepareOwner());
}

/** Restore replaces the current bag; a non-empty current bag is set aside first ("replaced"). Prices as saved. */
export function restoreEarlierCart(earlierId: string): void {
  if (typeof window === "undefined") return;
  const owner = prepareOwner();
  const earlier = readEarlierRaw(owner);
  const entry = earlier.find((c) => c.id === earlierId);
  if (!entry) return;
  const current = readCartRaw(owner);
  writeEarlierRaw(owner, earlier.filter((c) => c.id !== earlierId));
  if (current.items.length > 0) setAside(owner, current.items, "replaced", current.updatedAt);
  writeCartRaw(owner, entry.items.map((i) => ({ ...i, selected: true })));
  removeKey(NOTICE_PREFIX + owner);
  notify();
}

/** "Add to bag" merges an earlier cart into the current bag (prices as saved; the same line adds quantity). */
export function mergeEarlierCart(earlierId: string): void {
  if (typeof window === "undefined") return;
  const owner = prepareOwner();
  const earlier = readEarlierRaw(owner);
  const entry = earlier.find((c) => c.id === earlierId);
  if (!entry) return;
  const current = readCartRaw(owner).items;
  for (const line of entry.items) {
    const existing = current.find((i) => i.id === line.id);
    if (existing) existing.quantity += line.quantity;
    else current.push({ ...line, selected: true });
  }
  writeEarlierRaw(owner, earlier.filter((c) => c.id !== earlierId));
  writeCartRaw(owner, current);
  removeKey(NOTICE_PREFIX + owner);
  notify();
}

export function deleteEarlierCart(earlierId: string): void {
  if (typeof window === "undefined") return;
  const owner = prepareOwner();
  writeEarlierRaw(owner, readEarlierRaw(owner).filter((c) => c.id !== earlierId));
  notify();
}

/** When a stale bag was set aside and the notice has not been seen yet: that bag's date. */
export function loadEarlierCartNotice(): number | null {
  if (typeof window === "undefined") return null;
  const saved = readJson(NOTICE_PREFIX + prepareOwner()) as { at?: unknown } | null;
  const at = Number(saved?.at);
  return Number.isFinite(at) && at > 0 ? at : null;
}

export function dismissEarlierCartNotice(): void {
  if (typeof window === "undefined") return;
  removeKey(NOTICE_PREFIX + prepareOwner());
  notify();
}

/** The date an earlier cart is shown with: when it was last changed, else when it was set aside. */
export function earlierCartDate(cart: EarlierCart): number {
  return cart.updatedAt && cart.updatedAt > 0 ? cart.updatedAt : cart.savedAt;
}

export function formatCartDate(ms: number): string {
  const d = new Date(ms);
  try {
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

function useCartEvents(refresh: () => void) {
  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener(CART_EVENT, handler);
    window.addEventListener(AUTH_CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(CART_EVENT, handler);
      window.removeEventListener(AUTH_CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [refresh]);
}

/** Earlier (set-aside) carts and the one-off "saved under Earlier carts" notice. */
export function useEarlierCarts() {
  const [carts, setCarts] = useState<EarlierCart[]>([]);
  const [notice, setNotice] = useState<number | null>(null);
  const refresh = useCallback(() => {
    setCarts(loadEarlierCarts());
    setNotice(loadEarlierCartNotice());
  }, []);
  useCartEvents(refresh);
  return {
    carts,
    notice,
    dismissNotice: dismissEarlierCartNotice,
    restore: restoreEarlierCart,
    addToBag: mergeEarlierCart,
    remove: deleteEarlierCart,
  };
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(() => {
    setItems(loadCart());
  }, []);

  useEffect(() => {
    setMounted(true);
    void ensureCartSettings();
  }, []);
  useCartEvents(refresh);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const selectedItems = items.filter((i) => i.selected);
  const selectedCount = selectedItems.reduce((sum, item) => sum + item.quantity, 0);

  const subtotal = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  // Items only. The delivery fee comes from the server at checkout (see lib/bag-quote.ts).
  const total = subtotal;

  return {
    items,
    mounted,
    totalQuantity,
    selectedItems,
    selectedCount,
    subtotal,
    total,
    addToCart,
    updateQuantity,
    removeItem,
    toggleItemSelection,
    selectAll,
    clearCart,
    completeCheckout,
  };
}
