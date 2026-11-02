"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bike,
  BookOpen,
  Briefcase,
  Car,
  ChefHat,
  ChevronDown,
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
import { Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useHomeMenu } from "../../lib/home-menu";
import {
  SCREENSAVER_MODULES,
  circularOffset,
  entitySubtitle,
  selectScreensaver,
  wrapIndex,
  type ScreensaverEntity,
  type ScreensaverIcon,
  type ScreensaverModuleDef,
} from "../../lib/home-screensaver";
import { useModules } from "../../lib/modules";
import "./home-screensaver.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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

type Slide = ScreensaverModuleDef & { title: string };

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

function HomeScreensaver({ slides, onClose }: { slides: Slide[]; onClose: () => void }) {
  const [view, setView] = useState(launch.view);
  const [moduleIndex, setModuleIndex] = useState(launch.moduleIndex);
  const [entityIndex, setEntityIndex] = useState(launch.entityIndex);
  const frameRef = useRef<HTMLDivElement>(null);
  const pausedByUser = useRef(false);
  const timer = useRef(0);
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

  function stepModule(dir: 1 | -1) {
    if (slides.length < 2) return;
    stopAutoplay();
    setModuleIndex((index) => wrapIndex(Math.min(index, slides.length - 1) + dir, slides.length));
    setEntityIndex(0);
  }

  function stepEntity(dir: 1 | -1) {
    if (entities.length < 2) return;
    stopAutoplay();
    setEntityIndex((index) => wrapIndex(Math.min(index, entities.length - 1) + dir, entities.length));
  }

  function openModule() {
    stopAutoplay();
    setView("module");
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
      if (now < lockedUntil) return;
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
      lockedUntil = now + 320;
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

  const subtitle = entitySubtitle(entities);
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
        onPointerUp={onPointerUp}
        onPointerCancel={clearGesture}
      >
        <div className="hs-visual" aria-hidden="true">
          <HeroPhoto
            src={view === "cover" ? slide.cover : entity.image}
            position={view === "cover" ? slide.coverPosition : entity.imagePosition}
            gradient={view === "cover" ? slide.coverGradient : entity.gradient}
          />
        </div>
        <div className="hs-scrim hs-scrim-top" />
        <div className="hs-scrim hs-scrim-bottom" />

        <div className="hs-top">
          {view === "cover" ? (
            <p className="hs-wordmark">peebee</p>
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

        {view === "cover" ? (
          <>
            <div className="hs-cover-stack">
              <h1 className="hs-cover-title">{slide.title}</h1>
              <p className="hs-cover-sub">{subtitle}</p>
              <Dots slides={slides} index={mi} onSelect={(index) => { stopAutoplay(); setModuleIndex(index); setEntityIndex(0); }} />
            </div>
            <button type="button" className="hs-glass hs-details" aria-label={`Show ${slide.title} details`} onClick={openModule}>
              <ChevronUp size={18} strokeWidth={2.2} aria-hidden />
              Details
            </button>
          </>
        ) : (
          <>
            <div className="hs-mod-switch">
              <span className="hs-glass hs-name-pill">{slide.title}</span>
              <Dots slides={slides} index={mi} onSelect={(index) => { stopAutoplay(); setModuleIndex(index); setEntityIndex(0); }} />
            </div>
            <svg className="hs-sheet-shape" viewBox="0 0 390 438" preserveAspectRatio="none" aria-hidden="true">
              <path className="hs-sheet-fill" d="M0 6C150 4 210 36 390 38V438H0Z" />
            </svg>
            <div className="hs-sheet-body">
              <div className="hs-copy" key={entity.id}>
                <h1 className="hs-entity-title">{entity.title}</h1>
                <p className="hs-meta"><span className="hs-meta-dot" aria-hidden />{entity.meta}</p>
                <p className="hs-desc">{entity.description}</p>
              </div>
              <Cta entity={entity} />
            </div>
            <Thumbs entities={entities} active={ei} moduleId={slide.id} onSelect={(index) => { stopAutoplay(); setEntityIndex(index); }} />
          </>
        )}
      </div>
    </div>
  );

  function clearGesture() { gesture.current = null; }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    stopAutoplay();
    if ((event.target as HTMLElement).closest("button, a")) return;
    gesture.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 && Math.abs(dy) < 48) return;
    if (Math.abs(dx) > Math.abs(dy)) stepModule(dx < 0 ? 1 : -1);
    else if (dy < 0) { if (view === "cover") openModule(); else stepEntity(1); }
    else if (view === "module") stepEntity(-1);
  }
}

const gesture = { current: null as { x: number; y: number } | null };

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
    const timeout = window.setTimeout(() => setGhost(null), 380);
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
          <img src={entity.image} alt="" draggable={false} className="hs-thumb-img" onError={() => setFailed(true)} />
        )}
      </span>
      <span className="hs-thumb-label">{entity.title}</span>
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
