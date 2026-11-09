/** Motion decisions for Buy. Pure helpers are unit-tested; navigation falls back when view transitions or motion are unavailable. */

export type NavDir = "forward" | "back";
export type BuyChrome = "none" | "reel" | "card";
export type CardMotionMode = "fade" | "view" | "flip";

/** Damped spring with no overshoot, about 450ms, for the card-to-hero expand. */
export const CARD_EXPAND_MS = 450;
export const CARD_EXPAND_EASE = "cubic-bezier(.32, .72, 0, 1)";
export const CARD_FADE_MS = 150;

export const SWIPE_LIMIT = -96;
export const SWIPE_OPEN = -88;
export const SWIPE_COMMIT = -64;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollLink(scrollY: number, range: number): number {
  if (range <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / range));
}

/** Which hero card a flick should land on. Negative velocity means the finger moved left (towards the next card). */
export function heroTargetIndex(scrollLeft: number, stride: number, count: number, velocity: number): number {
  if (count <= 1 || stride <= 0) return 0;
  const pos = scrollLeft / stride;
  let index: number;
  if (velocity <= -0.35) index = Math.ceil(pos - 0.01);
  else if (velocity >= 0.35) index = Math.floor(pos + 0.01);
  else index = Math.round(pos);
  return Math.max(0, Math.min(count - 1, index));
}

export function slideStride(el: HTMLElement): number {
  const slide = el.querySelector<HTMLElement>(".buy-hero__slide, .shop-hero__slide, .buy-extra__slide");
  if (!slide) return Math.max(1, el.clientWidth);
  const style = getComputedStyle(el);
  const gap = Number.parseFloat(style.columnGap || style.gap || "0") || 0;
  return slide.offsetWidth + gap;
}

export function clampSwipe(dx: number): number {
  return Math.max(SWIPE_LIMIT, Math.min(0, dx));
}

export function swipeSnap(dx: number): number {
  return dx <= SWIPE_COMMIT ? SWIPE_OPEN : 0;
}

export function sheetShouldClose(dy: number, velocity: number): boolean {
  return dy >= 120 || velocity >= 0.5;
}

export function pathOf(href: string): string {
  const raw = href.split("?")[0]?.split("#")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

/** Push transitions are for in-Buy collection, product and store screens. */
export function isBuyPushHref(href: string): boolean {
  return /^\/(shopping|product|store)(\/|$)/.test(pathOf(href));
}

export function productIdFromHref(href: string): string | null {
  const match = /^\/product\/([^/]+)$/.exec(pathOf(href));
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** A CSS view-transition-name that is unique per product and safe as an ident. */
export function productVtName(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+/, "") || "item";
  return `buy-card-${safe}`;
}

export function cardMotionMode(reduced: boolean, viewTransitions: boolean): CardMotionMode {
  if (reduced) return "fade";
  return viewTransitions ? "view" : "flip";
}

let armedReel: string | null = null;
let armedProduct: string | null = null;
let suppressPop = false;
let backInstalled = false;

export function armReel(productId: string) {
  armedReel = productId;
}

export function reelArmedFor(productId: string): boolean {
  return armedReel === productId;
}

export function clearReel() {
  armedReel = null;
}

export function armProductCard(id: string, el: HTMLElement) {
  armedProduct = id;
  document.querySelectorAll<HTMLElement>("[data-product-source]").forEach((node) => {
    node.style.viewTransitionName = "";
  });
  el.dataset.productSource = id;
  if (!prefersReducedMotion()) el.style.viewTransitionName = productVtName(id);
}

export function productArmedFor(id: string): boolean {
  return armedProduct === id;
}

export function clearProductCard() {
  armedProduct = null;
}

function sourceSelector(id: string): string {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, "");
  return `[data-product-source="${escaped}"]`;
}

function stripProductNames() {
  document.querySelectorAll<HTMLElement>("[data-product-source], [data-product-hero]").forEach((node) => {
    node.style.viewTransitionName = "";
  });
}

function tagHero(id: string) {
  const hero = document.querySelector<HTMLElement>("[data-product-hero]");
  if (hero && !prefersReducedMotion()) hero.style.viewTransitionName = productVtName(id);
  return hero;
}

function tagSource(id: string) {
  const card = document.querySelector<HTMLElement>(sourceSelector(id));
  if (card && !prefersReducedMotion()) card.style.viewTransitionName = productVtName(id);
  return card;
}

function waitForElement(selector: string, timeout: number): Promise<HTMLElement | null> {
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const found = document.querySelector<HTMLElement>(selector);
      if (found) { resolve(found); return; }
      if (performance.now() - start >= timeout) resolve(null);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function clearMotionAttrs() {
  const root = document.documentElement;
  delete root.dataset.navDir;
  delete root.dataset.buyChrome;
  delete root.dataset.buyMotion;
  delete root.dataset.buyFlip;
}

function supportsViewTransition(): boolean {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function";
}

async function fadeNavigate(go: () => void, from: string) {
  const root = document.documentElement;
  stripProductNames();
  if (supportsViewTransition()) {
    root.dataset.buyMotion = "fade";
    try {
      const transition = document.startViewTransition!(() => {
        go();
        return untilPath((path) => path !== from);
      });
      await transition.finished.catch(() => undefined);
    } finally {
      clearMotionAttrs();
    }
    return;
  }
  const veil = document.createElement("div");
  veil.className = "buy-veil";
  document.body.appendChild(veil);
  await new Promise((resolve) => window.setTimeout(resolve, CARD_FADE_MS));
  go();
  veil.remove();
}

function placeClone(node: HTMLElement, rect: DOMRect): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.setAttribute("data-buy-flip-clone", "");
  Object.assign(clone.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "75",
    overflow: "hidden",
    borderRadius: "24px",
    pointerEvents: "none",
    transformOrigin: "top left",
    transition: "none",
  });
  document.body.appendChild(clone);
  return clone;
}

async function flipNavigate(dir: NavDir, go: () => void) {
  const id = armedProduct;
  const origin = dir === "back"
    ? document.querySelector<HTMLElement>("[data-product-hero]")
    : (id ? document.querySelector<HTMLElement>(sourceSelector(id)) : null);
  if (!origin || !id) { go(); return; }
  const from = origin.getBoundingClientRect();
  const clone = placeClone(origin, from);
  document.documentElement.dataset.buyFlip = dir;
  go();
  const dest = await waitForElement(dir === "back" ? sourceSelector(id) : "[data-product-hero]", 800);
  if (!dest) { clone.remove(); delete document.documentElement.dataset.buyFlip; return; }
  dest.style.visibility = "hidden";
  const to = dest.getBoundingClientRect();
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  clone.getBoundingClientRect();
  clone.style.transition = `transform ${CARD_EXPAND_MS}ms ${CARD_EXPAND_EASE}, border-radius ${CARD_EXPAND_MS}ms ${CARD_EXPAND_EASE}`;
  clone.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${sx}, ${sy})`;
  clone.style.borderRadius = dir === "back" ? "24px" : "0px";
  await new Promise((resolve) => window.setTimeout(resolve, CARD_EXPAND_MS + 40));
  dest.style.visibility = "";
  clone.remove();
  delete document.documentElement.dataset.buyFlip;
}

/** Browser Back starts after the URL has changed but before React paints, so the product hero is still on screen. */
export function installProductCardBack() {
  if (backInstalled || typeof window === "undefined") return;
  backInstalled = true;
  window.addEventListener("popstate", () => {
    if (suppressPop || !armedProduct || prefersReducedMotion()) return;
    const hero = document.querySelector<HTMLElement>("[data-product-hero]");
    const id = armedProduct;
    if (!hero || !id) return;
    if (!supportsViewTransition()) {
      void flipNavigate("back", () => undefined);
      return;
    }
    hero.style.viewTransitionName = productVtName(id);
    const root = document.documentElement;
    root.dataset.buyMotion = "card";
    root.dataset.navDir = "back";
    root.dataset.buyChrome = "reel";
    const transition = document.startViewTransition!(() => {
      stripProductNames();
      return waitForElement(sourceSelector(id), 700).then((card) => { if (card) card.style.viewTransitionName = productVtName(id); });
    });
    transition.finished.finally(() => { clearMotionAttrs(); clearProductCard(); });
  }, true);
}

type RouterLike = { push: (href: string) => void; back: () => void };

function canViewTransition(): boolean {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function" && !prefersReducedMotion();
}

function untilPath(match: (path: string) => boolean, timeout = 600): Promise<void> {
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (match(pathOf(window.location.pathname)) || performance.now() - start >= timeout) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Slide the next screen in from the right. `href` "" with dir "back" calls router.back(). A card expand does not also run the page push. */
export async function navigateWithPush(router: RouterLike, href: string, dir: NavDir = "forward", chrome: BuyChrome = "none") {
  installProductCardBack();
  const go = () => {
    if (dir === "back" && !href) router.back();
    else router.push(href);
  };
  const from = pathOf(window.location.pathname);
  const reduced = prefersReducedMotion();
  if (chrome === "card") {
    if (dir === "back") suppressPop = true;
    try {
      if (reduced || cardMotionMode(reduced, supportsViewTransition()) === "fade") {
        await fadeNavigate(go, from);
        return;
      }
      if (!supportsViewTransition()) {
        await flipNavigate(dir, go);
        return;
      }
      const root = document.documentElement;
      const id = armedProduct;
      root.dataset.navDir = dir;
      root.dataset.buyMotion = "card";
      root.dataset.buyChrome = "reel";
      try {
        const transition = document.startViewTransition!(() => {
          stripProductNames();
          go();
          return untilPath((path) => path !== from).then(async () => {
            if (!id) return;
            if (dir === "back") {
              const card = await waitForElement(sourceSelector(id), 700);
              if (card) card.style.viewTransitionName = productVtName(id);
              else root.dataset.buyMotion = "pop";
            } else {
              const hero = await waitForElement("[data-product-hero]", 700);
              if (hero) hero.style.viewTransitionName = productVtName(id);
            }
          });
        });
        await transition.finished.catch(() => undefined);
      } catch {
        if (pathOf(window.location.pathname) === from) go();
      } finally {
        clearMotionAttrs();
        if (dir === "back") clearProductCard();
      }
    } finally {
      suppressPop = false;
    }
    return;
  }
  if (!canViewTransition()) {
    go();
    return;
  }
  const root = document.documentElement;
  root.dataset.navDir = dir;
  if (chrome === "reel") root.dataset.buyChrome = "reel";
  try {
    const transition = document.startViewTransition!(() => {
      go();
      return untilPath((path) => path !== from);
    });
    await transition.finished.catch(() => undefined);
  } catch {
    if (pathOf(window.location.pathname) === from) go();
  } finally {
    clearMotionAttrs();
  }
}

/** Spring the scroller onto a card, then commit that position to scrollLeft. */
export function springTrackTo(el: HTMLElement, target: number, done?: () => void) {
  const finish = () => {
    el.style.transition = "";
    el.style.transform = "";
    done?.();
  };
  if (prefersReducedMotion()) {
    el.scrollLeft = target;
    finish();
    return;
  }
  const delta = target - el.scrollLeft;
  if (Math.abs(delta) < 1) {
    el.scrollLeft = target;
    finish();
    return;
  }
  el.style.transition = "none";
  el.style.transform = "translateX(0)";
  el.getBoundingClientRect();
  el.style.transition = "transform 360ms cubic-bezier(.34,1.36,.64,1)";
  el.style.transform = `translateX(${-delta}px)`;
  const end = (event: TransitionEvent) => {
    if (event.propertyName !== "transform") return;
    el.removeEventListener("transitionend", end);
    el.style.transition = "none";
    el.scrollLeft = target;
    el.style.transform = "";
    finish();
  };
  el.addEventListener("transitionend", end);
  window.setTimeout(() => {
    el.removeEventListener("transitionend", end);
    if (el.style.transform) {
      el.style.transition = "none";
      el.scrollLeft = target;
      el.style.transform = "";
      finish();
    }
  }, 420);
}
