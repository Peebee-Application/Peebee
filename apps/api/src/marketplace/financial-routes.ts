import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { merchantRoleGuard } from "../lib/guards.js";
import { getOption } from "../lib/option-settings.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { storeOfUser } from "./plans.js";
import { financialReport } from "./financial-report.js";

export const financialRoutes = new Hono();
for (const path of ["/merchants/me/financial-report", "/merchants/me/financial-entries", "/merchants/me/financial-entries/*"]) {
  financialRoutes.use(path, requireAuth, merchantRoleGuard, async (c,next) => {
    if (!await getOption("merchant_financial_reports_enabled")) return c.json({error: "reports_disabled", message: "Financial reporting is disabled by admin."},403);
    return next();
  });
}
const instant = z.string().datetime({offset:true}).transform(value => new Date(value).toISOString().replace("T"," ").slice(0,19));
const querySchema = z.object({from: instant, until: instant, outletId: z.string().max(200).optional(), page: z.coerce.number().int().min(1).max(100000).default(1)}).refine(v => v.until>v.from, "The end must be after the start.");
async function validOutlet(store: Record<string,unknown>, id?: string | null) {
  return !id || !!(await db.execute({sql: "SELECT 1 FROM merchant_outlets WHERE id=? AND merchant_id=?", args: [id,String(store.merchant_id)]})).rows.length;
}
financialRoutes.get("/merchants/me/financial-report", async c => {
  const store = await storeOfUser(c.get("user").sub,c.req.header("X-Merchant-Id"));
  if (!store) return c.json({error:"no_store"},404);
  const query = querySchema.safeParse(c.req.query());
  if (!query.success) return c.json({error:"invalid_query",message:"Provide a valid start and end time and page number."},400);
  if (!await validOutlet(store,query.data.outletId)) return c.json({error:"outlet_not_found"},404);
  c.header("Cache-Control","private, no-store");
  return c.json(await financialReport({storeId:String(store.id),merchantId:String(store.merchant_id),environment:await getPlatformEnvironment(),...query.data}));
});

const entrySchema = z.object({requestId:z.string().uuid(),outletId:z.string().max(200).nullable().optional(),category:z.enum(["operating_expense","cost_of_goods","tax"]),amountUgx:z.number().int().positive().safe(),occurredAt:instant,description:z.string().trim().min(3).max(500),reference:z.string().trim().min(1).max(200)});
financialRoutes.post("/merchants/me/financial-entries",async c => {
  const store=await storeOfUser(c.get("user").sub,c.req.header("X-Merchant-Id"));
  if (!store) return c.json({error:"no_store"},404);
  if (!await hasTable("store_financial_entries")) return c.json({error:"migration_pending",message:"The expense journal migration has not been applied yet."},503);
  const parsed=entrySchema.safeParse(await c.req.json().catch(()=>null));
  if (!parsed.success) return c.json({error:"invalid_body",message:"Provide a positive whole-shilling amount, date, description, reference and request ID."},400);
  const d=parsed.data, environment=await getPlatformEnvironment();
  if (!await validOutlet(store,d.outletId)) return c.json({error:"outlet_not_found"},404);
  const id=`fin_${store.id}_${environment}_${d.requestId}`;
  await db.execute({sql:`INSERT OR IGNORE INTO store_financial_entries(id,store_id,outlet_id,environment,category,amount_ugx,occurred_at,description,reference,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,args:[id,String(store.id),d.outletId??null,environment,d.category,d.amountUgx,d.occurredAt,d.description,d.reference,c.get("user").sub]});
  const entry=(await db.execute({sql:"SELECT * FROM store_financial_entries WHERE id=? AND store_id=?",args:[id,String(store.id)]})).rows[0];
  if (!entry || entry.outlet_id!==(d.outletId??null) || entry.category!==d.category || Number(entry.amount_ugx)!==d.amountUgx || entry.occurred_at!==d.occurredAt || entry.description!==d.description || entry.reference!==d.reference) return c.json({error:"request_id_reused",message:"Use a new request ID for a different journal entry."},409);
  return c.json({entry,moneyMovement:false},201);
});

financialRoutes.post("/merchants/me/financial-entries/:id/void",async c => {
  const store=await storeOfUser(c.get("user").sub,c.req.header("X-Merchant-Id"));
  if (!store) return c.json({error:"no_store"},404);
  if (!await hasTable("store_financial_entries")) return c.json({error:"migration_pending"},503);
  const body=z.object({reason:z.string().trim().min(10).max(500)}).safeParse(await c.req.json().catch(()=>null));
  if (!body.success) return c.json({error:"reason_required"},400);
  const entry=(await db.execute({sql:"SELECT id,voided_at FROM store_financial_entries WHERE id=? AND store_id=? AND environment=?",args:[c.req.param("id"),String(store.id),await getPlatformEnvironment()]})).rows[0];
  if (!entry) return c.json({error:"not_found"},404);
  if (!entry.voided_at) await db.execute({sql:"UPDATE store_financial_entries SET voided_at=datetime('now'),voided_by=?,void_reason=? WHERE id=? AND store_id=? AND voided_at IS NULL",args:[c.get("user").sub,body.data.reason,c.req.param("id"),String(store.id)]});
  return c.json({ok:true,moneyMovement:false});
});
