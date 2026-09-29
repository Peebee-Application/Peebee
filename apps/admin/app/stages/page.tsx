"use client";

import { hasPermission, type AdminStageSummary } from "@tuma/shared";
import { ChevronRight, PiggyBank, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function AdminStagesPage() {
  const { user } = useAuth();
  const canView = hasPermission(user?.adminRole ?? null, "riders.view");
  const [stages, setStages] = useState<AdminStageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .adminGetStages()
      .then((res) => setStages(res.stages))
      .catch((err) => setError(errorMessage(err)));
  }

  useEffect(() => {
    if (canView) load();
  }, [canView]);

  async function createStage(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminCreateStage({ name: name.trim(), area: area.trim() || undefined });
      setName("");
      setArea("");
      setShowCreate(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-5 px-4 pb-6 pt-4">
        <h1 className="text-xl font-bold text-ink">Stage savings circles</h1>
        <p className="text-sm text-ink-500">You don&apos;t have permission to view this.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Stages (RSLA)</h1>
      <p className="text-sm text-ink-500">
        Viewing a circle&apos;s ledger is read-only — for support and technical issues only. Money disagreements
        between members stay inside the group.
      </p>
      <Link
        href="/stages/pending"
        className="flex items-center justify-between rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 py-3"
      >
        <span className="text-sm font-semibold text-ink">Pending stage proposals</span>
        <ChevronRight className="h-4.5 w-4.5 text-ink-500" strokeWidth={1.75} aria-hidden />
      </Link>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!stages ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : stages.length === 0 ? (
        <p className="text-sm text-ink-500">No stage circles yet.</p>
      ) : (
        <ul className="space-y-2">
          {stages.map((s) => (
            <li key={s.id}>
              <Link href={`/stages/${s.id}`} className="home-card flex items-center gap-3 !py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                  <PiggyBank className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{s.name}</span>
                  <span className="block text-xs text-ink-500">{s.member_count} members</span>
                </span>
                <ChevronRight className="h-4.5 w-4.5 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-[var(--border-faint)] py-3 text-sm font-bold text-ink-500"
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          Register a stage
        </button>
      ) : (
        <form onSubmit={createStage} className="home-card space-y-3">
          <div className="space-y-1">
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
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="stageArea">
              Area (optional)
            </label>
            <input
              id="stageArea"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Kira, Wakiso"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
          </div>
          <p className="text-xs text-ink-500">
            Riders join it themselves from the app and elect their own officers — nothing else to set up here.
          </p>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create stage"}
          </button>
        </form>
      )}
    </div>
  );
}
