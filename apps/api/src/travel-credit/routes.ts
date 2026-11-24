import {Hono,type Context} from 'hono';
import {z} from 'zod';
import {requireAuth,requireRole} from '../auth/middleware.js';
import {requirePermission} from '../admin/permissions.js';
import {logActivity} from '../admin/activity.js';
import {db} from '../db/client.js';
import {getPlatformEnvironment,setSetting} from '../lib/settings.js';
import {newId} from '../lib/ids.js';
import {resolveCustomerByIdentifier} from '../wallet/service.js';
import {TravelError,config,overview,statement,issueVoucher,cancelVoucher,repay,quote,quoteView,fund} from './service.js';
export const travelCreditRoutes=new Hono();
travelCreditRoutes.use('/travel-credit/*',requireAuth,requireRole('customer'));
for(const path of ['/admin/travel-credit','/admin/travel-credit/*'])travelCreditRoutes.use(path,requireAuth,requireRole('admin'),requirePermission('payments.manage'));
const run=(fn:(c:Context)=>Promise<Response>)=>async(c:Context)=>{try{return await fn(c);}catch(e){if(e instanceof TravelError)return c.json({error:e.code,message:e.message},e.status);throw e;}};
const positive=z.number().int().min(1).max(1_000_000_000),limit=z.number().int().min(0).max(1_000_000_000);
const source=z.object({accountId:z.string().min(1).max(100).optional(),voucherId:z.string().min(1).max(100).optional(),voucherCode:z.string().trim().min(1).max(80).optional()}).refine(v=>[v.accountId,v.voucherId,v.voucherCode].filter(Boolean).length===1);
async function body<T>(c:Context,schema:z.ZodType<T>){const result=schema.safeParse(await c.req.json().catch(()=>null));if(!result.success)throw new TravelError(400,'invalid_body','Check the entered details.');return result.data;}
async function customer(value:string){const user=await resolveCustomerByIdentifier(value);if(!user)throw new TravelError(404,'customer_not_found','No customer has that phone number or email.');return user;}
async function audit(c:Context,action:string,id:string,after:unknown){await logActivity({actor:c.get('user'),action,summary:action,entityType:'travel_credit',entityId:id,after});}
travelCreditRoutes.get('/travel-credit/me',run(async c=>c.json(await overview(c.get('user').sub))));
travelCreditRoutes.get('/travel-credit/accounts/:id',run(async c=>c.json(await statement(c.req.param('id')!,c.get('user').sub))));
travelCreditRoutes.post('/travel-credit/vouchers',run(async c=>{const p=await body(c,z.object({recipient:z.string().min(3).max(200),amount:positive,requestId:z.string().min(8).max(100)}));const user=await customer(p.recipient);return c.json(await issueVoucher(c.get('user').sub,{recipientId:user.id,amount:p.amount,requestId:p.requestId}),201);}));
travelCreditRoutes.post('/travel-credit/vouchers/:id/cancel',run(async c=>c.json(await cancelVoucher(c.req.param('id')!,c.get('user').sub))));
travelCreditRoutes.post('/travel-credit/accounts/:id/repay',run(async c=>{const p=await body(c,z.object({amount:positive,requestId:z.string().min(8).max(100)}));return c.json(await repay(c.req.param('id')!,c.get('user').sub,p.amount,p.requestId));}));
travelCreditRoutes.post('/travel-credit/orders/:id/quote',run(async c=>c.json(quoteView(await quote(c.req.param('id')!,c.get('user').sub,await body(c,source))))));
travelCreditRoutes.post('/travel-credit/orders/:id/fund',run(async c=>{const p=await body(c,source.and(z.object({acceptedAmount:positive,acceptedSponsored:limit})));return c.json(await fund(c.req.param('id')!,c.get('user').sub,p,p.acceptedAmount,p.acceptedSponsored));}));
travelCreditRoutes.get('/admin/travel-credit',run(async c=>c.json(await overview(c.get('user').sub,true))));
travelCreditRoutes.get('/admin/travel-credit/accounts/:id',run(async c=>c.json(await statement(c.req.param('id')!,c.get('user').sub,true))));
travelCreditRoutes.put('/admin/travel-credit/settings',run(async c=>{
 const p=await body(c,z.object({corporateEnabled:z.boolean(),vouchersEnabled:z.boolean(),voucherMax:limit,voucherDays:z.number().int().min(1).max(365)}));
 for(const [key,value]of Object.entries({travel_corporate_enabled:p.corporateEnabled?'1':'0',travel_vouchers_enabled:p.vouchersEnabled?'1':'0',travel_voucher_max_ugx:String(p.voucherMax),travel_voucher_days:String(p.voucherDays)}))await setSetting(key as Parameters<typeof setSetting>[0],value);
 await audit(c,'travel_credit.settings','settings',p);return c.json(await config());
}));
travelCreditRoutes.post('/admin/travel-credit/accounts',run(async c=>{
 if(!(await config()).ready)throw new TravelError(503,'travel_upgrade_pending','Travel credit is not set up yet.');
 const p=await body(c,z.object({name:z.string().trim().min(2).max(120),owner:z.string().min(3).max(200),creditLimit:limit})),owner=await customer(p.owner),id=newId('tc');
 await db.execute({sql:'INSERT INTO travel_accounts(id,name,owner_id,environment,credit_limit) VALUES(?,?,?,?,?)',args:[id,p.name,owner.id,await getPlatformEnvironment(),p.creditLimit]});await audit(c,'travel_credit.account_created',id,{...p,ownerId:owner.id});return c.json({id},201);
}));
travelCreditRoutes.put('/admin/travel-credit/accounts/:id',run(async c=>{
 await statement(c.req.param('id')!,c.get('user').sub,true);const p=await body(c,z.object({active:z.boolean(),creditLimit:limit}));
 try{await db.execute({sql:'UPDATE travel_accounts SET active=?,credit_limit=? WHERE id=?',args:[p.active?1:0,p.creditLimit,c.req.param('id')!]});}catch{throw new TravelError(409,'limit_below_outstanding','The credit limit cannot be lower than the outstanding amount.');}
 await audit(c,'travel_credit.account_updated',c.req.param('id')!,p);return c.json(await statement(c.req.param('id')!,c.get('user').sub,true));
}));
travelCreditRoutes.put('/admin/travel-credit/accounts/:id/members',run(async c=>{
 await statement(c.req.param('id')!,c.get('user').sub,true);const p=await body(c,z.object({customer:z.string().min(3).max(200),active:z.boolean(),perBooking:limit,monthlyLimit:limit})),user=await customer(p.customer);
 await db.execute({sql:'INSERT INTO travel_members(account_id,user_id,active,per_booking,monthly_limit) VALUES(?,?,?,?,?) ON CONFLICT(account_id,user_id) DO UPDATE SET active=excluded.active,per_booking=excluded.per_booking,monthly_limit=excluded.monthly_limit',args:[c.req.param('id')!,user.id,p.active?1:0,p.perBooking,p.monthlyLimit]});await audit(c,'travel_credit.member_updated',c.req.param('id')!,{...p,userId:user.id});return c.json(await statement(c.req.param('id')!,c.get('user').sub,true));
}));
