import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getPlatformEnvironment, getWalletAccountSettings } from "../lib/settings.js";
import { ensureProviderWorkWallet, providerWorkWalletBalance } from "../wallet/provider-work-wallet.js";
import { personalWalletIsActive } from "../wallet/personal-wallet.js";
import { hasTable } from "../lib/schema.js";
import { notifyUser } from "../lib/webpush.js";
import { assignProvider, getJob, jobView, providerCancel } from "./jobs.js";
import { hasFreshLocation } from "./onsite.js";
import { canWork, inHours, logEvent, notifyCustomer, openJobsFor, providerFor, toDb, transition, workOnsiteReady, type Row } from "./service.js";
import { getWorkSettings } from "./settings.js";

export const providerRoutes = new Hono();

const NOT_PROVIDER = { error: "not_a_provider", message: "Register as a provider first." } as const;

// ---------------------------------------------------------------------------
// Registering and profile
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  kind: z.enum(["individual", "company"]),
  displayName: z.string().min(2).max(80),
  companyName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(20).optional(),
  bio: z.string().max(500).default(""),
  serviceIds: z.array(z.string().min(1).max(80)).min(1).max(40),
});

async function servicesOf(providerId: string) {
  return (
    await db.execute({
      sql: `SELECT s.id, s.type, s.category, s.name FROM work_provider_services ps JOIN work_services s ON s.id = ps.service_id WHERE ps.provider_id = ? ORDER BY s.sort_order`,
      args: [providerId],
    })
  ).rows;
}

async function profileView(provider: Row, role: "owner" | "staff") {
  const count = Number(provider.rating_count);
  return {
    id: provider.id,
    kind: provider.kind,
    displayName: provider.display_name,
    companyName: provider.company_name ?? null,
    phone: provider.phone ?? null,
    bio: provider.bio,
    status: provider.status,
    statusNote: provider.status_note ?? null,
    online: Boolean(provider.online),
    role,
    rating: count ? Math.round((Number(provider.rating_sum) / count) * 10) / 10 : null,
    ratingCount: count,
    jobsCompleted: Number(provider.jobs_completed),
    services: await servicesOf(String(provider.id)),
  };
}

async function validServiceIds(ids: string[]): Promise<string[] | null> {
  const unique = [...new Set(ids)];
  const rows = (await db.execute({ sql: `SELECT id FROM work_services WHERE active = 1 AND id IN (${unique.map(() => "?").join(", ")})`, args: unique })).rows;
  return rows.length === unique.length ? unique : null;
}

providerRoutes.post("/provider/register", async (c) => {
  const user = c.get("user");
  if (user.role === "admin") return c.json({ error: "forbidden", message: "Staff accounts can't register as providers." }, 403);
  const settings = await getWorkSettings();
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  if (!(settings.providerKinds as string[]).includes(d.kind)) {
    return c.json({ error: "kind_unavailable", message: d.kind === "company" ? "Company accounts aren't open yet." : "Individual accounts aren't open yet." }, 403);
  }
  if (d.kind === "company" && !d.companyName) return c.json({ error: "invalid_body", message: "Enter your company name." }, 400);
  if (await providerFor(user.sub)) return c.json({ error: "already_registered", message: "You're already registered." }, 409);

  const serviceIds = await validServiceIds(d.serviceIds);
  if (!serviceIds) return c.json({ error: "invalid_services", message: "One of those services isn't available." }, 400);

  const id = newId("wpr");
  const status = settings.requireApproval ? "pending" : "approved";
  try {
    await db.execute({
      sql: `INSERT INTO work_providers (id, user_id, kind, display_name, company_name, phone, bio, status, environment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, user.sub, d.kind, d.displayName, d.companyName ?? null, d.phone ?? null, d.bio, status, await getPlatformEnvironment()],
    });
  } catch {
    return c.json({ error: "already_registered", message: "You're already registered." }, 409);
  }
  await db.execute({ sql: "INSERT INTO work_provider_members (provider_id, user_id, role) VALUES (?, ?, 'owner')", args: [id, user.sub] });
  await ensureProviderWorkWallet("work", id, await getPlatformEnvironment());
  for (const serviceId of serviceIds) {
    await db.execute({ sql: "INSERT OR IGNORE INTO work_provider_services (provider_id, service_id) VALUES (?, ?)", args: [id, serviceId] });
  }
  const created = (await providerFor(user.sub))!;
  return c.json({ provider: await profileView(created.provider, created.role) }, 201);
});

providerRoutes.get("/provider/me", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  const settings = await getWorkSettings();
  return c.json({ provider: await profileView(ctx.provider, ctx.role), canWork: canWork(ctx.provider, settings) });
});

const updateSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  companyName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(20).optional(),
  bio: z.string().max(500).optional(),
  serviceIds: z.array(z.string().min(1).max(80)).min(1).max(40).optional(),
  online: z.boolean().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

providerRoutes.put("/provider/me", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  if (ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can change this." }, 403);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const settings = await getWorkSettings();

  if (d.online === true && !canWork(ctx.provider, settings)) {
    return c.json({ error: "not_approved", message: "You can go online once Peebee has approved your account." }, 403);
  }
  if ((d.lat == null) !== (d.lng == null)) return c.json({ error: "invalid_body", message: "Send both latitude and longitude." }, 400);
  if (d.serviceIds) {
    const ids = await validServiceIds(d.serviceIds);
    if (!ids) return c.json({ error: "invalid_services", message: "One of those services isn't available." }, 400);
    await db.execute({ sql: "DELETE FROM work_provider_services WHERE provider_id = ?", args: [ctx.provider.id] });
    for (const sid of ids) await db.execute({ sql: "INSERT OR IGNORE INTO work_provider_services (provider_id, service_id) VALUES (?, ?)", args: [ctx.provider.id, sid] });
  }
  await db.execute({
    sql: `UPDATE work_providers SET display_name = COALESCE(?, display_name), company_name = COALESCE(?, company_name), phone = COALESCE(?, phone), bio = COALESCE(?, bio),
            online = COALESCE(?, online), lat = COALESCE(?, lat), lng = COALESCE(?, lng), location_at = CASE WHEN ? IS NULL THEN location_at ELSE datetime('now') END,
            updated_at = datetime('now') WHERE id = ?`,
    args: [d.displayName ?? null, d.companyName ?? null, d.phone ?? null, d.bio ?? null, d.online == null ? null : d.online ? 1 : 0, d.lat ?? null, d.lng ?? null, d.lat ?? null, ctx.provider.id],
  });
  const fresh = (await providerFor(c.get("user").sub))!;
  return c.json({ provider: await profileView(fresh.provider, fresh.role) });
});

// ---------------------------------------------------------------------------
// Company staff
// ---------------------------------------------------------------------------

providerRoutes.get("/provider/staff", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  if (ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can see staff." }, 403);
  const rows = (
    await db.execute({
      sql: `SELECT m.user_id, m.role, m.status, u.name, u.phone FROM work_provider_members m JOIN users u ON u.id = m.user_id WHERE m.provider_id = ? ORDER BY (m.role = 'owner') DESC, u.name`,
      args: [ctx.provider.id],
    })
  ).rows;
  return c.json({ staff: rows });
});

providerRoutes.post("/provider/staff", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  if (ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can add staff." }, 403);
  if (ctx.provider.kind !== "company") return c.json({ error: "not_a_company", message: "Only company accounts have staff." }, 409);
  const parsed = z.object({ identifier: z.string().min(3).max(160) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter the staff member's phone number or email." }, 400);

  const person = (await db.execute({ sql: "SELECT id, name, role FROM users WHERE phone = ? OR email = ? LIMIT 1", args: [parsed.data.identifier.trim(), parsed.data.identifier.trim()] })).rows[0] as Row | undefined;
  if (!person || person.role === "admin") return c.json({ error: "user_not_found", message: "No Peebee account has that phone number or email. Ask them to sign up first." }, 404);
  const other = await providerFor(String(person.id));
  if (other && other.provider.id !== ctx.provider.id) return c.json({ error: "already_in_team", message: "That person already works with another provider." }, 409);

  await db.execute({
    sql: `INSERT INTO work_provider_members (provider_id, user_id, role, status) VALUES (?, ?, 'staff', 'active')
          ON CONFLICT(provider_id, user_id) DO UPDATE SET status = 'active' WHERE work_provider_members.role = 'staff'`,
    args: [ctx.provider.id, person.id],
  });
  return c.json({ ok: true, staff: { userId: person.id, name: person.name } }, 201);
});

providerRoutes.delete("/provider/staff/:userId", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  if (ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can remove staff." }, 403);
  const res = await db.execute({
    sql: "UPDATE work_provider_members SET status = 'revoked' WHERE provider_id = ? AND user_id = ? AND role = 'staff' AND status = 'active'",
    args: [ctx.provider.id, c.req.param("userId") as string],
  });
  if ((res.rowsAffected ?? 0) !== 1) return c.json({ error: "not_found", message: "That person isn't on your team." }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** The provider context for actions that need an approved account. Owners act for the company; staff only on their own jobs. */
async function working(c: { get: (k: "user") => { sub: string } }) {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return { error: NOT_PROVIDER, status: 404 as const };
  const settings = await getWorkSettings();
  if (!canWork(ctx.provider, settings)) return { error: { error: "not_approved", message: "Your account isn't approved to take jobs yet." }, status: 403 as const };
  return { ctx, settings };
}

providerRoutes.get("/provider/jobs/open", async (c) => {
  const w = await working(c);
  if ("error" in w) return c.json(w.error, w.status);
  if (w.ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can take new jobs." }, 403);
  const jobs = await openJobsFor(w.ctx.provider, w.settings);
  const offers = new Map(
    ((await db.execute({ sql: "SELECT job_id, price_ugx, eta_minutes, status FROM work_offers WHERE provider_id = ?", args: [w.ctx.provider.id] })).rows as Row[]).map((o) => [String(o.job_id), o]),
  );
  return c.json({
    jobs: await Promise.all(jobs.map(async (j) => ({ ...(await jobView(j, "provider")), myOffer: offers.get(String(j.id)) ?? null }))),
  });
});

providerRoutes.get("/provider/jobs", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  const status = c.req.query("status");
  const owner = ctx.role === "owner";
  const rows = (
    await db.execute({
      sql: `SELECT * FROM work_jobs WHERE ${owner ? "provider_id = ?" : "worker_id = ? AND provider_id = ?"} ${status ? "AND status = ?" : ""} ORDER BY created_at DESC LIMIT 100`,
      args: [...(owner ? [ctx.provider.id] : [c.get("user").sub, ctx.provider.id]), ...(status ? [status] : [])],
    })
  ).rows as Row[];
  return c.json({ jobs: await Promise.all(rows.map((r) => jobView(r, "provider"))) });
});

/** A job that belongs to this provider; staff only see what is assigned to them. */
async function myJob(ctx: { provider: Row; role: "owner" | "staff" }, userId: string, id: string): Promise<Row | null> {
  const job = await getJob(id);
  if (!job || job.provider_id !== ctx.provider.id) return null;
  if (ctx.role === "staff" && job.worker_id !== userId) return null;
  return job;
}

/** One job: yours (or assigned to you, for staff), or an open job you could take. */
providerRoutes.get("/provider/jobs/:id", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  const settings = await getWorkSettings();
  const id = c.req.param("id") as string;
  let job = await myJob(ctx, c.get("user").sub, id);
  if (!job && ctx.role === "owner" && canWork(ctx.provider, settings)) {
    job = (await openJobsFor(ctx.provider, settings)).find((j) => j.id === id) ?? null;
  }
  if (!job) return c.json({ error: "not_found", message: "Job not found." }, 404);
  const myOffer = (await db.execute({ sql: "SELECT price_ugx, eta_minutes, message, status FROM work_offers WHERE job_id = ? AND provider_id = ?", args: [job.id, ctx.provider.id] })).rows[0] ?? null;
  return c.json({ job: { ...(await jobView(job, "provider")), myOffer }, role: ctx.role });
});

providerRoutes.post("/provider/jobs/:id/accept", async (c) => {
  const w = await working(c);
  if ("error" in w) return c.json(w.error, w.status);
  if (w.ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can take new jobs." }, 403);
  const job = await getJob(c.req.param("id") as string);
  if (!job || job.status !== "open") return c.json({ error: "not_open", message: "That job has already been taken or closed." }, 409);
  if (job.matching_mode !== "broadcast") return c.json({ error: "wrong_mode", message: job.matching_mode === "customer_picks" ? "Send an offer; the customer chooses." : "Peebee assigns this job." }, 409);
  const eligible = (await openJobsFor(w.ctx.provider, w.settings)).some((j) => j.id === job.id);
  if (!eligible) return c.json({ error: "not_eligible", message: "This job isn't one you can take (service or distance)." }, 403);
  const result = await assignProvider(job, w.ctx.provider, { actor: { id: c.get("user").sub, kind: "provider" } });
  if (!result.ok) return c.json({ error: result.error, message: result.message }, result.status);
  notifyCustomer(job, "A provider accepted your job", String(job.service_name));
  return c.json({ job: await jobView((await getJob(String(job.id))) as Row, "provider") });
});

const offerSchema = z.object({ priceUgx: z.number().int().min(1).max(1_000_000_000).optional(), etaMinutes: z.number().int().min(1).max(10080).optional(), message: z.string().max(300).default("") });

providerRoutes.post("/provider/jobs/:id/offer", async (c) => {
  const w = await working(c);
  if ("error" in w) return c.json(w.error, w.status);
  if (w.ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can send offers." }, 403);
  const parsed = offerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const job = await getJob(c.req.param("id") as string);
  if (!job || job.status !== "open") return c.json({ error: "not_open", message: "That job has already been taken or closed." }, 409);
  if (job.matching_mode !== "customer_picks") return c.json({ error: "wrong_mode", message: job.matching_mode === "broadcast" ? "Accept this job directly." : "Peebee assigns this job." }, 409);
  if (!(await openJobsFor(w.ctx.provider, w.settings)).some((j) => j.id === job.id)) return c.json({ error: "not_eligible", message: "This job isn't one you can take (service or distance)." }, 403);

  // A fixed-price job has one price; a quote job needs the provider's own.
  let price = Number(job.price_ugx);
  if (job.pricing_mode === "quote") {
    price = parsed.data.priceUgx ?? 0;
    if (price < Number(job.callout_fee_ugx) || price < 1 || price > w.settings.maxQuoteUgx) {
      return c.json({ error: "invalid_price", message: `Quote between ${Number(job.callout_fee_ugx).toLocaleString("en-UG")} and ${w.settings.maxQuoteUgx.toLocaleString("en-UG")} UGX.` }, 400);
    }
  }
  await db.execute({
    sql: `INSERT INTO work_offers (id, job_id, provider_id, price_ugx, eta_minutes, message, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')
          ON CONFLICT(job_id, provider_id) DO UPDATE SET price_ugx = excluded.price_ugx, eta_minutes = excluded.eta_minutes, message = excluded.message, status = 'pending'`,
    args: [newId("wof"), job.id, w.ctx.provider.id, price, parsed.data.etaMinutes ?? null, parsed.data.message],
  });
  await logEvent(String(job.id), c.get("user").sub, "provider", "offered", { providerId: w.ctx.provider.id, priceUgx: price });
  notifyCustomer(job, "You have a new offer", String(job.service_name));
  return c.json({ ok: true, priceUgx: price });
});

providerRoutes.delete("/provider/jobs/:id/offer", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  const res = await db.execute({ sql: "UPDATE work_offers SET status = 'withdrawn' WHERE job_id = ? AND provider_id = ? AND status = 'pending'", args: [c.req.param("id") as string, ctx.provider.id] });
  return (res.rowsAffected ?? 0) === 1 ? c.json({ ok: true }) : c.json({ error: "not_found", message: "You have no open offer on that job." }, 404);
});

providerRoutes.post("/provider/jobs/:id/quote", async (c) => {
  const w = await working(c);
  if ("error" in w) return c.json(w.error, w.status);
  if (w.ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can quote." }, 403);
  const parsed = z.object({ priceUgx: z.number().int().min(1).max(1_000_000_000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter your price in UGX." }, 400);
  const job = await myJob(w.ctx, c.get("user").sub, c.req.param("id") as string);
  if (!job) return c.json({ error: "not_found", message: "Job not found." }, 404);
  if (job.pricing_mode !== "quote" || !["assigned", "quoted"].includes(String(job.status))) return c.json({ error: "cannot_quote", message: "This job isn't waiting for a quote." }, 409);
  const price = parsed.data.priceUgx;
  if (price < Number(job.callout_fee_ugx) || price > w.settings.maxQuoteUgx) {
    return c.json({ error: "invalid_price", message: `Quote between ${Number(job.callout_fee_ugx).toLocaleString("en-UG")} and ${w.settings.maxQuoteUgx.toLocaleString("en-UG")} UGX.` }, 400);
  }
  const ok = await transition({
    jobId: String(job.id), from: ["assigned", "quoted"], to: "quoted", set: { price_ugx: price, quoted_at: toDb(), quote_expires_at: inHours(w.settings.quoteValidHours) },
    environment: job.environment === "sandbox" ? "sandbox" : "live", actor: { id: c.get("user").sub, kind: "provider" }, action: "quoted", detail: { priceUgx: price },
  });
  if (!ok) return c.json({ error: "cannot_quote", message: "This job just changed. Refresh and try again." }, 409);
  notifyCustomer(job, "Your quote is ready", `${job.service_name}: UGX ${price.toLocaleString("en-UG")}`);
  return c.json({ job: await jobView((await getJob(String(job.id))) as Row, "provider") });
});

providerRoutes.post("/provider/jobs/:id/assign-worker", async (c) => {
  const w = await working(c);
  if ("error" in w) return c.json(w.error, w.status);
  if (w.ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can assign staff." }, 403);
  const parsed = z.object({ workerId: z.string().min(1).max(80) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Choose a team member." }, 400);
  const job = await myJob(w.ctx, c.get("user").sub, c.req.param("id") as string);
  if (!job) return c.json({ error: "not_found", message: "Job not found." }, 404);
  if (!["assigned", "quoted", "booked"].includes(String(job.status))) return c.json({ error: "cannot_assign", message: "You can only change who does the job before it starts." }, 409);
  const member = (await db.execute({ sql: "SELECT 1 FROM work_provider_members WHERE provider_id = ? AND user_id = ? AND status = 'active'", args: [w.ctx.provider.id, parsed.data.workerId] })).rows[0];
  if (!member) return c.json({ error: "not_on_team", message: "That person isn't on your team." }, 404);
  await db.execute({ sql: "UPDATE work_jobs SET worker_id = ?, updated_at = datetime('now') WHERE id = ? AND provider_id = ? AND status IN ('assigned', 'quoted', 'booked')", args: [parsed.data.workerId, job.id, w.ctx.provider.id] });
  await logEvent(String(job.id), c.get("user").sub, "provider", "worker_assigned", { workerId: parsed.data.workerId });
  notifyUser(parsed.data.workerId, { title: "You've been given a job", body: String(job.service_name), url: "/jobs", tag: `work-${job.id}` }).catch(() => {});
  return c.json({ job: await jobView((await getJob(String(job.id))) as Row, "provider") });
});

/** Start and finish: the provider owner, or the staff member the job is assigned to. */
async function progress(c: any, from: string, to: "in_progress" | "completed") {
  const user = c.get("user");
  const ctx = await providerFor(user.sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  const settings = await getWorkSettings();
  if (!canWork(ctx.provider, settings)) return c.json({ error: "not_approved", message: "Your account isn't approved to take jobs yet." }, 403);
  const job = await myJob(ctx, user.sub, c.req.param("id"));
  if (!job) return c.json({ error: "not_found", message: "Job not found." }, 404);
  if (to === "in_progress" && settings.onsiteCheckEnabled && settings.onsiteRequireLocation && settings.trackingEnabled && (await workOnsiteReady())) {
    if (!hasFreshLocation(job)) {
      return c.json({ error: "location_required", message: "Turn on location sharing on this page and wait a moment, then start the job." }, 409);
    }
  }
  const now = toDb();
  const body = (await c.req.json().catch(() => ({}))) as { note?: string };
  const ok = await transition({
    jobId: String(job.id), from: [from], to,
    set: to === "in_progress" ? { started_at: now } : { completed_at: now, confirm_by: inHours(settings.autoConfirmHours) },
    environment: job.environment === "sandbox" ? "sandbox" : "live",
    actor: { id: user.sub, kind: ctx.role === "owner" ? "provider" : "worker" }, action: to === "in_progress" ? "started" : "completed", detail: body.note ? { note: String(body.note).slice(0, 300) } : undefined,
  });
  if (!ok) return c.json({ error: "wrong_state", message: to === "in_progress" ? "This job isn't ready to start (it may still need a quote or payment)." : "This job isn't in progress." }, 409);
  notifyCustomer(job, to === "in_progress" ? "Your job has started" : "Your job is done — please confirm", String(job.service_name));
  return c.json({ job: await jobView((await getJob(String(job.id))) as Row, "provider") });
}
providerRoutes.post("/provider/jobs/:id/start", (c) => progress(c, "booked", "in_progress"));
providerRoutes.post("/provider/jobs/:id/complete", (c) => progress(c, "in_progress", "completed"));

providerRoutes.post("/provider/jobs/:id/cancel", async (c) => {
  const w = await working(c);
  if ("error" in w) return c.json(w.error, w.status);
  if (w.ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can cancel a job." }, 403);
  const job = await myJob(w.ctx, c.get("user").sub, c.req.param("id") as string);
  if (!job) return c.json({ error: "not_found", message: "Job not found." }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const result = await providerCancel(job, c.get("user").sub, w.settings, String(body.reason ?? "Cancelled by provider"));
  if (!result.ok) return c.json({ error: result.error, message: result.message }, result.status);
  return c.json({ ok: true, rematched: result.rematched });
});

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

providerRoutes.get("/provider/earnings", async (c) => {
  const ctx = await providerFor(c.get("user").sub);
  if (!ctx) return c.json(NOT_PROVIDER, 404);
  if (ctx.role !== "owner") return c.json({ error: "forbidden", message: "Only the account owner can see earnings." }, 403);
  const paid = (await db.execute({ sql: `SELECT COALESCE(SUM(m.amount_ugx), 0) AS total, COUNT(*) AS n FROM work_money m JOIN work_jobs j ON j.id = m.job_id WHERE m.kind = 'payout' AND m.status = 'done' AND j.provider_id = ?`, args: [ctx.provider.id] })).rows[0] as Row;
  const coming = (await db.execute({ sql: `SELECT COALESCE(SUM(held_ugx - ROUND(held_ugx * commission_percent / 100.0)), 0) AS total, COUNT(*) AS n FROM work_jobs WHERE provider_id = ? AND status IN ('booked', 'in_progress', 'completed', 'disputed')`, args: [ctx.provider.id] })).rows[0] as Row;
  const environment = await getPlatformEnvironment();
  await ensureProviderWorkWallet("work", String(ctx.provider.id), environment);
  const [workWalletBalance, personalWalletActive, walletSettings, transferSchemaReady, personalWalletActivationAvailable] = await Promise.all([
    providerWorkWalletBalance("work", String(ctx.provider.id), environment),
    personalWalletIsActive(c.get("user").sub),
    getWalletAccountSettings(),
    hasTable("provider_wallet_transfers"),
    hasTable("personal_wallets"),
  ]);
  return c.json({
    providerId: String(ctx.provider.id),
    paidUgx: Number(paid.total), paidJobs: Number(paid.n),
    upcomingUgx: Number(coming.total), upcomingJobs: Number(coming.n),
    jobsCompleted: Number(ctx.provider.jobs_completed),
    workWalletReady: workWalletBalance !== null,
    workWalletBalance: workWalletBalance ?? 0,
    personalWalletActive,
    personalWalletActivationAvailable,
    providerWalletTransfersEnabled: walletSettings.providerTransfersEnabled && transferSchemaReady,
  });
});

