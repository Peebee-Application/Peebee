"use client";

import type { StageReports } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { formatUgx } from "../../../../lib/order-display";

const LOAN_STATUS_LABEL: Record<keyof StageReports["loansCount"], string> = {
  pending: "Pending",
  approved: "Approved",
  disbursed: "Disbursed",
  repaid: "Repaid",
  rejected: "Rejected",
  defaulted: "Defaulted",
};

export default function StageReportsPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [report, setReport] = useState<StageReports | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStageReports(stageId)
      .then(setReport)
      .catch((err) => setError(errorMessage(err)));
  }, [stageId]);

  if (!report && error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!report) return <div className="p-4 text-sm text-ink-500">Loading…</div>;

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Reports</h1>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="home-card !py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Total saved</p>
          <p className="text-lg font-extrabold text-ink">{formatUgx(report.totalSaved)}</p>
        </div>
        <div className="home-card !py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Outstanding loans</p>
          <p className="text-lg font-extrabold text-ink">{formatUgx(report.outstandingLoans)}</p>
        </div>
        <div className="home-card !py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Total disbursed</p>
          <p className="text-lg font-extrabold text-ink">{formatUgx(report.totalDisbursed)}</p>
        </div>
        <div className="home-card !py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Total repaid</p>
          <p className="text-lg font-extrabold text-ink">{formatUgx(report.totalRepaid)}</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Loans by status</p>
        <div className="home-card grid grid-cols-3 gap-2 !py-3 text-center">
          {(Object.keys(report.loansCount) as (keyof StageReports["loansCount"])[]).map((key) => (
            <div key={key}>
              <p className="text-lg font-extrabold text-ink">{report.loansCount[key]}</p>
              <p className="text-[10px] text-ink-500">{LOAN_STATUS_LABEL[key]}</p>
            </div>
          ))}
        </div>
      </div>

      {report.topSavers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Top savers this cycle</p>
          <ul className="space-y-2">
            {report.topSavers.map((s, i) => (
              <li key={s.rider_id} className="home-card flex items-center justify-between !rounded-2xl !py-3">
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-ink">{i + 1}</span>
                  <span className="text-sm font-semibold text-ink">{s.name}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-bold text-ink">{formatUgx(s.saved)}</span>
                  <span className="block text-[10px] text-ink-500">{s.shares} shares</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.cycleHistory.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Cycle history</p>
          <ul className="space-y-2">
            {report.cycleHistory.map((cy) => (
              <li key={cy.id} className="home-card flex items-center justify-between !rounded-2xl !py-3">
                <span>
                  <span className="block text-sm text-ink">
                    {cy.start_date} – {cy.end_date}
                  </span>
                  <span className="block text-xs capitalize text-ink-500">
                    {cy.status} · {formatUgx(cy.sharePrice)}/share
                  </span>
                </span>
                <span className="text-sm font-bold text-ink">{formatUgx(cy.totalSaved)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
