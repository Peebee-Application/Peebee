"use client";

import { isProSubscriptionCurrent, type AdminStageSummary, type Stage } from "@peebee/shared";
import { ChevronRight, Crown, PiggyBank, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function SavingsIndexPage() {
  const { rider } = useAuth();
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [discoverable, setDiscoverable] = useState<AdminStageSummary[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [requiresPro, setRequiresPro] = useState(false);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  function loadAll() {
    api
      .getMyStages()
      .then((res) => setStages(res.stages))
      .catch((err) => setError(errorMessage(err)));
    api
      .discoverStages()
      .then((res) => setDiscoverable(res.stages))
      .catch(() => {});
  }

  useEffect(() => {
    loadAll();
    api
      .getSettings()
      .then(({ settings }) => setRequiresPro(settings.vslaRequiresPro))
      .catch(() => {});
  }, []);

  // A rider who already belongs to at least one stage is grandfathered —
  // this only ever blocks *joining or creating a new* circle, matching the
  // server's own check in apps/api/src/stages/routes.ts.
  const needsPro = requiresPro && (stages?.length ?? 0) === 0 && !isProSubscriptionCurrent(rider);

  async function createStage(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    setPendingNotice(null);
    try {
      await api.createStage({ name: name.trim() });
      setName("");
      setShowCreate(false);
      setPendingNotice(
        `"${name.trim()}" was submitted for Peebee's approval. You'll be notified once it's approved and you can set up its RSLA.`,
      );
      loadAll();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function join(stageId: string) {
    setJoiningId(stageId);
    setError(null);
    try {
      await api.joinStage(stageId);
      window.location.href = `/savings/${stageId}`;
    } catch (err) {
      setError(errorMessage(err));
      setJoiningId(null);
    }
  }

  if (stages === null) {
    return <div className="p-4 text-sm text-ink-500">Loading…</div>;
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">RSLA</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {pendingNotice && <p className="rounded-lg bg-gold/10 px-3 py-2 text-sm text-ink">{pendingNotice}</p>}

      {stages.length > 0 ? (
        <ul className="space-y-2">
          {stages.map((s) => (
            <li key={s.id}>
              <Link href={`/savings/${s.id}`} className="home-card flex items-center gap-3 !rounded-2xl !py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                  <PiggyBank className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">{s.name}</span>
                  <span className="block text-xs capitalize text-ink-500">{s.role}</span>
                </span>
                <ChevronRight className="h-4.5 w-4.5 shrink-0 text-ink-500/60" strokeWidth={2} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="home-card space-y-2 text-center">
          <p className="text-sm text-ink-500">You&apos;re not part of an RSLA yet.</p>
        </div>
      )}

      {discoverable.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Stages you can join</p>
          {discoverable.map((s) => (
            <div key={s.id} className="home-card flex items-center gap-3 !rounded-2xl !py-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                <PiggyBank className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">{s.name}</span>
                <span className="block text-xs text-ink-500">{s.member_count} members</span>
              </span>
              {needsPro ? (
                <Link
                  href="/account#rider-pro"
                  className="shrink-0 rounded-full border border-gold px-4 py-2 text-xs font-bold text-ink"
                >
                  Requires Pro
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => join(s.id)}
                  disabled={joiningId === s.id}
                  className="shrink-0 rounded-full bg-gold px-4 py-2 text-xs font-bold text-ink-gold disabled:opacity-60"
                >
                  {joiningId === s.id ? "Joining…" : "Join"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {needsPro && (stages?.length ?? 0) === 0 && (
        <Link
          href="/account#rider-pro"
          className="flex items-center justify-center gap-2 rounded-full border border-gold bg-gold/10 py-3 text-sm font-bold text-ink"
        >
          <Crown className="h-4 w-4 text-gold" strokeWidth={2} aria-hidden />
          Upgrade to Pro to join or start a stage circle
        </Link>
      )}

      {needsPro ? null : !showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-[var(--border-faint)] py-3 text-sm font-bold text-ink-500"
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          Don&apos;t see your stage? Propose it
        </button>
      ) : (
        <form onSubmit={createStage} className="home-card space-y-3">
          <label className="text-xs font-semibold text-ink-500" htmlFor="stageName">
            Stage name
          </label>
          <input
            id="stageName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kira Stage"
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
          <p className="text-xs text-ink-500">
            Peebee reviews every proposed stage before it can have an RSLA, to keep one canonical record per stage.
          </p>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
          >
            {busy ? "Submitting…" : "Submit for approval"}
          </button>
        </form>
      )}
    </div>
  );
}
