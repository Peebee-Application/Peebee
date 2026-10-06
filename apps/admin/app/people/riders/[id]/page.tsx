"use client";

import { hasPermission, type AdminRider } from "@peebee/shared";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { PersonPhoto, SubmittedFields } from "../../../../components/PersonPreview";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="max-w-[65%] whitespace-pre-wrap break-words text-right font-medium text-ink">{value || "Not supplied"}</span>
    </div>
  );
}

export default function RiderDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const { user } = useAuth();
  const canVerify = hasPermission(user?.adminRole ?? null, "riders.verify");
  const canManage = hasPermission(user?.adminRole ?? null, "riders.manage");
  const [rider, setRider] = useState<AdminRider | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docType,setDocType]=useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.adminListRiders();
    const found = res.riders.find((r) => r.user_id === userId) ?? null;
    setRider(found);
    return found;
  }, [userId]);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  useEffect(() => {
    if (!rider?.national_id_key) return;
    let url: string | null = null;
    let disposed=false;
    api
      .adminRiderIdDocumentBlob(userId)
      .then((blob) => {
        if(disposed)return;
        setDocType(blob.type);
        url = URL.createObjectURL(blob);
        setDocUrl(url);
      })
      .catch(() => {});
    return () => {
      disposed=true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [rider?.national_id_key, userId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!rider) {
    return <div className="p-4 text-sm text-ink-500">{error ?? "Loading rider…"}</div>;
  }

  const suspended = rider.status === "suspended";

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <Link href="/people?tab=riders" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500">
        <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
        Users
      </Link>

      <header className="home-card flex items-center justify-between gap-3 !rounded-3xl !p-5">
        <PersonPhoto kind="riders" id={userId} name={rider.name}/>
        <h1 className="min-w-0 flex-1 break-words text-xl font-bold text-ink">{rider.name}</h1>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            rider.verified ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"
          }`}
        >
          {rider.verified ? "Verified" : "Pending"}
        </span>
      </header>

      <SubmittedFields title="Registration details" fields={[["First name",rider.first_name],["Last name",rider.last_name],["Stage latitude",rider.stage_lat],["Stage longitude",rider.stage_lng],["Registered",rider.created_at],["Profile completed",rider.profile_completed_at],["Account status",rider.status]]}/>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <section className="home-card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Contact</h2>
        <Row label="Phone" value={rider.phone} />
        <Row label="Alt. phone" value={rider.alt_phone} />
        <Row label="Email" value={rider.email} />
        <Row label="Area" value={rider.area} />
        <Row label="Vehicle" value={rider.vehicle_info} />
        <Row label="Mobile money number" value={rider.momo_msisdn} />
      </section>

      <section className="home-card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Stage</h2>
        <Row label="Stage" value={rider.stage_name} />
        <Row label="Stage address" value={rider.stage_address} />
        <Row label="Chairman" value={rider.stage_chairman_name} />
        <Row label="Chairman contact" value={rider.stage_chairman_contact} />
        <Row label="Home address" value={rider.home_address} />
      </section>

      <section className="home-card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Emergency contact</h2>
        <Row label="Name" value={rider.emergency_contact_name} />
        <Row label="Phone" value={rider.emergency_contact_phone} />
      </section>

      <section className="home-card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">National ID</h2>
        <Row label="Submitted name" value={[rider.first_name, rider.last_name].filter(Boolean).join(' ')} />
        <p className="break-words text-sm text-ink-500">Before verifying this rider, check that their submitted name is similar to the name on their ID. A Google account name alone does not verify identity.</p>
        {!rider.national_id_key && <p className="break-words text-sm text-ink-500">Not uploaded yet.</p>}
        {rider.national_id_key && !docUrl && <p className="break-words text-sm text-ink-500">Loading document…</p>}
        {docUrl && (
          <div className="space-y-3">
            {docType.startsWith("image/")&&<img src={docUrl} alt="Submitted national ID" className="max-h-96 w-full rounded-xl object-contain"/>}
            {docType==="application/pdf"&&<iframe src={docUrl} title="Submitted national ID" className="h-96 w-full rounded-xl"/>}
          <a
            href={docUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm font-semibold text-gold"
          >
            View document <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </a>
          </div>
        )}
        {canVerify && (
          <button
            disabled={busy}
            onClick={() => run(() => api.adminVerifyRider(userId, !rider.verified))}
            className={`min-h-11 w-full rounded-full px-4 text-sm font-bold disabled:opacity-60 ${
              rider.verified ? "border border-[var(--border-faint)] text-ink" : "bg-gold text-ink-gold"
            }`}
          >
            {rider.verified ? "Revoke approval" : "Approve"}
          </button>
        )}
      </section>

      {canManage && (
        <button
          disabled={busy}
          onClick={() => run(() => api.adminSetUserStatus(userId, suspended ? "active" : "suspended"))}
          className={`min-h-11 w-full rounded-full px-4 text-sm font-bold disabled:opacity-60 ${
            suspended ? "bg-green text-white" : "border border-red-200 text-red-700"
          }`}
        >
          {suspended ? "Reactivate account" : "Suspend account"}
        </button>
      )}
    </div>
  );
}
