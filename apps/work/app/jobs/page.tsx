"use client";

import type { WorkJob } from "@peebee/shared";
import { Briefcase } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { api, errorMessage } from "../../lib/api";
import { timeAgo, ugx } from "../../lib/format";

export default function JobsPage() {
  const [jobs, setJobs] = useState<WorkJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.workProviderJobs().then((r) => setJobs(r.jobs)).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><Briefcase className="h-7 w-7 text-gold" aria-hidden /> Jobs</h1>
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{error}</div>}
      {jobs === null && !error && <p className="text-base text-ink-500">Loading…</p>}
      {jobs?.length === 0 && <p className="text-base font-medium text-ink-500">No jobs yet</p>}
      {(showAll ? jobs : jobs?.slice(0, 8))?.map((j) => (
        <Link key={j.id} href={`/jobs/${j.id}`} className="home-card flex items-start justify-between gap-3 !p-4 transition active:scale-[0.99]">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-xl font-black text-ink">{j.service.name}</p>
            <p className="truncate text-base font-medium text-ink-500">{j.area || j.address}</p>
            <p className="text-sm font-medium text-ink-500">{timeAgo(j.createdAt)}{j.priceUgx ? ` · ${ugx(j.priceUgx)}` : ""}</p>
          </div>
          <StatusBadge status={j.status} />
        </Link>
      ))}
      {jobs && jobs.length > 8 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="flex min-h-14 w-full items-center justify-center text-lg font-bold text-gold">Show all {jobs.length}</button>
      )}
    </div>
  );
}
