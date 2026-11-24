import {notifyUser} from '../lib/webpush.js';
import {Hono,type Context} from 'hono';
import {z} from 'zod';
import bcrypt from 'bcryptjs';
import {db,executeBatch,requireChangedRow} from '../db/client.js';
import {requireAuth,requireRole} from '../auth/middleware.js';
import {requirePermission} from '../admin/permissions.js';
import {logActivity} from '../admin/activity.js';
import {hasTable} from '../lib/schema.js';
import {getActiveCallProvider,getPlatformEnvironment,getVoiceNoteMaxSeconds} from '../lib/settings.js';
import {isCallProviderConfigured} from '../calls/credentials.js';
import {callRoutes} from '../calls/routes.js';
import {getR2Bucket,r2IsReady,uploadResponseHeaders} from '../storage/r2.js';
import {newId} from '../lib/ids.js';
import {consume,checkLockout,recordFailure,clearFailures} from '../lib/ratelimit.js';
import {generateCode,hashCode,timingSafeEqual} from '../verify/otp.js';
import {isResendConfigured,sendVerificationEmail} from '../verify/email.js';
import {isAfricasTalkingConfigured,sendVerificationSms} from '../verify/sms.js';
import {maskTarget} from '../verify/service.js';
import {toAuthUser} from '../auth/serialize.js';
import {getCustomerTools,DEFAULT_PUSH,pushPreferencesSchema} from './settings.js';
type Row=Record<string,any>;
export const accountToolsRoutes=new Hono();
accountToolsRoutes.use('/account-tools/*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
accountToolsRoutes.use('/admin/customer-cases*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
accountToolsRoutes.use('/account-tools/*',requireAuth,requireRole('customer'));
accountToolsRoutes.use('/admin/customer-cases*',requireAuth,requireRole('admin'),requirePermission('chat.view_support'));
const body=(c:Context)=>c.req.json().catch(()=>null);
const missing=(c:Context)=>c.json({message:'Account tools upgrade is pending. Please try again later.'},503);
async function ready(){return hasTable('customer_cases');}
accountToolsRoutes.get('/account-tools/config',async c=>{
 const s=await getCustomerTools(),provider=await getActiveCallProvider();
 return c.json({...s,voiceNoteMaxSeconds:await getVoiceNoteMaxSeconds(),ready:await ready(),pushReady:s.pushEnabled&&!!process.env.VAPID_PUBLIC_KEY&&!!process.env.VAPID_PRIVATE_KEY,publicKey:s.pushEnabled?process.env.VAPID_PUBLIC_KEY||null:null,callsReady:['cloudflare','webrtc_p2p'].includes(provider)&&await isCallProviderConfigured(provider),callProvider:provider});
});
accountToolsRoutes.get('/account-tools/sessions',async c=>{
 if(!(await hasTable('account_sessions')))return missing(c);
 const s=await getCustomerTools();if(!s.sessionsEnabled)return c.json({sessions:[],enabled:false});
 await db.execute({sql:"DELETE FROM account_sessions WHERE user_id=? AND last_seen_at<datetime('now',?)",args:[c.get('user').sub,'-'+s.sessionRetentionDays+' days']});
 const rows=await db.execute({sql:`SELECT s.jti AS id,s.user_agent,s.first_seen_at,s.last_seen_at,s.expires_at,r.revoked_at FROM account_sessions s LEFT JOIN revoked_sessions r ON r.jti=s.jti WHERE s.user_id=? ORDER BY s.last_seen_at DESC`,args:[c.get('user').sub]});
 return c.json({enabled:true,sessions:rows.rows.map(r=>({...r,current:r.id===c.get('user').jti}))});
});
accountToolsRoutes.post('/account-tools/sessions/:id/revoke',async c=>{
 if(!(await hasTable('account_sessions')))return missing(c);const u=c.get('user'),id=c.req.param('id');
 if(!(await getCustomerTools()).sessionsEnabled)return c.json({message:'Session management is disabled.'},403);
 const r=(await db.execute({sql:'SELECT * FROM account_sessions WHERE jti=? AND user_id=?',args:[id,u.sub]})).rows[0];if(!r)return c.json({message:'Session not found.'},404);
 await db.execute({sql:'INSERT OR IGNORE INTO revoked_sessions(jti,user_id,expires_at) VALUES(?,?,?)',args:[id,u.sub,String(r.expires_at)]});return c.json({ok:true,current:id===u.jti});
});
accountToolsRoutes.get('/account-tools/preferences',async c=>{
 if(!(await hasTable('account_preferences')))return missing(c);const r=(await db.execute({sql:'SELECT push_json FROM account_preferences WHERE user_id=?',args:[c.get('user').sub]})).rows[0];return c.json({push:r?JSON.parse(String(r.push_json)):DEFAULT_PUSH});
});
accountToolsRoutes.put('/account-tools/preferences',async c=>{
 if(!(await hasTable('account_preferences')))return missing(c);const p=pushPreferencesSchema.safeParse(await body(c));if(!p.success)return c.json({message:'Invalid notification preferences.'},400);
 await db.execute({sql:"INSERT INTO account_preferences(user_id,push_json) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET push_json=excluded.push_json,updated_at=datetime('now')",args:[c.get('user').sub,JSON.stringify(p.data)]});return c.json({push:p.data});
});
const contactSchema=z.object({channel:z.enum(['sms','email']),target:z.string().trim().min(3).max(160),password:z.string().min(1).max(100)}).strict();
accountToolsRoutes.post('/account-tools/contact/request',async c=>{
 if(!(await hasTable('account_contact_changes')))return missing(c);const s=await getCustomerTools();if(!s.contactChangesEnabled)return c.json({message:'Contact changes are disabled.'},403);
 const p=contactSchema.safeParse(await body(c));if(!p.success)return c.json({message:'Enter the new contact and current password.'},400);const d=p.data,u=c.get('user'),target=d.channel==='email'?d.target.toLowerCase():d.target;
 if(!(d.channel==='email'?z.string().email().safeParse(target).success:/^\+[1-9][0-9]{7,14}$/.test(target)))return c.json({message:'Enter a valid email or phone in international format.'},400);
 const lock='contact:'+u.sub;if(!(await checkLockout(lock)).allowed)return c.json({message:'Too many attempts. Try later.'},429);
 const row=(await db.execute({sql:'SELECT * FROM users WHERE id=?',args:[u.sub]})).rows[0] as Row;
 if(!row.password_set_at||!await bcrypt.compare(d.password,row.password_hash)){await recordFailure(lock);return c.json({message:'Current password required. Google-only accounts can set a password through account recovery first.'},400);}await clearFailures(lock);
 const rate=await consume('contact-send:'+u.sub,1,s.otpCooldownSeconds);if(!rate.allowed)return c.json({message:'Wait before requesting another code.',retryAfterSeconds:rate.retryAfterSeconds},429);
 const column=d.channel==='email'?'email':'phone';if((await db.execute({sql:`SELECT 1 FROM users WHERE ${column}=?`,args:[target]})).rows.length)return c.json({message:'This contact cannot be used.'},409);
 const configured=d.channel==='email'?await isResendConfigured():isAfricasTalkingConfigured();if(!configured&&process.env.ENVIRONMENT!=='development')return c.json({message:'Verification delivery is unavailable.'},503);
 const id=newId('contact'),code=generateCode();await db.execute({sql:'INSERT INTO account_contact_changes(id,user_id,channel,target,code_hash,expires_at) VALUES(?,?,?,?,?,?)',args:[id,u.sub,d.channel,target,await hashCode(code),new Date(Date.now()+s.otpMinutes*60000).toISOString()]});
 try{if(configured){if(d.channel==='email')await sendVerificationEmail(target,code);else await sendVerificationSms(target,code);}}catch{await db.execute({sql:"UPDATE account_contact_changes SET consumed_at=datetime('now') WHERE id=?",args:[id]});return c.json({message:'The verification code could not be delivered.'},502);}
 return c.json({id,target:maskTarget(d.channel,target),...(process.env.ENVIRONMENT==='development'&&!configured?{devCode:code}:{})});
});
accountToolsRoutes.post('/account-tools/contact/confirm',async c=>{
 if(!(await hasTable('account_contact_changes')))return missing(c);const s=await getCustomerTools();if(!s.contactChangesEnabled)return c.json({message:'Contact changes are disabled.'},403);
 const p=z.object({id:z.string(),code:z.string().regex(/^\d{6}$/)}).safeParse(await body(c));if(!p.success)return c.json({message:'Enter the six-digit code.'},400);
 const u=c.get('user'),r=(await db.execute({sql:'SELECT * FROM account_contact_changes WHERE id=? AND user_id=? AND consumed_at IS NULL',args:[p.data.id,u.sub]})).rows[0] as Row;
 if(!r||Date.parse(r.expires_at)<Date.now()||r.attempts>=s.otpAttempts)return c.json({message:'This code is expired or unavailable.'},400);
 if(!timingSafeEqual(await hashCode(p.data.code),r.code_hash)){await db.execute({sql:'UPDATE account_contact_changes SET attempts=attempts+1 WHERE id=?',args:[r.id]});return c.json({message:'Incorrect code.'},400);}
 const col=r.channel==='email'?'email':'phone';
 try{const result=await executeBatch([{sql:`UPDATE users SET ${col}=?,${col}_verified_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND EXISTS(SELECT 1 FROM account_contact_changes WHERE id=? AND consumed_at IS NULL AND attempts<? AND expires_at>?)`,args:[r.target,u.sub,r.id,s.otpAttempts,new Date().toISOString()]},requireChangedRow,{sql:"UPDATE account_contact_changes SET consumed_at=datetime('now') WHERE user_id=? AND channel=? AND consumed_at IS NULL",args:[u.sub,r.channel]}]);if(!result[0])return c.json({message:'The code has already been used.'},409);}catch{return c.json({message:'This contact cannot be used.'},409);}
 return c.json({user:toAuthUser((await db.execute({sql:'SELECT * FROM users WHERE id=?',args:[u.sub]})).rows[0] as Row)});
});
// Real providers only. These wrappers bind calls to the authenticated customer's actual booking/assigned driver.
accountToolsRoutes.post('/account-tools/calls',async c=>{
 const d=z.object({orderId:z.string()}).safeParse(await body(c));if(!d.success)return c.json({message:'Choose a booking.'},400);
 const o=(await db.execute({sql:'SELECT * FROM orders WHERE id=? AND customer_id=? AND environment=?',args:[d.data.orderId,c.get('user').sub,await getPlatformEnvironment()]})).rows[0];if(!o||!o.rider_id)return c.json({message:'No assigned driver is available.'},409);
 const provider=await getActiveCallProvider();if(!['cloudflare','webrtc_p2p'].includes(provider)||!await isCallProviderConfigured(provider))return c.json({message:'In-app audio is not enabled by Peebee.'},503);
 const h=new Headers(c.req.raw.headers);h.set('Content-Type','application/json');return callRoutes.fetch(new Request(new URL('/calls',c.req.url),{method:'POST',headers:h,body:JSON.stringify({orderId:o.id,calleeId:o.rider_id})}));
});
accountToolsRoutes.get('/account-tools/calls/incoming',async c=>{
 const r=await db.execute({sql:`SELECT ca.*,u.name AS caller_name FROM calls ca JOIN orders o ON o.id=ca.order_id JOIN users u ON u.id=ca.caller_id WHERE ca.callee_id=? AND ca.status='ringing' AND ca.environment=? AND o.customer_id=? AND o.rider_id=ca.caller_id AND o.environment=ca.environment AND ca.provider IN ('cloudflare','webrtc_p2p') ORDER BY ca.created_at LIMIT 1`,args:[c.get('user').sub,await getPlatformEnvironment(),c.get('user').sub]});return c.json({call:r.rows[0]||null});
});
async function ownCase(c:Context){if(!await ready())return null;const r=(await db.execute({sql:'SELECT * FROM customer_cases WHERE id=? AND environment=?',args:[c.req.param('id')||'',await getPlatformEnvironment()]})).rows[0] as Row|undefined;if(!r||(c.get('user').role!=='admin'&&r.customer_id!==c.get('user').sub))return null;return r;}
accountToolsRoutes.get('/account-tools/cases',async c=>{if(!await ready())return missing(c);return c.json({cases:(await db.execute({sql:'SELECT id,order_id,description,status,version,created_at,updated_at FROM customer_cases WHERE customer_id=? AND environment=? ORDER BY created_at DESC',args:[c.get('user').sub,await getPlatformEnvironment()]})).rows});});
accountToolsRoutes.post('/account-tools/cases',async c=>{
 if(!await ready())return missing(c);const s=await getCustomerTools();if(!s.lostPropertyEnabled)return c.json({message:'Lost-property reporting is disabled. Contact support.'},403);
 const p=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),orderId:z.string(),description:z.string().trim().min(5).max(2000),contact:z.string().trim().min(5).max(160)}).strict().safeParse(await body(c));if(!p.success)return c.json({message:'Choose a booking and describe the item and contact details.'},400);
 const d=p.data,u=c.get('user'),environment=await getPlatformEnvironment();const existing=(await db.execute({sql:'SELECT id FROM customer_cases WHERE id=? AND customer_id=?',args:[d.id,u.sub]})).rows[0];if(existing)return c.json({id:existing.id});
 const o=(await db.execute({sql:'SELECT 1 FROM orders WHERE id=? AND customer_id=? AND environment=?',args:[d.orderId,u.sub,environment]})).rows[0];if(!o)return c.json({message:'Booking not found.'},404);
 if(!(await consume('lost-case:'+u.sub,s.maxCasesPerDay,86400)).allowed)return c.json({message:'Daily report limit reached. Use support for an existing report.'},429);
 await executeBatch([{sql:'INSERT INTO customer_cases(id,customer_id,order_id,environment,description,contact) VALUES(?,?,?,?,?,?)',args:[d.id,u.sub,d.orderId,environment,d.description,d.contact]},{sql:'INSERT INTO customer_case_events(id,case_id,actor_id,body,status) VALUES(?,?,?,?,?)',args:[newId('caseevt'),d.id,u.sub,'Report submitted','open']}]);return c.json({id:d.id},201);
});
accountToolsRoutes.get('/admin/customer-cases',async c=>{if(!await ready())return missing(c);return c.json({cases:(await db.execute({sql:'SELECT id,order_id,description,status,version,created_at FROM customer_cases WHERE environment=? ORDER BY updated_at DESC',args:[await getPlatformEnvironment()]})).rows});});
for(const base of ['/account-tools/cases','/admin/customer-cases']){
 accountToolsRoutes.get(base+'/:id',async c=>{if(!await ready())return missing(c);const report=await ownCase(c);if(!report)return c.json({message:'Report not found.'},404);return c.json({report,events:(await db.execute({sql:'SELECT e.id,e.body,e.status,e.created_at,u.name AS actor_name FROM customer_case_events e JOIN users u ON u.id=e.actor_id WHERE case_id=? ORDER BY e.created_at,e.rowid',args:[report.id]})).rows,files:(await db.execute({sql:'SELECT id,mime,created_at FROM customer_case_files WHERE case_id=?',args:[report.id]})).rows});});
 accountToolsRoutes.post(base+'/:id/message',async c=>{const report=await ownCase(c);if(!report)return c.json({message:'Report not found.'},404);const p=z.object({body:z.string().trim().min(1).max(2000),status:z.enum(['open','investigating','found','returned','closed']).optional(),version:z.number().int().optional()}).strict().safeParse(await body(c));if(!p.success)return c.json({message:'Enter an update.'},400);
 const staff=c.get('user').role==='admin';if(p.data.status&&!staff)return c.json({message:'Only support staff can change case status.'},403);
 if(p.data.status&&p.data.version!==report.version)return c.json({message:'This report changed. Refresh before updating it.'},409);
 const status=p.data.status||report.status;
 let results:number[];try{results=await executeBatch([{sql:"UPDATE customer_cases SET status=?,version=version+1,updated_at=datetime('now') WHERE id=? AND version=?",args:[status,report.id,report.version]},requireChangedRow,{sql:'INSERT INTO customer_case_events(id,case_id,actor_id,body,status) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM customer_cases WHERE id=? AND version=?)',args:[newId('caseevt'),report.id,c.get('user').sub,p.data.body,p.data.status||null,report.id,Number(report.version)+1]}]);}catch{return c.json({message:'This report changed. Refresh first.'},409);}if(!results[0])return c.json({message:'This report changed. Refresh first.'},409);
 if(staff){await notifyUser(report.customer_id,{title:'Lost-property report updated',body:'Peebee support has updated your report.',tag:'case-'+report.id,url:'/?screen=notifications'}).catch(()=>{});await logActivity({actor:c.get('user'),action:'customer.case.update',summary:'Updated lost-property report',entityType:'customer_case',entityId:report.id,after:{status}});}return c.json({ok:true});});
 accountToolsRoutes.post(base+'/:id/files',async c=>{const report=await ownCase(c);if(!report)return c.json({message:'Report not found.'},404);if(!r2IsReady())return c.json({message:'File storage is unavailable.'},503);const s=await getCustomerTools();const f=(await c.req.formData().catch(()=>null))?.get('file');if(!(f instanceof File)||!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>s.maxAttachmentMb*1048576)return c.json({message:'Choose a supported image within the configured size limit.'},400);
 const bytes=new Uint8Array(await f.arrayBuffer());const valid=f.type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:f.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!valid)return c.json({message:'The image contents do not match its file type.'},400);
 const id=newId('casefile'),key='customer-cases/'+report.id+'/'+id;
 const result=await db.execute({sql:'INSERT INTO customer_case_files(id,case_id,uploader_id,storage_key,mime) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM customer_case_files WHERE case_id=?)<?',args:[id,report.id,c.get('user').sub,key,f.type,report.id,s.maxCaseAttachments]});if(!result.rowsAffected)return c.json({message:'Attachment limit reached.'},409);
 try{await getR2Bucket().put(key,bytes,{httpMetadata:{contentType:f.type}});}catch{await db.execute({sql:'DELETE FROM customer_case_files WHERE id=?',args:[id]});return c.json({message:'Upload failed. Try again.'},502);}return c.json({id},201);});
 accountToolsRoutes.get(base+'/:id/files/:fileId',async c=>{const report=await ownCase(c);if(!report)return c.json({message:'Report not found.'},404);const f=(await db.execute({sql:'SELECT storage_key,mime FROM customer_case_files WHERE id=? AND case_id=?',args:[c.req.param('fileId'),report.id]})).rows[0];if(!f)return c.json({message:'Image not found.'},404);const object=await getR2Bucket().get(String(f.storage_key));if(!object)return c.json({message:'Image not found.'},404);return new Response(object.body,{headers:{...uploadResponseHeaders(String(f.mime),'image/jpeg'),'Cache-Control':'no-store'}});});
}

