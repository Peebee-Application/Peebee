import { MODULE_NOTICE_REASONS, type ModuleNotice } from "./modules.js";

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
 * CSS for the screens that refer to a switched-off module, as Admin chose. "hide" removes every trace: each link into its
 * screens, the list item or card it sits in, and anything an app tagged `data-module="<key>"` (a sentence, a button that
 * is not a link). "inactive" keeps all of that where it is, greyed out and not tappable. Either way, only a direct visit
 * to one of the module's own pages (a saved or shared link) shows the "Currently Offline" notice, and an app's home path
 * (an `exact` rule) is never touched.
 */
export function hiddenLinksCss(rules: readonly ModuleRouteRule[], isOn: (module: string) => boolean, tagged: readonly string[] = [], display: "hide" | "inactive" = "hide"): string {
  const off = rules.filter((r) => !r.exact && r.prefix !== "/" && !isOn(r.module));
  const links = off.flatMap((r) => [`a[href="${r.prefix}"]`, `a[href^="${r.prefix}/"]`, `a[href^="${r.prefix}?"]`]);
  const marked = [...new Set([...off.map((r) => r.module), ...tagged.filter((m) => !isOn(m))])].map((m) => `[data-module="${m}"]`);
  if (display === "inactive") {
    const all = [...links, ...marked];
    return all.length ? `${all.join(",")}{pointer-events:none!important;cursor:not-allowed!important;opacity:.4!important;filter:grayscale(1)!important}` : "";
  }
  return [...links.flatMap((sel) => [sel, `li:has(>${sel})`]), ...marked].map((sel) => `${sel}{display:none!important}`).join("");
}

/** The selectors of links into switched-off modules' screens, so a greyed-out link can also be kept out of the keyboard's reach. */
export function offlineLinkSelectors(rules: readonly ModuleRouteRule[], isOn: (module: string) => boolean): string[] {
  return rules
    .filter((r) => !r.exact && r.prefix !== "/" && !isOn(r.module))
    .flatMap((r) => [`a[href="${r.prefix}"]`, `a[href^="${r.prefix}/"]`, `a[href^="${r.prefix}?"]`]);
}
