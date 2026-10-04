"use client";

import type { AdminStageDetail, StageTransaction } from "@peebee/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../lib/api";

const TYPE_LABEL: Record<StageTransaction["type"], string> = {
  contribution: "Savings contribution",
  loan_disbursement: "Loan disbursed",
  repayment: "Loan repayment",
  share_out: "Share-out",
  fine: "Fine",
  expense: "Expense",
};

function formatUgx(n: number) {
  return `UGX ${n.toLocaleString("en-UG")}`;
}

export default function AdminStageDetailPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const [detail, setDetail] = useState<AdminStageDetail | null>(null);
  const [transactions, setTransactions] = useState<StageTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.adminGetStage(stageId), api.adminGetStageLedger(stageId)])
      .then(([d, l]) => {
        setDetail(d);
        setTransactions(l.transactions);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [stageId]);

  if (error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!detail) return <div className="p-4 text-sm text-ink-500">Loading…</div>;

  const pot = (transactions ?? []).reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">{detail.stage.name}</h1>
      <p className="text-sm text-ink-500">{detail.members.length} members</p>

      <div className="home-card !py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Group pot</p>
        <p className="text-lg font-extrabold text-ink">{formatUgx(pot)}</p>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Members</p>
        <ul className="space-y-1.5">
          {detail.members.map((m) => (
            <li key={m.rider_id} className="flex items-center justify-between rounded-xl border border-[var(--border-faint)] px-3 py-2">
              <span className="text-sm text-ink">{m.name}</span>
              <span className="text-xs font-semibold capitalize text-ink-500">{m.role.replace("_", " ")}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Ledger</p>
        <ul className="space-y-1.5">
          {(transactions ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-xl border border-[var(--border-faint)] px-3 py-2">
              <span className="text-sm text-ink">
                {TYPE_LABEL[t.type]} <span className="text-ink-500">· {t.member_name ?? "—"}</span>
              </span>
              <span className={`text-sm font-bold ${t.amount >= 0 ? "text-green" : "text-red-600"}`}>
                {t.amount >= 0 ? "+" : ""}
                {formatUgx(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
