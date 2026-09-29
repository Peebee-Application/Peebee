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

const TABS = ["Overview", "Savings", "Loans", "Shareout"] as const;
type Tab = (typeof TABS)[number];

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-UG", { month: "short" });
}

/** Small dependency-free bar chart — mirrors the reference VSLA platform's
 * "Contributions/Loans Per Month" charts closely enough to be recognizable,
 * without pulling in a charting library for a handful of bars. */
function MiniBarChart({ series, valueKey, color, label }: {
  series: StageReports["monthlySeries"];
  valueKey: "contributions" | "loans" | "repayments";
  color: string;
  label: string;
}) {
  const max = Math.max(1, ...series.map((s) => s[valueKey]));
  return (
    <div className="home-card !py-3">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">{label}</p>
      <div className="flex h-28 items-end gap-1.5">
        {series.map((s) => (
          <div key={s.month} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(2, (s[valueKey] / max) * 100)}%`, backgroundColor: color }}
              title={formatUgx(s[valueKey])}
            />
            <span className="text-[9px] text-ink-500">{monthLabel(s.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StageReportsPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [report, setReport] = useState<StageReports | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

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

      <div className="flex gap-1 rounded-full bg-[rgb(var(--surface-muted))] p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-1.5 text-xs font-bold ${
              tab === t ? "bg-gold text-ink-gold" : "text-ink-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-5">
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

          <MiniBarChart series={report.monthlySeries} valueKey="contributions" color="#C9A227" label="Contributions per month" />

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
        </div>
      )}

      {tab === "Savings" && (
        <div className="space-y-5">
          <MiniBarChart series={report.monthlySeries} valueKey="contributions" color="#C9A227" label="Contributions per month" />
          {report.topSavers.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Top savers</p>
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
        </div>
      )}

      {tab === "Loans" && (
        <div className="space-y-5">
          <div className="home-card grid grid-cols-3 gap-2 !py-3 text-center">
            {(Object.keys(report.loansCount) as (keyof StageReports["loansCount"])[]).map((key) => (
              <div key={key}>
                <p className="text-lg font-extrabold text-ink">{report.loansCount[key]}</p>
                <p className="text-[10px] text-ink-500">{LOAN_STATUS_LABEL[key]}</p>
              </div>
            ))}
          </div>
          <MiniBarChart series={report.monthlySeries} valueKey="loans" color="#153A75" label="Loans disbursed per month" />
          <MiniBarChart series={report.monthlySeries} valueKey="repayments" color="#2F855A" label="Repayments per month" />
        </div>
      )}

      {tab === "Shareout" && (
        <div className="space-y-5">
          {report.cycleHistory.length > 0 ? (
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
          ) : (
            <p className="py-6 text-center text-sm text-ink-500">No cycles yet.</p>
          )}
          <p className="rounded-lg bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs text-ink-500">
            Share-out (splitting the pot among members at cycle end) isn&apos;t automated yet — officers record it as a
            ledger entry when a cycle closes.
          </p>
        </div>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
