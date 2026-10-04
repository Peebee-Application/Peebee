"use client";

import type { StageDetail, StageMemberRole } from "@peebee/shared";
import { Check } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";

const OFFICER_ROLES = ["chairman", "vice_chairman", "secretary", "treasurer", "money_counter", "mobilizer"] as const;
const ROLE_OPTIONS = ["member", ...OFFICER_ROLES] as const;

/** The 5-step guided RSLA launch wizard: activate → add a cycle → add an
 * approval workflow → add members → define member roles → launch. Steps
 * 2–3 reuse the existing cycle-setup screen (no need to duplicate that
 * form here); step 4 reuses the stage page's invite flow; step 5 (direct
 * role assignment, since a brand-new circle has no voting history to
 * elect from yet) lives inline below. Every step stays editable after
 * launch — this page doesn't disappear once the RSLA goes live. */
export default function StageSetupPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);

  function load() {
    api
      .getStage(stageId)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }

  useEffect(() => {
    load();
  }, [stageId]);

  if (!detail && error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!detail) return <div className="p-4 text-sm text-ink-500">Loading…</div>;

  if (!detail.isGroupAdmin && !(OFFICER_ROLES as readonly string[]).includes(detail.myRole)) {
    return <div className="p-4 text-sm text-ink-500">Only the group admin or an elected officer can set this up.</div>;
  }

  const hasCycle = !!detail.cycle;
  const hasWorkflow = detail.approvalWorkflow.length > 0;
  const hasMembers = detail.members.length > 1;
  const hasRoles = detail.members.some((m) => (OFFICER_ROLES as readonly string[]).includes(m.role));
  const canLaunch = hasCycle && hasWorkflow;
  const launched = !!detail.stage.rsla_launched_at;

  async function assignRole(riderId: string, role: StageMemberRole) {
    setRoleBusyId(riderId);
    setError(null);
    try {
      await api.setStageMemberRole(stageId, riderId, role);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRoleBusyId(null);
    }
  }

  async function launch() {
    setLaunching(true);
    setError(null);
    try {
      await api.launchStage(stageId);
      router.push(`/savings/${stageId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Set up {detail.stage.name} RSLA</h1>
        <p className="text-sm text-ink-500">
          {launched ? "Live — you can still adjust any step below." : "Work through these steps, then launch."}
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <StepRow n={1} label="Activate RSLA" done>
        <p className="text-xs text-ink-500">{detail.stage.name} RSLA — done.</p>
      </StepRow>

      <StepRow n={2} label="Add a cycle" done={hasCycle}>
        <Link href={`/savings/${stageId}/cycle-setup`} className="text-xs font-bold text-gold">
          {hasCycle ? "Edit cycle details →" : "Set start date, share price, interest, loan terms →"}
        </Link>
      </StepRow>

      <StepRow n={3} label="Add an approval workflow" done={hasWorkflow}>
        <Link href={`/savings/${stageId}/cycle-setup`} className="text-xs font-bold text-gold">
          {hasWorkflow ? "Edit approval workflow →" : "Choose who votes on loan requests →"}
        </Link>
      </StepRow>

      <StepRow n={4} label="Add members" done={hasMembers} optional>
        <Link href={`/savings/${stageId}`} className="text-xs font-bold text-gold">
          Invite members from the circle page →
        </Link>
      </StepRow>

      <StepRow n={5} label="Define member roles" done={hasRoles} optional>
        <div className="space-y-2">
          {detail.members.map((m) => (
            <div key={m.rider_id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.name}</span>
              <select
                value={m.role}
                disabled={roleBusyId === m.rider_id}
                onChange={(e) => assignRole(m.rider_id, e.target.value as StageMemberRole)}
                className="rounded-lg border border-[var(--border-faint)] px-2 py-1 text-xs font-semibold capitalize text-ink outline-none focus:border-gold disabled:opacity-60"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <p className="text-[11px] text-ink-500">
            You can re-elect these later via Elections once the circle has a track record.
          </p>
        </div>
      </StepRow>

      {!launched && (
        <button
          type="button"
          onClick={launch}
          disabled={!canLaunch || launching}
          className="min-h-12 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50"
        >
          {launching ? "Launching…" : canLaunch ? "Launch RSLA" : "Add a cycle and workflow to launch"}
        </button>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}

function StepRow({ n, label, done, optional, children }: { n: number; label: string; done: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="home-card space-y-2">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done ? "bg-green/20 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"
          }`}
        >
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : n}
        </span>
        <span className="text-sm font-bold text-ink">{label}</span>
        {optional && <span className="text-[10px] text-ink-500">(optional for now)</span>}
      </div>
      <div className="pl-8.5">{children}</div>
    </div>
  );
}
