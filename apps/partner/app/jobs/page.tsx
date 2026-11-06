"use client";

import { observeNotificationSnapshot } from "@peebee/shared";

import type { CarDriverJob } from "@peebee/shared";
import { MapPin, Power, Route } from "lucide-react";
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
    return <p className="px-4 py-5 text-lg text-ink-500">Switch to Driver to see ride requests.</p>;
  }
  return (
    <div className="space-y-4 px-4 py-5">
      <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><Route className="h-7 w-7 text-gold" aria-hidden /> Requests</h1>
      {!me?.online && (
        <Link href="/" className="home-card flex min-h-16 items-center gap-3 text-xl font-bold text-gold">
          <Power className="h-6 w-6" aria-hidden /> You&apos;re offline. Go online
        </Link>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {me?.online && jobs.length === 0 && (
        <div className="home-card space-y-2 py-10 text-center">
          <Route className="mx-auto h-10 w-10 text-ink-500/40" aria-hidden />
          <p className="text-lg text-ink-500">Nothing nearby yet</p>
        </div>
      )}
      {jobs.map((job) => (
        <section key={job.id} className="home-card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words text-xl font-bold text-ink">{job.destinationAddress ?? "Destination"}</p>
            <strong className="shrink-0 text-2xl font-black tabular-nums text-ink">{ugx(job.fare)}</strong>
          </div>
          <p className="text-lg text-ink-500">
            <MapPin className="mr-1 inline h-5 w-5 text-gold" aria-hidden />
            {job.pickupAddress ?? "Pickup"}
          </p>
          <p className="text-lg text-ink-500">
            {job.distanceKm != null ? `${job.distanceKm.toFixed(1)} km` : ""}
            {job.pickupDistanceKm != null ? ` · ${job.pickupDistanceKm} km away` : ""}
            {job.scheduledFor ? ` · ${new Date(job.scheduledFor).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </p>
          {job.categoryKind === "ambulance" && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">Emergency ambulance</p>}
          {job.categoryKind === "luxury" && <p className="text-base font-bold text-gold">Luxury{job.hireHours ? ` · hired ${job.hireHours} h` : ""}</p>}
          {job.serviceTier && <p className="text-base font-bold text-gold">{job.serviceTier === "xl" ? "XL" : job.serviceTier === "comfort" ? "Comfort" : "Convenient"}</p>}
          {job.tripNote && <p className="text-lg text-ink">{job.tripNote}</p>}
          {job.matchingMode === "customer_selects" ? (
            <>
              {job.bidding && !job.applied && (
                <input
                  inputMode="numeric"
                  value={bids[job.id] ?? ""}
                  onChange={(e) => setBids((b) => ({ ...b, [job.id]: e.target.value.replace(/\D/g, "") }))}
                  placeholder={`Your price (${Math.round((job.bidding.min ?? 0) / 1000)}k–${Math.round((job.bidding.max ?? 0) / 1000)}k)`}
                  aria-label="Your price"
                  className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3 text-lg"
                />
              )}
              <button
                disabled={busyId === job.id || job.applied}
                onClick={() => apply(job)}
                className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50"
              >
                {job.applied ? "Applied · waiting" : busyId === job.id ? "Please wait…" : bids[job.id] ? "Apply with my price" : "Apply"}
              </button>
            </>
          ) : (
            <p className="text-lg text-ink-500">Goes to the nearest driver automatically.</p>
          )}
        </section>
      ))}
    </div>
  );
}
