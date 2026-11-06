"use client";

import { ChevronRight, Clock, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Accordion } from "../../../components/Accordion";
import { adminRequest, requestErrorMessage } from "../../../lib/admin-request";

type Person = { key: string; group: string; label: string; what: string; href: string | null; reviewable?: boolean; total: number | null; last30: number | null; pending: number | null };
type Loaded = { groups: { id: string; label: string }[]; people: Person[] };

const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-UG"));

/** Every kind of person on Peebee, grouped by what they do, with how many there are and how many are waiting. */
export default function UserTypesPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminRequest<Loaded>("/admin/platform/people").then(setData).catch((err) => setError(requestErrorMessage(err)));
  }, []);

  if (error) return <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (!data) return <div className="p-4 text-base text-ink-500">Loading…</div>;

  const waiting = data.people.reduce((s, p) => s + (p.pending ?? 0), 0);

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <h1 className="text-2xl font-extrabold text-ink">Everyone on Peebee</h1>
      <section className="home-card !bg-black-700 text-white dark:!bg-black">
        <p className="text-sm font-semibold text-white/70">Waiting for approval</p>
        <p className="mt-1 text-4xl font-extrabold text-gold">{waiting.toLocaleString("en-UG")}</p>
        <p className="mt-1 text-sm text-white/70">Across {data.people.length} kinds of people. A dash means the figure isn&apos;t available yet.</p>
      </section>

      {data.groups.map((g) => {
        const rows = data.people.filter((p) => p.group === g.id);
        if (rows.length === 0) return null;
        const pending = rows.reduce((s, p) => s + (p.pending ?? 0), 0);
        return (
          <Accordion key={g.id} title={g.label} icon={UsersRound} defaultOpen={g.id === "customers" || pending > 0} summary={pending > 0 ? `${pending} waiting` : `${rows.length}`}>
            <ul className="space-y-3">
              {rows.map((p) => {
                const body = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-extrabold text-ink">{p.label}</span>
                      <span className="mt-0.5 block text-sm text-ink-500">{p.what}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {p.last30 != null && <span className="text-ink-500">+{n(p.last30)} in 30 days</span>}
                        {p.pending != null && p.pending > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-0.5 text-ink"><Clock className="h-4 w-4" aria-hidden />{n(p.pending)} waiting</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-3xl font-extrabold text-ink">{n(p.total)}</span>
                    {(p.reviewable || p.href) && <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" aria-hidden />}
                  </>
                );
                const cls = "flex min-h-16 items-center gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 py-3";
                return (
                  <li key={p.key}>
                    {p.reviewable ? <Link href={`/people/types/${p.key}`} className={cls}>{body}</Link> : p.href ? <Link href={p.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}
                  </li>
                );
              })}
            </ul>
          </Accordion>
        );
      })}
    </div>
  );
}
