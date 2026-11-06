"use client";

import { CheckCircle2, Clock, ExternalLink, PauseCircle, Search, ShieldAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TabBar } from "../../../../components/TabBar";
import { adminRequest, requestErrorMessage } from "../../../../lib/admin-request";
import { canReject, needsReason, performAction, type PersonAction, type ReviewKind } from "../../../../lib/people-actions";

type Item = { id: string; userId: string | null; name: string; phone: string | null; status: string; detail: string | null; createdAt: string | null };
type Loaded = {
  kind: ReviewKind; label: string; what: string; href: string | null; canManage: boolean; accountOnly?: boolean; notReady?: boolean;
  counts: Record<string, number>; items: Item[];
};
type Tab = "waiting" | "active" | "suspended" | "rejected";

const CHIP: Record<string, string> = {
  waiting: "bg-gold/25 text-ink", active: "bg-green/15 text-green", suspended: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300", rejected: "bg-[rgb(var(--surface-muted))] text-ink-500",
};
const CHIP_LABEL: Record<string, string> = { waiting: "Waiting", active: "Active", suspended: "Suspended", rejected: "Rejected" };

/** One kind of person: who is waiting, active or suspended, with the approve / suspend / reinstate actions that kind supports. */
export default function ReviewPage() {
  const { key } = useParams<{ key: string }>();
  const [tab, setTab] = useState<Tab>("waiting");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: PersonAction } | null>(null);
  const [reason, setReason] = useState("");
  const picked = useRef(false);

  const load = useCallback(() => {
    adminRequest<Loaded>(`/admin/platform/people/${encodeURIComponent(key)}/list?status=${tab}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`)
      .then((d) => {
        setData(d);
        setError(null);
        // Open on Waiting when someone is waiting; otherwise on Active.
        if (!picked.current) { picked.current = true; if (!(d.counts.waiting > 0)) setTab("active"); }
      })
      .catch((err) => setError(requestErrorMessage(err)));
  }, [key, tab, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function run(item: Item, action: PersonAction) {
    if (!data) return;
    if (needsReason(data.kind, action) && !reason.trim()) { setMessage("Give a short reason first."); return; }
    setBusyId(item.id);
    setMessage(null);
    try {
      await performAction(data.kind, key, item, action, reason.trim() || undefined);
      setConfirming(null);
      setReason("");
      setMessage(`${item.name}: ${action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "suspend" ? "suspended" : "reinstated"}.`);
      load();
    } catch (err) {
      setMessage(requestErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (!data) return <div className="p-4 text-base text-ink-500">Loading…</div>;

  const counts = data.counts;
  const tabs = [
    { id: "waiting" as Tab, label: "Waiting", icon: Clock, count: counts.waiting },
    { id: "active" as Tab, label: "Active", icon: CheckCircle2 },
    { id: "suspended" as Tab, label: "Suspended", icon: PauseCircle },
    ...((counts.rejected ?? 0) > 0 ? [{ id: "rejected" as Tab, label: "Rejected", icon: XCircle }] : []),
  ];

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <div>
        <Link href="/people/types" className="text-sm font-semibold text-ink-500">← Everyone on Peebee</Link>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{data.label}</h1>
        <p className="mt-1 text-base text-ink-500">{data.what}</p>
      </div>

      {data.notReady && <p className="rounded-2xl bg-[rgb(var(--surface-muted))] px-4 py-3 text-base text-ink-500">This area isn&apos;t set up on the live database yet, so there is nobody to show.</p>}
      {!data.canManage && <p className="rounded-2xl bg-[rgb(var(--surface-muted))] px-4 py-3 text-base text-ink-500">You can look but not change: your role doesn&apos;t include approving or suspending these.</p>}

      <TabBar label="Status" active={tab} onChange={setTab} tabs={tabs} />

      <label className="field-box flex min-h-14 items-center gap-3 rounded-2xl px-4">
        <Search className="h-5 w-5 shrink-0 text-ink-500" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" aria-label="Search name or phone" className="min-w-0 flex-1 text-lg" />
      </label>

      {message && <p role="status" className="rounded-2xl bg-gold/20 px-4 py-3 text-base font-semibold text-ink">{message}</p>}

      {data.items.length === 0 && <p className="py-8 text-center text-base text-ink-500">{tab === "waiting" ? "Nobody is waiting." : "Nobody here."}</p>}

      <ul className="space-y-3">
        {data.items.map((item) => {
          const busy = busyId === item.id;
          const open = confirming?.id === item.id ? confirming.action : null;
          return (
            <li key={item.id} className="home-card space-y-3 !p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-extrabold text-ink">{item.name}</p>
                  <p className="text-sm text-ink-500">{[item.phone, item.detail].filter(Boolean).join(" · ") || "No phone on file"}</p>
                  {item.createdAt && <p className="text-xs text-ink-500">Joined {item.createdAt.slice(0, 10)}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${CHIP[item.status] ?? CHIP.active}`}>{CHIP_LABEL[item.status] ?? item.status}</span>
              </div>

              {data.canManage && !open && (
                <div className="grid grid-cols-1 gap-2">
                  {(item.status === "waiting" || item.status === "suspended" || item.status === "rejected") && (
                    <button type="button" disabled={busy} onClick={() => run(item, item.status === "waiting" ? "approve" : "reinstate")} className="min-h-14 rounded-2xl bg-gold text-lg font-extrabold text-ink-gold disabled:opacity-60">
                      {busy ? "Working…" : item.status === "waiting" ? "Approve" : "Reinstate"}
                    </button>
                  )}
                  {item.status === "waiting" && canReject(data.kind) && (
                    <button type="button" disabled={busy} onClick={() => run(item, "reject")} className="min-h-14 rounded-2xl border border-[var(--border-faint)] text-lg font-bold text-ink disabled:opacity-60">Reject</button>
                  )}
                  {(item.status === "active" || item.status === "waiting") && (
                    <button type="button" disabled={busy} onClick={() => { setConfirming({ id: item.id, action: "suspend" }); setReason(""); setMessage(null); }} className="min-h-14 rounded-2xl border border-red-300 text-lg font-bold text-red-700 dark:text-red-300">Suspend</button>
                  )}
                </div>
              )}

              {open === "suspend" && (
                <div className="space-y-3 rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                  {data.accountOnly && (
                    <p className="flex items-start gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                      This suspends the whole account, not just the {item.detail?.toLowerCase() ?? "role"}. They are signed out everywhere.
                    </p>
                  )}
                  {(data.kind === "channel" || data.kind === "work_provider" || data.kind === "worker" || data.kind === "service_business") && (
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needsReason(data.kind, "suspend") ? "Reason (required)" : "Reason (optional)"} aria-label="Reason" className="min-h-14 w-full rounded-2xl px-4 text-lg" />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setConfirming(null)} className="min-h-14 rounded-2xl border border-[var(--border-faint)] text-lg font-bold text-ink">Cancel</button>
                    <button type="button" disabled={busy} onClick={() => run(item, "suspend")} className="min-h-14 rounded-2xl bg-red-600 text-lg font-extrabold text-white disabled:opacity-60">{busy ? "Working…" : "Suspend"}</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {data.href && (
        <Link href={data.href} className="home-card flex min-h-14 items-center gap-3">
          <ExternalLink className="h-5 w-5 shrink-0 text-gold" aria-hidden />
          <span className="min-w-0 flex-1 text-base font-bold text-ink">Open the full {data.label.toLowerCase()} page</span>
        </Link>
      )}
    </div>
  );
}
