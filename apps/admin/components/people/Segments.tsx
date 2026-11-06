"use client";

import { Bike, Briefcase, ChevronRight, Clapperboard, Clock, GraduationCap, Store, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { adminRequest, requestErrorMessage } from "../../lib/admin-request";
import { Accordion } from "../Accordion";

export type Segment = {
  key: string; group: string; label: string; what: string; href: string | null; notReady: boolean; failed: boolean;
  total: number | null; active: number | null; fresh: number | null; pending: number | null; now: number | null;
};
type Loaded = { environment: string; groups: { id: string; label: string }[]; segments: Segment[] };

const ICON: Record<string, LucideIcon> = { customers: Users, learn: GraduationCap, creators: Clapperboard, merchants: Store, riders: Bike, hive: Briefcase };
const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-UG"));
const pct = (a: number | null, t: number | null) => (a == null || !t ? null : Math.min(100, Math.round((a / t) * 100)));

/** How much of a segment was active this month, as a thin bar. */
function Share({ active, total }: { active: number | null; total: number | null }) {
  const p = pct(active, total);
  if (p == null) return <span className="text-ink-500">—</span>;
  return (
    <span className="flex items-center gap-2" title={`${p}% active in the last 30 days`}>
      <span className="h-2 w-16 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]" aria-hidden><span className="block h-full rounded-full bg-gold" style={{ width: `${p}%` }} /></span>
      <span className="w-9 text-right text-sm font-bold tabular-nums text-ink">{p}%</span>
    </span>
  );
}

function Kpi({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <>
      <p className="text-sm font-semibold text-ink-500">{label}</p>
      <p className="mt-1 text-3xl font-extrabold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-ink-500">{sub}</p>}
    </>
  );
  return href ? <Link href={href} className="home-card block !p-4 transition hover:border-gold/60">{body}</Link> : <div className="home-card !p-4">{body}</div>;
}

/**
 * Every kind of user, grouped by audience. On a phone each audience is a section of tappable cards; on a desktop it is a
 * dense table (segment, total, activity bar, new, waiting) so a screen shows a whole audience at once.
 */
export function Segments() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminRequest<Loaded>("/admin/platform/segments").then(setData).catch((err) => setError(requestErrorMessage(err)));
  }, []);

  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (!data) return <div className="py-6 text-base text-ink-500">Loading…</div>;

  const seg = (k: string) => data.segments.find((s) => s.key === k);
  const waiting = data.segments.reduce((sum, s) => sum + (s.pending ?? 0), 0);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Customers" value={n(seg("customers")?.total)} sub={`${n(seg("customers")?.active)} active this month`} />
        <Kpi label="Students" value={n(seg("students")?.total)} sub={`${n(seg("students")?.active)} learning this month`} />
        <Kpi label="Creators" value={n(seg("creators")?.total)} sub={`${n(seg("creators")?.active)} posted this month`} />
        <Kpi label="Riders online" value={n(seg("boda_riders")?.now)} sub={`of ${n(seg("boda_riders")?.total)} boda riders`} />
        <div className="col-span-2 lg:col-span-1">
          <Kpi label="Waiting for approval" value={n(waiting)} sub="across every kind" href="/people/types" />
        </div>
      </section>

      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0 2xl:grid-cols-3">
        {data.groups.map((g) => {
          const rows = data.segments.filter((s) => s.group === g.id);
          const Icon = ICON[g.id] ?? Users;
          const pending = rows.reduce((sum, s) => sum + (s.pending ?? 0), 0);
          return (
            <div key={g.id}>
              {/* Phone: one collapsible section per audience, each segment a card. */}
              <div className="lg:hidden">
                <Accordion title={g.label} icon={Icon} summary={pending > 0 ? `${pending} waiting` : `${rows.length}`} defaultOpen={g.id === "customers"}>
                  <ul className="space-y-3">
                    {rows.map((s) => <SegmentCard key={s.key} s={s} />)}
                  </ul>
                </Accordion>
              </div>

              {/* Desktop: one table per audience. */}
              <section className="home-card hidden !p-0 lg:block">
                <header className="flex items-center gap-3 border-b border-[var(--border-faint)] px-5 py-4">
                  <Icon className="h-5 w-5 text-gold" aria-hidden />
                  <h2 className="flex-1 text-lg font-extrabold text-ink">{g.label}</h2>
                  {pending > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-gold/25 px-2.5 py-0.5 text-sm font-bold text-ink"><Clock className="h-4 w-4" aria-hidden />{pending} waiting</span>}
                </header>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs font-bold uppercase tracking-wide text-ink-500">
                      <th className="px-5 py-2.5 font-bold">Segment</th>
                      <th className="px-2 py-2.5 text-right font-bold">Total</th>
                      <th className="whitespace-nowrap px-2 py-2.5 font-bold">Active 30d</th>
                      <th className="px-2 py-2.5 text-right font-bold">New</th>
                      <th className="px-5 py-2.5 text-right font-bold">Waiting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-faint)]">
                    {rows.map((s) => <SegmentRow key={s.key} s={s} />)}
                  </tbody>
                </table>
              </section>
            </div>
          );
        })}
      </div>
      {data.segments.some((s) => s.failed || s.notReady) && (
        <p className="text-sm text-ink-500">A dash means that figure isn&apos;t available yet. Showing {data.environment} data.</p>
      )}
    </div>
  );
}

function SegmentCard({ s }: { s: Segment }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold text-ink">{s.label}</span>
        <span className="mt-0.5 block text-sm text-ink-500">{s.what}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-ink-500">
          {s.active != null && <Share active={s.active} total={s.total} />}
          {s.fresh != null && <span>+{n(s.fresh)} new</span>}
          {s.now != null && <span>{n(s.now)} online now</span>}
          {s.pending != null && s.pending > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-gold/25 px-2.5 py-0.5 text-ink"><Clock className="h-4 w-4" aria-hidden />{n(s.pending)} waiting</span>}
        </span>
      </span>
      <span className="shrink-0 text-3xl font-extrabold tabular-nums text-ink">{n(s.total)}</span>
      {s.href && <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" aria-hidden />}
    </>
  );
  const cls = "flex min-h-16 items-center gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 py-3";
  return <li>{s.href ? <Link href={s.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

function SegmentRow({ s }: { s: Segment }) {
  const label = (
    <span className="block">
      <span className="block text-[15px] font-bold text-ink">{s.label}</span>
      <span className="block text-xs text-ink-500">{s.what}</span>
    </span>
  );
  return (
    <tr className="group align-middle transition hover:bg-[rgb(var(--surface-muted))]">
      <td className="px-5 py-3">{s.href ? <Link href={s.href} className="block">{label}</Link> : label}</td>
      <td className="px-2 py-3 text-right text-lg font-extrabold tabular-nums text-ink">{n(s.total)}</td>
      <td className="px-2 py-3"><Share active={s.active} total={s.total} /></td>
      <td className="px-2 py-3 text-right text-sm font-semibold tabular-nums text-ink-500">{s.fresh == null ? "—" : `+${n(s.fresh)}`}</td>
      <td className="px-5 py-3 text-right text-sm font-bold tabular-nums">{s.pending ? <span className="rounded-full bg-gold/25 px-2.5 py-0.5 text-ink">{n(s.pending)}</span> : <span className="text-ink-500">—</span>}</td>
    </tr>
  );
}
