"use client";

import type { WorkJob } from "@peebee/shared";
import { Briefcase, CheckCircle2, Clock, MapPin, Power } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { TabBar } from "../components/TabBar";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { estimatedEarnings, ugx, whenLabel } from "../lib/format";

export default function HomePage() {
  const { provider, canWork, isOwner, refreshProvider } = useAuth();
  const [open, setOpen] = useState<WorkJob[]>([]);
  const [active, setActive] = useState<WorkJob[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "mine">("open");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, feed] = await Promise.all([
        api.workProviderJobs(),
        canWork && isOwner ? api.workOpenJobs() : Promise.resolve({ jobs: [] as WorkJob[] }),
      ]);
      setActive(mine.jobs.filter((j) => ["assigned", "quoted", "booked", "in_progress", "completed", "disputed"].includes(j.status)));
      setOpen(feed.jobs);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [canWork, isOwner]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!provider) return null;

  async function toggleOnline() {
    setError(null);
    try {
      const next = !provider!.online;
      let coords: { lat?: number; lng?: number } = {};
      if (next && typeof navigator !== "undefined" && navigator.geolocation) {
        coords = await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => resolve({}),
            { timeout: 6000, maximumAge: 60000 },
          ),
        );
      }
      await api.workProviderUpdate({ online: next, ...coords });
      await refreshProvider();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function accept(job: WorkJob) {
    setBusyId(job.id);
    setError(null);
    setNotice(null);
    try {
      if (job.matchingMode === "broadcast") {
        await api.workAcceptJob(job.id);
        setNotice("Accepted. It is yours.");
      } else {
        await api.workOfferOnJob(job.id, {});
        setNotice("Offer sent.");
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const canOpen = isOwner && canWork;
  const view = tab === "open" && canOpen ? "open" : "mine";
  const list = view === "open" ? open : active;
  const shown = showAll ? list : list.slice(0, 4);

  return (
    <div className="space-y-4">
      {provider.status !== "approved" && (
        <div className="home-card space-y-1 !p-4">
          <p className="text-xl font-black text-ink">{provider.status === "pending" ? "Waiting for approval" : provider.status === "suspended" ? "Account suspended" : "Not approved"}</p>
          <p className="text-lg text-ink-500">{provider.statusNote || (provider.status === "pending" ? "Peebee is checking your account." : "Contact Peebee support.")}</p>
        </div>
      )}

      {isOwner && (
        <button
          type="button"
          onClick={toggleOnline}
          disabled={!canWork}
          className={`flex min-h-20 w-full items-center justify-between gap-3 rounded-3xl p-4 text-left transition active:scale-[0.99] disabled:opacity-50 ${provider.online ? "bg-gold text-ink-gold" : "home-card"}`}
        >
          <span className="text-2xl font-black">{provider.online ? "You are online" : "Go online"}</span>
          <Power className="h-8 w-8 shrink-0" aria-hidden />
        </button>
      )}

      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-lg font-bold text-red-600" role="alert">{error}</div>}
      {notice && <div className="rounded-2xl bg-green/10 p-3 text-lg font-bold text-green" role="status">{notice}</div>}

      {canOpen && (
        <TabBar
          label="Jobs"
          active={view}
          onChange={(t) => { setTab(t); setShowAll(false); }}
          tabs={[
            { id: "open", label: "Open", icon: Briefcase, count: open.length },
            { id: "mine", label: "Mine", icon: CheckCircle2, count: active.length },
          ]}
        />
      )}

      {view === "open" && !provider.online && <p className="home-card text-center text-lg text-ink-500">Go online to see jobs.</p>}
      {view === "open" && provider.online && open.length === 0 && <p className="home-card text-center text-lg text-ink-500">No jobs right now.</p>}
      {view === "mine" && active.length === 0 && <p className="home-card text-center text-lg text-ink-500">No jobs yet.</p>}

      {shown.map((j) =>
        view === "mine" ? (
          <JobCard key={j.id} job={j} />
        ) : (
          <div key={j.id} className="home-card space-y-3 !p-4">
            <JobSummary job={j} />
            {j.myOffer ? (
              <p className="text-lg font-bold text-gold">Offer sent{j.myOffer.price_ugx ? ` · ${ugx(j.myOffer.price_ugx)}` : ""}. Waiting.</p>
            ) : (
              <button type="button" onClick={() => accept(j)} disabled={busyId === j.id} className="min-h-16 w-full rounded-2xl bg-gold text-xl font-extrabold text-ink-gold transition active:scale-[0.98] disabled:opacity-50">
                {busyId === j.id ? "Please wait…" : j.matchingMode === "broadcast" ? "Accept" : "Send offer"}
              </button>
            )}
          </div>
        ),
      )}
      {list.length > 4 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="flex min-h-14 w-full items-center justify-center text-lg font-bold text-gold">Show all {list.length}</button>
      )}
    </div>
  );
}

function JobSummary({ job }: { job: WorkJob }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xl font-black text-ink">{job.service.name}{job.quantity > 1 ? ` × ${job.quantity}` : ""}</p>
        <StatusBadge status={job.status} />
      </div>
      <p className="flex items-center gap-2 text-lg text-ink-500"><MapPin className="h-5 w-5 shrink-0 text-gold" aria-hidden />{job.area || job.address}</p>
      <p className="flex items-center gap-2 text-lg text-ink-500"><Clock className="h-5 w-5 shrink-0 text-gold" aria-hidden />{whenLabel(job.scheduledFor)}</p>
      <p className="text-xl font-black text-ink">
        {job.pricingMode === "quote" && job.priceUgx === 0 ? `Quote needed · call-out ${ugx(job.calloutFeeUgx)}` : `About ${ugx(estimatedEarnings(job))}`}
      </p>
    </div>
  );
}

function JobCard({ job }: { job: WorkJob }) {
  return (
    <Link href={`/jobs/${job.id}`} className="home-card block !p-4 transition active:scale-[0.99]">
      <JobSummary job={job} />
    </Link>
  );
}
