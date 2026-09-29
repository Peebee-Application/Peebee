"use client";

import { hasPermission } from "@tuma/shared";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

type PendingStage = {
  id: string;
  name: string;
  area: string | null;
  address: string | null;
  description: string | null;
  proposer_name: string | null;
  proposer_phone: string | null;
  created_at: string;
};

export default function PendingStagesPage() {
  const { user } = useAuth();
  const canView = hasPermission(user?.adminRole ?? null, "riders.view");
  const [stages, setStages] = useState<PendingStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function load() {
    api
      .adminGetPendingStages()
      .then((res) => setStages(res.stages as unknown as PendingStage[]))
      .catch((err) => setError(errorMessage(err)));
  }

  useEffect(() => {
    if (canView) load();
  }, [canView]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.adminApproveStage(id);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) return;
    setBusyId(id);
    setError(null);
    try {
      await api.adminRejectStage(id, reason.trim());
      setRejectingId(null);
      setReason("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-5 px-4 pb-6 pt-4">
        <h1 className="text-xl font-bold text-ink">Pending stage proposals</h1>
        <p className="text-sm text-ink-500">You don&apos;t have permission to view this.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Pending stage proposals</h1>
      <p className="text-sm text-ink-500">
        A rider proposed each of these as their stage. Approve to make it the canonical, joinable stage record —
        reject if it duplicates an existing stage under a different name, or looks wrong.
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!stages ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : stages.length === 0 ? (
        <p className="text-sm text-ink-500">Nothing waiting on review.</p>
      ) : (
        <ul className="space-y-3">
          {stages.map((s) => (
            <li key={s.id} className="home-card space-y-3">
              <div>
                <p className="text-sm font-bold text-ink">{s.name}</p>
                {s.area && <p className="text-xs text-ink-500">{s.area}</p>}
                {s.address && <p className="text-xs text-ink-500">{s.address}</p>}
                {s.description && <p className="mt-1 text-xs text-ink-500">{s.description}</p>}
                <p className="mt-2 text-xs text-ink-500">
                  Proposed by {s.proposer_name ?? "unknown"} {s.proposer_phone ? `(${s.proposer_phone})` : ""}
                </p>
              </div>

              {rejectingId === s.id ? (
                <div className="space-y-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for declining"
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setReason("");
                      }}
                      className="flex-1 rounded-full border border-[var(--border-faint)] py-2 text-sm font-bold text-ink-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => reject(s.id)}
                      disabled={busyId === s.id || !reason.trim()}
                      className="flex-1 rounded-full bg-red-600 py-2 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {busyId === s.id ? "…" : "Confirm reject"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRejectingId(s.id)}
                    className="flex-1 rounded-full border border-[var(--border-faint)] py-2 text-sm font-bold text-ink-500"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => approve(s.id)}
                    disabled={busyId === s.id}
                    className="flex-1 rounded-full bg-gold py-2 text-sm font-bold text-ink-gold disabled:opacity-60"
                  >
                    {busyId === s.id ? "…" : "Approve"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
