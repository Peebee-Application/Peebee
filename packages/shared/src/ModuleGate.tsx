"use client";

import { useEffect, type ReactNode } from "react";
import { OFFLINE_HEADLINE, describeModuleNotice, inactiveLinksCss, moduleForPath, offlineLinkSelectors, offlineRoots, type ModuleRouteRule } from "./module-routes.js";
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

/**
 * The notice on an app's home screen when some of what it links to is off: one card per switched-off module (Buy, not
 * each thing inside Buy) saying "Currently Offline", with Admin's reason, message and date. Those links stay where they
 * are, inactive.
 */
export function ModuleOfflineBanner({ rules, modules }: { rules: readonly ModuleRouteRule[]; modules: ModulesView }) {
  const roots = offlineRoots(rules, modules);
  if (!roots.length) return null;
  return (
    <section role="status" aria-label={OFFLINE_HEADLINE} style={{ margin: "12px 16px", display: "grid", gap: 8 }}>
      {roots.map((root) => {
        const notice = modules.notice(root.module);
        const { dateLine, message } = describeModuleNotice(notice);
        const reason = reasonLine(notice);
        return (
          <div key={root.module} style={{ padding: "12px 16px", borderRadius: 16, background: "rgb(var(--surface-card))", border: "1px solid var(--border-faint)", color: "rgb(var(--color-ink))" }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgb(var(--color-gold))" }}>{root.title}</p>
            <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700 }}>{OFFLINE_HEADLINE}{reason ? ` · ${reason}` : ""}</p>
            {message && <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.45, color: "rgb(var(--color-ink-500))" }}>{message}</p>}
            {dateLine && <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 700 }}>{dateLine}</p>}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Makes links into a switched-off module truly inactive: greyed out by CSS, announced as disabled, out of the tab
 * order, and a tap, click or Enter on one goes nowhere. It acts on whatever is on the page, including cards and tabs
 * that appear later, so it covers lists nobody wrote a check for.
 */
function ModuleLinkGuard({ rules, modules }: { rules: readonly ModuleRouteRule[]; modules: ModulesView }) {
  const selector = offlineLinkSelectors(rules, modules).join(",");
  useEffect(() => {
    if (!selector) return;
    const mark = () => document.querySelectorAll<HTMLElement>(selector).forEach((el) => { el.setAttribute("aria-disabled", "true"); el.setAttribute("tabindex", "-1"); });
    mark();
    let frame = 0;
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(mark); });
    observer.observe(document.body, { childList: true, subtree: true });
    const block = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest(selector) : null;
      if (link) { event.preventDefault(); event.stopPropagation(); }
    };
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
 * Shows the page, or the notice in its place when the module that owns this path is off. Everything else that links into
 * an offline module is inactive, and the app's home (`/`) says "Currently Offline" for each module that is off. Paths no
 * rule names always show.
 */
export function ModuleRouteGate({ rules, pathname, modules, children }: { rules: readonly ModuleRouteRule[]; pathname: string; modules: ModulesView; children: ReactNode }) {
  const rule = moduleForPath(pathname, rules);
  const css = inactiveLinksCss(rules, modules);
  const extras = <>{css ? <style>{css}</style> : null}<ModuleLinkGuard rules={rules} modules={modules} /></>;
  if (rule && !modules(rule.module)) return <>{extras}<ModuleNoticeScreen title={rule.title} modules={modules} moduleKey={rule.module} /></>;
  return <>{extras}{pathname === "/" && <ModuleOfflineBanner rules={rules} modules={modules} />}{children}</>;
}
