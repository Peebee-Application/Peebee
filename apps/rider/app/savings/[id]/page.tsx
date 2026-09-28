"use client";

import type { StageDetail } from "@tuma/shared";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../lib/api";
import { formatUgx } from "../../../lib/order-display";

const OFFICER_ROLES = ["chairman", "vice_chairman", "secretary", "treasurer", "money_counter", "mobilizer"] as const;

export default function StageDetailPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startingCycle, setStartingCycle] = useState(false);
  const [sharePrice, setSharePrice] = useState("1000");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  useEffect(() => {
    api
      .getStage(stageId)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }, [stageId]);

  async function startCycle() {
    if (startingCycle) return;
    setStartingCycle(true);
    setError(null);
    try {
      await api.startStageCycle(stageId, {
        startDate: new Date().toISOString().slice(0, 10),
        sharePrice: Number(sharePrice) || undefined,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      // Refetch regardless of outcome — a "cycle already active" failure
      // (e.g. from a double-tap) means the cycle exists anyway, so this
      // picks up the real state instead of leaving a stale error on screen
      // over a page that's actually already up to date.
      try {
        const fresh = await api.getStage(stageId);
        setDetail(fresh);
        if (fresh.cycle) setError(null);
      } catch {}
      setStartingCycle(false);
    }
  }

  if (!detail && error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!detail) return <div className="p-4 text-sm text-ink-500">Loading…</div>;

  const officers = detail.members.filter((m) => (OFFICER_ROLES as readonly string[]).includes(m.role));
  const canManage = detail.isGroupAdmin || (OFFICER_ROLES as readonly string[]).includes(detail.myRole);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!invitePhone.trim()) return;
    setInviteBusy(true);
    setInviteMessage(null);
    try {
      const res = await api.inviteToStage(stageId, invitePhone.trim());
      setInviteMessage(`${res.name} added.`);
      setInvitePhone("");
      const fresh = await api.getStage(stageId);
      setDetail(fresh);
    } catch (err) {
      setInviteMessage(errorMessage(err));
    } finally {
      setInviteBusy(false);
    }
  }

  async function transferAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!transferTarget) return;
    setTransferBusy(true);
    try {
      await api.transferStageAdmin(stageId, transferTarget);
      const fresh = await api.getStage(stageId);
      setDetail(fresh);
      setTransferTarget("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTransferBusy(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <div>
        <h1 className="text-xl font-bold text-ink">{detail.stage.name}</h1>
        <p className="text-sm text-ink-500">
          {detail.cycle ? `Cycle · ${detail.cycle.start_date} – ${detail.cycle.end_date}` : "No active cycle yet"} ·{" "}
          {detail.members.length} members
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {detail.cycle ? (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="home-card !py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Group pot</p>
            <p className="text-lg font-extrabold text-ink">{formatUgx(detail.pot)}</p>
          </div>
          <div className="home-card !py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Out on loan</p>
            <p className="text-lg font-extrabold text-ink">{formatUgx(detail.outOnLoan)}</p>
          </div>
        </div>
      ) : (
        <div className="home-card space-y-3 text-center">
          <p className="text-sm text-ink-500">This circle hasn&apos;t started a savings cycle yet.</p>
          {canManage && (
            <>
              <div className="flex items-center gap-2 text-left">
                <label className="text-xs font-semibold text-ink-500" htmlFor="share-price">
                  Share price (UGX)
                </label>
                <input
                  id="share-price"
                  inputMode="numeric"
                  value={sharePrice}
                  onChange={(e) => setSharePrice(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-24 rounded-lg border border-[var(--border-faint)] px-2 py-1 text-sm font-bold text-ink outline-none focus:border-gold"
                />
              </div>
              <button
                type="button"
                onClick={startCycle}
                disabled={startingCycle}
                className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
              >
                {startingCycle ? "Starting…" : "Start a savings cycle"}
              </button>
            </>
          )}
        </div>
      )}

      {officers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Officers</p>
          <div className="flex gap-2">
            {officers.map((o) => (
              <Link
                key={o.rider_id}
                href={`/savings/${stageId}/chat?with=${o.rider_id}`}
                className="flex-1 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-2.5 text-center"
              >
                <span className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-ink">
                  {o.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="block truncate text-xs font-bold text-ink">{o.name}</span>
                <span className="block text-[10px] capitalize text-ink-500">{o.role.replace("_", " ")}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {detail.cycle && (
        <div className="space-y-2">
          <Link
            href={`/savings/${stageId}/contribute`}
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-4 text-sm font-bold text-ink-gold"
          >
            Log a contribution
          </Link>
          <Link
            href={`/savings/${stageId}/loan`}
            className="flex min-h-12 w-full items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 text-sm font-bold text-ink"
          >
            Loans
          </Link>
        </div>
      )}

      <div className="flex gap-2">
        <Link
          href={`/savings/${stageId}/elections`}
          className="flex-1 rounded-full border border-[var(--border-faint)] py-2.5 text-center text-xs font-bold text-ink-500"
        >
          Elections
        </Link>
        <Link
          href={`/savings/${stageId}/ledger`}
          className="flex-1 rounded-full border border-[var(--border-faint)] py-2.5 text-center text-xs font-bold text-ink-500"
        >
          Ledger
        </Link>
        <Link
          href={`/savings/${stageId}/reports`}
          className="flex-1 rounded-full border border-[var(--border-faint)] py-2.5 text-center text-xs font-bold text-ink-500"
        >
          Reports
        </Link>
        <Link
          href={`/savings/${stageId}/chat`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--border-faint)] py-2.5 text-center text-xs font-bold text-ink-500"
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Circle chat
        </Link>
      </div>

      {detail.isGroupAdmin && (
        <div className="home-card space-y-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Group admin</p>

          <form onSubmit={invite} className="space-y-2">
            <label className="text-xs font-semibold text-ink-500" htmlFor="invite-phone">
              Add a member by phone
            </label>
            <div className="flex gap-2">
              <input
                id="invite-phone"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                placeholder="07XXXXXXXX"
                className="flex-1 rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-gold"
              />
              <button
                type="submit"
                disabled={inviteBusy}
                className="rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
              >
                {inviteBusy ? "Adding…" : "Add"}
              </button>
            </div>
            {inviteMessage && <p className="text-xs text-ink-500">{inviteMessage}</p>}
          </form>

          <form onSubmit={transferAdmin} className="space-y-2">
            <label className="text-xs font-semibold text-ink-500" htmlFor="transfer-target">
              Transfer group admin to
            </label>
            <div className="flex gap-2">
              <select
                id="transfer-target"
                value={transferTarget}
                onChange={(e) => setTransferTarget(e.target.value)}
                className="flex-1 rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-gold"
              >
                <option value="">Choose a member…</option>
                {detail.members
                  .filter((m) => m.rider_id !== detail.groupAdminId)
                  .map((m) => (
                    <option key={m.rider_id} value={m.rider_id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              <button
                type="submit"
                disabled={transferBusy || !transferTarget}
                className="rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink disabled:opacity-60"
              >
                {transferBusy ? "…" : "Transfer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
