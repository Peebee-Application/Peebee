"use client";

import type { StageElectionRoleStatus, StageElectionSessionDetail, StageMemberRole } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { VoiceReasonRecorder } from "../../../../components/VoiceReasonRecorder";

const OFFICER_ROLES: StageMemberRole[] = ["chairman", "vice_chairman", "secretary", "treasurer", "money_counter", "mobilizer"];

function timeLeft(deadline: string | null): string {
  if (!deadline) return "";
  const ms = new Date(deadline.replace(" ", "T") + "Z").getTime() - Date.now();
  if (ms <= 0) return "closed";
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
}

export default function StageElectionsPage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const { user } = useAuth();
  const [detail, setDetail] = useState<StageElectionSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingTo, setApplyingTo] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  // Start-session form
  const [showStart, setShowStart] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<StageMemberRole[]>([]);
  const [nominationDeadline, setNominationDeadline] = useState("");
  const [startBusy, setStartBusy] = useState(false);

  // Start-voting form
  const [votingHours, setVotingHours] = useState("6");
  const [votingBusy, setVotingBusy] = useState(false);

  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  function load() {
    api
      .getActiveElectionSession(stageId)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }

  useEffect(() => {
    load();
  }, [stageId]);

  async function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (selectedRoles.length === 0 || !nominationDeadline) return;
    setStartBusy(true);
    setError(null);
    try {
      await api.startElectionSession(stageId, {
        roles: selectedRoles,
        nominationDeadline: new Date(nominationDeadline).toISOString(),
      });
      setShowStart(false);
      setSelectedRoles([]);
      setNominationDeadline("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStartBusy(false);
    }
  }

  async function apply(electionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.applyForElection(electionId, statement.trim() || undefined);
      if (voiceBlob) await api.uploadElectionVoiceNote(electionId, voiceBlob);
      setApplyingTo(null);
      setStatement("");
      setVoiceBlob(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function startVoting(sessionId: string) {
    setVotingBusy(true);
    setError(null);
    try {
      await api.startElectionVoting(stageId, sessionId, Number(votingHours) || 6);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setVotingBusy(false);
    }
  }

  async function vote(electionId: string, candidateRiderId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.voteInElection(electionId, candidateRiderId);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function publish(sessionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.publishElectionResults(stageId, sessionId);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function playVoice(electionId: string, candidateRiderId: string) {
    const key = `${electionId}:${candidateRiderId}`;
    setPlayingAudio(key);
    try {
      const blob = await api.electionVoiceNoteBlob(electionId, candidateRiderId);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPlayingAudio(null);
    }
  }

  if (!detail && error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!detail) return <div className="p-4 text-sm text-ink-500">Loading…</div>;

  const { session, elections, isManager } = detail;

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Officer elections</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!session ? (
        <div className="home-card space-y-3 text-center">
          <p className="text-sm text-ink-500">No election is running right now.</p>
          {isManager &&
            (!showStart ? (
              <button
                type="button"
                onClick={() => setShowStart(true)}
                className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold"
              >
                Start an election
              </button>
            ) : (
              <form onSubmit={startSession} className="space-y-3 text-left">
                <p className="text-xs font-semibold text-ink-500">Which roles are up for election?</p>
                <div className="flex flex-wrap gap-2">
                  {OFFICER_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() =>
                        setSelectedRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize ${
                        selectedRoles.includes(role) ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
                      }`}
                    >
                      {role.replace("_", " ")}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="nomDeadline">
                    Applications close at
                  </label>
                  <input
                    id="nomDeadline"
                    type="datetime-local"
                    value={nominationDeadline}
                    onChange={(e) => setNominationDeadline(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
                  />
                </div>
                <button
                  type="submit"
                  disabled={startBusy || selectedRoles.length === 0 || !nominationDeadline}
                  className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
                >
                  {startBusy ? "Starting…" : "Open applications"}
                </button>
              </form>
            ))}
        </div>
      ) : (
        <>
          <div className="home-card !py-3 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">
              {session.status === "nominating" && "Applications open"}
              {session.status === "voting" && "Voting open"}
              {session.status === "closed" && "Voting closed — awaiting results"}
              {session.status === "published" && "Results published"}
            </p>
            {session.status === "nominating" && <p className="text-xs text-ink-500">{timeLeft(session.nomination_deadline)}</p>}
            {session.status === "voting" && <p className="text-xs text-ink-500">{timeLeft(session.voting_deadline)}</p>}
          </div>

          {elections.map((election: StageElectionRoleStatus) => {
            const iApplied = election.nominees.some((n) => n.candidate_rider_id === user?.id);
            const appliedElsewhere =
              !iApplied && elections.some((e) => e.id !== election.id && e.nominees.some((n) => n.candidate_rider_id === user?.id));
            return (
              <div key={election.id} className="home-card space-y-3">
                <p className="text-sm font-bold capitalize text-ink">{election.role.replace("_", " ")}</p>

                {election.winner_rider_id && session.status === "published" && (
                  <p className="rounded-lg bg-green/10 px-3 py-2 text-xs font-bold text-green">
                    Elected: {election.nominees.find((n) => n.candidate_rider_id === election.winner_rider_id)?.name ?? "—"}
                  </p>
                )}

                {election.nominees.length === 0 ? (
                  <p className="text-xs text-ink-500">No one has applied yet.</p>
                ) : (
                  <div className="space-y-2">
                    {election.nominees.map((n) => (
                      <div key={n.candidate_rider_id} className="rounded-xl border border-[var(--border-faint)] p-3">
                        <div className="flex items-start gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-ink">
                            {n.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-ink">{n.name}</p>
                            <p className="text-[11px] text-ink-500">
                              {n.rating != null ? `${n.rating.toFixed(1)}★` : "No rating yet"}
                              {n.vehicle_info ? ` · ${n.vehicle_info}` : ""} · on Tuma since{" "}
                              {new Date(n.member_since.replace(" ", "T") + "Z").toLocaleDateString("en-UG", { year: "numeric", month: "short" })}
                            </p>
                            {n.statement && <p className="mt-1 text-xs text-ink">{n.statement}</p>}
                            {n.voice_note_key && (
                              <button
                                type="button"
                                onClick={() => playVoice(election.id, n.candidate_rider_id)}
                                disabled={playingAudio === `${election.id}:${n.candidate_rider_id}`}
                                className="mt-1 text-xs font-bold text-gold disabled:opacity-60"
                              >
                                ▶ Play voice note
                              </button>
                            )}
                            {session.status !== "nominating" && election.tallies && (
                              <p className="mt-1 text-xs font-bold text-ink-500">{election.tallies[n.candidate_rider_id] ?? 0} vote(s)</p>
                            )}
                          </div>
                        </div>
                        {session.status === "voting" && (
                          <button
                            type="button"
                            onClick={() => vote(election.id, n.candidate_rider_id)}
                            disabled={busy || (election.myVote === n.candidate_rider_id) || (election.myVote != null && !election.canChangeVote)}
                            className={`mt-2 w-full rounded-full py-2 text-xs font-bold disabled:opacity-50 ${
                              election.myVote === n.candidate_rider_id ? "bg-green/20 text-green" : "bg-gold text-ink-gold"
                            }`}
                          >
                            {election.myVote === n.candidate_rider_id
                              ? "Your vote"
                              : election.myVote && !election.canChangeVote
                                ? "Vote locked"
                                : "Vote"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {session.status === "nominating" && !iApplied && appliedElsewhere && (
                  <p className="text-center text-xs text-ink-500">
                    You&apos;ve already applied for another role — one position per member per election.
                  </p>
                )}

                {session.status === "nominating" && !iApplied && !appliedElsewhere && (
                  <>
                    {applyingTo === election.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={statement}
                          onChange={(e) => setStatement(e.target.value)}
                          placeholder="Why should members vote for you?"
                          rows={3}
                          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
                        />
                        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-faint)] px-3 py-2">
                          <span className="text-xs text-ink-500">Voice note (optional):</span>
                          <VoiceReasonRecorder blob={voiceBlob} onChange={setVoiceBlob} />
                        </div>
                        <button
                          type="button"
                          onClick={() => apply(election.id)}
                          disabled={busy}
                          className="w-full rounded-full bg-gold py-2 text-xs font-bold text-ink-gold disabled:opacity-60"
                        >
                          {busy ? "Submitting…" : "Submit application"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setApplyingTo(election.id)}
                        className="w-full rounded-full border border-dashed border-[var(--border-faint)] py-2 text-xs font-bold text-ink-500"
                      >
                        Apply for this role
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {isManager && session.status === "nominating" && (
            <div className="home-card space-y-2">
              <label className="text-xs font-semibold text-ink-500" htmlFor="votingHours">
                Voting duration (hours)
              </label>
              <input
                id="votingHours"
                inputMode="numeric"
                value={votingHours}
                onChange={(e) => setVotingHours(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm outline-none focus:border-gold"
              />
              <button
                type="button"
                onClick={() => startVoting(session.id)}
                disabled={votingBusy}
                className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
              >
                {votingBusy ? "Starting…" : "Close applications & start voting"}
              </button>
            </div>
          )}

          {isManager && session.status === "closed" && (
            <button
              type="button"
              onClick={() => publish(session.id)}
              disabled={busy}
              className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
            >
              {busy ? "Publishing…" : "Publish results"}
            </button>
          )}
        </>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
