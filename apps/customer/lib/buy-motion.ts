/** Motion decisions for Buy. Pure helpers are unit-tested; navigation falls back when view transitions or motion are unavailable. */

export type NavDir = "forward" | "back";
export type BuyChrome = "none" | "reel";

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

let armedReel: string | null = null;

export function armReel(productId: string) {
  armedReel = productId;
}

export function reelArmedFor(productId: string): boolean {
  return armedReel === productId;
}

export function clearReel() {
  armedReel = null;
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

/** Slide the next screen in from the right. `href` "" with dir "back" calls router.back(). */
export async function navigateWithPush(router: RouterLike, href: string, dir: NavDir = "forward", chrome: BuyChrome = "none") {
  const go = () => {
    if (dir === "back" && !href) router.back();
    else router.push(href);
  };
  if (!canViewTransition()) {
    go();
    return;
  }
  const root = document.documentElement;
  const from = pathOf(window.location.pathname);
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
    delete root.dataset.navDir;
    delete root.dataset.buyChrome;
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
