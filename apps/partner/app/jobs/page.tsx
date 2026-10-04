"use client";

import { observeNotificationSnapshot } from "@peebee/shared";

import type { CarDriverJob } from "@peebee/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const ugx = (n: number) => `UGX ${Number(n).toLocaleString("en-UG")}`;

export default function JobsPage() {
  const { me, mode } = useAuth();
  const [jobs, setJobs] = useState<CarDriverJob[]>([]);
  const [bids, setBids] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.carDriverJobs().then((r) => {
      observeNotificationSnapshot("car-jobs", r.jobs.map((job) => job.id));
      setJobs(r.jobs);
    }).catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 6000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function apply(job: CarDriverJob) {
    const raw = bids[job.id];
    setBusyId(job.id);
    setError("");
    try {
      await api.carDriverApply(job.id, raw ? Number(raw) : undefined);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (mode !== "driver") {
    return <p className="px-4 py-5 text-sm text-ink-500">Switch to Driver (top right) to see ride requests.</p>;
  }
  return (
    <div className="space-y-4 px-4 py-5">
      <h1 className="text-2xl font-black text-ink">Ride requests</h1>
      {!me?.online && <p className="home-card text-sm text-ink-500">You&apos;re offline. <Link href="/" className="font-bold text-gold">Go online</Link> to receive requests.</p>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {me?.online && jobs.length === 0 && <p className="text-sm text-ink-500">No requests for your vehicle type right now.</p>}
      {jobs.map((job) => (
        <section key={job.id} className="home-card space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold text-ink">{job.pickupAddress ?? "Pickup"} → {job.destinationAddress ?? "Destination"}</p>
            <strong className="shrink-0 text-sm">{ugx(job.fare)}</strong>
          </div>
          {job.scheduledFor && <p className="text-xs font-semibold text-ink">Pickup {new Date(job.scheduledFor).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })}</p>}
          <p className="text-xs text-ink-500">
            {job.distanceKm != null ? `${job.distanceKm.toFixed(1)} km trip` : ""}
            {job.pickupDistanceKm != null ? ` · ${job.pickupDistanceKm} km to pickup` : ""}
          </p>
          {job.matchingMode === "customer_selects" ? (
            <>
              {job.bidding && !job.applied && (
                <input
                  inputMode="numeric"
                  value={bids[job.id] ?? ""}
                  onChange={(e) => setBids((b) => ({ ...b, [job.id]: e.target.value.replace(/\D/g, "") }))}
                  placeholder={`Your price (${ugx(job.bidding.min ?? 0)} – ${ugx(job.bidding.max ?? 0)}), or leave empty`}
                  className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3 text-sm"
                />
              )}
              <button
                disabled={busyId === job.id || job.applied}
                onClick={() => apply(job)}
                className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50"
              >
                {job.applied ? "Applied — waiting for the customer" : busyId === job.id ? "Please wait…" : bids[job.id] ? "Apply with my price" : "Apply at the app price"}
              </button>
            </>
          ) : (
            <p className="text-xs text-ink-500">This ride is assigned automatically to the nearest driver.</p>
          )}
        </section>
      ))}
    </div>
  );
}
