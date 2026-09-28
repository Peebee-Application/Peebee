"use client";

import { hasPermission, type AdminStageSummary } from "@tuma/shared";
import { ChevronRight, PiggyBank } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function AdminStagesPage() {
  const { user } = useAuth();
  const canView = hasPermission(user?.adminRole ?? null, "riders.view");
  const [stages, setStages] = useState<AdminStageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    api
      .adminGetStages()
      .then((res) => setStages(res.stages))
      .catch((err) => setError(errorMessage(err)));
  }, [canView]);

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
      <h1 className="text-xl font-bold text-ink">Stage savings circles</h1>
      <p className="text-sm text-ink-500">
        Read-only — for support and technical issues only. Money disagreements between members stay inside the
        group.
      </p>
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
    </div>
  );
}
