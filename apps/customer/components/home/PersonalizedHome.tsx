"use client";
import { availableHomeShortcuts, isModuleOn, isPracticeMode, resolveHomeMenu, type DeliverySettings, type HomeHistoryEntry, type HomeTemplatesSettings, type LearnEnrollment } from "@peebee/shared";
import { BookOpen, BriefcaseBusiness, Building2, Check, ChevronRight, CloudOff, MoreHorizontal, Route, ShoppingBag, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useSpecialCarServices } from "../../lib/special-car";
import { useTaxipress } from "../../lib/taxipress";
import { useHireAvailability } from "../../lib/home-menu";
import { EMPTY_HOME_PREFERENCES, HOME_INTERESTS, homeSuggestions, parseHomePreferences, type HomePreferences, type HomeSuggestion } from "../../lib/personalized-home";
import { BottomDrawer } from "../BottomDrawer";
import { HomeClock } from "./HomeClock";
import { homeFont } from "./home-font";
import { ExplorePeebeeCard, HomeLaunch } from "./HomeScreensaver";

const SERVICES = [
  { id: "ride", label: "Ride", href: "/ride", module: "ride", Icon: Route },
  { id: "buy", label: "Buy", href: "/shopping", module: "buy", Icon: ShoppingBag },
  { id: "eat", label: "Eat", href: "/food", module: "buy.food", Icon: UtensilsCrossed },
  { id: "learn", label: "Learn", href: "/learn", module: "learn", Icon: BookOpen },
  { id: "work", label: "Work", href: "/services", module: "hive", Icon: BriefcaseBusiness },
] as const;
const INTEREST_LABELS = { ride: "Ride", buy: "Shopping", eat: "Food", work: "Help at home", learn: "Learning" };

function SuggestionCard({ suggestion, onOptions }: { suggestion: HomeSuggestion; onOptions: () => void }) {
  return <section className="ph-hero" aria-label="Suggested next move">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/home-screensaver/${suggestion.image}.webp`} alt="" fetchPriority="high" />
    <div className="ph-hero-shade" />
    <button type="button" aria-label="Suggestion preferences" className="ph-hero-options" onClick={onOptions}><MoreHorizontal size={26} aria-hidden /></button>
    <div className="ph-hero-copy"><h2>{suggestion.title}</h2><p className="ph-hero-detail">{suggestion.detail}</p><p className="ph-hero-reason">{suggestion.reason}</p></div>
    <Link className="ph-primary" href={suggestion.href}>{suggestion.action}</Link>
  </section>;
}

export function PersonalizedHome({ settings, config, urgent, children }: { settings: DeliverySettings; config: HomeTemplatesSettings; urgent: ReactNode; children: ReactNode }) {
  const { user } = useAuth();
  const rules = config.personalization;
  const special = useSpecialCarServices(), taxi = useTaxipress(), hire = useHireAvailability();
  const menu = resolveHomeMenu(settings.homeMenu);
  const world = isPracticeMode() ? "practice" : "live";
  const on = useCallback((key: string) => isModuleOn(key, world, settings.modules?.available), [world, settings.modules?.available]);
  const available = availableHomeShortcuts(config, { on, special, taxipress: taxi.enabled, hire, hive: menu.hive.shortcuts });
  const key = `peebee:home-preferences:${world}:${user?.id ?? "guest"}`;
  const subscribePreferences = useCallback((notify: () => void) => {
    window.addEventListener("storage", notify); window.addEventListener("peebee:home-preferences", notify);
    return () => { window.removeEventListener("storage", notify); window.removeEventListener("peebee:home-preferences", notify); };
  }, []);
  const readPreferences = useCallback(() => { try { return localStorage.getItem(key) || "{}"; } catch { return "{}"; } }, [key]);
  const rawPreferences = useSyncExternalStore(subscribePreferences, readPreferences, () => "");
  const [volatilePreferences, setVolatilePreferences] = useState<HomePreferences | null>(null);
  const preferences = useMemo(() => volatilePreferences ?? parseHomePreferences(rawPreferences), [rawPreferences, volatilePreferences]);
  const preferencesReady = rawPreferences !== "";
  const [history, setHistory] = useState<HomeHistoryEntry[]>([]);
  const [enrollments, setEnrollments] = useState<LearnEnrollment[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [sheet, setSheet] = useState(false);
  const [contextError, setContextError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [closedRestaurants, setClosedRestaurants] = useState<string[]>([]);
  const [checkedRestaurants, setCheckedRestaurants] = useState<string[]>([]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    update(); const timer = setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    let active = true;
    if (!preferencesReady) return;
    if (!user || !rules.historyEnabled || !preferences.enabled) return;
    Promise.allSettled([api.getHomeContext(), on("learn") && rules.learningSuggestions ? api.learnEnrollments() : Promise.resolve({ enrollments: [] })]).then(([orders, courses]) => {
      if (!active) return;
      setHistory(orders.status === "fulfilled" ? orders.value.history : []);
      setEnrollments(courses.status === "fulfilled" ? courses.value.enrollments : []);
      setContextError(orders.status === "rejected"); setLoading(false);
    });
    return () => { active = false; };
  }, [key, user, preferencesReady, rules.historyEnabled, rules.learningSuggestions, preferences.enabled, on, reload]);
  const suggestions = useMemo(() => now ? homeSuggestions({ now, rules, available, history, enrollments, preferences }) : [], [now, rules, available, history, enrollments, preferences]);
  // Do not advertise a closed/suspended historical restaurant. Until checked, use a general food suggestion.
  const restaurantId = suggestions.find(s => s.id.startsWith("restaurant:"))?.id.slice("restaurant:".length);
  useEffect(() => {
    if (!restaurantId || checkedRestaurants.includes(restaurantId)) return;
    let active = true;
    api.getRestaurant(restaurantId).then(({ restaurant }) => {
      if (active && (restaurant.status !== "active" || !restaurant.is_open)) setClosedRestaurants(v => [...v, restaurantId]);
    }).catch(() => { if (active) setClosedRestaurants(v => [...v, restaurantId]); }).finally(() => { if (active) setCheckedRestaurants(v => [...v, restaurantId]); });
    return () => { active = false; };
  }, [restaurantId, checkedRestaurants]);
  const suggestion = suggestions.find(s => !s.id.startsWith("restaurant:") || (checkedRestaurants.includes(s.id.slice(11)) && !closedRestaurants.includes(s.id.slice(11))));
  function save(next: HomePreferences) {
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { setVolatilePreferences(next); }
    window.dispatchEvent(new Event("peebee:home-preferences"));
  }
  const services = SERVICES.filter(s => on(s.module));
  return <HomeLaunch startClosed><div className={`ph-home ${homeFont.className}`}>
    <HomeClock rules={rules} name={user?.name?.trim().split(/\s+/)[0]} />
    {urgent}
    {!now ? <div className="ph-skeleton ph-hero-skeleton" aria-label="Loading suggestions" /> : suggestion ? <SuggestionCard suggestion={suggestion} onOptions={() => setSheet(true)} /> : <section className="ph-empty"><BookOpen size={36} aria-hidden /><h2>Make today your own</h2><button type="button" className="ph-secondary" onClick={() => setSheet(true)}>Your preferences</button></section>}
    {contextError && rules.historyEnabled && preferences.enabled && <div className="ph-context-error"><CloudOff size={20} aria-hidden /><span>Personal suggestions couldn’t load.</span><button type="button" onClick={() => { setLoading(true); setReload(v => v + 1); }}>Try again</button></div>}
    <section className="ph-services"><div className="ph-section-heading"><h2>Explore Peebee</h2><button type="button" aria-label="Personalize Home" onClick={() => setSheet(true)}><MoreHorizontal size={24} aria-hidden /></button></div>
      <div className="ph-service-grid">{services.map(({ id, label, href, Icon }) => <Link key={id} href={href}><span className="ph-icon-chip"><Icon size={28} strokeWidth={2} aria-hidden /></span><span>{id === "buy" ? menu.clusters.shopping.label : id === "eat" ? menu.clusters.food.label : id === "work" ? menu.clusters.hive.label : menu.clusters[id].label || label}</span></Link>)}
        {menu.navigation.spacesEnabled && <Link href="/spaces"><span className="ph-icon-chip"><Building2 size={28} strokeWidth={2} aria-hidden /></span><span>{menu.navigation.spacesLabel}</span></Link>}
      </div>
    </section>
    {loading && rules.historyEnabled && preferences.enabled && <span className="sr-only" role="status">Loading your recent activity</span>}
    {children}
    <ExplorePeebeeCard timing={config} />
    {on("channels") && <section><h2 className="ph-section-title">Discover something new</h2><Link className="ph-stream-row" href="/spotlight"><BookOpen size={24} aria-hidden /><span>Watch Stream</span><ChevronRight size={24} aria-hidden /></Link></section>}
    <BottomDrawer isOpen={sheet} onClose={() => setSheet(false)} title="Your home" className="ph-preferences">
      <label className="ph-preference-row"><span>Use my activity</span><input type="checkbox" checked={preferences.enabled} onChange={e => save({ ...preferences, enabled: e.target.checked })} /></label>
      <p>Suggestions use completed activity and interests you choose.</p>
      <h3>What do you enjoy?</h3>
      {HOME_INTERESTS.map(interest => <button className="ph-preference-row" type="button" key={interest} aria-pressed={preferences.interests.includes(interest)} onClick={() => save({ ...preferences, interests: preferences.interests.includes(interest) ? preferences.interests.filter(i => i !== interest) : [...preferences.interests, interest] })}><span>{INTEREST_LABELS[interest]}</span>{preferences.interests.includes(interest) && <Check size={24} className="text-gold" aria-hidden />}</button>)}
      {suggestion && <button className="ph-secondary" type="button" onClick={() => { save({ ...preferences, hidden: [...preferences.hidden, suggestion.id] }); setSheet(false); }}>Hide this suggestion</button>}
      {preferences.hidden.length > 0 && <button type="button" className="ph-secondary" onClick={() => save({ ...preferences, hidden: [] })}>Restore hidden suggestions</button>}
      <button type="button" className="ph-primary" onClick={() => setSheet(false)}>Done</button>
    </BottomDrawer>
  </div></HomeLaunch>;
}
