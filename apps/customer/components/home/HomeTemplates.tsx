"use client";

import { HOME_TEMPLATES, availableHomeShortcuts, isModuleOn, isPracticeMode, randomHomeInterval, resolveHomeMenu, resolveHomeTemplates, type DeliverySettings, type HomeShortcut, type HomeTemplatesSettings } from "@peebee/shared";
import { Ambulance, ArrowRight, Award, Bike, BookOpen, Briefcase, Bus, Car, ChefHat, Citrus, Clapperboard, Croissant, Crown, HardHat, ListChecks, MessagesSquare, Package, Pause, Pill, Play, Radio, ShoppingBag, ShoppingBasket, Sparkles, Truck, Tv, UsersRound, UtensilsCrossed, WashingMachine, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useSpecialCarServices } from "../../lib/special-car";
import { useTaxipress } from "../../lib/taxipress";
import { useHireAvailability } from "../../lib/home-menu";
import { useChatDrawer } from "../../lib/chat-drawer";
import { useCalls } from "../../lib/calls-context";
import { isNavigationOverlayOpen } from "../../lib/location-flow-state";
import { canRotateHome, chooseHomeSelection, restoreHomeSelection, type HomeSelection } from "../../lib/home-rotation";
import { Greeting } from "./Greeting";
import { ExplorePeebeeCard } from "./HomeScreensaver";
import "./home-templates.css";

const ICONS: Record<HomeShortcut["icon"], LucideIcon> = {
  bike: Bike, car: Car, people: UsersRound, truck: Truck, parcel: Package, bus: Bus, crown: Crown, ambulance: Ambulance,
  list: ListChecks, basket: ShoppingBasket, store: ShoppingBag, pill: Pill, food: UtensilsCrossed, chef: ChefHat, bread: Croissant,
  juice: Citrus, clean: Sparkles, laundry: WashingMachine, fix: Wrench, worker: HardHat, hire: Briefcase, book: BookOpen,
  live: Radio, tv: Tv, award: Award, chat: MessagesSquare, spotlight: Clapperboard,
};

/** Replaces home content only. BrandHeader and BottomNav remain owned by AppShell. */
export function HomeExperience({ legacy, children }: { legacy: ReactNode; children: ReactNode }) {
  const [settings, setSettings] = useState<DeliverySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const response = await api.getSettings(); setSettings(response.settings); setError(null); }
    catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => { if (active && document.visibilityState === "visible") void load(); };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("peebee:data-updated", refresh);
    return () => { active = false; document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); window.removeEventListener("peebee:data-updated", refresh); };
  }, [load]);
  if (!settings) return error ? <><div role="status" className="mx-4 my-3 rounded-xl border border-[var(--border-faint)] p-3 text-sm">Home designs could not load. Your services are still available.<button type="button" onClick={() => void load()} className="ml-2 min-h-11 font-bold underline">Try again</button></div>{legacy}</> : <div className="dh px-4 py-4"><Greeting compact /><div aria-label="Loading home" aria-busy="true" className="dh-loading" /></div>;
  const config = resolveHomeTemplates(settings.homeTemplates);
  if (!config.enabled) return legacy;
  return <DynamicHome config={config} settings={settings}>{children}</DynamicHome>;
}

function DynamicHome({ config, settings, children }: { config: HomeTemplatesSettings; settings: DeliverySettings; children: ReactNode }) {
  const world = isPracticeMode() ? "practice" : "live";
  const on = (key: string) => isModuleOn(key, world, settings.modules?.available);
  const special = useSpecialCarServices();
  const taxipress = useTaxipress();
  const hire = useHireAvailability();
  const { user } = useAuth();
  const chat = useChatDrawer();
  const calls = useCalls();
  const menu = resolveHomeMenu(settings.homeMenu);
  const available = availableHomeShortcuts(config, { on, special, taxipress: taxipress.enabled, hire, hive: menu.hive.shortcuts });
  const availableKey = available.map((s) => s.id).join("|");
  const storageKey = `peebee:home-template:${user?.id ?? "customer"}`;
  const blocked = chat.open || !["idle", "ended", "error"].includes(calls.state.phase);
  return <div className="dh space-y-5 px-4 pb-6 pt-4">
    <Greeting compact />
    <HomeArtwork key={`${storageKey}:${availableKey}:${config.shortcutCount}:${config.templates.join("|")}`} config={config} available={available} storageKey={storageKey} blocked={blocked} />
    {children}
    <ExplorePeebeeCard />
  </div>;
}

/** Only the artwork resets if Admin removes a destination; order/payment components stay mounted. */
function HomeArtwork({ config, available, storageKey, blocked }: { config: HomeTemplatesSettings; available: HomeShortcut[]; storageKey: string; blocked: boolean }) {
  const availableKey = available.map((s) => s.id).join("|");
  const [selection, setSelection] = useState<HomeSelection>(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    return restoreHomeSelection(raw, config, available) ?? chooseHomeSelection(config, available);
  });
  const [paused, setPaused] = useState(() => { try { return sessionStorage.getItem(`${storageKey}:paused`) === "1"; } catch { return false; } });
  const lastInteraction = useRef(0);
  const pointerDown = useRef(false);
  const hovered = useRef(false);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(selection)); } catch { /* Private browsing still works. */ }
  }, [selection, storageKey]);

  const rotate = useEffectEvent(() => {
    const focused = document.activeElement;
    const overlay = blocked || isNavigationOverlayOpen()
      || document.documentElement.classList.contains("customer-menu-open")
      || Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some((node) => node.getClientRects().length > 0);
    if (!canRotateHome({ visible: document.visibilityState === "visible" && document.hasFocus(), paused, overlay,
      focused: !!focused && !!document.querySelector("main")?.contains(focused), pointerDown: pointerDown.current, hovered: hovered.current,
      now: Date.now(), lastInteraction: lastInteraction.current, quietSeconds: config.interactionPauseSeconds })) return false;
    setSelection((previous) => chooseHomeSelection(config, available, previous?.template));
    return true;
  });
  useEffect(() => {
    if (paused || !availableKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => { clearTimeout(timer); timer = setTimeout(() => {
      const changed = rotate();
      schedule(changed ? randomHomeInterval(config) : config.interactionPauseSeconds * 1000);
    }, delay); };
    const visible = () => { clearTimeout(timer); pointerDown.current = false; hovered.current = false; if (document.visibilityState === "visible") schedule(randomHomeInterval(config)); };
    const interact = () => { lastInteraction.current = Date.now(); };
    const down = () => { pointerDown.current = true; interact(); };
    const up = () => { pointerDown.current = false; interact(); };
    schedule(randomHomeInterval(config));
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointercancel", up, { passive: true });
    document.addEventListener("keydown", interact);
    window.addEventListener("scroll", interact, { passive: true });
    window.addEventListener("blur", up);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); document.removeEventListener("pointerdown", down); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); document.removeEventListener("keydown", interact); window.removeEventListener("scroll", interact); window.removeEventListener("blur", up); };
  }, [paused, availableKey, config.minIntervalSeconds, config.maxIntervalSeconds, config.interactionPauseSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  const template = HOME_TEMPLATES.find((t) => t.id === selection?.template) ?? HOME_TEMPLATES[0];
  const shortcuts = (selection?.shortcuts ?? []).flatMap((id) => { const s = available.find((entry) => entry.id === id); return s ? [s] : []; });
  function pause() {
    const next = !paused; setPaused(next);
    try { sessionStorage.setItem(`${storageKey}:paused`, next ? "1" : "0"); } catch { /* Storage is optional. */ }
  }
  return <>
    <div className="dh-controls"><span className="text-xs text-ink-500">A little help for your day</span><button type="button" aria-pressed={paused} onClick={pause} className="dh-pause">{paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}{paused ? "Resume changes" : "Pause changes"}</button></div>
    {available.length === 0 ? <section className="dh-empty"><h2>Nothing to show here just yet</h2><p>The main menu still takes you to available services.</p><Link href="/help">Get help <ArrowRight size={16} aria-hidden /></Link></section> :
      <section className={`dh-art dh-${template.id}`} data-home-template={template.id} aria-label={template.name}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") hovered.current = true; }} onPointerLeave={() => { hovered.current = false; lastInteraction.current = Date.now(); }}>
        <span className="dh-object" aria-hidden />
        <h2>{template.title}</h2>
        {template.id === "08" && <p className="dh-intro">Choose what you need to get started</p>}
        {template.id === "11" && <p className="dh-intro">Pick a note to begin.</p>}
        <ul className="dh-options">{shortcuts.map((shortcut, index) => {
          const Icon = ICONS[shortcut.icon];
          return <li key={shortcut.id} className="dh-option"><Link href={shortcut.href} prefetch={false} data-module={shortcut.module}>
            <span className="dh-number" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
            <span className="dh-icon"><Icon strokeWidth={1.6} aria-hidden /></span>
            <span className="dh-copy"><span className="dh-label">{shortcut.label}</span><span className="dh-description">{shortcut.description}</span></span>
            <ArrowRight className="dh-arrow" size={20} aria-hidden />
          </Link></li>;
        })}</ul>
      </section>}
  </>;
}
