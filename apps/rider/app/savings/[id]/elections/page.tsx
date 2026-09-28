"use client";

import type { StageDetail, StageElection, StageMemberRole } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";

const OFFICER_ROLES: StageMemberRole[] = ["chairman", "vice_chairman", "secretary", "treasurer", "money_counter", "mobilizer"];

export default function StageElectionsPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [elections, setElections] = useState<StageElection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickCandidateFor, setPickCandidateFor] = useState<string | null>(null);

  async function load() {
    const [d, e] = await Promise.all([api.getStage(stageId), api.getStageElections(stageId)]);
    setDetail(d);
    setElections(e.elections);
  }

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [stageId]);

  async function openElection(role: StageMemberRole) {
    try {
      await api.openStageElection(stageId, role);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function nominate(electionId: string, candidateRiderId: string) {
    try {
      await api.nominateForElection(electionId, candidateRiderId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function vote(electionId: string, candidateRiderId: string) {
    try {
      await api.voteInElection(electionId, candidateRiderId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
    setPickCandidateFor(null);
  }

  const openElections = elections.filter((e) => e.status === "open");
  const filledRoles = new Set(detail?.members.filter((m) => m.role !== "member").map((m) => m.role) ?? []);
  const openableRoles = OFFICER_ROLES.filter(
    (r) => !filledRoles.has(r) && !openElections.some((e) => e.role === r),
  );

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Officer elections</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {openElections.length === 0 && (
        <p className="text-sm text-ink-500">No open votes right now.</p>
      )}

      {openElections.map((election) => (
        <div key={election.id} className="home-card space-y-2.5">
          <p className="text-sm font-bold capitalize text-ink">Voting for {election.role.replace("_", " ")}</p>
          {election.nominees.length === 0 ? (
            <p className="text-xs text-ink-500">No one nominated yet.</p>
          ) : (
            <div className="space-y-1.5">
              {election.nominees.map((n) => (
                <button
                  key={n.candidate_rider_id}
                  onClick={() => vote(election.id, n.candidate_rider_id)}
                  className="flex w-full items-center justify-between rounded-xl border border-[var(--border-faint)] px-3 py-2"
                >
                  <span className="text-sm font-semibold text-ink">{n.name}</span>
                  <span className="text-xs font-bold text-gold">{n.votes} vote{n.votes === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          )}

          {pickCandidateFor === election.id ? (
            <div className="space-y-1.5 rounded-xl bg-[rgb(var(--surface-muted))] p-2.5">
              {detail?.members.map((m) => (
                <button
                  key={m.rider_id}
                  onClick={() => nominate(election.id, m.rider_id)}
                  className="block w-full rounded-lg bg-[rgb(var(--surface-card))] px-3 py-1.5 text-left text-sm text-ink"
                >
                  {m.name}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickCandidateFor(election.id)}
              className="w-full rounded-full border border-dashed border-[var(--border-faint)] py-2 text-xs font-bold text-ink-500"
            >
              Nominate someone
            </button>
          )}
        </div>
      ))}

      {openableRoles.length > 0 && (
        <div className="home-card space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Open a new vote</p>
          <div className="flex flex-wrap gap-2">
            {openableRoles.map((role) => (
              <button
                key={role}
                onClick={() => openElection(role)}
                className="rounded-full border border-[var(--border-faint)] px-3 py-1.5 text-xs font-bold capitalize text-ink"
              >
                {role.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
