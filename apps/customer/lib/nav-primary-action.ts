"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ComponentType } from "react";

/**
 * A page or flow can hand the bottom nav one primary action (e.g. /cart →
 * "Checkout", a ride sheet → "Next: payment"). The nav then swaps its
 * right-hand capsule for a single button that runs it, so the screen doesn't
 * need its own floating/in-sheet primary button above the nav.
 *
 * Several components can register at once (a restaurant page and the place
 * picker it opens, or a ride sheet and its "where to?" step). The one that
 * became active most recently wins; when it clears, the previous one returns.
 */
export interface NavPrimaryAction {
  /**
   * All actions use the solid gold surface in both themes. "cart" retains
   * its bag treatment; "step" and "gold" preserve callers' existing metadata.
   * `confirmation`, rather than the tone, marks an actual final commitment.
   */
  tone?: "gold" | "step" | "cart";
  /** Item count badge for tone "cart". */
  count?: number;
  /** Small line under the label, e.g. "2 items". */
  sublabel?: string;
  label: string;
  /** Secondary text shown on the button, e.g. the order total. */
  detail?: string;
  disabled?: boolean;
  busy?: boolean;
  /** Final commitment: the nav requires a deliberate slide (or keyboard confirmation). */
  confirmation?: boolean;
  /** Exact approved swipe label when it differs from the default payment/confirmation copy. */
  confirmationLabel?: string;
  /** The left navigation control closes this screen to Home, without cancelling its underlying job. */
  closeToHome?: boolean;
  /** Leading icon for tone "gold" (defaults to the shopping bag), e.g. a bike for "Book Boda". */
  icon?: ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;
  onClick: () => void | Promise<void>;
}

type Slot = { action: NavPrimaryAction | null; seq: number; priority: number };

const slots = new Map<number, Slot>();
let nextId = 1;
let nextSeq = 1;
let current: NavPrimaryAction | null = null;
const listeners = new Set<() => void>();

function recompute() {
  let best: Slot | null = null;
  for (const slot of slots.values()) {
    if (slot.action && (!best || slot.priority > best.priority || (slot.priority === best.priority && slot.seq > best.seq))) best = slot;
  }
  const next = best?.action ?? null;
  if (next !== current) {
    current = next;
    listeners.forEach((l) => l());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNavPrimaryAction(): NavPrimaryAction | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/**
 * Registers the action while the calling component is mounted (pass null to clear).
 * `priority` lets a full-screen overlay (the place picker) win over the page
 * underneath even when both become active in the same render.
 */
export function useRegisterNavPrimaryAction(action: NavPrimaryAction | null, priority = 0) {
  // Keep the latest handler without re-registering on every render.
  const handlerRef = useRef<(() => void | Promise<void>) | null>(null);
  useLayoutEffect(() => { handlerRef.current = action?.onClick ?? null; });
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = nextId++;
  const label = action?.label;
  const tone = action?.tone;
  const count = action?.count;
  const sublabel = action?.sublabel;
  const detail = action?.detail;
  const disabled = action?.disabled;
  const busy = action?.busy;
  const confirmation = action?.confirmation;
  const confirmationLabel = action?.confirmationLabel;
  const closeToHome = action?.closeToHome;
  const icon = action?.icon;
  const enabled = action !== null;

  // Remove this component's slot when it unmounts.
  useEffect(() => {
    const id = idRef.current!;
    return () => {
      slots.delete(id);
      recompute();
    };
  }, []);

  useEffect(() => {
    const id = idRef.current!;
    const prev = slots.get(id);
    if (!enabled || label === undefined) {
      slots.set(id, { action: null, seq: prev?.seq ?? 0, priority });
      recompute();
      return;
    }
    // Becoming active (from nothing) moves this flow to the top; plain
    // updates (label, disabled, total…) keep its place.
    const seq = prev?.action ? prev.seq : nextSeq++;
    slots.set(id, {
      seq,
      priority,
      action: { tone, count, sublabel, label, detail, disabled, busy, confirmation, confirmationLabel, closeToHome, icon, onClick: () => handlerRef.current?.() },
    });
    recompute();
  }, [enabled, tone, count, sublabel, label, detail, disabled, busy, confirmation, confirmationLabel, closeToHome, icon, priority]);
}

/* ------------------------------------------------------------------ */
/* Nav "Back": while a cart/checkout is open or a flow is past its     */
/* landing step, the detached Home button becomes a one-step Back.      */
/* Same stacking rules as the primary action: most recently activated   */
/* (or higher priority) wins; clearing restores the previous one.       */
/* ------------------------------------------------------------------ */

type BackSlot = { handler: (() => void) | null; seq: number; priority: number };
const backSlots = new Map<number, BackSlot>();
let backCurrent: (() => void) | null = null;
const backListeners = new Set<() => void>();

function recomputeBack() {
  let best: BackSlot | null = null;
  for (const slot of backSlots.values()) {
    if (slot.handler && (!best || slot.priority > best.priority || (slot.priority === best.priority && slot.seq > best.seq))) best = slot;
  }
  const next = best?.handler ?? null;
  if (next !== backCurrent) {
    backCurrent = next;
    backListeners.forEach((l) => l());
  }
}

/** The active one-step Back handler, or null when Home should show. */
export function useNavBack(): (() => void) | null {
  return useSyncExternalStore(
    (l) => {
      backListeners.add(l);
      return () => backListeners.delete(l);
    },
    () => backCurrent,
    () => null,
  );
}

/** While `active`, the nav shows Back and runs `onBack` (latest closure) when tapped. */
export function useRegisterNavBack(active: boolean, onBack: () => void, priority = 0) {
  const handlerRef = useRef(onBack);
  useLayoutEffect(() => { handlerRef.current = onBack; });
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = nextId++;

  useEffect(() => {
    const id = idRef.current!;
    return () => {
      backSlots.delete(id);
      recomputeBack();
    };
  }, []);

  useEffect(() => {
    const id = idRef.current!;
    const prev = backSlots.get(id);
    if (!active) {
      backSlots.set(id, { handler: null, seq: prev?.seq ?? 0, priority });
    } else {
      const seq = prev?.handler ? prev.seq : nextSeq++;
      // A stable wrapper per activation so subscribers don't churn on re-renders.
      backSlots.set(id, { handler: prev?.handler ?? (() => handlerRef.current()), seq, priority });
    }
    recomputeBack();
  }, [active, priority]);
}

/* In-app history: lets "Back" use router.back() only when the previous
   screen is inside the app; otherwise it goes to the module's parent route. */
let inAppNavigations = 0;
export function noteInAppNavigation() {
  inAppNavigations += 1;
}
export function hasInAppHistory() {
  return inAppNavigations > 1;
}
export function goBackOr(router: { back: () => void; push: (href: string) => void }, fallback: string) {
  if (hasInAppHistory()) router.back();
  else router.push(fallback);
}
