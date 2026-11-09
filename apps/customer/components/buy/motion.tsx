"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  armReel,
  heroTargetIndex,
  isBuyPushHref,
  navigateWithPush,
  prefersReducedMotion,
  scrollLink,
  slideStride,
  springTrackTo,
  swipeSnap,
  clampSwipe,
  type BuyChrome,
  type NavDir,
} from "../../lib/buy-motion";

export function useScrollLink(name: "--buy-s" | "--c", range: number, target: "root" | RefObject<HTMLElement | null> = "root") {
  useEffect(() => {
    const el = target === "root" ? document.documentElement : target.current;
    if (!el) return;
    let frame = 0;
    const apply = () => el.style.setProperty(name, scrollLink(window.scrollY, range).toFixed(3));
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      el.style.removeProperty(name);
    };
  }, [name, range, target]);
}

export function useBuyHomeChrome() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.buyHome = "1";
    return () => { delete root.dataset.buyHome; };
  }, []);
  useScrollLink("--buy-s", 56);
}

export function useFadeImages(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const arm = (img: HTMLImageElement) => {
      img.classList.add("buy-fade");
      if (img.complete && img.naturalWidth > 0) img.dataset.loaded = "true";
    };
    const onLoad = (event: Event) => {
      const node = event.target;
      if (node instanceof HTMLImageElement && root.contains(node)) {
        node.classList.add("buy-fade");
        node.dataset.loaded = "true";
      }
    };
    root.querySelectorAll("img").forEach(arm);
    root.addEventListener("load", onLoad, true);
    const watch = new MutationObserver(() => root.querySelectorAll("img").forEach(arm));
    watch.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener("load", onLoad, true);
      watch.disconnect();
    };
  }, [rootRef]);
}

export function useSnapTrack(ref: RefObject<HTMLDivElement | null>, count: number) {
  const [index, setIndex] = useState(0);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dragging = false;
    let pulled = false;
    let startX = 0;
    let startScroll = 0;
    let lastX = 0;
    let lastT = 0;
    let vx = 0;
    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
      dragging = true;
      pulled = false;
      startX = lastX = event.clientX;
      startScroll = el.scrollLeft;
      lastT = performance.now();
      vx = 0;
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (!pulled && Math.abs(dx) < 8) return;
      if (!pulled) {
        pulled = true;
        el.style.scrollSnapType = "none";
        el.style.scrollBehavior = "auto";
        el.setPointerCapture?.(event.pointerId);
      }
      const now = performance.now();
      vx = (event.clientX - lastX) / Math.max(1, now - lastT);
      lastX = event.clientX;
      lastT = now;
      el.scrollLeft = startScroll - dx;
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (!pulled) return;
      const stride = slideStride(el);
      const next = heroTargetIndex(el.scrollLeft, stride, count, -vx);
      setMoving(true);
      setIndex(next);
      springTrackTo(el, next * stride, () => {
        el.style.scrollSnapType = "";
        el.style.scrollBehavior = "";
        setMoving(false);
      });
    };
    const onScroll = () => {
      if (dragging) return;
      const next = heroTargetIndex(el.scrollLeft, slideStride(el), count, 0);
      setIndex((current) => (current === next ? current : next));
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("scroll", onScroll);
    };
  }, [count, ref]);

  function go(next: number) {
    const el = ref.current;
    if (!el) return;
    const bounded = Math.max(0, Math.min(count - 1, next));
    setIndex(bounded);
    if (prefersReducedMotion()) {
      el.scrollLeft = bounded * slideStride(el);
      return;
    }
    setMoving(true);
    el.style.scrollSnapType = "none";
    springTrackTo(el, bounded * slideStride(el), () => {
      el.style.scrollSnapType = "";
      setMoving(false);
    });
  }

  return { ref, index, moving, go };
}

export function SnapDots({ count, index, moving, labels, onPick }: {
  count: number; index: number; moving: boolean; labels: string[]; onPick: (index: number) => void;
}) {
  if (count < 2) return null;
  return (
    <div className="buy-dots" data-moving={moving ? "" : undefined}>
      <span className="buy-dotpill" style={{ transform: `translateX(${index * 44}px)` }} aria-hidden />
      {labels.map((label, i) => (
        <button key={`${label}-${i}`} type="button" className="buy-dot" aria-label={label} aria-current={i === index ? "true" : undefined} onClick={() => onPick(i)} />
      ))}
    </div>
  );
}

export function usePillIndicator(activeIndex: number) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ind = root.querySelector<HTMLElement>("[data-pill-ind]");
    const tab = root.querySelectorAll<HTMLElement>('[role="tab"]')[activeIndex];
    if (!ind || !tab) return;
    if (prefersReducedMotion()) ind.style.transition = "none";
    else ind.style.transition = "";
    ind.style.width = `${tab.offsetWidth}px`;
    ind.style.height = `${tab.offsetHeight}px`;
    ind.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop}px)`;
  }, [activeIndex]);
  return ref;
}

export function PushLink({ href, dir = "forward", chrome = "none", reelFor, children, ...rest }: React.ComponentProps<typeof Link> & {
  dir?: NavDir; chrome?: BuyChrome; reelFor?: string;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(event) => {
        rest.onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const target = typeof href === "string" ? href : "";
        if (!isBuyPushHref(target) && dir !== "back") return;
        event.preventDefault();
        if (reelFor) {
          document.querySelectorAll("[data-reel-vt]").forEach((node) => node.removeAttribute("data-reel-vt"));
          event.currentTarget.querySelector("img")?.setAttribute("data-reel-vt", "");
          armReel(reelFor);
        }
        void navigateWithPush(router, target, dir, chrome);
      }}
    >
      {children}
    </Link>
  );
}

export function Crossfade({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="buy-cross">
      <div key={id} className="buy-cross__in">{children}</div>
    </div>
  );
}

export function RollingCount({ value }: { value: number }) {
  const [frame, setFrame] = useState({ from: value, to: value, id: 0 });
  if (frame.to !== value) setFrame({ from: frame.to, to: value, id: frame.id + 1 });
  const same = frame.from === frame.to;
  return (
    <span className={`buy-roll${same ? " is-still" : ""}`} key={frame.id}>
      {!same && <span className="buy-roll__old">{frame.from}</span>}
      <span className="buy-roll__new">{frame.to}</span>
    </span>
  );
}

const SWIPE_EVENT = "peebee-swipe-open";

export function SwipeRow({ id, label, onRemove, className = "", children }: {
  id: string; label: string; onRemove: () => void; className?: string; children: ReactNode;
}) {
  const [x, setX] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [removing, setRemoving] = useState(false);
  const start = useRef({ x: 0, y: 0, base: 0, axis: "" as "" | "x" | "y" });
  const removed = useRef(false);

  useEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) {
        setAnimate(true);
        setX(0);
      }
    };
    window.addEventListener(SWIPE_EVENT, onOpen);
    return () => window.removeEventListener(SWIPE_EVENT, onOpen);
  }, [id]);

  function finishRemove() {
    if (removed.current) return;
    removed.current = true;
    onRemove();
  }

  function beginRemove() {
    if (prefersReducedMotion()) {
      finishRemove();
      return;
    }
    setRemoving(true);
    window.setTimeout(finishRemove, 500);
  }

  return (
    <li
      className={`buy-swipe ${className}`}
      data-removing={removing ? "" : undefined}
      onTransitionEnd={(event) => {
        if (removing && (event.propertyName === "grid-template-rows" || event.propertyName === "opacity")) finishRemove();
      }}
    >
      <div className="buy-swipe__clip">
        <button type="button" className="buy-swipe__trash" aria-label={`Remove ${label}`} onClick={beginRemove}>
          <Trash2 className="h-5 w-5" aria-hidden />
        </button>
        <div
          className="buy-swipe__face"
          style={{ transform: `translateX(${x}px)`, transition: animate && !prefersReducedMotion() ? "transform 200ms cubic-bezier(.34,1.4,.64,1)" : "none" }}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button, a, input")) return;
            start.current = { x: event.clientX, y: event.clientY, base: x, axis: "" };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
            const dx = event.clientX - start.current.x;
            const dy = event.clientY - start.current.y;
            if (!start.current.axis) {
              if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
              start.current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            }
            if (start.current.axis !== "x") return;
            setAnimate(false);
            setX(clampSwipe(start.current.base + dx));
          }}
          onPointerUp={(event) => {
            if (start.current.axis !== "x") return;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            const next = swipeSnap(x);
            setAnimate(true);
            setX(next);
            if (next !== 0) window.dispatchEvent(new CustomEvent(SWIPE_EVENT, { detail: id }));
          }}
          onPointerCancel={() => { setAnimate(true); setX(0); }}
        >
          {children}
        </div>
      </div>
    </li>
  );
}
