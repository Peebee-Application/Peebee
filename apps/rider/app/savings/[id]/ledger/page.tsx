"use client";

import type { StageTransaction } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { formatUgx } from "../../../../lib/order-display";

const TYPE_LABEL: Record<StageTransaction["type"], string> = {
  contribution: "Savings contribution",
  loan_disbursement: "Loan disbursed",
  repayment: "Loan repayment",
  share_out: "Share-out",
  fine: "Fine",
  expense: "Expense",
};

export default function StageLedgerPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [transactions, setTransactions] = useState<StageTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStageLedger(stageId)
      .then((res) => setTransactions(res.transactions))
      .catch((err) => setError(errorMessage(err)));
  }, [stageId]);

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
            <li key={t.id} className="home-card flex items-center justify-between !rounded-2xl !py-3">
              <span>
                <span className="block text-sm text-ink">{TYPE_LABEL[t.type]}</span>
                <span className="block text-xs text-ink-500">{t.member_name ?? "—"}</span>
              </span>
              <span className={`text-sm font-bold ${t.amount >= 0 ? "text-green" : "text-red-600"}`}>
                {t.amount >= 0 ? "+" : ""}
                {formatUgx(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
