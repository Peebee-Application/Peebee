"use client";

import type { Rider } from "@peebee/shared";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

type RiderRow = Rider & { name: string; phone: string };

export default function AdminRidersPage() {
  const { user, ready } = useAuth();
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "admin") return;
    api
      .adminListRiders()
      .then((res) => setRiders(res.riders as RiderRow[]))
      .catch((err) => setError(errorMessage(err)));
  }, [user]);

  if (!ready) return null;
  if (user?.role !== "admin") {
    return <div className="p-4 text-sm text-ink-500">Not authorized.</div>;
  }

  async function toggle(userId: string, verified: boolean) {
    setBusyId(userId);
    try {
      await api.adminVerifyRider(userId, verified);
      setRiders((prev) => prev.map((r) => (r.user_id === userId ? { ...r, verified: verified ? 1 : 0 } : r)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Rider verification</h1>
      <p className="text-sm text-ink-500">Manual approval — no automated KYC/document check yet.</p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="space-y-2.5">
        {riders.map((rider) => (
          <li key={rider.user_id} className="home-card flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold text-ink">{rider.name}</span>
              <span className="block text-xs text-ink-500">
                {rider.phone} · {rider.area ?? "no area"} · {rider.is_online ? "online" : "offline"}
              </span>
            </span>
            <button
              disabled={busyId === rider.user_id}
              onClick={() => toggle(rider.user_id, !rider.verified)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold disabled:opacity-60 ${
                rider.verified ? "bg-[rgb(var(--surface-muted))] text-ink" : "bg-green text-white"
              }`}
            >
              {rider.verified ? "Revoke" : "Verify"}
            </button>
          </li>
        ))}
        {riders.length === 0 && <p className="py-6 text-center text-sm text-ink-500">No riders yet.</p>}
      </ul>
    </div>
  );
}
