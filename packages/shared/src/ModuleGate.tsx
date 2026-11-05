"use client";

import { useEffect, type ReactNode } from "react";
import { MODULE_KEYS } from "./modules.js";
import { OFFLINE_HEADLINE, describeModuleNotice, hiddenLinksCss, moduleForPath, offlineLinkSelectors, type ModuleRouteRule } from "./module-routes.js";
import type { ModulesView } from "./use-modules.js";

/** The reason's own wording ("Back soon", "Coming soon") as a second line; a plain "not available" adds nothing to "Currently Offline". */
function reasonLine(notice: ReturnType<ModulesView["notice"]>): string | null {
  return notice.reason === "unavailable" ? null : describeModuleNotice(notice).headline;
}

/**
 * The one full-screen notice for a screen whose module is switched off in Admin → Services. It always says "Currently
 * Offline"; Admin's reason, message and date follow. Styled with the apps' own colour tokens, inline, because the apps'
 * Tailwind builds do not scan this package.
 */
export function ModuleNoticeScreen({ title, modules, moduleKey }: { title: string; modules: ModulesView; moduleKey: string }) {
  const notice = modules.notice(moduleKey);
  const { dateLine, message } = describeModuleNotice(notice);
  const reason = reasonLine(notice);
  return (
    <section role="status" style={{ display: "flex", minHeight: "60dvh", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380, textAlign: "center", padding: "32px 24px", borderRadius: 24, background: "rgb(var(--surface-card))", border: "1px solid var(--border-faint)", color: "rgb(var(--color-ink))" }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgb(var(--color-gold))" }}>{title}</p>
        <h1 style={{ margin: "10px 0 0", fontSize: 24, fontWeight: 700 }}>{OFFLINE_HEADLINE}</h1>
        {reason && <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 700 }}>{reason}</p>}
        {message && <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.5, color: "rgb(var(--color-ink-500))" }}>{message}</p>}
        {dateLine && <p style={{ margin: "12px 0 0", fontSize: 14, fontWeight: 700 }}>{dateLine}</p>}
      </div>
    </section>
  );
}

/** When switched-off modules are greyed out rather than hidden: keeps their links out of the tab order and stops a keyboard Enter or a tap from following one. */
function ModuleLinkGuard({ rules, modules }: { rules: readonly ModuleRouteRule[]; modules: ModulesView }) {
  const selector = modules.display === "inactive" ? offlineLinkSelectors(rules, modules).join(",") : "";
  useEffect(() => {
    if (!selector) return;
    const mark = () => document.querySelectorAll<HTMLElement>(selector).forEach((el) => { el.setAttribute("aria-disabled", "true"); el.setAttribute("tabindex", "-1"); });
    mark();
    let frame = 0;
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(mark); });
    observer.observe(document.body, { childList: true, subtree: true });
    const block = (event: Event) => { if (event.target instanceof Element && event.target.closest(selector)) { event.preventDefault(); event.stopPropagation(); } };
    document.addEventListener("click", block, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", block, true);
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => { el.removeAttribute("aria-disabled"); el.removeAttribute("tabindex"); });
    };
  }, [selector]);
  return null;
}

/**
 * Shows the page, or "Currently Offline" in its place when the module that owns this path is off (someone opened a saved
 * or shared link). Everything else that refers to a switched-off module is hidden or greyed out as Admin chose, by
 * `hiddenLinksCss`, and each app also treats its own lists the same way. Paths no rule names always show.
 */
export function ModuleRouteGate({ rules, pathname, modules, children }: { rules: readonly ModuleRouteRule[]; pathname: string; modules: ModulesView; children: ReactNode }) {
  const rule = moduleForPath(pathname, rules);
  const css = hiddenLinksCss(rules, modules, MODULE_KEYS, modules.display);
  const extras = <>{css ? <style>{css}</style> : null}<ModuleLinkGuard rules={rules} modules={modules} /></>;
  if (rule && !modules(rule.module)) return <>{extras}<ModuleNoticeScreen title={rule.title} modules={modules} moduleKey={rule.module} /></>;
  return <>{extras}{children}</>;
}
