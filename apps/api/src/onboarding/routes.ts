import { Hono, type Context, type Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { requireSuperAdmin } from '../admin/permissions.js';
import { logActivity } from '../admin/activity.js';
import { db, executeBatch } from '../db/client.js';
import { hasTable } from '../lib/schema.js';
import { newId } from '../lib/ids.js';
import { clientIp, consume, hashKey } from '../lib/ratelimit.js';
import { getR2Bucket } from '../storage/r2.js';
import { extensionForMime, baseMimeType } from '../lib/mime.js';
import { activate, activationPreview, enroll, enrollmentSchema, invite, OnboardingError, normalizePhone } from './service.js';
import { onboardingSettings, saveOnboardingSettings, settingsSchema } from './messaging.js';
import { isAwaitingActivation } from './state.js';
import { salesAccess } from './access.js';

export const onboardingRoutes=new Hono();
onboardingRoutes.onError((error,c)=>{
  if(error instanceof OnboardingError)return c.json({error:error.code,message:error.message},error.status);
  console.error('Onboarding operation failed',{name:error.name});
  return c.json({error:'onboarding_failed',message:'Could not complete this request. Please try again.'},500);
});
async function ready(c:Context,next:Next) {
  if(!(await hasTable('onboarding_accounts'))||!(await hasTable('sales_agents')))return c.json({error:'onboarding_not_ready',message:'The onboarding database update has not been applied yet.'},503);
  c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');await next();
}
async function agent(c:Context,next:Next) {
  const user=c.get('user');
  if(user.adminRole!=='super_admin') {
    const r=await db.execute({sql:'SELECT 1 FROM sales_agents WHERE user_id=? AND enabled=1',args:[user.sub]});
    if(!r.rows[0])return c.json({error:'forbidden',message:'Sales-agent access is required.'},403);
  }
  await next();
}
onboardingRoutes.use('/sales/*',requireAuth,ready,agent);
onboardingRoutes.use('/admin/onboarding/*',requireAuth,ready,requireSuperAdmin());
onboardingRoutes.use('/onboarding/*',ready);
onboardingRoutes.use('/sales-access/*',requireAuth,ready);
onboardingRoutes.get('/sales-access/status',async c=>{
  const user=c.get('user');
  return c.json({status:await salesAccess(user.sub,user.adminRole==='super_admin')});
});
onboardingRoutes.post('/sales-access/request',async c=>{
  const parsed=z.object({consent:z.literal(true)}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'consent_required',message:'Confirm that you want to apply for sales-agent access.'},400);
  if(!(await hasTable('sales_agent_requests')))return c.json({error:'sales_requests_not_ready',message:'Sales applications are temporarily unavailable.'},503);
  const user=c.get('user'),status=await salesAccess(user.sub,user.adminRole==='super_admin');
  if(status==='none'){
    if(!(await onboardingSettings()).enabled)return c.json({error:'onboarding_disabled',message:'Sales applications are paused by Admin.'},403);
    const r=await db.execute({sql:"INSERT INTO sales_agent_requests (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING",args:[user.sub]});
    if(r.rowsAffected)await logActivity({actor:user,action:'sales.agent.apply',entityType:'user',entityId:user.sub,summary:'Requested sales-agent approval',ip:clientIp(c)});
  }
  return c.json({status:await salesAccess(user.sub,user.adminRole==='super_admin')});
});
onboardingRoutes.get('/admin/onboarding/requests',async c=>{
  if(!(await hasTable('sales_agent_requests')))return c.json({requests:[]});
  return c.json({requests:(await db.execute("SELECT r.user_id,r.status,r.created_at,u.name,u.email,u.phone FROM sales_agent_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 100")).rows});
});
onboardingRoutes.post('/admin/onboarding/requests/:id',async c=>{
  const parsed=z.object({decision:z.enum(['approved','rejected'])}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'invalid_body'},400);
  if(!(await hasTable('sales_agent_requests')))return c.json({error:'sales_requests_not_ready'},503);
  const id=c.req.param('id'),user=c.get('user'),decision=parsed.data.decision;
  const results=await executeBatch([
    {sql:"UPDATE sales_agent_requests SET status=?,reviewed_by=?,reviewed_at=datetime('now') WHERE user_id=? AND status='pending' AND EXISTS (SELECT 1 FROM users u WHERE u.id=user_id AND u.status='active')",args:[decision,user.sub,id]},
    // Only the winning reviewer may grant access; a replay or competing decision cannot re-enable an agent.
    {sql:"INSERT INTO sales_agents (user_id,created_by) SELECT r.user_id,? FROM sales_agent_requests r JOIN users u ON u.id=r.user_id WHERE r.user_id=? AND r.status='approved' AND r.reviewed_by=? AND u.status='active' ON CONFLICT(user_id) DO NOTHING",args:[user.sub,id,user.sub]},
  ]);
  if(!results[0])return c.json({error:'already_reviewed',message:'This application has already been reviewed.'},409);
  await logActivity({actor:user,action:`sales.agent.${decision}`,entityType:'user',entityId:id,summary:`${decision==='approved'?'Approved':'Rejected'} sales-agent application`,ip:clientIp(c)});
  return c.json({ok:true});
});

onboardingRoutes.get('/sales/me',c=>c.json({user:{id:c.get('user').sub,name:c.get('user').name},superAdmin:c.get('user').adminRole==='super_admin'}));
onboardingRoutes.get('/sales/categories',async c=>c.json({categories:(await db.execute('SELECT id,name FROM merchant_categories WHERE active=1 ORDER BY sort_order,name')).rows}));
onboardingRoutes.get('/sales/onboarding',async c=>{
  const user=c.get('user');
  const result=await db.execute({sql:`SELECT a.id,a.user_id,a.account_type,a.created_at,a.activated_at,u.name,u.email,u.phone,
    (SELECT status FROM onboarding_deliveries WHERE account_id=a.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS delivery_status,
    (SELECT channel FROM onboarding_deliveries WHERE account_id=a.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS delivery_channel
    FROM onboarding_accounts a JOIN users u ON u.id=a.user_id WHERE a.account_type<>'agent' AND (?=1 OR a.agent_id=?) ORDER BY a.created_at DESC LIMIT 100`,args:[user.adminRole==='super_admin'?1:0,user.sub]});
  return c.json({records:result.rows});
});
onboardingRoutes.post('/sales/onboarding',bodyLimit({maxSize:30*1024*1024}),async c=>{
  if(!(await onboardingSettings()).enabled)return c.json({error:'onboarding_disabled',message:'Onboarding is paused by Admin.'},403);
  let data:unknown;let form:FormData|undefined;
  if((c.req.header('Content-Type')??'').includes('multipart/form-data')) {
    form=await c.req.formData();
    const raw=form.get('data');if(typeof raw!=='string')return c.json({error:'invalid_body'},400);
    try{data=JSON.parse(raw);}catch{return c.json({error:'invalid_body'},400);}
  }else data=await c.req.json().catch(()=>null);
  const parsed=enrollmentSchema.safeParse(data);
  if(!parsed.success)return c.json({error:'invalid_body',message:parsed.error.issues.map(i=>i.message).join(' '),issues:parsed.error.issues},400);
  const input=parsed.data, user=c.get('user');
  // Validate every file before writing anything. Agent-chosen keys never enter SQL.
  const documents:Record<string,string>={},uploads:Array<{file:File;key:string;field:string}>=[];
  const files:{field:string;types:string[];limit:number;audience:string}[]=[
    {field:'riderId',types:['image/jpeg','image/png','image/webp','application/pdf'],limit:8*1024*1024,audience:'rider'},
    {field:'photo',types:['image/jpeg','image/png','image/webp'],limit:4*1024*1024,audience:'rider'},
    {field:'ownerId',types:['image/jpeg','image/png','image/webp','application/pdf'],limit:8*1024*1024,audience:'merchant'},
    {field:'businessDocument',types:['image/jpeg','image/png','image/webp','application/pdf'],limit:8*1024*1024,audience:'merchant'},
  ];
  for(const spec of files) {
    const file=form?.get(spec.field);if(!(file instanceof File)||!file.size)continue;
    if(input.accountType!==spec.audience||file.size>spec.limit||!spec.types.includes(baseMimeType(file.type)))return c.json({error:'invalid_document',message:`Check the ${spec.field} file type and size.`},400);
    documents.userId??=crypto.randomUUID();
    const key=`onboarding/${documents.userId}/${crypto.randomUUID()}.${extensionForMime(file.type,'bin')}`;
    uploads.push({file,key,field:spec.field});documents[spec.field]=key;
  }
  const stored:string[]=[];
  let result:{id:string;replayed:boolean};
  try {
    for(const upload of uploads){await getR2Bucket().put(upload.key,await upload.file.arrayBuffer(),{httpMetadata:{contentType:upload.file.type}});stored.push(upload.key);}
    result=await enroll(input,user.sub,documents);
  }catch(error){await Promise.allSettled(stored.map(key=>getR2Bucket().delete(key)));throw error;}
  if(result.replayed) {
    await Promise.allSettled(stored.map(key=>getR2Bucket().delete(key)));
    return c.json({id:result.id,replayed:true},200);
  }
  await logActivity({actor:user,action:'onboarding.create',entityType:'onboarding',entityId:result.id,summary:`Registered ${input.accountType} ${input.name}`,ip:clientIp(c)});
  const delivery=await invite(result.id);
  return c.json({id:result.id,delivery},201);
});
onboardingRoutes.post('/sales/onboarding/:id/resend',async c=>{
  const id=c.req.param('id'),u=c.get('user');
  const result=await db.execute({sql:"SELECT id FROM onboarding_accounts WHERE id=? AND account_type<>'agent' AND (?=1 OR agent_id=?)",args:[id,u.adminRole==='super_admin'?1:0,u.sub]});
  if(!result.rows[0])return c.json({error:'not_found'},404);
  const delivery=await invite(id);
  await logActivity({actor:u,action:'onboarding.resend',entityType:'onboarding',entityId:id,summary:'Retried account activation message',ip:clientIp(c)});
  return c.json({delivery});
});
const previewSchema=z.object({token:z.string().min(40).max(100)});
onboardingRoutes.post('/onboarding/preview',async c=>{
  const limit=await consume(`onboarding:preview:${await hashKey(clientIp(c))}`,30,60);
  if(!limit.allowed)return c.json({error:'rate_limited'},429);
  const parsed=previewSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'invalid_activation'},400);
  const a=await activationPreview(parsed.data.token);
  return c.json({name:a.name,accountType:a.account_type,expiresAt:a.expires_at});
});
onboardingRoutes.post('/onboarding/activate',async c=>{
  const limit=await consume(`onboarding:activate:${await hashKey(clientIp(c))}`,10,60);
  if(!limit.allowed)return c.json({error:'rate_limited'},429);
  const parsed=previewSchema.extend({password:z.string().min(10).max(100)}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'invalid_body',message:'Choose a password of at least 10 characters.'},400);
  return c.json(await activate(parsed.data.token,parsed.data.password));
});
onboardingRoutes.get('/admin/onboarding/settings',async c=>c.json(await onboardingSettings()));
onboardingRoutes.put('/admin/onboarding/settings',async c=>{
  const parsed=settingsSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'invalid_body',message:parsed.error.issues.map(i=>i.message).join(' ')},400);
  await saveOnboardingSettings(parsed.data);
  await logActivity({actor:c.get('user'),action:'onboarding.settings',summary:'Updated onboarding policy and messaging configuration',ip:clientIp(c)});
  return c.json(await onboardingSettings());
});
onboardingRoutes.get('/admin/onboarding/agents',async c=>c.json({agents:(await db.execute(`SELECT s.user_id,s.enabled,u.name,u.email,u.phone,CASE WHEN a.id IS NULL THEN u.created_at ELSE a.activated_at END AS activated_at FROM sales_agents s JOIN users u ON u.id=s.user_id LEFT JOIN onboarding_accounts a ON a.user_id=u.id ORDER BY s.created_at DESC`)).rows}));
onboardingRoutes.post('/admin/onboarding/agents',async c=>{
  const parsed=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().transform(v=>v.toLowerCase()),phone:z.string().optional().transform(v=>v?.trim()?normalizePhone(v):undefined).refine(v=>!v||/^\+[1-9]\d{7,14}$/.test(v)),consent:z.literal(true)}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'invalid_body',message:'Add the agent name, email and a valid phone number.'},400);
  const d=parsed.data,u=c.get('user');
  const clash=await db.execute({sql:'SELECT id FROM users WHERE lower(email)=? OR (? IS NOT NULL AND phone=?)',args:[d.email,d.phone??null,d.phone??null]});
  if(clash.rows[0])return c.json({error:'account_exists',message:'This person already has an account. Use their existing user ID to grant agent access.'},409);
  const id=crypto.randomUUID(),accountId=newId('onb'),passwordHash=await bcrypt.hash(randomBytes(32).toString('base64url'),10);
  await executeBatch([
    {sql:"INSERT INTO users (id,name,email,phone,password_hash,role) VALUES (?,?,?,?,?,'customer')",args:[id,d.name,d.email,d.phone??null,passwordHash]},
    {sql:'INSERT INTO sales_agents (user_id,created_by) VALUES (?,?)',args:[id,u.sub]},
    {sql:"INSERT INTO onboarding_accounts (id,user_id,agent_id,account_type,request_id,consent_at) VALUES (?,?,?,'agent',?,datetime('now'))",args:[accountId,id,u.sub,crypto.randomUUID()]},
  ]);
  await logActivity({actor:u,action:'sales.agent.create',entityType:'user',entityId:id,summary:`Invited sales agent ${d.name}`,ip:clientIp(c)});
  return c.json({id,delivery:await invite(accountId)},201);
});
onboardingRoutes.post('/admin/onboarding/agents/existing',async c=>{
  const parsed=z.object({email:z.string().trim().email().transform(v=>v.toLowerCase())}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'invalid_body',message:'Enter the existing account email.'},400);
  const r=await db.execute({sql:"SELECT id,name FROM users WHERE lower(email)=? AND status='active'",args:[parsed.data.email]});
  const user=r.rows[0];
  if(!user)return c.json({error:'not_found',message:'No active account uses this email.'},404);
  if(await isAwaitingActivation(String(user.id)))return c.json({error:'activation_required',message:'This account must activate before agent access can be added.'},409);
  await db.execute({sql:'INSERT INTO sales_agents (user_id,created_by) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=1',args:[user.id,c.get('user').sub]});
  await logActivity({actor:c.get('user'),action:'sales.agent.enable',entityType:'user',entityId:String(user.id),summary:`Enabled sales-agent access for ${user.name}`,ip:clientIp(c)});
  return c.json({ok:true});
});
onboardingRoutes.post('/admin/onboarding/agents/:id',async c=>{
  const parsed=z.object({enabled:z.boolean()}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'invalid_body'},400);
  const id=c.req.param('id');
  const r=await db.execute({sql:'UPDATE sales_agents SET enabled=? WHERE user_id=?',args:[parsed.data.enabled?1:0,id]});
  if(!r.rowsAffected)return c.json({error:'not_found'},404);
  await logActivity({actor:c.get('user'),action:'sales.agent.status',entityType:'user',entityId:id,summary:parsed.data.enabled?'Enabled sales-agent access':'Disabled sales-agent access',ip:clientIp(c)});
  return c.json({ok:true});
});
onboardingRoutes.post('/admin/onboarding/agents/:id/resend',async c=>{
  const r=await db.execute({sql:"SELECT a.id FROM onboarding_accounts a JOIN sales_agents s ON s.user_id=a.user_id WHERE a.user_id=? AND a.account_type='agent' AND s.enabled=1",args:[c.req.param('id')]});
  if(!r.rows[0])return c.json({error:'not_found'},404);
  return c.json({delivery:await invite(String(r.rows[0].id))});
});
