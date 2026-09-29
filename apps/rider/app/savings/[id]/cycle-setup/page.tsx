"use client";

import type { StageDetail, StageLoanApprovalWorkflowRow, StageMemberRole } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";

const OFFICER_ROLES = ["chairman", "vice_chairman", "secretary", "treasurer", "money_counter", "mobilizer"] as const;

/** Group-admin-owned cycle configuration — duration, share price, interest,
 * loanable multiple, max loan duration, and the per-role loan approval
 * quorum. Deliberately not on the platform admin settings screen: those
 * are only fallback defaults a brand-new circle starts from. Every stage's
 * own group admin (or an elected officer) sets the real numbers for their
 * circle here. */
export default function CycleSetupPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [cycleMonths, setCycleMonths] = useState("12");
  const [sharePrice, setSharePrice] = useState("1000");
  const [interestRate, setInterestRate] = useState("8");
  const [loanableMultiple, setLoanableMultiple] = useState("2");
  const [maxLoanMonths, setMaxLoanMonths] = useState("3");

  const [workflow, setWorkflow] = useState<StageLoanApprovalWorkflowRow[]>([]);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowSaved, setWorkflowSaved] = useState(false);

  const [endDate, setEndDate] = useState("");
  const [editingCycle, setEditingCycle] = useState(false);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [cycleSaved, setCycleSaved] = useState(false);

  async function load() {
    try {
      const fresh = await api.getStage(stageId);
      setDetail(fresh);
      setWorkflow(fresh.approvalWorkflow.length > 0 ? fresh.approvalWorkflow : defaultWorkflow());
      if (fresh.cycle) {
        setSharePrice(String(fresh.cycle.share_price));
        setInterestRate(String(fresh.cycle.interest_rate));
        setLoanableMultiple(String(fresh.cycle.loanable_contribution_multiple));
        setMaxLoanMonths(String(fresh.cycle.max_loan_duration_months));
        setEndDate(fresh.cycle.end_date);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, [stageId]);

  function defaultWorkflow(): StageLoanApprovalWorkflowRow[] {
    return (["chairman", "secretary", "treasurer"] as StageMemberRole[]).map((role) => ({
      role,
      approvals_required: 1,
      rejections_required: 1,
    }));
  }

  async function startCycle(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.startStageCycle(stageId, {
        startDate,
        cycleMonths: Number(cycleMonths) || undefined,
        sharePrice: Number(sharePrice) || undefined,
        interestRate: Number(interestRate) || undefined,
        loanableContributionMultiple: Number(loanableMultiple) || undefined,
        maxLoanDurationMonths: Number(maxLoanMonths) || undefined,
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function updateWorkflowRow(role: StageMemberRole, field: "approvals_required" | "rejections_required", value: string) {
    setWorkflow((prev) => prev.map((w) => (w.role === role ? { ...w, [field]: Math.max(0, Number(value) || 0) } : w)));
  }

  function toggleRole(role: StageMemberRole) {
    setWorkflow((prev) =>
      prev.some((w) => w.role === role)
        ? prev.filter((w) => w.role !== role)
        : [...prev, { role, approvals_required: 1, rejections_required: 1 }],
    );
  }

  async function saveCycle(e: React.FormEvent) {
    e.preventDefault();
    if (!detail?.cycle) return;
    setCycleBusy(true);
    setCycleSaved(false);
    setError(null);
    try {
      await api.updateStageCycle(stageId, detail.cycle.id, {
        endDate: endDate || undefined,
        sharePrice: Number(sharePrice) || undefined,
        interestRate: interestRate === "" ? undefined : Number(interestRate),
        loanableContributionMultiple: Number(loanableMultiple) || undefined,
        maxLoanDurationMonths: Number(maxLoanMonths) || undefined,
      });
      setCycleSaved(true);
      setEditingCycle(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCycleBusy(false);
    }
  }

  async function saveWorkflow() {
    if (!detail?.cycle) return;
    setWorkflowBusy(true);
    setWorkflowSaved(false);
    setError(null);
    try {
      await api.setStageLoanWorkflow(stageId, detail.cycle.id, workflow);
      setWorkflowSaved(true);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorkflowBusy(false);
    }
  }

  if (!detail && error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!detail) return <div className="p-4 text-sm text-ink-500">Loading…</div>;

  if (!detail.isGroupAdmin && !(OFFICER_ROLES as readonly string[]).includes(detail.myRole)) {
    return <div className="p-4 text-sm text-ink-500">Only the group admin or an elected officer can configure this circle.</div>;
  }

  return (
    <div className="space-y-6 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Cycle setup</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {detail.cycle ? (
        <div className="home-card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Active cycle</p>
            {!editingCycle && (
              <button type="button" onClick={() => setEditingCycle(true)} className="text-xs font-bold text-gold">
                Edit
              </button>
            )}
          </div>
          <p className="text-sm text-ink">Started {detail.cycle.start_date}</p>

          {editingCycle ? (
            <form onSubmit={saveCycle} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-500" htmlFor="end-date">
                  End date
                </label>
                <input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-gold"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Share price (UGX)" value={sharePrice} onChange={setSharePrice} />
                <Field label="Interest rate (%)" value={interestRate} onChange={setInterestRate} />
                <Field label="Loanable multiple" value={loanableMultiple} onChange={setLoanableMultiple} hint="Max loan = savings × this" />
                <Field label="Max loan duration (months)" value={maxLoanMonths} onChange={setMaxLoanMonths} />
              </div>
              <p className="rounded-lg bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs text-ink-500">
                Changes apply going forward only — already-recorded contributions and loans keep their original amounts.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingCycle(false)}
                  className="flex-1 rounded-full border border-[var(--border-faint)] py-2.5 text-sm font-bold text-ink-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={cycleBusy}
                  className="flex-1 rounded-full bg-gold py-2.5 text-sm font-bold text-ink-gold disabled:opacity-60"
                >
                  {cycleBusy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-sm text-ink">Ends {detail.cycle.end_date}</p>
              <p className="text-xs text-ink-500">
                {detail.cycle.share_price.toLocaleString("en-UG")} UGX/share · {detail.cycle.interest_rate}% interest ·
                loanable ×{detail.cycle.loanable_contribution_multiple} · max {detail.cycle.max_loan_duration_months}mo loans
              </p>
              {cycleSaved && <p className="text-xs text-green">Saved.</p>}
            </>
          )}
        </div>
      ) : (
        <form onSubmit={startCycle} className="home-card space-y-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Start a savings cycle</p>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="start-date">
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-gold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cycle length (months)" value={cycleMonths} onChange={setCycleMonths} />
            <Field label="Share price (UGX)" value={sharePrice} onChange={setSharePrice} />
            <Field label="Interest rate (%)" value={interestRate} onChange={setInterestRate} />
            <Field label="Loanable multiple" value={loanableMultiple} onChange={setLoanableMultiple} hint="Max loan = savings × this" />
            <Field label="Max loan duration (months)" value={maxLoanMonths} onChange={setMaxLoanMonths} />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
          >
            {busy ? "Starting…" : "Start cycle"}
          </button>
        </form>
      )}

      <div className="home-card space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Loan approval workflow</p>
        <p className="text-xs text-ink-500">
          Choose which officer roles must vote on a loan request, and how many approvals or rejections decide it.
        </p>
        <div className="space-y-2">
          {OFFICER_ROLES.map((role) => {
            const row = workflow.find((w) => w.role === role);
            return (
              <div key={role} className="rounded-xl border border-[var(--border-faint)] p-2.5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!row}
                    onChange={() => toggleRole(role)}
                    className="h-4 w-4 accent-gold"
                  />
                  <span className="text-sm font-semibold capitalize text-ink">{role.replace("_", " ")}</span>
                </label>
                {row && (
                  <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                    <div>
                      <label className="text-[11px] text-ink-500">Approvals needed</label>
                      <input
                        inputMode="numeric"
                        value={row.approvals_required}
                        onChange={(e) => updateWorkflowRow(role, "approvals_required", e.target.value)}
                        className="w-full rounded-lg border border-[var(--border-faint)] px-2 py-1 text-sm font-bold text-ink outline-none focus:border-gold"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-ink-500">Rejections needed</label>
                      <input
                        inputMode="numeric"
                        value={row.rejections_required}
                        onChange={(e) => updateWorkflowRow(role, "rejections_required", e.target.value)}
                        className="w-full rounded-lg border border-[var(--border-faint)] px-2 py-1 text-sm font-bold text-ink outline-none focus:border-gold"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={saveWorkflow}
          disabled={workflowBusy || !detail.cycle}
          className="min-h-11 w-full rounded-full border border-gold px-4 text-sm font-bold text-gold disabled:opacity-50"
        >
          {!detail.cycle ? "Start a cycle first" : workflowBusy ? "Saving…" : "Save approval workflow"}
        </button>
        {workflowSaved && <p className="text-center text-xs text-green">Saved.</p>}
      </div>

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}

function Field({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-ink-500">{label}</label>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm font-bold text-ink outline-none focus:border-gold"
      />
      {hint && <p className="text-[10px] text-ink-500">{hint}</p>}
    </div>
  );
}
