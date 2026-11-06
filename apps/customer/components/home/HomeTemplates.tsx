"use client";

import { HOME_TEMPLATES, availableHomeShortcuts, isModuleOn, isPracticeMode, randomHomeInterval, resolveHomeMenu, resolveHomeTemplates, type DeliverySettings, type HomeShortcut, type HomeTemplatesSettings } from "@peebee/shared";
import { ArrowRight } from "lucide-react";
import { HomeTemplateArtwork } from "@peebee/shared/home-artwork";
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
import { ExplorePeebeeCard, HomeLaunch } from "./HomeScreensaver";
import "@peebee/shared/home-artwork.css";

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
  return <HomeLaunch startClosed><div className="dh space-y-5 px-4 pb-6 pt-4">
    <Greeting compact />
    <HomeArtwork key={`${storageKey}:${availableKey}:${config.shortcutCount}:${config.templates.join("|")}`} config={config} available={available} storageKey={storageKey} blocked={blocked} />
    {children}
    <ExplorePeebeeCard timing={config} />
  </div></HomeLaunch>;
}

/** Only the artwork resets if Admin removes a destination; order/payment components stay mounted. */
function HomeArtwork({ config, available, storageKey, blocked }: { config: HomeTemplatesSettings; available: HomeShortcut[]; storageKey: string; blocked: boolean }) {
  const availableKey = available.map((s) => s.id).join("|");
  const [selection, setSelection] = useState<HomeSelection>(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    return restoreHomeSelection(raw, config, available) ?? chooseHomeSelection(config, available);
  });
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
    if (!canRotateHome({ visible: document.visibilityState === "visible" && document.hasFocus(), paused: false, overlay,
      focused: !!focused && !!document.querySelector("main")?.contains(focused), pointerDown: pointerDown.current, hovered: hovered.current,
      now: Date.now(), lastInteraction: lastInteraction.current, quietSeconds: config.interactionPauseSeconds })) return false;
    setSelection((previous) => chooseHomeSelection(config, available, previous?.template));
    return true;
  });
  useEffect(() => {
    if (!availableKey) return;
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
  }, [availableKey, config.minIntervalSeconds, config.maxIntervalSeconds, config.interactionPauseSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  const template = HOME_TEMPLATES.find((t) => t.id === selection?.template) ?? HOME_TEMPLATES[0];
  const shortcuts = (selection?.shortcuts ?? []).flatMap((id) => { const s = available.find((entry) => entry.id === id); return s ? [s] : []; });
  return <>
    {available.length === 0 ? <section className="dh-empty"><h2>Nothing to show here just yet</h2><p>The main menu still takes you to available services.</p><Link href="/help">Get help <ArrowRight size={16} aria-hidden /></Link></section> :
      <HomeTemplateArtwork templateId={template.id} shortcuts={shortcuts}
        renderLink={(shortcut, content) => <Link href={shortcut.href} prefetch={false} className="dh-shortcut" data-module={shortcut.module}>{content}</Link>}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") hovered.current = true; }}
        onPointerLeave={() => { hovered.current = false; lastInteraction.current = Date.now(); }} />}
  </>;
}
