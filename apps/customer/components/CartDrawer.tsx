"use client";

import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../lib/nav-primary-action";
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { useCart, dismissEarlierCartNotice } from "../lib/cart";
import { prefersReducedMotion, sheetShouldClose } from "../lib/buy-motion";
import { RollingCount, SwipeRow } from "./buy/motion";
import { bagCheckoutHref } from "../lib/bag-checkout";
import { EarlierCarts } from "./EarlierCarts";
import { CartVariantPicker } from "./buy/CartVariantPicker";
import { ProductImage } from "./ProductImage";

export interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

/**
 * The shopping bag: its items and their subtotal only. Delivery is its own step: "Proceed to
 * Checkout" goes to /cart?step=delivery (see lib/bag-checkout.ts), which only ever checks out
 * this bag. Restaurant carts and earlier carts are never touched from here.
 */
export function CartDrawer({
  isOpen,
  onClose,
}: CartDrawerProps) {
  const router = useRouter();
  const {
    items,
    totalQuantity,
    selectedCount,
    subtotal,
    updateQuantity,
    removeItem,
  } = useCart();

  const [portalReady, setPortalReady] = useState(false);
  /** The product whose cart row has its options open (one at a time). */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [sheetH, setSheetH] = useState(640);
  const [dragPhase, setDragPhase] = useState<"idle" | "drag" | "settle">("idle");
  const drag = useRef({ y: 0, t: 0, vy: 0, origin: 0, active: false });

  useEffect(() => {
    setPortalReady(true);
  }, []);

  // The "saved under Earlier carts" notice shows the next time the bag opens; closing the bag clears it.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) dismissEarlierCartNotice();
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // Lock body scroll and listen for Escape key when open
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

  // Next step: the Delivery screen of this bag's checkout.
  const proceedToCheckout = () => {
    if (selectedCount === 0) return;
    onClose();
    router.push(bagCheckoutHref("delivery"));
  };

  // Screens without the bottom nav (single store, product) keep the bag's own buttons.
  const [navPresent, setNavPresent] = useState(false);
  // While open, the drawer drives the bottom nav (which floats above it):
  // Home → Back (closes the bag), and the right capsule is this bag's next step.
  useRegisterNavBack(isOpen && navPresent, onClose, 2);
  useRegisterNavPrimaryAction(
    isOpen && navPresent && items.length > 0
      ? {
          tone: "step",
          label: "Continue to delivery",
          detail: `UGX ${subtotal.toLocaleString()}`,
          disabled: selectedCount === 0,
          onClick: proceedToCheckout,
        }
      : null,
    2,
  );
  useEffect(() => {
    if (!isOpen) return;
    setNavPresent(!!document.querySelector("nav.customer-nav"));
    document.documentElement.classList.add("peebee-cart-drawer-open");
    return () => document.documentElement.classList.remove("peebee-cart-drawer-open");
  }, [isOpen]);

  if (!portalReady || typeof document === "undefined") return null;

  const dim = !isOpen || dragPhase === "idle" ? 1 : Math.max(0, 1 - dragY / Math.max(1, sheetH));
  function pointerDown(event: React.PointerEvent, fromBody: boolean) {
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    if (fromBody && (bodyRef.current?.scrollTop ?? 0) > 0) return;
    setSheetH(drawerRef.current?.offsetHeight || 640);
    drag.current = { y: event.clientY, t: performance.now(), vy: 0, origin: dragY, active: true };
    setDragPhase("drag");
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event: React.PointerEvent) {
    if (!drag.current.active) return;
    const now = performance.now();
    const step = event.clientY - drag.current.y;
    drag.current.vy = step / Math.max(1, now - drag.current.t);
    drag.current.t = now;
    drag.current.y = event.clientY;
    drag.current.origin = Math.max(0, drag.current.origin + step);
    setDragY(drag.current.origin);
  }
  function pointerUp() {
    if (!drag.current.active) return;
    drag.current.active = false;
    const close = sheetShouldClose(dragY, drag.current.vy);
    if (prefersReducedMotion()) {
      setDragY(0);
      setDragPhase("idle");
      if (close) onClose();
      return;
    }
    setDragPhase("settle");
    if (close) {
      setDragY(sheetH || 640);
      window.setTimeout(() => { setDragY(0); setDragPhase("idle"); onClose(); }, 300);
    } else {
      setDragY(0);
      window.setTimeout(() => setDragPhase("idle"), 260);
    }
  }
  const dragStyle = dragPhase === "idle" ? undefined : {
    transform: `translateY(${dragY}px)`,
    transition: dragPhase === "drag" ? "none" : dragY === 0 ? "transform 250ms cubic-bezier(.34,1.3,.64,1)" : "transform 300ms ease-out",
  };

  return createPortal(
    <div
      className={`menu-item-cart-layer marketplace-cart-layer${isOpen ? " is-open" : ""}`}
      aria-hidden={!isOpen}
      style={{ ["--cart-dim" as string]: String(isOpen ? dim : 0) }}
    >
      {/* Backdrop */}
      <button
        type="button"
        className="menu-item-cart-layer__backdrop cursor-pointer"
        aria-label="Close cart drawer"
        tabIndex={isOpen ? 0 : -1}
        onClick={onClose}
      />

      {/* Slide-in Drawer */}
      <aside
        ref={drawerRef}
        className="menu-item-cart-drawer flex flex-col h-full bg-[rgb(var(--surface-card))] text-ink shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marketplace-cart-drawer-title"
        inert={!isOpen}
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* =========================================================================
            HEADER
        ========================================================================= */}
        <div
          className="menu-item-cart-drawer__header flex flex-col px-5 py-3 border-b border-[var(--border-faint)]"
          onPointerDown={(event) => pointerDown(event, false)}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        >
          <span className="buy-grabber" aria-hidden />
          <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/15 text-gold">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="marketplace-cart-drawer-title"
                className="text-lg font-extrabold tracking-tight text-ink leading-tight"
              >
                My cart
              </h2>
              <p className="text-xs text-ink-500 font-medium" aria-live="polite">
                {totalQuantity > 0
                  ? `${totalQuantity} item${totalQuantity === 1 ? "" : "s"} from stores`
                  : "Cart is empty"}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="menu-item-cart-drawer__close flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink hover:scale-105 active:scale-95 transition"
            aria-label="Close cart"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
          </div>
        </div>

        {/* =========================================================================
            BODY CONTENT
        ========================================================================= */}
        <div
          ref={bodyRef}
          className="menu-item-cart-drawer__body flex-1 overflow-y-auto px-5 py-4 overscroll-contain"
          onPointerDown={(event) => pointerDown(event, true)}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        >
          {items.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gold/10 text-gold shadow-inner">
                <ShoppingBag className="h-10 w-10 opacity-70" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-ink">Your bag is empty</h3>
                <p className="text-xs text-ink-500 max-w-xs leading-relaxed">
                  Explore fresh groceries, bakeries, electronics, and fashion boutiques to add items.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-xs font-bold text-ink-gold shadow-sm hover:scale-105 active:scale-95 transition"
              >
                <span>Continue Shopping</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <EarlierCarts className="w-full pt-4 text-left" />
            </div>
          ) : (
            /* Items List View */
            <div className="space-y-4">
              <EarlierCarts showList={false} />
              {/* Items List */}
              <ul className="space-y-3">
                {items.map((line) => (
                  <SwipeRow key={line.id} id={line.id} label={line.title} onRemove={() => removeItem(line.id)}>
                  <div className="flex gap-3 rounded-[20px] border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-2.5">
                    {/* Thumbnail */}
                    <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[14px] bg-[rgb(var(--surface-card))]">
                      <ProductImage
                        src={line.imageUrl}
                        alt={line.title}
                        category={line.category}
                        className="h-full w-full object-cover"
                        aspectRatio="square"
                      />
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                      {/* Name + remove */}
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-semibold leading-tight text-ink">{line.title}</h4>
                          {line.variantId && line.variantTitle ? (
                            <CartVariantPicker line={line} open={pickerFor === line.productId} onToggle={() => setPickerFor((cur) => (cur === line.productId ? null : line.productId))} />
                          ) : line.storeName ? (
                            <p className="mt-0.5 truncate text-[11px] text-ink-500">{line.storeName}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(line.id)}
                          className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-ink-500 transition hover:text-red-500 active:scale-90"
                          aria-label={`Remove ${line.title}`}
                          title="Remove item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Stepper + line price (one line, never wraps) */}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-0.5">
                          <button
                            type="button"
                            onClick={() => updateQuantity(line.id, -1)}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition hover:text-ink active:scale-90"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-5 text-center text-xs font-bold tabular-nums text-ink">{line.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(line.id, 1)}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition hover:text-ink active:scale-90"
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>

                        <span className="min-w-0 truncate whitespace-nowrap text-sm font-bold tabular-nums text-ink">
                          UGX {(line.price * line.quantity).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  </SwipeRow>
                ))}
              </ul>
              <EarlierCarts showNotice={false} />
            </div>
          )}
        </div>

        {/* =========================================================================
            FOOTER: items subtotal only; delivery is chosen at the next step.
        ========================================================================= */}
        {items.length > 0 && (
          <div className="menu-item-cart-drawer__footer border-t border-[var(--border-faint)] px-5 py-4 bg-[rgb(var(--surface-card))] space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm font-black text-ink">
                <span>Subtotal ({selectedCount} item{selectedCount === 1 ? "" : "s"})</span>
                <span className="font-mono text-base text-gold">UGX {subtotal.toLocaleString()}</span>
              </div>
            </div>

            <div className={`pt-1 flex items-center gap-2 ${navPresent ? "justify-end" : ""}`}>
              {!navPresent && (
              <button
                type="button"
                onClick={proceedToCheckout}
                disabled={selectedCount === 0}
                className="flex-1 py-3.5 px-4 rounded-full bg-gold text-ink-gold font-bold text-sm shadow-md hover:brightness-105 active:scale-98 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>Proceed to Checkout</span>
                <ChevronRight className="h-4 w-4 stroke-[2.5]" />
              </button>
              )}

              <Link
                href="/cart"
                onClick={onClose}
                className="p-3.5 rounded-full border border-[var(--border-faint)] text-xs font-bold text-ink-500 hover:text-ink hover:bg-[rgb(var(--surface-muted))] transition"
                title="View full cart screen"
              >
                View full cart
              </Link>
            </div>
          </div>
        )}
      </aside>
    </div>,
    document.body
  );
}

/**
 * Reusable floating or top-bar cart trigger icon button
 */
export function CartDrawerTrigger({
  onClick,
  className = "",
}: {
  onClick: () => void;
  className?: string;
}) {
  const { totalQuantity } = useCart();

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card)/.9)] backdrop-blur-md text-ink shadow-sm hover:scale-105 active:scale-95 transition ${className}`}
      aria-label={`Open shopping cart, ${totalQuantity} items`}
    >
      <ShoppingBag className="h-5 w-5" />
      {totalQuantity > 0 && (
        <span className="absolute -top-1 -right-1 flex min-w-[20px] h-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-black text-ink-gold shadow-sm">
          <RollingCount value={totalQuantity} />
        </span>
      )}
    </button>
  );
}

/**
 * Sticky bottom pill bar (similar to food's bottom drawer bar)
 */
export function CartDrawerBottomBar({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const { totalQuantity, total } = useCart();

  if (totalQuantity === 0) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md animate-in slide-in-from-bottom duration-300">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between rounded-full bg-ink px-5 py-3.5 text-cream shadow-2xl transition-transform active:scale-98 hover:bg-ink/90 cursor-pointer"
        aria-label={`Review bag, ${totalQuantity} items for UGX ${total.toLocaleString()}`}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold text-xs font-black text-ink-gold">
            {totalQuantity}
          </span>
          <span className="text-xs font-bold">Review Bag</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-black text-gold">
            UGX {total.toLocaleString()}
          </span>
          <span className="text-xs font-bold text-white/80">View Cart →</span>
        </div>
      </button>
    </div>
  );
}
