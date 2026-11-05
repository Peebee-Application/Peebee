import { MODULE_NOTICE_REASONS, getModule, type ModuleNotice } from "./modules.js";

/**
 * Which screens belong to which module, per app. `prefix` matches that path and everything under it; `exact` matches only
 * that path (an app's home). The longest matching rule wins, so `/ride/car` beats `/ride`.
 */
export type ModuleRouteRule = { prefix: string; module: string; title: string; exact?: boolean };

export function moduleForPath(pathname: string, rules: readonly ModuleRouteRule[]): ModuleRouteRule | null {
  let best: ModuleRouteRule | null = null;
  for (const rule of rules) {
    const hit = rule.exact ? pathname === rule.prefix : pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`);
    if (hit && (!best || rule.prefix.length > best.prefix.length)) best = rule;
  }
  return best;
}

/** What a notice says, in words: the reason's headline, the date line if there is a date, and Admin's own message. */
export function describeModuleNotice(notice: ModuleNotice): { headline: string; dateLine: string | null; message: string | null } {
  const reason = MODULE_NOTICE_REASONS.find((r) => r.id === notice.reason) ?? MODULE_NOTICE_REASONS[2]!;
  let dateLine: string | null = null;
  if (notice.returnAt) {
    const when = new Date(notice.returnAt);
    if (Number.isFinite(when.getTime())) {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(notice.returnAt);
      const day = when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
      const time = dateOnly ? "" : ` at ${when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
      dateLine = `${reason.dateLabel} ${day}${time}`;
    }
  }
  return { headline: reason.headline, dateLine, message: notice.message ?? null };
}

/** What every offline notice is headed with, whatever Admin's reason: the same plain words in every app. */
export const OFFLINE_HEADLINE = "Currently Offline";

/**
 * The highest switched-off module above each rule's module, once each, in rule order. Buy off reads as "Buy", not as
 * Shopping, Stores, Pharmacy and Food one by one. Admin's notice for that module is what people are shown.
 */
export function offlineRoots(rules: readonly ModuleRouteRule[], isOn: (module: string) => boolean): { module: string; title: string }[] {
  const seen = new Set<string>();
  const out: { module: string; title: string }[] = [];
  for (const rule of rules) {
    if (isOn(rule.module)) continue;
    let top = getModule(rule.module);
    for (let up = top?.parent ? getModule(top.parent) : undefined; top && up && !isOn(up.key); up = up.parent ? getModule(up.parent) : undefined) top = up;
    const key = top?.key ?? rule.module;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ module: key, title: top?.label ?? rule.title });
  }
  return out;
}

/** The attribute selectors of every link into a switched-off module's screens (an app's `exact` home is never one). */
export function offlineLinkSelectors(rules: readonly ModuleRouteRule[], isOn: (module: string) => boolean): string[] {
  return rules
    .filter((r) => !r.exact && r.prefix !== "/" && !isOn(r.module))
    .flatMap((r) => [`a[href="${r.prefix}"]`, `a[href^="${r.prefix}/"]`, `a[href^="${r.prefix}?"]`]);
}

/**
 * CSS that greys out every link into the screens of a switched-off module, and cannot be tapped. Nothing is removed: the
 * card, tab or menu entry stays where people expect it, but inactive. This is the catch-all behind each app's own
 * lists, so whatever links to a module that is off is inactive even where nobody wrote a check for it.
 */
export function inactiveLinksCss(rules: readonly ModuleRouteRule[], isOn: (module: string) => boolean): string {
  const selectors = offlineLinkSelectors(rules, isOn);
  if (!selectors.length) return "";
  return `${selectors.join(",")}{pointer-events:none!important;cursor:not-allowed!important;opacity:.4!important;filter:grayscale(1)!important}`;
}
