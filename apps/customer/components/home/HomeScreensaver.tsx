"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bike,
  BookOpen,
  Briefcase,
  Car,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Croissant,
  HardHat,
  ListChecks,
  Package,
  Phone,
  Pill,
  Radio,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Store,
  Truck,
  Tv,
  UtensilsCrossed,
  WashingMachine,
  Wrench,
  X,
} from "lucide-react";
import localFont from "next/font/local";
import { BrandLogo } from "../BrandLogo";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useHomeMenu } from "../../lib/home-menu";
import {
  SCREENSAVER_MODULES,
  circularOffset,
  entitySubtitle,
  selectScreensaver,
  thumbLabelOf,
  wrapIndex,
  type ScreensaverEntity,
  type ScreensaverIcon,
  type ScreensaverModuleDef,
} from "../../lib/home-screensaver";
import { useModules } from "../../lib/modules";
import "./home-screensaver.css";

// Latin variable file (one woff2 covers every weight). Each face is declared
// separately so a weight in between still snaps the way the Google CSS did.
const jakarta = localFont({
  src: [
    { path: "../../lib/fonts/plus-jakarta-sans/plus-jakarta-sans-latin.woff2", weight: "400", style: "normal" },
    { path: "../../lib/fonts/plus-jakarta-sans/plus-jakarta-sans-latin.woff2", weight: "500", style: "normal" },
    { path: "../../lib/fonts/plus-jakarta-sans/plus-jakarta-sans-latin.woff2", weight: "600", style: "normal" },
    { path: "../../lib/fonts/plus-jakarta-sans/plus-jakarta-sans-latin.woff2", weight: "700", style: "normal" },
    { path: "../../lib/fonts/plus-jakarta-sans/plus-jakarta-sans-latin.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
});

const ICONS: Record<ScreensaverIcon, LucideIcon> = {
  phone: Phone,
  package: Package,
  bag: ShoppingBag,
  truck: Truck,
  bike: Bike,
  car: Car,
  utensils: UtensilsCrossed,
  chef: ChefHat,
  croissant: Croissant,
  list: ListChecks,
  basket: ShoppingBasket,
  store: Store,
  pill: Pill,
  sparkles: Sparkles,
  washer: WashingMachine,
  wrench: Wrench,
  hardhat: HardHat,
  briefcase: Briefcase,
  book: BookOpen,
  radio: Radio,
  tv: Tv,
};

const AUTOPLAY_MS = 5600;

/** Survives client navigations so Back returns to the same slide. A full reload is a new launch. */
let launch: { closed: boolean; view: "cover" | "module"; moduleIndex: number; entityIndex: number } = {
  closed: false,
  view: "cover",
  moduleIndex: 0,
  entityIndex: 0,
};
const launchListeners = new Set<() => void>();

function subscribeLaunch(listener: () => void) {
  launchListeners.add(listener);
  return () => { launchListeners.delete(listener); };
}

/** Opens the full-screen slideshow again from the home card. */
export function openHomeScreensaver() {
  launch = { ...launch, closed: false, view: "cover" };
  for (const listener of launchListeners) listener();
}

type Slide = ScreensaverModuleDef & { title: string };

type PageSnap = {
  id: string;
  mode: "cover" | "module";
  src?: string;
  position?: string;
  gradient: string;
  title: string;
  sub: string;
  entity: ScreensaverEntity | null;
};

type Flight = {
  id: string;
  axis: "cluster" | "entity" | "open";
  dir: 1 | -1;
  progress: number;
  dragging: boolean;
  commitOnEnd: boolean;
  reduced: boolean;
  settled?: boolean;
  outgoing: PageSnap;
  incoming: PageSnap;
  apply: () => void;
};

function layerStyle(role: "out" | "in", flight: Flight): React.CSSProperties {
  const { dir, progress, reduced } = flight;
  if (reduced) return { opacity: role === "out" ? 1 - progress : Math.max(progress, 0.001), zIndex: role === "out" ? 2 : 1, transform: "none" };
  // Keep the entire cover opaque until it has cleared the screen, with the
  // first detail page already in place underneath it.
  if (flight.axis === "open") return {
    zIndex: role === "out" ? 2 : 1,
    transform: role === "out" ? `translate3d(0, ${-progress * 100}%, 0)` : "none",
    opacity: 1,
  };
  if (flight.axis === "cluster" && flight.incoming.mode === "cover") return {
    zIndex: role === "out" ? 2 : 1,
    "--hs-image-x": `${role === "out" ? -dir * progress * 100 : dir * (1 - progress) * 100}%`,
    "--hs-copy-opacity": role === "out" ? 1 - progress : progress,
    "--hs-copy-y": `${role === "out" ? -progress * 12 : (1 - progress) * 28}px`,
  } as React.CSSProperties;
  if (flight.axis !== "cluster") return {
    zIndex: role === "out" ? 2 : 1,
    "--hs-image-y": `${role === "out" ? -dir * progress * 12 : dir * (1 - progress) * 65}%`,
    "--hs-image-scale": role === "out" ? 1 - progress * 0.14 : 1.12 - progress * 0.12,
    "--hs-image-opacity": role === "out" ? 1 - progress : 1,
    "--hs-copy-opacity": role === "out" ? 1 - progress : progress,
    "--hs-copy-y": "0px",
    "--hs-copy-x": `${role === "out" ? progress * 20 : -(1 - progress) * 28}px`,
    "--hs-roll": `${role === "out" ? progress * 90 : -90 * (1 - progress)}deg`,
  } as React.CSSProperties;
  if (role === "out") return { transform: `translate3d(${-dir * progress * 100}%, 0, 0)`, opacity: 1, zIndex: 2 };
  const slide = dir * (1 - progress) * 25;
  const scale = 0.92 + 0.08 * progress;
  return { transform: `translate3d(${slide}%, 0, 0) scale(${scale})`, opacity: progress, zIndex: 1 };
}

function useSlides(): Slide[] {
  const moduleOn = useModules();
  const menu = useHomeMenu();
  return selectScreensaver(SCREENSAVER_MODULES, moduleOn, menu.hive.shortcuts).map((mod) => ({
    ...mod,
    title: menu.clusters[mod.cluster]?.label?.trim() || mod.title,
  }));
}

export function HomeLaunch({ children }: { children: React.ReactNode }) {
  const slides = useSlides();
  const [closed, setClosed] = useState(launch.closed);
  useEffect(() => subscribeLaunch(() => setClosed(launch.closed)), []);
  const show = !closed && slides.length > 0;
  return (
    <>
      <div {...(show ? { inert: true, "aria-hidden": true as const } : {})}>{children}</div>
      {show && (
        <HomeScreensaver
          slides={slides}
          onClose={() => {
            launch = { ...launch, closed: true };
            setClosed(true);
          }}
        />
      )}
    </>
  );
}

/** Compact way back into the slideshow. Hidden when every module is switched off. */
export function ExplorePeebeeCard() {
  const slides = useSlides();
  if (slides.length === 0) return null;
  const sub = slides.map((slide) => slide.title).join(" · ");
  return (
    <button type="button" className="hs-home-explore" onClick={openHomeScreensaver} aria-label={`Explore Peebee, ${sub}`}>
      <span className="hs-home-explore__media" aria-hidden />
      <span className="hs-home-explore__copy">
        <span className="hs-home-explore__title">Explore Peebee</span>
        <span className="hs-home-explore__sub">{sub}</span>
      </span>
      <ChevronRight size={20} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

function HomeScreensaver({ slides, onClose }: { slides: Slide[]; onClose: () => void }) {
  const [view, setView] = useState(launch.view);
  const [moduleIndex, setModuleIndex] = useState(launch.moduleIndex);
  const [entityIndex, setEntityIndex] = useState(launch.entityIndex);
  const frameRef = useRef<HTMLDivElement>(null);
  const pausedByUser = useRef(false);
  const timer = useRef(0);
  const [flight, setFlight] = useState<Flight | null>(null);
  const flightRef = useRef<Flight | null>(null);
  const actions = useRef({ view, openModule: () => {}, stepModule: (_dir: 1 | -1) => {}, stepEntity: (_dir: 1 | -1) => {} });

  const mi = slides.length === 0 ? 0 : Math.min(moduleIndex, slides.length - 1);
  const slide = slides[mi]!;
  const entities = slide?.entities ?? [];
  const ei = entities.length === 0 ? 0 : Math.min(entityIndex, entities.length - 1);
  const entity = entities[ei];

  useEffect(() => {
    launch = { ...launch, view, moduleIndex: mi, entityIndex: ei };
  }, [view, mi, ei]);

  function stopAutoplay() {
    pausedByUser.current = true;
    window.clearInterval(timer.current);
  }

  function putFlight(next: Flight | null) {
    flightRef.current = next;
    setFlight(next);
  }

  function pageSnap(s: Slide, ent: ScreensaverEntity, mode: "cover" | "module"): PageSnap {
    return {
      id: `${mode}:${s.id}:${ent.id}`,
      mode,
      src: mode === "cover" ? s.cover : ent.image,
      position: mode === "cover" ? s.coverPosition : ent.imagePosition,
      gradient: mode === "cover" ? s.coverGradient : ent.gradient,
      title: mode === "cover" ? s.title : ent.title,
      sub: mode === "cover" ? entitySubtitle(s.entities) : ent.meta,
      entity: mode === "module" ? ent : null,
    };
  }

  function currentSnap(): PageSnap {
    return pageSnap(slide, entity, view);
  }

  function playSnap(dir: 1 | -1, incoming: PageSnap, apply: () => void, dragging = false, progress = 0, axis: Flight["axis"] = "cluster") {
    if (flightRef.current && !dragging) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next: Flight = {
      id: nextFlightId(dir, incoming.id),
      dir,
      axis,
      progress,
      dragging,
      commitOnEnd: !dragging,
      reduced,
      outgoing: currentSnap(),
      incoming,
      apply,
    };
    putFlight(next);
    if (!dragging) requestAnimationFrame(() => requestAnimationFrame(() => putFlight(flightRef.current && flightRef.current.id === next.id ? { ...flightRef.current, progress: 1 } : flightRef.current)));
  }

  // Detail flights animate their children rather than the page itself. Also
  // settle when a browser suppresses transitionend (for example in a hidden tab).
  useEffect(() => {
    if (!flight || flight.dragging) return;
    const timeout = window.setTimeout(() => {
      const current = flightRef.current;
      if (!current || current.id !== flight.id || current.settled) return;
      current.settled = true;
      if (current.commitOnEnd && current.progress >= 1) current.apply();
      putFlight(null);
    }, flight.reduced ? 200 : 800);
    return () => window.clearTimeout(timeout);
  }, [flight]);

  function stepModule(dir: 1 | -1) {
    if (slides.length < 2 || !slide || !entity) return;
    stopAutoplay();
    const index = wrapIndex(mi + dir, slides.length);
    const next = slides[index];
    const ent = next?.entities[0];
    if (!next || !ent) return;
    playSnap(dir, pageSnap(next, ent, view), () => { setModuleIndex(index); setEntityIndex(0); });
  }

  function stepEntity(dir: 1 | -1) {
    if (view !== "module" || entities.length < 2 || !slide || !entity) return;
    stopAutoplay();
    const index = wrapIndex(ei + dir, entities.length);
    const ent = entities[index];
    if (!ent) return;
    playSnap(dir, pageSnap(slide, ent, "module"), () => setEntityIndex(index), false, 0, "entity");
  }

  function goModule(index: number) {
    if (!slide || !entity || index === mi) return;
    stopAutoplay();
    const dir: 1 | -1 = circularOffset(index, mi, slides.length) >= 0 ? 1 : -1;
    const next = slides[index];
    const ent = next?.entities[0];
    if (!next || !ent) return;
    playSnap(dir, pageSnap(next, ent, view), () => { setModuleIndex(index); setEntityIndex(0); });
  }

  function goEntity(index: number) {
    if (view !== "module" || !slide || !entity || index === ei) return;
    stopAutoplay();
    const dir: 1 | -1 = circularOffset(index, ei, entities.length) >= 0 ? 1 : -1;
    const ent = entities[index];
    if (!ent) return;
    playSnap(dir, pageSnap(slide, ent, "module"), () => setEntityIndex(index), false, 0, "entity");
  }

  function onFlightEnd(event: React.TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== "transform" && event.propertyName !== "opacity") return;
    const current = flightRef.current;
    if (!current || current.dragging || current.settled) return;
    current.settled = true;
    if (current.commitOnEnd && current.progress >= 1) current.apply();
    putFlight(null);
  }

  function openModule() {
    stopAutoplay();
    const first = entities[0];
    if (!first || flightRef.current) return;
    playSnap(1, pageSnap(slide, first, "module"), () => { setEntityIndex(0); setView("module"); }, false, 0, "open");
  }

  function backToCover() {
    stopAutoplay();
    setView("cover");
  }

  useEffect(() => {
    actions.current = { view, openModule, stepModule, stepEntity };
  });

  useEffect(() => {
    frameRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const blocked = [document.querySelector(".customer-header"), document.querySelector(".customer-nav")]
      .filter((node): node is Element => !!node);
    for (const node of blocked) node.setAttribute("inert", "");
    return () => {
      document.documentElement.style.overflow = previous;
      for (const node of blocked) node.removeAttribute("inert");
    };
  }, []);

  useEffect(() => {
    if (view !== "cover" || slides.length < 2 || pausedByUser.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = () => {
      window.clearInterval(timer.current);
      if (document.hidden) return;
      timer.current = window.setInterval(() => {
        if (document.hidden || pausedByUser.current) return;
        setModuleIndex((index) => wrapIndex(Math.min(index, slides.length - 1) + 1, slides.length));
        setEntityIndex(0);
      }, AUTOPLAY_MS);
    };
    const onVisible = () => { if (document.hidden || pausedByUser.current) window.clearInterval(timer.current); else start(); };
    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [view, slides.length]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let wheelX = 0;
    let wheelY = 0;
    let lockedUntil = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const now = Date.now();
      if (now < lockedUntil || flightRef.current) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (horizontal) {
        wheelX += event.deltaX;
        if (Math.abs(wheelX) < 48) return;
        actions.current.stepModule(wheelX > 0 ? 1 : -1);
        wheelX = 0;
      } else {
        wheelY += event.deltaY;
        if (Math.abs(wheelY) < 48) return;
        const forward = wheelY > 0;
        wheelY = 0;
        if (actions.current.view === "cover") { if (forward) actions.current.openModule(); }
        else actions.current.stepEntity(forward ? 1 : -1);
      }
      lockedUntil = now + 800;
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const act = actions.current;
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); act.stepModule(1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); act.stepModule(-1); }
      else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (act.view === "cover") act.openModule();
        else act.stepEntity(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (act.view === "module") act.stepEntity(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const selector = 'a[href], button:not([disabled]):not([tabindex="-1"])';
    function onTab(event: KeyboardEvent) {
      if (event.key !== "Tab" || !frame) return;
      const items = [...frame.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !frame.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !frame.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onTab);
    return () => document.removeEventListener("keydown", onTab);
  }, [view, mi, ei]);

  if (!slide || !entity) return null;

  const pending = flight && flight.progress > 0 && (flight.dragging || flight.commitOnEnd) ? flight.incoming : null;
  const thumbModule = pending ? slides.find((item) => item.entities.some((ent) => pending.id === `${pending.mode}:${item.id}:${ent.id}`)) ?? slide : slide;
  const thumbIndex = pending?.entity ? Math.max(0, thumbModule.entities.findIndex((ent) => ent.id === pending.entity?.id)) : ei;
  const layers: { snap: PageSnap; role?: "in" | "out" }[] = flight
    ? [{ snap: flight.incoming, role: "in" }, { snap: flight.outgoing, role: "out" }]
    : [{ snap: currentSnap() }];

  return (
    <div className={`${jakarta.className} hs-overlay`}>
      <div
        ref={frameRef}
        className="hs-frame"
        data-view={view}
        role="dialog"
        aria-modal="true"
        aria-label="Peebee"
        aria-describedby="hs-help"
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={clearGesture}
      >
        <div className="hs-stage">
          {layers.map(({ snap, role }) => (
            <PageLayer key={snap.id} snap={snap} motion={flight?.axis} phase={role}
              className={flight ? (flight.dragging ? "hs-layer is-flight is-drag" : "hs-layer is-flight") : "hs-layer"}
              style={flight && role ? layerStyle(role, flight) : undefined}
              hidden={role === "out"} slides={slides}
              moduleIndex={Math.max(0, slides.findIndex((item) => snap.id.startsWith(`${snap.mode}:${item.id}:`)))}
              onPickModule={goModule} onOpen={openModule} onEnd={role === "out" ? onFlightEnd : undefined} />
          ))}
        </div>

        <div className="hs-top">
          {view === "cover" ? (
            <BrandLogo variant="light" className="hs-wordmark" />
          ) : (
            <button type="button" className="hs-explore" aria-label="Back to slideshow" onClick={backToCover}>
              <ChevronDown size={18} strokeWidth={2.2} aria-hidden />
              Explore
            </button>
          )}
          <button type="button" className="hs-glass hs-close" aria-label="Close and go to home" onClick={onClose}>
            <X size={18} strokeWidth={2.2} aria-hidden />
          </button>
        </div>

        <p id="hs-help" className="hs-sr">
          Arrow keys move between modules, and up or down through a module. Buttons do the same without gestures.
        </p>

        {view === "module" && (
          <>
            <div className="hs-mod-switch">
              <span className="hs-glass hs-name-pill">{thumbModule.title}</span>
              <Dots slides={slides} index={slides.indexOf(thumbModule)} onSelect={goModule} />
            </div>
            <Thumbs entities={thumbModule.entities} active={thumbIndex} moduleId={thumbModule.id} onSelect={goEntity} />
          </>
        )}
      </div>
    </div>
  );

  function clearGesture() {
    const current = flightRef.current;
    gesture.current = null;
    if (current?.dragging) putFlight({ ...current, dragging: false, progress: 0, commitOnEnd: false });
  }

  function trackHorizontal(dx: number) {
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    const width = frameRef.current?.clientWidth || 1;
    const progress = Math.min(1, Math.abs(dx) / width);
    const existing = flightRef.current;
    if (!existing || existing.dir !== dir || !existing.dragging) {
        if (slides.length < 2) return;
        const index = wrapIndex(mi + dir, slides.length);
        const next = slides[index];
        const ent = next?.entities[0];
        if (!next || !ent) return;
        playSnap(dir, pageSnap(next, ent, view), () => { setModuleIndex(index); setEntityIndex(0); }, true, progress);
      return;
    }
    putFlight({ ...existing, progress, dragging: true });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (flightRef.current) return;
    stopAutoplay();
    if ((event.target as HTMLElement).closest("button, a")) return;
    gesture.current = { x: event.clientX, y: event.clientY, axis: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (start.axis === "x") trackHorizontal(dx);
    else if (view === "cover" && (dy < 0 || flightRef.current?.axis === "open")) {
      const progress = Math.min(1, Math.max(0, -dy) / (frameRef.current?.clientHeight || 1));
      const existing = flightRef.current;
      if (existing?.dragging && existing.axis === "open") putFlight({ ...existing, progress });
      else if (entities[0]) playSnap(1, pageSnap(slide, entities[0], "module"), () => { setEntityIndex(0); setView("module"); }, true, progress, "open");
    }
    else if (view === "module" && entities.length > 1) {
      const dir: 1 | -1 = dy < 0 ? 1 : -1;
      const progress = Math.min(1, Math.abs(dy) / (frameRef.current?.clientHeight || 1));
      const existing = flightRef.current;
      if (existing?.dragging && existing.dir === dir) putFlight({ ...existing, progress });
      else {
        const index = wrapIndex(ei + dir, entities.length);
        playSnap(dir, pageSnap(slide, entities[index]!, "module"), () => setEntityIndex(index), true, progress, "entity");
      }
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const verticalFlight = flightRef.current;
    if (verticalFlight?.dragging && verticalFlight.axis !== "cluster") {
      const commit = verticalFlight.axis === "open" ? dy <= -48 : Math.abs(dy) >= 48;
      putFlight({ ...verticalFlight, dragging: false, progress: commit ? 1 : 0, commitOnEnd: commit });
      return;
    }
    const horizontal = start.axis === "x" || (start.axis !== "y" && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= 48);
    if (horizontal) {
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const current = flightRef.current;
      if (Math.abs(dx) < 48) {
        if (current?.dragging) putFlight({ ...current, dragging: false, progress: 0, commitOnEnd: false });
        return;
      }
      if (current?.dragging && current.dir === dir) {
        if (current.progress > 0.98) { current.apply(); putFlight(null); }
        else putFlight({ ...current, dragging: false, progress: 1, commitOnEnd: true });
        return;
      }
      stepModule(dir);
      return;
    }
    if (Math.abs(dy) < 48) return;
    if (dy < 0) { if (view === "cover") openModule(); else stepEntity(1); }
    else if (view === "module") stepEntity(-1);
  }
}

const gesture = { current: null as { x: number; y: number; axis: "x" | "y" | null } | null };
let flightSerial = 0;
function nextFlightId(dir: number, incomingId: string) {
  flightSerial += 1;
  return `${flightSerial}-${dir}-${incomingId}`;
}

function PageLayer({ motion, phase, snap, className, style, hidden, slides, moduleIndex, onPickModule, onOpen, onEnd }: {
  motion?: Flight["axis"];
  phase?: "in" | "out";
  snap: PageSnap;
  className?: string;
  style?: React.CSSProperties;
  hidden?: boolean;
  slides?: Slide[];
  moduleIndex?: number;
  onPickModule?: (index: number) => void;
  onOpen?: () => void;
  onEnd?: (event: React.TransitionEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className={className ?? "hs-layer"} data-mode={snap.mode} data-motion={motion} data-phase={phase} style={style} inert={hidden || undefined} aria-hidden={hidden || undefined} onTransitionEnd={onEnd}>
      <div className="hs-visual" aria-hidden="true">
        <HeroPhoto src={snap.src} position={snap.position} gradient={snap.gradient} />
      </div>
      <div className="hs-scrim hs-scrim-top" />
      <div className="hs-scrim hs-scrim-bottom" />
      {snap.mode === "cover" ? (
        <>
          <div className="hs-cover-stack">
            <h1 className="hs-cover-title">{snap.title}</h1>
            <p className="hs-cover-sub">{snap.sub}</p>
            {slides && onPickModule && <Dots slides={slides} index={moduleIndex ?? 0} onSelect={onPickModule} />}
          </div>
          {onOpen && (
            <button type="button" className="hs-glass hs-details" aria-label={`Show ${snap.title} details`} onClick={onOpen}>
              <ChevronUp size={18} strokeWidth={2.2} aria-hidden />
            </button>
          )}
        </>
      ) : snap.entity && (
        <>
          <svg className="hs-sheet-shape" viewBox="0 0 390 438" preserveAspectRatio="none" aria-hidden="true">
            <path className="hs-sheet-fill" d="M0 6C150 4 210 36 390 38V438H0Z" />
          </svg>
          <div className="hs-sheet-body">
            <div className="hs-copy">
              <h1 className="hs-entity-title">{snap.entity.title}</h1>
              <p className="hs-meta"><span className="hs-meta-dot" aria-hidden />{snap.entity.meta}</p>
              <p className="hs-desc">{snap.entity.description}</p>
            </div>
            <Cta entity={snap.entity} />
          </div>
        </>
      )}
    </div>
  );
}

function Dots({ slides, index, onSelect }: { slides: Slide[]; index: number; onSelect: (index: number) => void }) {
  return (
    <div className="hs-dots" role="tablist" aria-label="Modules">
      {slides.map((item, itemIndex) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={itemIndex === index}
          aria-label={item.title}
          className={itemIndex === index ? "hs-dot is-on" : "hs-dot"}
          onClick={() => onSelect(itemIndex)}
        />
      ))}
    </div>
  );
}

function Cta({ entity }: { entity: ScreensaverEntity }) {
  const Icon = ICONS[entity.icon];
  return (
    <Link className="hs-cta" href={entity.href}>
      <Icon size={22} strokeWidth={2} aria-hidden />
      {entity.cta}
    </Link>
  );
}

function Thumbs({ entities, active, moduleId, onSelect }: { entities: ScreensaverEntity[]; active: number; moduleId: string; onSelect: (index: number) => void }) {
  const [ghost, setGhost] = useState<{ id: string; d: number; entity: ScreensaverEntity } | null>(null);
  const previous = useRef<{ moduleId: string; items: { id: string; d: number; entity: ScreensaverEntity }[] }>({ moduleId: "", items: [] });
  const visible = entities
    .map((item, index) => ({ id: item.id, d: circularOffset(index, active, entities.length), entity: item, index }))
    .filter((item) => Math.abs(item.d) <= 1);
  const visibleKey = `${moduleId}:${visible.map((item) => `${item.id}@${item.d}`).join("|")}`;

  useEffect(() => {
    const current = visible;
    const prior = previous.current;
    previous.current = { moduleId, items: current.map(({ id, d, entity }) => ({ id, d, entity })) };
    if (prior.moduleId !== moduleId) return;
    const ids = new Set(current.map((item) => item.id));
    const left = prior.items.find((item) => !ids.has(item.id));
    if (!left || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setGhost(left);
    const timeout = window.setTimeout(() => setGhost(null), 760);
    return () => window.clearTimeout(timeout);
    // visibleKey changes only when the thumb window changes; `visible` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  return (
    <>
      {ghost && <ThumbView key={`ghost-${ghost.id}`} entity={ghost.entity} d={ghost.d} ghost />}
      {visible.map((item) => (
        <ThumbView key={item.id} entity={item.entity} d={item.d} current={item.d === 0} onSelect={() => onSelect(item.index)} />
      ))}
    </>
  );
}

function ThumbView({ entity, d, current = false, ghost = false, onSelect }: { entity: ScreensaverEntity; d: number; current?: boolean; ghost?: boolean; onSelect?: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className={ghost ? "hs-thumb is-ghost" : "hs-thumb"}
      data-d={d}
      aria-current={current ? "true" : undefined}
      aria-hidden={ghost || undefined}
      tabIndex={ghost ? -1 : undefined}
      aria-label={ghost ? undefined : entity.title}
      onClick={onSelect}
    >
      <span className="hs-thumb-ring" style={{ background: entity.gradient }}>
        {entity.image && !failed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entity.image} alt="" draggable={false} className="hs-thumb-img" style={{ objectPosition: entity.imagePosition ?? "50% 40%" }} onError={() => setFailed(true)} />
        )}
      </span>
      <span className="hs-thumb-label">{thumbLabelOf(entity)}</span>
    </button>
  );
}

function HeroPhoto({ src, position, gradient }: { src?: string; position?: string; gradient: string }) {
  const [stack, setStack] = useState<string[]>([]);
  useEffect(() => {
    if (!src) return;
    let live = true;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    image.onload = () => {
      if (!live) return;
      setStack((prev) => (prev[prev.length - 1] === src ? prev : [...prev.slice(-1), src]));
    };
    image.onerror = () => { if (live) setStack([]); };
    return () => { live = false; };
  }, [src]);
  const shown = src ? stack : [];
  return (
    <div className="hs-visual-bg" style={{ background: gradient }}>
      {shown.map((url) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={url} src={url} alt="" draggable={false} className="hs-visual-img" style={{ objectPosition: position ?? "50% 50%" }} />
      ))}
    </div>
  );
}
