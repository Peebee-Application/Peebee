"use client";

import type { StageDetail, StageTransaction } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { formatUgx } from "../../../../lib/order-display";

const OFFICER_ROLES = ["chairman", "vice_chairman", "secretary", "treasurer", "money_counter", "mobilizer"] as const;

const TYPE_LABEL: Record<StageTransaction["type"], string> = {
  contribution: "Savings contribution",
  loan_disbursement: "Loan disbursed",
  repayment: "Loan repayment",
  share_out: "Share-out",
  fine: "Fine",
  expense: "Expense",
};

const RECONCILE_TYPES = ["contribution", "loan_disbursement", "repayment", "share_out", "fine", "expense"] as const;

export default function StageLedgerPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [transactions, setTransactions] = useState<StageTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);
  const [reconcileType, setReconcileType] = useState<StageTransaction["type"]>("contribution");
  const [reconcileAmount, setReconcileAmount] = useState("");
  const [reconcileMemberId, setReconcileMemberId] = useState("");
  const [reconcileNarrative, setReconcileNarrative] = useState("");
  const [reconcileBusy, setReconcileBusy] = useState(false);

  function load() {
    api
      .getStageLedger(stageId)
      .then((res) => setTransactions(res.transactions))
      .catch((err) => setError(errorMessage(err)));
    api.getStage(stageId).then(setDetail).catch(() => {});
  }

  useEffect(() => {
    load();
  }, [stageId]);

  const canManage = detail ? detail.isGroupAdmin || (OFFICER_ROLES as readonly string[]).includes(detail.myRole) : false;

  async function reconcile(e: React.FormEvent) {
    e.preventDefault();
    if (!reconcileAmount || !reconcileNarrative.trim()) return;
    setReconcileBusy(true);
    setError(null);
    try {
      const signed = reconcileType === "loan_disbursement" || reconcileType === "expense" ? -Math.abs(Number(reconcileAmount)) : Math.abs(Number(reconcileAmount));
      await api.createStageTransaction(stageId, {
        type: reconcileType,
        amount: signed,
        memberId: reconcileMemberId || null,
        narrative: reconcileNarrative.trim(),
      });
      setReconcileAmount("");
      setReconcileNarrative("");
      setShowReconcile(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReconcileBusy(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Ledger</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!transactions ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="text-sm text-ink-500">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {transactions.map((t) => (
            <li key={t.id} className="home-card space-y-1 !rounded-2xl !py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">{TYPE_LABEL[t.type]}</span>
                <span className={`text-sm font-bold ${t.amount >= 0 ? "text-green" : "text-red-600"}`}>
                  {t.amount >= 0 ? "+" : ""}
                  {formatUgx(t.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>{t.member_name ?? "—"}</span>
                <span>{new Date(t.created_at.replace(" ", "T") + "Z").toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              {t.narrative && <p className="text-xs text-ink-500">{t.narrative}</p>}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="home-card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Manual reconciliation</p>
            {!showReconcile && (
              <button type="button" onClick={() => setShowReconcile(true)} className="text-xs font-bold text-gold">
                Add a missed transaction
              </button>
            )}
          </div>
          {showReconcile && (
            <form onSubmit={reconcile} className="space-y-2">
              <p className="text-xs text-ink-500">
                For a transaction that actually happened but was never recorded — e.g. a contribution the treasurer
                forgot to confirm.
              </p>
              <select
                value={reconcileType}
                onChange={(e) => setReconcileType(e.target.value as StageTransaction["type"])}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
              >
                {RECONCILE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <select
                value={reconcileMemberId}
                onChange={(e) => setReconcileMemberId(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
              >
                <option value="">No specific member</option>
                {detail?.members.map((m) => (
                  <option key={m.rider_id} value={m.rider_id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <input
                inputMode="numeric"
                value={reconcileAmount}
                onChange={(e) => setReconcileAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Amount (UGX)"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
              />
              <input
                value={reconcileNarrative}
                onChange={(e) => setReconcileNarrative(e.target.value)}
                placeholder="What happened, and why it's being added now"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowReconcile(false)}
                  className="flex-1 rounded-full border border-[var(--border-faint)] py-2 text-sm font-bold text-ink-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reconcileBusy || !reconcileAmount || !reconcileNarrative.trim()}
                  className="flex-1 rounded-full bg-gold py-2 text-sm font-bold text-ink-gold disabled:opacity-60"
                >
                  {reconcileBusy ? "Saving…" : "Record it"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
