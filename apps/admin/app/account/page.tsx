"use client";

import { ADMIN_ROLE_LABELS, hasPermission } from "@peebee/shared";
import { ClipboardList, LogOut, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChangePasswordPanel } from "../../components/ChangePasswordPanel";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

type AccessRequest = Awaited<ReturnType<typeof api.adminFinancialAccessRequests>>["requests"][number];

function FinancialAccessRequests() {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<{ email: string; link: string } | null>(null);

  async function refresh() {
    setError("");
    try {
      setRequests((await api.adminFinancialAccessRequests()).requests);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function review(request: AccessRequest, approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const { link } = await api.adminReviewFinancialAccessRequest(request.id, approve);
      if (link) setInvite({ email: request.email, link });
      setRequests(previous => previous?.filter(item => item.id !== request.id) ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="home-card space-y-3" aria-labelledby="financial-access-requests">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="financial-access-requests" className="font-bold text-ink">Financials guest access requests</h2>
        <button type="button" onClick={() => void refresh()} disabled={busy} className="text-sm font-semibold text-ink underline">Refresh</button>
      </div>
      {error && <p role="status" className="text-sm text-ink">{error}</p>}
      {requests?.length === 0 && <p className="text-sm text-ink-500">No pending requests.</p>}
      {!requests && !error && <p role="status" className="text-sm text-ink-500">Loading requests…</p>}
      {invite && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-ink" htmlFor="financial-approved-link">Invitation link for {invite.email}</label>
          <input id="financial-approved-link" readOnly value={invite.link} onFocus={event => event.currentTarget.select()}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2" />
          <p className="text-sm text-ink-500">Share this link with the guest. It expires in seven days.</p>
        </div>
      )}
      <ul className="space-y-3">
        {requests?.map(request => (
          <li key={request.id} className="space-y-2 border-t border-[var(--border-faint)] pt-3">
            <p className="break-words font-semibold text-ink">{request.email}</p>
            <p className="text-xs text-ink-500">{new Date(request.createdAt * 1000).toLocaleString()}</p>
            {request.note && <p className="whitespace-pre-wrap break-words text-sm text-ink-500">{request.note}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void review(request, true)}
                className="min-h-10 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60">Approve and create link</button>
              <button type="button" disabled={busy} onClick={() => void review(request, false)}
                className="min-h-10 rounded-full border border-[var(--border-faint)] px-4 text-sm font-semibold text-ink disabled:opacity-60">Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AccountPage() {
  const { user, logout } = useAuth();
  const isSuperAdmin = user?.adminRole === "super_admin";
  const canViewActivityLog = hasPermission(user?.adminRole ?? null, "activity_log.view");

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Account</h1>

      <section className="home-card flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink/10 text-ink">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-bold text-ink">{user?.name ?? "—"}</span>
          <span className="block text-sm text-ink-500">{user?.phone ?? user?.email}</span>
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-semibold text-ink">
          {user?.adminRole ? ADMIN_ROLE_LABELS[user.adminRole] : "Admin"}
        </span>
      </section>

      {isSuperAdmin && (
        <Link
          href="/staff"
          className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink"
        >
          <Users className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden />
          Staff accounts
        </Link>
      )}

      {canViewActivityLog && (
        <Link
          href="/activity"
          className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink"
        >
          <ClipboardList className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden />
          Activity log
        </Link>
      )}

      {isSuperAdmin && <FinancialAccessRequests />}

      <ChangePasswordPanel />

      <button
        onClick={logout}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        Log out
      </button>
    </div>
  );
}
