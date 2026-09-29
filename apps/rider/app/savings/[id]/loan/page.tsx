"use client";

import type { StageDetail, StageLoan } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { formatUgx } from "../../../../lib/order-display";
import { useAuth } from "../../../../lib/auth-context";

const STATUS_LABEL: Record<StageLoan["status"], string> = {
  pending: "Awaiting votes",
  approved: "Approved — collect it",
  rejected: "Rejected",
  disbursed: "Disbursed",
  repaid: "Repaid",
  defaulted: "Defaulted",
};

export default function StageLoanPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const { user } = useAuth();
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [loans, setLoans] = useState<StageLoan[]>([]);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [d, l] = await Promise.all([api.getStage(stageId), api.getStageLoans(stageId)]);
    setDetail(d);
    setLoans(l.loans);
  }

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [stageId]);

  // Whether this rider's role is named anywhere in the cycle's approval
  // workflow — covers the officer roles above and, when the group admin has
  // added it, a "member" approver pool any regular member can vote through.
  const canVote = detail ? detail.approvalWorkflow.some((w) => w.role === detail.myRole) : false;

  async function requestLoan(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.requestStageLoan(stageId, { amount: value, reason: reason.trim() || undefined });
      setAmount("");
      setReason("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function vote(loanId: string, status: "approved" | "rejected") {
    try {
      await api.voteStageLoan(loanId, { status });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function confirmReceived(loanId: string) {
    try {
      await api.confirmStageLoanDisbursement(loanId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Loans</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={requestLoan} className="home-card space-y-3">
        <p className="text-sm font-semibold text-ink">Request a loan</p>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="Amount (UGX)"
          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
        />
        {detail?.cycle && (
          <p className="text-xs text-ink-500">
            Max up to your savings × {detail.cycle.loanable_contribution_multiple}, interest {detail.cycle.interest_rate}%.
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !amount}
          className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? "Sending…" : "Request loan"}
        </button>
      </form>

      <div className="space-y-2">
        {loans.map((loan) => (
          <div key={loan.id} className="home-card space-y-2 !py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-ink">{loan.member_name}</span>
              <span className="rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 text-xs font-semibold text-ink-500">
                {STATUS_LABEL[loan.status]}
              </span>
            </div>
            <p className="text-lg font-extrabold text-ink">{formatUgx(loan.amount)}</p>
            {loan.reason && <p className="text-xs text-ink-500">{loan.reason}</p>}

            {loan.status === "pending" && canVote && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => vote(loan.id, "approved")}
                  className="flex-1 rounded-full bg-green py-2 text-xs font-bold text-white"
                >
                  Approve
                </button>
                <button
                  onClick={() => vote(loan.id, "rejected")}
                  className="flex-1 rounded-full border border-[var(--border-faint)] py-2 text-xs font-bold text-red-600"
                >
                  Reject
                </button>
              </div>
            )}

            {loan.status === "approved" && loan.member_id === user?.id && (
              <button
                onClick={() => confirmReceived(loan.id)}
                className="min-h-10 w-full rounded-full bg-gold text-xs font-bold text-ink-gold"
              >
                Confirm I received it
              </button>
            )}

            {["disbursed", "defaulted"].includes(loan.status) && loan.member_id === user?.id && (
              <a
                href={`/savings/${stageId}/loan/${loan.id}/repay`}
                className="block min-h-10 w-full rounded-full border border-[var(--border-faint)] py-2.5 text-center text-xs font-bold text-ink"
              >
                Repay
              </a>
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
