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
