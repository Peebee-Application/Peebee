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
