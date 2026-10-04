"use client";

import type { StageReports } from "@peebee/shared";
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

const TABS = ["Contributions", "Loans", "Member Activity", "Cycle Insights"] as const;
type Tab = (typeof TABS)[number];

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-UG", { month: "short" });
}

const PIE_COLORS = ["#C9A227", "#153A75", "#2F855A", "#B45309", "#7C3AED", "#DB2777", "#0891B2", "#DC2626", "#4B5563", "#65A30D"];

function MiniBarChart({ series, valueKey, color, label }: {
  series: StageReports["monthlySeries"];
  valueKey: "contributions" | "loans" | "repayments" | "activeContributors";
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
              title={valueKey === "activeContributors" ? String(s[valueKey]) : formatUgx(s[valueKey])}
            />
            <span className="text-[9px] text-ink-500">{monthLabel(s.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Contributions vs loans, both lines on one chart — a lightweight SVG
 * polyline, no charting library needed for 12 points. */
function TrendLineChart({ series }: { series: StageReports["monthlySeries"] }) {
  const w = 300;
  const h = 100;
  const max = Math.max(1, ...series.map((s) => Math.max(s.contributions, s.loans)));
  const step = w / Math.max(1, series.length - 1);
  const points = (key: "contributions" | "loans") =>
    series.map((s, i) => `${i * step},${h - (s[key] / max) * h}`).join(" ");
  return (
    <div className="home-card !py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Contributions vs loans</p>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gold" />Contributions</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#153A75]" />Loans</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full">
        <polyline points={points("contributions")} fill="none" stroke="#C9A227" strokeWidth="2" />
        <polyline points={points("loans")} fill="none" stroke="#153A75" strokeWidth="2" />
      </svg>
    </div>
  );
}

/** Projected share-out split — each member's proportional slice of the
 * current pot based on their savings this cycle. Actual share-out
 * execution (splitting the real pot at cycle end) isn't automated yet, so
 * this is explicitly labeled as a projection, not a completed payout. */
function ShareOutPie({ topSavers }: { topSavers: StageReports["topSavers"] }) {
  const total = topSavers.reduce((sum, s) => sum + s.saved, 0);
  if (total === 0) return <p className="py-6 text-center text-sm text-ink-500">No savings recorded yet this cycle.</p>;

  let cumulative = 0;
  const radius = 45;
  const cx = 50;
  const cy = 50;
  const slices = topSavers.map((s, i) => {
    const fraction = s.saved / total;
    const startAngle = cumulative * 2 * Math.PI;
    cumulative += fraction;
    const endAngle = cumulative * 2 * Math.PI;
    const x1 = cx + radius * Math.sin(startAngle);
    const y1 = cy - radius * Math.cos(startAngle);
    const x2 = cx + radius * Math.sin(endAngle);
    const y2 = cy - radius * Math.cos(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return { path, color: PIE_COLORS[i % PIE_COLORS.length], name: s.name, fraction };
  });

  return (
    <div className="home-card !py-3">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">Projected share-out (if the cycle ended today)</p>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0">
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} />
          ))}
        </svg>
        <ul className="min-w-0 flex-1 space-y-1">
          {slices.slice(0, 6).map((s, i) => (
            <li key={i} className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
              <span className="shrink-0 font-bold text-ink-500">{Math.round(s.fraction * 100)}%</span>
            </li>
          ))}
        </ul>
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
  const [tab, setTab] = useState<Tab>("Contributions");

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
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Total members</p>
          <p className="text-lg font-extrabold text-ink">{report.totalMembers}</p>
        </div>
        <div className="home-card !py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Total contributions</p>
          <p className="text-lg font-extrabold text-ink">{formatUgx(report.totalSaved)}</p>
        </div>
        <div className="home-card !py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Total loans disbursed</p>
          <p className="text-lg font-extrabold text-ink">{formatUgx(report.totalDisbursed)}</p>
        </div>
        <div className="home-card !py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Outstanding loans</p>
          <p className="text-lg font-extrabold text-ink">{formatUgx(report.outstandingLoans)}</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-full bg-[rgb(var(--surface-muted))] p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-1.5 text-[11px] font-bold ${
              tab === t ? "bg-gold text-ink-gold" : "text-ink-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Contributions" && (
        <div className="space-y-5">
          <p className="text-xs text-ink-500">
            Tracks individual and group savings contributions, for transparency and an overview of financial growth.
          </p>
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
          <p className="text-xs text-ink-500">
            Loan distributions, repayments, and interest earned — helps the group monitor borrowing activity and
            repayment health.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="home-card !py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Total repaid</p>
              <p className="text-lg font-extrabold text-ink">{formatUgx(report.totalRepaid)}</p>
            </div>
            <div className="home-card !py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Interest earned</p>
              <p className="text-lg font-extrabold text-ink">{formatUgx(report.totalInterestEarned)}</p>
            </div>
          </div>
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

      {tab === "Member Activity" && (
        <div className="space-y-5">
          <p className="text-xs text-ink-500">
            Highlights member engagement and participation over time, supporting group decision-making and
            accountability.
          </p>
          <TrendLineChart series={report.monthlySeries} />
          <MiniBarChart series={report.monthlySeries} valueKey="activeContributors" color="#7C3AED" label="Members who saved, per month" />
        </div>
      )}

      {tab === "Cycle Insights" && (
        <div className="space-y-5">
          <p className="text-xs text-ink-500">
            Tracks each savings cycle&apos;s duration, contributions, and loans for effective group operations.
          </p>
          <ShareOutPie topSavers={report.topSavers} />
          {report.cycleHistory.length > 0 ? (
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
          ) : (
            <p className="py-6 text-center text-sm text-ink-500">No cycles yet.</p>
          )}
        </div>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
