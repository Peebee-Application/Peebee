"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useWebModules, type ModuleNotice as Notice } from "../lib/web-modules";

const HEADLINE: Record<Notice["reason"], { kicker: string; headline: string; date: string }> = {
  coming_soon: { kicker: "Coming soon", headline: "Coming soon", date: "Launching" },
  maintenance: { kicker: "Back soon", headline: "Back soon", date: "Expected back" },
  unavailable: { kicker: "Not available", headline: "Not available right now", date: "Expected" },
};

function when(value: string | undefined): string {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
}

/** What a page shows when the module behind it is switched off in Admin: the reason, Admin's message and the date. */
export function ModuleNoticePage({ name, notice }: { name: string; notice: Notice }) {
  const text = HEADLINE[notice.reason];
  const date = when(notice.returnAt);
  return (
    <div className="plain wrap" role="status">
      <p className="kicker">{text.kicker}</p>
      <h1 className="display">{name}: currently offline.</h1>
      {notice.reason !== "unavailable" && <p className="lead"><b>{text.headline}</b></p>}
      {notice.message && <p className="lead">{notice.message}</p>}
      {date && <p className="lead">{text.date}: {date}</p>}
      <Link href="/" className="btn btn-gold">Back to Peebee</Link>
    </div>
  );
}

/** Shows its children while the module is on, and the notice while it is off. */
export function ModuleGate({ module, name, children }: { module: string; name: string; children: ReactNode }) {
  const modules = useWebModules();
  if (modules.on(module)) return <>{children}</>;
  return <ModuleNoticePage name={name} notice={modules.notice(module)} />;
}

/** Shows its children only while the module is on (a link or tile that should disappear, with no notice). */
export function ModuleShow({ module, children }: { module: string | null; children: ReactNode }) {
  const modules = useWebModules();
  return !module || modules.on(module) ? <>{children}</> : null;
}
