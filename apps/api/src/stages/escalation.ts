import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getVslaSettings } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";

type Overdue = {
  id: string;
  stage_id: string;
  member_id: string;
  member_name: string;
  amount: number;
  kind: "contribution" | "repayment";
};

async function findOverdueContributions(hours: number): Promise<Overdue[]> {
  const res = await db.execute({
    sql: `SELECT c.id, c.stage_id, c.member_id, u.name AS member_name, c.amount
          FROM stage_contributions c JOIN users u ON u.id = c.member_id
          WHERE c.status = 'pending' AND c.escalated_at IS NULL
            AND c.created_at <= datetime('now', ?)`,
    args: [`-${hours} hours`],
  });
  return (res.rows as unknown as Omit<Overdue, "kind">[]).map((r) => ({ ...r, kind: "contribution" as const }));
}

async function findOverdueRepayments(hours: number): Promise<Overdue[]> {
  const res = await db.execute({
    sql: `SELECT r.id, l.stage_id, l.member_id, u.name AS member_name, r.amount
          FROM stage_repayments r
          JOIN stage_loans l ON l.id = r.loan_id
          JOIN users u ON u.id = l.member_id
          WHERE r.status = 'pending' AND r.escalated_at IS NULL
            AND r.created_at <= datetime('now', ?)`,
    args: [`-${hours} hours`],
  });
  return (res.rows as unknown as Omit<Overdue, "kind">[]).map((r) => ({ ...r, kind: "repayment" as const }));
}

/** Nudges a member (push notification) and posts a system message the
 * treasurer will see in the circle chat, once a declared saving/repayment
 * has sat unconfirmed past the admin-set window. Runs on the same
 * heartbeat cron as the payment-provider reconciliation sweep. */
export async function sweepStageEscalations(): Promise<{ escalated: number }> {
  const settings = await getVslaSettings();
  const [contributions, repayments] = await Promise.all([
    findOverdueContributions(settings.unconfirmedIntentEscalationHours),
    findOverdueRepayments(settings.unconfirmedIntentEscalationHours),
  ]);
  const overdue = [...contributions, ...repayments];

  for (const item of overdue) {
    const table = item.kind === "contribution" ? "stage_contributions" : "stage_repayments";
    await db.execute({
      sql: `UPDATE ${table} SET escalated_at = datetime('now') WHERE id = ?`,
      args: [item.id],
    });
    await db.execute({
      sql: `INSERT INTO stage_messages (id, stage_id, sender_id, body, type, system_event_type, related_id)
            VALUES (?, ?, 'system', ?, 'system', 'intent_overdue', ?)`,
      args: [
        newId("smsg"),
        item.stage_id,
        `${item.member_name}'s ${item.kind === "contribution" ? "savings" : "repayment"} of UGX ${item.amount.toLocaleString("en-UG")} is still unconfirmed. Call or message them if you haven't received it.`,
        item.id,
      ],
    });
    await notifyUser(item.member_id, {
      title: "Still waiting on confirmation",
      body: `Your ${item.kind === "contribution" ? "savings" : "repayment"} of UGX ${item.amount.toLocaleString("en-UG")} hasn't been confirmed yet. Call or message your treasurer.`,
      url: "/savings",
      tag: `stage-intent-${item.id}`,
    }).catch(() => {});
  }

  return { escalated: overdue.length };
}

type OverdueLoan = { id: string; stage_id: string; cycle_id: string; member_id: string; member_name: string; days_overdue: number };

/** Applies each cycle's configured fine types to loans still overdue on
 * repayment, catching up whatever's due since the last sweep (so a
 * "daily" fine still lands correctly even if this only ran every few
 * hours) without ever double-charging. Each application is an ordinary
 * stage_transactions row (type='fine'), same as contributions/repayments
 * — no money moves, it's a record the group's officers act on. */
export async function sweepStageFines(): Promise<{ applied: number }> {
  const overdueRes = await db.execute({
    sql: `SELECT l.id, l.stage_id, l.cycle_id, l.member_id, u.name AS member_name,
                 CAST(julianday('now') - julianday(l.due_date) AS INTEGER) AS days_overdue
          FROM stage_loans l JOIN users u ON u.id = l.member_id
          WHERE l.status = 'disbursed' AND l.due_date < date('now')`,
    args: [],
  });
  const overdueLoans = overdueRes.rows as unknown as OverdueLoan[];
  let applied = 0;

  for (const loan of overdueLoans) {
    const fineTypesRes = await db.execute({
      sql: "SELECT id, name, schedule, amount FROM stage_fine_types WHERE cycle_id = ?",
      args: [loan.cycle_id],
    });
    const fineTypes = fineTypesRes.rows as unknown as { id: string; name: string; schedule: string; amount: number }[];
    if (fineTypes.length === 0) continue;

    for (const fine of fineTypes) {
      const expectedCount =
        fine.schedule === "flat"
          ? loan.days_overdue > 0
            ? 1
            : 0
          : fine.schedule === "daily"
            ? loan.days_overdue
            : fine.schedule === "weekly"
              ? Math.floor(loan.days_overdue / 7)
              : Math.floor(loan.days_overdue / 30);
      if (expectedCount <= 0) continue;

      const narrative = `Fine: ${fine.name}`;
      const existingRes = await db.execute({
        sql: "SELECT COUNT(*) AS n FROM stage_transactions WHERE type = 'fine' AND related_id = ? AND narrative = ?",
        args: [loan.id, narrative],
      });
      const existingCount = Number((existingRes.rows[0] as unknown as { n: number } | undefined)?.n) || 0;
      const toApply = expectedCount - existingCount;
      if (toApply <= 0) continue;

      for (let i = 0; i < toApply; i++) {
        await db.execute({
          sql: `INSERT INTO stage_transactions (id, stage_id, cycle_id, member_id, type, amount, narrative, related_id)
                VALUES (?, ?, ?, ?, 'fine', ?, ?, ?)`,
          args: [newId("stxn"), loan.stage_id, loan.cycle_id, loan.member_id, fine.amount, narrative, loan.id],
        });
        applied++;
      }
      await db.execute({
        sql: `INSERT INTO stage_messages (id, stage_id, sender_id, body, type, system_event_type, related_id)
              VALUES (?, ?, 'system', ?, 'system', 'fine_applied', ?)`,
        args: [newId("smsg"), loan.stage_id, `${loan.member_name} was fined UGX ${(fine.amount * toApply).toLocaleString("en-UG")} (${fine.name}) for a loan still overdue.`, loan.id],
      });
      await notifyUser(loan.member_id, {
        title: "A fine was applied",
        body: `${fine.name}: UGX ${(fine.amount * toApply).toLocaleString("en-UG")} — your loan repayment is overdue.`,
        url: `/savings/${loan.stage_id}/loan`,
        tag: `stage-fine-${loan.id}-${fine.id}`,
      }).catch(() => {});
    }
  }

  return { applied };
}

/** Auto-closes any election session whose voting_deadline has passed:
 * tallies each role's votes (highest count wins; a tie is left
 * unresolved for the group admin to break by hand via direct role
 * assignment), writes the winner into stage_members.role, and moves the
 * session to 'closed' — results stay hidden from ordinary members until
 * the group admin explicitly calls POST .../publish. */
export async function sweepElectionSessions(): Promise<{ closed: number }> {
  const dueRes = await db.execute({
    sql: `SELECT id, stage_id FROM stage_election_sessions
          WHERE status = 'voting' AND voting_deadline IS NOT NULL AND voting_deadline < datetime('now')`,
    args: [],
  });
  const dueSessions = dueRes.rows as unknown as { id: string; stage_id: string }[];

  for (const session of dueSessions) {
    const electionsRes = await db.execute({
      sql: "SELECT id, role FROM stage_officer_elections WHERE session_id = ?",
      args: [session.id],
    });
    for (const election of electionsRes.rows as unknown as { id: string; role: string }[]) {
      const tallyRes = await db.execute({
        sql: `SELECT candidate_rider_id, COUNT(*) AS n FROM stage_officer_votes
              WHERE election_id = ? GROUP BY candidate_rider_id ORDER BY n DESC LIMIT 2`,
        args: [election.id],
      });
      const rows = tallyRes.rows as unknown as { candidate_rider_id: string; n: number }[];
      const top = rows[0];
      const runnerUp = rows[1];
      const tied = !!top && !!runnerUp && top.n === runnerUp.n;
      const winner = top && !tied ? top.candidate_rider_id : null;

      await db.execute({
        sql: "UPDATE stage_officer_elections SET status = 'resolved', winner_rider_id = ?, resolved_at = datetime('now') WHERE id = ?",
        args: [winner, election.id],
      });
      if (winner) {
        await db.execute({
          sql: `INSERT INTO stage_members (id, stage_id, rider_id, role) VALUES (?, ?, ?, ?)
                ON CONFLICT(stage_id, rider_id) DO UPDATE SET role = excluded.role`,
          args: [newId("smem"), session.stage_id, winner, election.role],
        });
      }
    }
    await db.execute({ sql: "UPDATE stage_election_sessions SET status = 'closed' WHERE id = ?", args: [session.id] });
    const adminRes = await db.execute({ sql: "SELECT group_admin_id FROM stages WHERE id = ?", args: [session.stage_id] });
    const groupAdminId = (adminRes.rows[0] as unknown as { group_admin_id: string | null } | undefined)?.group_admin_id;
    if (groupAdminId) {
      await notifyUser(groupAdminId, {
        title: "Election results ready",
        body: "Voting has closed — publish the results when you're ready.",
        url: `/savings/${session.stage_id}/elections`,
        tag: `stage-election-closed-${session.id}`,
      }).catch(() => {});
    }
  }

  return { closed: dueSessions.length };
}
