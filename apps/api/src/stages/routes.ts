import { Hono, type Context } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { requirePermission } from "../admin/permissions.js";
import { newId } from "../lib/ids.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { getR2Bucket } from "../storage/r2.js";
import { getVslaSettings } from "../lib/settings.js";

/**
 * Rider Stage Savings Circles — a VSLA-style group savings/loans feature,
 * one circle per boda stage. Cash-first and non-custodial by design: every
 * money-moving step here is a two-part "intent, then officer-confirmed"
 * record, never a payment the platform itself processes. See
 * apps/api/src/db/migrations/0054_stage_savings_circles.sql for the schema
 * this reads and writes.
 */

export const stageRoutes = new Hono();
stageRoutes.use("/stages/*", requireAuth, requireRole("rider"));

const OFFICER_ROLES = ["chairman", "vice_chairman", "secretary", "treasurer", "money_counter", "mobilizer"] as const;
type OfficerRole = (typeof OFFICER_ROLES)[number];
type StageRole = "member" | OfficerRole;

type Membership = { id: string; stage_id: string; rider_id: string; role: StageRole; status: string };

async function getMembership(stageId: string, riderId: string): Promise<Membership | undefined> {
  const res = await db.execute({
    sql: "SELECT * FROM stage_members WHERE stage_id = ? AND rider_id = ? AND status = 'active'",
    args: [stageId, riderId],
  });
  return res.rows[0] as unknown as Membership | undefined;
}

function isOfficer(membership: Membership | undefined): membership is Membership & { role: OfficerRole } {
  return !!membership && (OFFICER_ROLES as readonly string[]).includes(membership.role);
}

/** Whether this rider is allowed to record a contribution/repayment as
 * received, per the admin-configured recorder policy. */
async function canRecordCash(stageId: string, riderId: string): Promise<boolean> {
  const membership = await getMembership(stageId, riderId);
  if (!isOfficer(membership)) return false;
  const settings = await getVslaSettings();
  if (settings.contributionRecorderRole === "treasurer_only") return membership.role === "treasurer";
  return true;
}

async function getActiveCycle(stageId: string) {
  const res = await db.execute({
    sql: "SELECT * FROM stage_cycles WHERE stage_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    args: [stageId],
  });
  return res.rows[0] as unknown as
    | {
        id: string;
        stage_id: string;
        start_date: string;
        end_date: string;
        interest_rate: number;
        loanable_contribution_multiple: number;
        max_loan_duration_months: number;
        status: string;
      }
    | undefined;
}

/** Every stage financial event also lands in the group chat as a system
 * pill, mirroring how order_events drive the WhatsApp-style timeline on
 * an order's chat thread. */
async function postSystemMessage(
  stageId: string,
  senderId: string,
  eventType: string,
  body: string,
  relatedId?: string,
) {
  await db.execute({
    sql: `INSERT INTO stage_messages (id, stage_id, sender_id, body, type, system_event_type, related_id)
          VALUES (?, ?, ?, ?, 'system', ?, ?)`,
    args: [newId("smsg"), stageId, senderId, body, eventType, relatedId ?? null],
  });
}

/** Seeds a sensible default quorum the first time a cycle is created —
 * every officer role must approve, any single rejection kills it. Admin
 * or the stage's own officers can adjust these rows later. */
async function ensureDefaultLoanWorkflow(cycleId: string) {
  const existing = await db.execute({ sql: "SELECT 1 FROM stage_loan_approval_workflow WHERE cycle_id = ?", args: [cycleId] });
  if (existing.rows.length > 0) return;
  for (const role of ["chairman", "secretary", "treasurer"] as const) {
    await db.execute({
      sql: `INSERT INTO stage_loan_approval_workflow (id, cycle_id, role, approvals_required, rejections_required)
            VALUES (?, ?, ?, 1, 1)`,
      args: [newId("wf"), cycleId, role],
    });
  }
}

async function recomputeLoanStatus(loanId: string) {
  const loanRes = await db.execute({ sql: "SELECT * FROM stage_loans WHERE id = ?", args: [loanId] });
  const loan = loanRes.rows[0] as unknown as { id: string; cycle_id: string; status: string } | undefined;
  if (!loan || loan.status !== "pending") return;

  const workflowRes = await db.execute({
    sql: "SELECT role, approvals_required, rejections_required FROM stage_loan_approval_workflow WHERE cycle_id = ?",
    args: [loan.cycle_id],
  });
  const workflow = workflowRes.rows as unknown as { role: string; approvals_required: number; rejections_required: number }[];
  if (workflow.length === 0) return;

  let rejected = false;
  let allApproved = true;
  for (const w of workflow) {
    const tally = await db.execute({
      sql: `SELECT
              SUM(CASE WHEN v.status = 'approved' THEN 1 ELSE 0 END) AS approvals,
              SUM(CASE WHEN v.status = 'rejected' THEN 1 ELSE 0 END) AS rejections
            FROM stage_loan_votes v
            JOIN stage_members m ON m.rider_id = v.member_id AND m.stage_id = (SELECT stage_id FROM stage_loans WHERE id = ?)
            WHERE v.loan_id = ? AND m.role = ?`,
      args: [loanId, loanId, w.role],
    });
    const row = tally.rows[0] as unknown as { approvals: number | null; rejections: number | null };
    const approvals = Number(row.approvals) || 0;
    const rejections = Number(row.rejections) || 0;
    if (rejections >= w.rejections_required) rejected = true;
    if (approvals < w.approvals_required) allApproved = false;
  }

  if (rejected) {
    await db.execute({
      sql: "UPDATE stage_loans SET status = 'rejected', decided_at = datetime('now') WHERE id = ?",
      args: [loanId],
    });
    await postSystemMessage(await stageIdForLoan(loanId), "system", "loan_rejected", "A loan request was rejected.", loanId);
  } else if (allApproved) {
    await db.execute({
      sql: "UPDATE stage_loans SET status = 'approved', decided_at = datetime('now') WHERE id = ?",
      args: [loanId],
    });
    await postSystemMessage(await stageIdForLoan(loanId), "system", "loan_approved", "A loan request was approved.", loanId);
  }
}

async function stageIdForLoan(loanId: string): Promise<string> {
  const res = await db.execute({ sql: "SELECT stage_id FROM stage_loans WHERE id = ?", args: [loanId] });
  return (res.rows[0]?.stage_id as string) ?? "";
}

// ---- Stages ----------------------------------------------------------

stageRoutes.get("/stages/mine", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT s.*, m.role FROM stages s
          JOIN stage_members m ON m.stage_id = s.id
          WHERE m.rider_id = ? AND m.status = 'active'`,
    args: [user.sub],
  });
  return c.json({ stages: res.rows });
});

/** Every active stage this rider hasn't joined yet — how they discover and
 * join a circle admin already registered for their stage. */
stageRoutes.get("/stages/discover", async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT s.*, (SELECT COUNT(*) FROM stage_members m2 WHERE m2.stage_id = s.id AND m2.status = 'active') AS member_count
          FROM stages s
          WHERE s.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM stage_members m WHERE m.stage_id = s.id AND m.rider_id = ? AND m.status = 'active')
          ORDER BY s.created_at DESC LIMIT 100`,
    args: [user.sub],
  });
  return c.json({ stages: res.rows });
});

const createStageSchema = z.object({
  name: z.string().trim().min(2),
  area: z.string().trim().optional(),
  address: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

stageRoutes.post("/stages", async (c) => {
  const user = c.get("user");
  const settings = await getVslaSettings();
  if (settings.stageCreationMode === "admin_only") {
    return c.json({ error: "forbidden", message: "Stages are created by Tuma admin right now." }, 403);
  }
  const parsed = createStageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  const id = newId("stage");
  await db.execute({
    sql: `INSERT INTO stages (id, name, area, address, description, created_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, parsed.data.name, parsed.data.area ?? null, parsed.data.address ?? null, parsed.data.description ?? null, user.sub],
  });
  await db.execute({
    sql: `INSERT INTO stage_members (id, stage_id, rider_id, role) VALUES (?, ?, ?, 'chairman')`,
    args: [newId("smem"), id, user.sub],
  });
  return c.json({ stageId: id });
});

stageRoutes.get("/stages/:id", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);

  const stageRes = await db.execute({ sql: "SELECT * FROM stages WHERE id = ?", args: [stageId] });
  const stage = stageRes.rows[0];
  if (!stage) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);

  const membersRes = await db.execute({
    sql: `SELECT m.rider_id, m.role, u.name FROM stage_members m
          JOIN users u ON u.id = m.rider_id
          WHERE m.stage_id = ? AND m.status = 'active'`,
    args: [stageId],
  });

  const cycle = await getActiveCycle(stageId);
  let pot = 0;
  let outOnLoan = 0;
  if (cycle) {
    const potRes = await db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) AS pot FROM stage_transactions WHERE cycle_id = ?",
      args: [cycle.id],
    });
    pot = Number(potRes.rows[0]?.pot) || 0;
    const loanRes = await db.execute({
      sql: `SELECT COALESCE(SUM(total_repayment), 0) AS total,
                   (SELECT COALESCE(SUM(r.amount), 0) FROM stage_repayments r
                    JOIN stage_loans l2 ON l2.id = r.loan_id WHERE l2.cycle_id = ? AND r.status = 'confirmed') AS repaid
            FROM stage_loans WHERE cycle_id = ? AND status IN ('disbursed')`,
      args: [cycle.id, cycle.id],
    });
    const total = Number(loanRes.rows[0]?.total) || 0;
    const repaid = Number(loanRes.rows[0]?.repaid) || 0;
    outOnLoan = Math.max(0, total - repaid);
  }

  return c.json({ stage, members: membersRes.rows, myRole: membership.role, cycle: cycle ?? null, pot, outOnLoan });
});

stageRoutes.post("/stages/:id/join", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const existing = await db.execute({ sql: "SELECT 1 FROM stage_members WHERE stage_id = ? AND rider_id = ?", args: [stageId, user.sub] });
  if (existing.rows.length > 0) {
    await db.execute({
      sql: "UPDATE stage_members SET status = 'active', joined_at = datetime('now'), left_at = NULL WHERE stage_id = ? AND rider_id = ?",
      args: [stageId, user.sub],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO stage_members (id, stage_id, rider_id) VALUES (?, ?, ?)",
      args: [newId("smem"), stageId, user.sub],
    });
  }
  await postSystemMessage(stageId, user.sub, "member_joined", `${user.name} joined the circle.`);
  return c.json({ ok: true });
});

// ---- Officer elections -------------------------------------------------

const electionSchema = z.object({ role: z.enum(OFFICER_ROLES) });

stageRoutes.post("/stages/:id/elections", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const parsed = electionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  const open = await db.execute({
    sql: "SELECT id FROM stage_officer_elections WHERE stage_id = ? AND role = ? AND status = 'open'",
    args: [stageId, parsed.data.role],
  });
  if (open.rows.length > 0) return c.json({ electionId: open.rows[0].id });

  const id = newId("elec");
  await db.execute({
    sql: "INSERT INTO stage_officer_elections (id, stage_id, role) VALUES (?, ?, ?)",
    args: [id, stageId, parsed.data.role],
  });
  await postSystemMessage(stageId, user.sub, "election_opened", `Voting opened for ${parsed.data.role.replace("_", " ")}.`, id);
  return c.json({ electionId: id });
});

stageRoutes.get("/stages/:id/elections", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);

  const electionsRes = await db.execute({
    sql: "SELECT * FROM stage_officer_elections WHERE stage_id = ? ORDER BY opened_at DESC LIMIT 50",
    args: [stageId],
  });
  const elections = electionsRes.rows as unknown as {
    id: string;
    stage_id: string;
    role: string;
    status: string;
    winner_rider_id: string | null;
  }[];

  const withDetail = await Promise.all(
    elections.map(async (election) => {
      const nomineesRes = await db.execute({
        sql: `SELECT n.candidate_rider_id, u.name,
                     (SELECT COUNT(*) FROM stage_officer_votes v WHERE v.election_id = n.election_id AND v.candidate_rider_id = n.candidate_rider_id) AS votes
              FROM stage_officer_nominations n JOIN users u ON u.id = n.candidate_rider_id
              WHERE n.election_id = ?`,
        args: [election.id],
      });
      return { ...election, nominees: nomineesRes.rows };
    }),
  );
  return c.json({ elections: withDetail });
});

const nominateSchema = z.object({ candidateRiderId: z.string() });

stageRoutes.post("/stages/elections/:electionId/nominate", async (c) => {
  const electionId = c.req.param("electionId");
  const user = c.get("user");
  const parsed = nominateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);
  await db.execute({
    sql: `INSERT OR IGNORE INTO stage_officer_nominations (id, election_id, candidate_rider_id, nominated_by)
          VALUES (?, ?, ?, ?)`,
    args: [newId("nom"), electionId, parsed.data.candidateRiderId, user.sub],
  });
  return c.json({ ok: true });
});

const voteElectionSchema = z.object({ candidateRiderId: z.string() });

stageRoutes.post("/stages/elections/:electionId/vote", async (c) => {
  const electionId = c.req.param("electionId");
  const user = c.get("user");
  const parsed = voteElectionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  const electionRes = await db.execute({ sql: "SELECT * FROM stage_officer_elections WHERE id = ?", args: [electionId] });
  const election = electionRes.rows[0] as unknown as { id: string; stage_id: string; role: string; status: string } | undefined;
  if (!election || election.status !== "open") return c.json({ error: "election_closed", message: "This vote isn't open anymore." }, 400);

  await db.execute({
    sql: `INSERT INTO stage_officer_votes (id, election_id, candidate_rider_id, voter_rider_id) VALUES (?, ?, ?, ?)
          ON CONFLICT(election_id, voter_rider_id) DO UPDATE SET candidate_rider_id = excluded.candidate_rider_id`,
    args: [newId("evote"), electionId, parsed.data.candidateRiderId, user.sub],
  });

  const memberCountRes = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM stage_members WHERE stage_id = ? AND status = 'active'",
    args: [election.stage_id],
  });
  const memberCount = Number(memberCountRes.rows[0]?.n) || 0;

  const tallyRes = await db.execute({
    sql: "SELECT candidate_rider_id, COUNT(*) AS votes FROM stage_officer_votes WHERE election_id = ? GROUP BY candidate_rider_id ORDER BY votes DESC LIMIT 1",
    args: [electionId],
  });
  const top = tallyRes.rows[0] as unknown as { candidate_rider_id: string; votes: number } | undefined;
  if (top && memberCount > 0 && Number(top.votes) > memberCount / 2) {
    await db.execute({
      sql: "UPDATE stage_officer_elections SET status = 'resolved', winner_rider_id = ?, resolved_at = datetime('now') WHERE id = ?",
      args: [top.candidate_rider_id, electionId],
    });
    await db.execute({
      sql: `INSERT INTO stage_members (id, stage_id, rider_id, role) VALUES (?, ?, ?, ?)
            ON CONFLICT(stage_id, rider_id) DO UPDATE SET role = excluded.role`,
      args: [newId("smem"), election.stage_id, top.candidate_rider_id, election.role],
    });
    await postSystemMessage(election.stage_id, "system", "election_resolved", `A new ${election.role.replace("_", " ")} was elected.`, electionId);
  }
  return c.json({ ok: true });
});

// ---- Cycles ------------------------------------------------------------

const createCycleSchema = z.object({
  startDate: z.string(),
  interestRate: z.number().nonnegative().optional(),
  loanableContributionMultiple: z.number().positive().optional(),
  maxLoanDurationMonths: z.number().int().positive().optional(),
  cycleMonths: z.number().int().positive().optional(),
});

stageRoutes.post("/stages/:id/cycles", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!isOfficer(membership)) return c.json({ error: "officers_only", message: "Only an elected officer can do that." }, 403);

  const existing = await getActiveCycle(stageId);
  if (existing) {
    return c.json({ error: "cycle_already_active", message: "This circle already has an active savings cycle.", cycleId: existing.id }, 400);
  }

  const parsed = createCycleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);
  const settings = await getVslaSettings();

  const start = new Date(parsed.data.startDate);
  const months = parsed.data.cycleMonths ?? settings.defaultCycleMonths;
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);

  const id = newId("cycle");
  await db.execute({
    sql: `INSERT INTO stage_cycles
            (id, stage_id, start_date, end_date, interest_rate, loanable_contribution_multiple, max_loan_duration_months)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      stageId,
      parsed.data.startDate,
      end.toISOString().slice(0, 10),
      settings.loanInterestEnabled ? parsed.data.interestRate ?? settings.defaultInterestRate : 0,
      parsed.data.loanableContributionMultiple ?? settings.defaultLoanableMultiple,
      parsed.data.maxLoanDurationMonths ?? settings.defaultMaxLoanMonths,
    ],
  });
  await ensureDefaultLoanWorkflow(id);
  await postSystemMessage(stageId, user.sub, "cycle_started", "A new savings cycle has started.", id);
  return c.json({ cycleId: id });
});

// ---- Contributions (intent -> confirm) ---------------------------------

const contributionSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(["cash", "momo"]),
});

stageRoutes.post("/stages/:id/contributions", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const cycle = await getActiveCycle(stageId);
  if (!cycle) return c.json({ error: "no_active_cycle", message: "This circle hasn't started a savings cycle yet." }, 400);

  const parsed = contributionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  let momoRecipient: string | null = null;
  if (parsed.data.method === "momo") {
    const treasurerRes = await db.execute({
      sql: `SELECT r.momo_msisdn FROM stage_members m JOIN riders r ON r.user_id = m.rider_id
            WHERE m.stage_id = ? AND m.role = 'treasurer' AND m.status = 'active' LIMIT 1`,
      args: [stageId],
    });
    momoRecipient = (treasurerRes.rows[0]?.momo_msisdn as string | null) ?? null;
  }

  const id = newId("scontr");
  await db.execute({
    sql: `INSERT INTO stage_contributions (id, stage_id, cycle_id, member_id, amount, method, momo_recipient_msisdn)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, stageId, cycle.id, user.sub, parsed.data.amount, parsed.data.method, momoRecipient],
  });
  await postSystemMessage(
    stageId,
    user.sub,
    "contribution_intent",
    `${user.name} intends to save UGX ${parsed.data.amount.toLocaleString("en-UG")} via ${parsed.data.method}.`,
    id,
  );
  return c.json({ contributionId: id, momoRecipientMsisdn: momoRecipient });
});

const MAX_PROOF_BYTES = 8 * 1024 * 1024;
const ALLOWED_PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

stageRoutes.post("/stages/contributions/:id/proof", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const res = await db.execute({ sql: "SELECT * FROM stage_contributions WHERE id = ?", args: [id] });
  const contribution = res.rows[0] as unknown as { id: string; stage_id: string; member_id: string; status: string } | undefined;
  if (!contribution) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (contribution.member_id !== user.sub) return c.json({ error: "forbidden", message: "You don't have permission to do that." }, 403);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "missing_file", message: "Choose a photo to upload." }, 400);
  if (!ALLOWED_PROOF_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type", message: "Use a JPEG, PNG, or WEBP image." }, 400);
  if (file.size > MAX_PROOF_BYTES) return c.json({ error: "file_too_large", message: "That image is too large." }, 400);

  const ext = extensionForMime(file.type, "jpg");
  const key = `stages/${contribution.stage_id}/contributions/${id}.${ext}`;
  await getR2Bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await db.execute({
    sql: "UPDATE stage_contributions SET proof_photo_key = ?, proof_reminder_dismissed = 1 WHERE id = ?",
    args: [key, id],
  });
  await db.execute({
    sql: `INSERT INTO stage_messages (id, stage_id, sender_id, type, media_key, system_event_type, related_id)
          VALUES (?, ?, ?, 'image', ?, 'contribution_proof', ?)`,
    args: [newId("smsg"), contribution.stage_id, user.sub, key, id],
  });
  return c.json({ ok: true });
});

stageRoutes.post("/stages/contributions/:id/confirm", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const res = await db.execute({ sql: "SELECT * FROM stage_contributions WHERE id = ?", args: [id] });
  const contribution = res.rows[0] as unknown as
    | { id: string; stage_id: string; cycle_id: string; member_id: string; amount: number; status: string }
    | undefined;
  if (!contribution) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (contribution.status !== "pending") return c.json({ error: "not_pending", message: "This has already been handled." }, 400);
  if (!(await canRecordCash(contribution.stage_id, user.sub))) return c.json({ error: "forbidden", message: "You don't have permission to do that." }, 403);

  await db.execute({
    sql: "UPDATE stage_contributions SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now') WHERE id = ?",
    args: [user.sub, id],
  });
  await db.execute({
    sql: `INSERT INTO stage_transactions (id, stage_id, cycle_id, member_id, type, amount, narrative, related_id)
          VALUES (?, ?, ?, ?, 'contribution', ?, 'Confirmed savings contribution', ?)`,
    args: [newId("stxn"), contribution.stage_id, contribution.cycle_id, contribution.member_id, contribution.amount, id],
  });
  await postSystemMessage(contribution.stage_id, user.sub, "contribution_confirmed", "A contribution was confirmed received.", id);
  return c.json({ ok: true });
});

stageRoutes.post("/stages/contributions/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const res = await db.execute({ sql: "SELECT * FROM stage_contributions WHERE id = ?", args: [id] });
  const contribution = res.rows[0] as unknown as { id: string; stage_id: string; member_id: string; status: string } | undefined;
  if (!contribution) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (contribution.member_id !== user.sub) return c.json({ error: "forbidden", message: "You don't have permission to do that." }, 403);
  if (contribution.status !== "pending") return c.json({ error: "not_pending", message: "This has already been handled." }, 400);
  await db.execute({
    sql: "UPDATE stage_contributions SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?",
    args: [id],
  });
  return c.json({ ok: true });
});

stageRoutes.get("/stages/:id/contributions", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const res = await db.execute({
    sql: `SELECT sc.*, u.name AS member_name FROM stage_contributions sc
          JOIN users u ON u.id = sc.member_id
          WHERE sc.stage_id = ? ORDER BY sc.created_at DESC LIMIT 200`,
    args: [stageId],
  });
  return c.json({ contributions: res.rows });
});

// ---- Loans ---------------------------------------------------------------

const requestLoanSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().trim().optional(),
  numberOfInstallments: z.number().int().positive().default(1),
});

stageRoutes.post("/stages/:id/loans", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const cycle = await getActiveCycle(stageId);
  if (!cycle) return c.json({ error: "no_active_cycle", message: "This circle hasn't started a savings cycle yet." }, 400);

  const existingLoan = await db.execute({
    sql: "SELECT 1 FROM stage_loans WHERE member_id = ? AND cycle_id = ? AND status IN ('pending', 'approved', 'disbursed')",
    args: [user.sub, cycle.id],
  });
  if (existingLoan.rows.length > 0) return c.json({ error: "existing_loan", message: "You already have a loan in progress this cycle." }, 400);

  const parsed = requestLoanSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  const savedRes = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS saved FROM stage_contributions WHERE member_id = ? AND cycle_id = ? AND status = 'confirmed'",
    args: [user.sub, cycle.id],
  });
  const saved = Number(savedRes.rows[0]?.saved) || 0;
  const maxLoan = saved * cycle.loanable_contribution_multiple;
  if (parsed.data.amount > maxLoan) {
    return c.json({ error: "over_limit", message: `Can borrow up to UGX ${maxLoan.toLocaleString("en-UG")} (savings × ${cycle.loanable_contribution_multiple}).` }, 400);
  }

  const potRes = await db.execute({ sql: "SELECT COALESCE(SUM(amount), 0) AS pot FROM stage_transactions WHERE cycle_id = ?", args: [cycle.id] });
  const pot = Number(potRes.rows[0]?.pot) || 0;
  if (parsed.data.amount > pot) return c.json({ error: "insufficient_funds", message: "The circle doesn't have enough saved right now." }, 400);

  const totalRepayment = Math.round(parsed.data.amount * (1 + cycle.interest_rate / 100));
  const due = new Date();
  due.setMonth(due.getMonth() + cycle.max_loan_duration_months);

  const id = newId("sloan");
  await db.execute({
    sql: `INSERT INTO stage_loans
            (id, stage_id, cycle_id, member_id, amount, interest_rate, number_of_installments, total_repayment, reason, due_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      stageId,
      cycle.id,
      user.sub,
      parsed.data.amount,
      cycle.interest_rate,
      parsed.data.numberOfInstallments,
      totalRepayment,
      parsed.data.reason ?? null,
      due.toISOString().slice(0, 10),
    ],
  });
  await postSystemMessage(stageId, user.sub, "loan_requested", `${user.name} requested a loan of UGX ${parsed.data.amount.toLocaleString("en-UG")}.`, id);
  return c.json({ loanId: id });
});

const voteLoanSchema = z.object({ status: z.enum(["approved", "rejected"]), comment: z.string().trim().optional() });

stageRoutes.post("/stages/loans/:id/vote", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const loanRes = await db.execute({ sql: "SELECT * FROM stage_loans WHERE id = ?", args: [id] });
  const loan = loanRes.rows[0] as unknown as { id: string; stage_id: string; status: string } | undefined;
  if (!loan) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (loan.status !== "pending") return c.json({ error: "not_pending", message: "This has already been handled." }, 400);
  const membership = await getMembership(loan.stage_id, user.sub);
  if (!isOfficer(membership)) return c.json({ error: "officers_only", message: "Only an elected officer can do that." }, 403);

  const parsed = voteLoanSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  await db.execute({
    sql: `INSERT INTO stage_loan_votes (id, loan_id, member_id, status, comment) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(loan_id, member_id) DO UPDATE SET status = excluded.status, comment = excluded.comment`,
    args: [newId("svote"), id, user.sub, parsed.data.status, parsed.data.comment ?? null],
  });
  await recomputeLoanStatus(id);
  return c.json({ ok: true });
});

stageRoutes.post("/stages/loans/:id/disbursement-confirm", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const loanRes = await db.execute({ sql: "SELECT * FROM stage_loans WHERE id = ?", args: [id] });
  const loan = loanRes.rows[0] as unknown as { id: string; stage_id: string; cycle_id: string; member_id: string; amount: number; status: string } | undefined;
  if (!loan) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (loan.member_id !== user.sub) return c.json({ error: "forbidden", message: "You don't have permission to do that." }, 403);
  if (loan.status !== "approved") return c.json({ error: "not_approved", message: "This loan hasn't been approved yet." }, 400);

  await db.execute({
    sql: "UPDATE stage_loans SET status = 'disbursed', disbursement_confirmed_at = datetime('now') WHERE id = ?",
    args: [id],
  });
  await db.execute({
    sql: `INSERT INTO stage_transactions (id, stage_id, cycle_id, member_id, type, amount, narrative, related_id)
          VALUES (?, ?, ?, ?, 'loan_disbursement', ?, 'Loan disbursed', ?)`,
    args: [newId("stxn"), loan.stage_id, loan.cycle_id, loan.member_id, -loan.amount, id],
  });
  await postSystemMessage(loan.stage_id, user.sub, "loan_disbursed", "A loan payout was confirmed received.", id);
  return c.json({ ok: true });
});

stageRoutes.get("/stages/:id/loans", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const res = await db.execute({
    sql: `SELECT l.*, u.name AS member_name FROM stage_loans l JOIN users u ON u.id = l.member_id
          WHERE l.stage_id = ? ORDER BY l.requested_at DESC LIMIT 200`,
    args: [stageId],
  });
  return c.json({ loans: res.rows });
});

// ---- Repayments (same intent -> confirm pattern) --------------------------

const repaymentSchema = z.object({ amount: z.number().int().positive(), method: z.enum(["cash", "momo"]) });

stageRoutes.post("/stages/loans/:id/repayments", async (c) => {
  const loanId = c.req.param("id");
  const user = c.get("user");
  const loanRes = await db.execute({ sql: "SELECT * FROM stage_loans WHERE id = ?", args: [loanId] });
  const loan = loanRes.rows[0] as unknown as { id: string; stage_id: string; member_id: string; status: string } | undefined;
  if (!loan) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (loan.member_id !== user.sub) return c.json({ error: "forbidden", message: "You don't have permission to do that." }, 403);
  if (!["disbursed", "defaulted"].includes(loan.status)) return c.json({ error: "not_repayable", message: "This loan isn't in a repayable state." }, 400);

  const parsed = repaymentSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  let momoRecipient: string | null = null;
  if (parsed.data.method === "momo") {
    const treasurerRes = await db.execute({
      sql: `SELECT r.momo_msisdn FROM stage_members m JOIN riders r ON r.user_id = m.rider_id
            WHERE m.stage_id = ? AND m.role = 'treasurer' AND m.status = 'active' LIMIT 1`,
      args: [loan.stage_id],
    });
    momoRecipient = (treasurerRes.rows[0]?.momo_msisdn as string | null) ?? null;
  }

  const id = newId("srepay");
  await db.execute({
    sql: `INSERT INTO stage_repayments (id, loan_id, amount, method, momo_recipient_msisdn) VALUES (?, ?, ?, ?, ?)`,
    args: [id, loanId, parsed.data.amount, parsed.data.method, momoRecipient],
  });
  await postSystemMessage(loan.stage_id, user.sub, "repayment_intent", `${user.name} intends to repay UGX ${parsed.data.amount.toLocaleString("en-UG")}.`, id);
  return c.json({ repaymentId: id, momoRecipientMsisdn: momoRecipient });
});

stageRoutes.post("/stages/repayments/:id/proof", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT r.*, l.stage_id, l.member_id FROM stage_repayments r JOIN stage_loans l ON l.id = r.loan_id WHERE r.id = ?`,
    args: [id],
  });
  const repayment = res.rows[0] as unknown as { id: string; stage_id: string; member_id: string } | undefined;
  if (!repayment) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (repayment.member_id !== user.sub) return c.json({ error: "forbidden", message: "You don't have permission to do that." }, 403);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "missing_file", message: "Choose a photo to upload." }, 400);
  if (!ALLOWED_PROOF_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type", message: "Use a JPEG, PNG, or WEBP image." }, 400);
  if (file.size > MAX_PROOF_BYTES) return c.json({ error: "file_too_large", message: "That image is too large." }, 400);

  const ext = extensionForMime(file.type, "jpg");
  const key = `stages/${repayment.stage_id}/repayments/${id}.${ext}`;
  await getR2Bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await db.execute({
    sql: "UPDATE stage_repayments SET proof_photo_key = ?, proof_reminder_dismissed = 1 WHERE id = ?",
    args: [key, id],
  });
  await db.execute({
    sql: `INSERT INTO stage_messages (id, stage_id, sender_id, type, media_key, system_event_type, related_id)
          VALUES (?, ?, ?, 'image', ?, 'repayment_proof', ?)`,
    args: [newId("smsg"), repayment.stage_id, user.sub, key, id],
  });
  return c.json({ ok: true });
});

stageRoutes.post("/stages/repayments/:id/confirm", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT r.*, l.stage_id, l.cycle_id, l.total_repayment FROM stage_repayments r
          JOIN stage_loans l ON l.id = r.loan_id WHERE r.id = ?`,
    args: [id],
  });
  const repayment = res.rows[0] as unknown as
    | { id: string; loan_id: string; stage_id: string; cycle_id: string; amount: number; status: string; total_repayment: number }
    | undefined;
  if (!repayment) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  if (repayment.status !== "pending") return c.json({ error: "not_pending", message: "This has already been handled." }, 400);
  if (!(await canRecordCash(repayment.stage_id, user.sub))) return c.json({ error: "forbidden", message: "You don't have permission to do that." }, 403);

  await db.execute({
    sql: "UPDATE stage_repayments SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now') WHERE id = ?",
    args: [user.sub, id],
  });
  await db.execute({
    sql: `INSERT INTO stage_transactions (id, stage_id, cycle_id, member_id, type, amount, narrative, related_id)
          VALUES (?, ?, ?, (SELECT member_id FROM stage_loans WHERE id = ?), 'repayment', ?, 'Loan repayment received', ?)`,
    args: [newId("stxn"), repayment.stage_id, repayment.cycle_id, repayment.loan_id, repayment.amount, id],
  });

  const totalRepaidRes = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS total FROM stage_repayments WHERE loan_id = ? AND status = 'confirmed'",
    args: [repayment.loan_id],
  });
  if ((Number(totalRepaidRes.rows[0]?.total) || 0) >= repayment.total_repayment) {
    await db.execute({ sql: "UPDATE stage_loans SET status = 'repaid' WHERE id = ?", args: [repayment.loan_id] });
  }
  await postSystemMessage(repayment.stage_id, user.sub, "repayment_confirmed", "A loan repayment was confirmed received.", id);
  return c.json({ ok: true });
});

// ---- Ledger --------------------------------------------------------------

stageRoutes.get("/stages/:id/ledger", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const res = await db.execute({
    sql: `SELECT t.*, u.name AS member_name FROM stage_transactions t
          LEFT JOIN users u ON u.id = t.member_id
          WHERE t.stage_id = ? ORDER BY t.created_at DESC LIMIT 200`,
    args: [stageId],
  });
  return c.json({ transactions: res.rows });
});

// ---- Chat (group + direct) -------------------------------------------------

stageRoutes.get("/stages/:id/messages", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const withRiderId = c.req.query("with");

  const res = await db.execute(
    withRiderId
      ? {
          sql: `SELECT * FROM stage_messages WHERE stage_id = ?
                AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
                ORDER BY created_at ASC LIMIT 500`,
          args: [stageId, user.sub, withRiderId, withRiderId, user.sub],
        }
      : {
          sql: "SELECT * FROM stage_messages WHERE stage_id = ? AND recipient_id IS NULL ORDER BY created_at ASC LIMIT 500",
          args: [stageId],
        },
  );
  return c.json({ messages: res.rows });
});

const sendMessageSchema = z.object({ body: z.string().trim().min(1), recipientId: z.string().optional() });

stageRoutes.post("/stages/:id/messages", async (c) => {
  const stageId = c.req.param("id");
  const user = c.get("user");
  const membership = await getMembership(stageId, user.sub);
  if (!membership) return c.json({ error: "not_a_member", message: "You're not a member of this stage circle." }, 403);
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  const id = newId("smsg");
  await db.execute({
    sql: "INSERT INTO stage_messages (id, stage_id, sender_id, recipient_id, body, type) VALUES (?, ?, ?, ?, ?, 'text')",
    args: [id, stageId, user.sub, parsed.data.recipientId ?? null, parsed.data.body],
  });
  return c.json({ messageId: id });
});

// ---- Admin oversight ------------------------------------------------------
// Read-only, gated by the vslaAdminLedgerVisibility setting (default
// "read_only_all") — support/technical visibility only. Money disagreements
// between members are the group's own to resolve, never Tuma's to referee.

export const stageAdminRoutes = new Hono();
stageAdminRoutes.use("/admin/stages/*", requireAuth, requireRole("admin"), requirePermission("riders.view"));

async function assertAdminLedgerVisible(c: Context) {
  const settings = await getVslaSettings();
  if (settings.adminLedgerVisibility === "private_per_stage") {
    return c.json({ error: "forbidden", message: "Stage ledgers are set to fully private right now." }, 403);
  }
  return null;
}

stageAdminRoutes.get("/admin/stages", async (c) => {
  const denied = await assertAdminLedgerVisible(c);
  if (denied) return denied;
  const res = await db.execute({
    sql: `SELECT s.*, (SELECT COUNT(*) FROM stage_members m WHERE m.stage_id = s.id AND m.status = 'active') AS member_count
          FROM stages s ORDER BY s.created_at DESC LIMIT 200`,
    args: [],
  });
  return c.json({ stages: res.rows });
});

const adminCreateStageSchema = z.object({
  name: z.string().trim().min(2),
  area: z.string().trim().optional(),
  address: z.string().trim().optional(),
  description: z.string().trim().optional(),
  /** Optional — a rider to seat as founding chairman right away. Without
   * one, the stage just has no officers until its first election. */
  chairmanRiderId: z.string().optional(),
});

/** Not gated by vslaAdminLedgerVisibility — that setting is about who can
 * *see* a stage's money, not whether admin can register one in the first
 * place. This is the only way to create a stage while
 * vslaStageCreationMode is "admin_only" (the default), since the rider-
 * facing POST /stages is deliberately rider-role-only. */
stageAdminRoutes.post("/admin/stages", async (c) => {
  const parsed = adminCreateStageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);

  const id = newId("stage");
  await db.execute({
    sql: `INSERT INTO stages (id, name, area, address, description) VALUES (?, ?, ?, ?, ?)`,
    args: [id, parsed.data.name, parsed.data.area ?? null, parsed.data.address ?? null, parsed.data.description ?? null],
  });
  if (parsed.data.chairmanRiderId) {
    await db.execute({
      sql: `INSERT INTO stage_members (id, stage_id, rider_id, role) VALUES (?, ?, ?, 'chairman')`,
      args: [newId("smem"), id, parsed.data.chairmanRiderId],
    });
  }
  return c.json({ stageId: id });
});

stageAdminRoutes.get("/admin/stages/:id", async (c) => {
  const denied = await assertAdminLedgerVisible(c);
  if (denied) return denied;
  const stageId = c.req.param("id");
  const stageRes = await db.execute({ sql: "SELECT * FROM stages WHERE id = ?", args: [stageId] });
  if (!stageRes.rows[0]) return c.json({ error: "not_found", message: "That couldn't be found." }, 404);
  const membersRes = await db.execute({
    sql: `SELECT m.rider_id, m.role, u.name FROM stage_members m JOIN users u ON u.id = m.rider_id
          WHERE m.stage_id = ? AND m.status = 'active'`,
    args: [stageId],
  });
  const cycle = await getActiveCycle(stageId);
  return c.json({ stage: stageRes.rows[0], members: membersRes.rows, cycle: cycle ?? null });
});

stageAdminRoutes.get("/admin/stages/:id/ledger", async (c) => {
  const denied = await assertAdminLedgerVisible(c);
  if (denied) return denied;
  const stageId = c.req.param("id");
  const res = await db.execute({
    sql: `SELECT t.*, u.name AS member_name FROM stage_transactions t
          LEFT JOIN users u ON u.id = t.member_id
          WHERE t.stage_id = ? ORDER BY t.created_at DESC LIMIT 500`,
    args: [stageId],
  });
  return c.json({ transactions: res.rows });
});
