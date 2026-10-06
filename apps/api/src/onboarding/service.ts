import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ActivationChannel } from '@peebee/shared';
import { db, executeBatch, type DbStatement } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { getPlatformEnvironment } from '../lib/settings.js';
import { merchantBusinessStatements } from '../merchants/service.js';
import { signToken } from '../auth/jwt.js';
import { toAuthUser } from '../auth/serialize.js';
import { ActivationDeliveryRejected, onboardingSettings, sendActivation } from './messaging.js';
import { ResendDeliveryError } from '../verify/email-keys.js';
import { hasColumn, hasTable } from '../lib/schema.js';

export const normalizePhone = (value:string)=>{
  let s=value.replace(/[\s().-]/g,'');
  if(/^0[37]\d{8}$/.test(s)) s=`+256${s.slice(1)}`;
  else if(/^256\d{9}$/.test(s)) s=`+${s}`;
  return s;
};
const optionalText=(max:number)=>z.preprocess(v=>v===''?undefined:v,z.string().trim().min(1).max(max).optional());
const phone=z.preprocess(v=>typeof v==='string'&&v.trim()?normalizePhone(v):undefined,z.string().regex(/^\+[1-9]\d{7,14}$/,'Use a valid international phone number.').optional());
const profileSchema=z.object({
  businessType:z.enum(["restaurant","kitchen","street_food","bakery"]).optional(),
  firstName:optionalText(60),lastName:optionalText(60),area:optionalText(120),vehicleInfo:optionalText(120),momoMsisdn:phone,altPhone:phone,
  stageAddress:optionalText(240),homeAddress:optionalText(240),stageName:optionalText(120),stageChairmanName:optionalText(120),stageChairmanContact:phone,
  emergencyContactName:optionalText(120),emergencyContactPhone:phone,
  lat:z.number().min(-90).max(90).optional(),lng:z.number().min(-180).max(180).optional(),
  businessName:optionalText(120),legalName:optionalText(160),description:optionalText(2000),cuisine:optionalText(120),address:optionalText(240),
  categoryId:optionalText(120),outletName:optionalText(120),openTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),closeTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});
export const enrollmentSchema=z.object({
  requestId:z.string().uuid(),accountType:z.enum(['customer','rider','restaurant','merchant']),name:z.string().trim().min(2).max(80),
  email:z.preprocess(v=>typeof v==='string'&&v.trim()?v.trim().toLowerCase():undefined,z.string().email().max(160).optional()),phone,
  preferredChannel:z.enum(['auto','email','sms','whatsapp']).default('auto'),consent:z.literal(true),profile:profileSchema.default({}),
}).superRefine((d,ctx)=>{
  if(!d.email&&!d.phone)ctx.addIssue({code:'custom',path:['email'],message:'Add an email or phone number.'});
  if(d.preferredChannel==='email'&&!d.email)ctx.addIssue({code:'custom',path:['email'],message:'Email is required for email activation.'});
  if(['sms','whatsapp'].includes(d.preferredChannel)&&!d.phone)ctx.addIssue({code:'custom',path:['phone'],message:'Phone is required for this channel.'});
  if(['restaurant','merchant'].includes(d.accountType)&&!d.profile.businessName)ctx.addIssue({code:'custom',path:['profile','businessName'],message:'Business name is required.'});
  if(d.accountType==='merchant'&&(!d.profile.categoryId||!d.profile.legalName||!d.profile.outletName||d.profile.lat==null||d.profile.lng==null))ctx.addIssue({code:'custom',path:['profile'],message:'Add legal name, category, outlet and location.'});
});
export class OnboardingError extends Error {constructor(public code:string,public status:400|403|404|409|410|429|503,message:string){super(message);}}
export function appUrl(type:string):string {
  const prod=(process.env.ENVIRONMENT??'development')!=='development';
  const values:Record<string,[string,string,string]>={customer:['CUSTOMER_APP_URL','https://customer.peebee.online','http://localhost:3000'],rider:['RIDER_APP_URL','https://rider.peebee.online','http://localhost:3001'],restaurant:['RESTAURANT_APP_URL','https://food.peebee.online','http://localhost:3003'],merchant:['MERCHANT_APP_URL','https://merchant.peebee.online','http://localhost:3005'],agent:['SALES_APP_URL','https://sales.peebee.online','http://localhost:3007']};
  const [env,live,local]=values[type]??values.customer;
  return (process.env[env]??(prod?live:local)).replace(/\/$/,'');
}
export const tokenHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function enroll(input:z.infer<typeof enrollmentSchema>,agentId:string,documents:Record<string,string>={}) {
  const previous=await db.execute({sql:'SELECT id FROM onboarding_accounts WHERE agent_id=? AND request_id=?',args:[agentId,input.requestId]});
  if(previous.rows[0]) return {id:String(previous.rows[0].id),replayed:true};
  const clash=await db.execute({sql:'SELECT id FROM users WHERE (? IS NOT NULL AND lower(email)=?) OR (? IS NOT NULL AND phone=?)',args:[input.email??null,input.email??null,input.phone??null,input.phone??null]});
  if(clash.rows.length) throw new OnboardingError('account_exists',409,'An account already uses these contact details. Ask the owner to sign in; no duplicate was created.');
  const p=input.profile;
  if(input.accountType==='merchant') {
    const category=await db.execute({sql:'SELECT id FROM merchant_categories WHERE id=? AND active=1',args:[p.categoryId!]});
    if(!category.rows[0]) throw new OnboardingError('invalid_category',400,'Choose an active merchant category.');
  }
  const userId=documents.userId??crypto.randomUUID(),id=newId('onb');
  const passwordHash=await bcrypt.hash(randomBytes(32).toString('base64url'),10);
  const role=input.accountType==='rider'?'rider':'customer';
  const statements:DbStatement[]=[
    {sql:'INSERT INTO users (id,name,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)',args:[userId,input.name,input.email??null,input.phone??null,passwordHash,role]},
    {sql:'INSERT INTO onboarding_accounts (id,user_id,agent_id,account_type,request_id,consent_at,preferred_channel) VALUES (?,?,?,?,?,datetime(\'now\'),?)',args:[id,userId,agentId,input.accountType,input.requestId,input.preferredChannel]},
  ];
  if(input.accountType==='rider') statements.push({
    sql:`INSERT INTO riders (user_id,first_name,last_name,area,vehicle_info,momo_msisdn,alt_phone,stage_address,home_address,stage_lat,stage_lng,stage_name,stage_chairman_name,stage_chairman_contact,emergency_contact_name,emergency_contact_phone,national_id_key,profile_photo_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,args:[userId,p.firstName??null,p.lastName??null,p.area??null,p.vehicleInfo??null,p.momoMsisdn??null,p.altPhone??null,p.stageAddress??null,p.homeAddress??null,p.lat??null,p.lng??null,p.stageName??null,p.stageChairmanName??null,p.stageChairmanContact??null,p.emergencyContactName??null,p.emergencyContactPhone??null,documents.riderId??null,documents.photo??null]});
  if(input.accountType==='restaurant') {
    const hasType=await hasColumn('restaurants','business_type');
    if(!hasType&&p.businessType&&p.businessType!=='restaurant') throw new OnboardingError('food_categories_unavailable',503,'Food categories are being enabled. Please try again shortly.');
    statements.push({sql:`INSERT INTO restaurants (id,owner_id,name,description,cuisine,phone,address,lat,lng,open_time,close_time,environment${hasType?',business_type':''}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?${hasType?',?':''})`,args:[newId('rst'),userId,p.businessName!,p.description??null,p.cuisine??null,input.phone??null,p.address??null,p.lat??null,p.lng??null,p.openTime??null,p.closeTime??null,await getPlatformEnvironment(),...(hasType?[p.businessType??'restaurant']:[])]});
  }
  if(input.accountType==='rider'&&[p.firstName,p.lastName,p.vehicleInfo,p.stageAddress,p.homeAddress,p.stageName,p.stageChairmanName,p.stageChairmanContact,p.emergencyContactName,p.emergencyContactPhone,documents.riderId,documents.photo].every(Boolean)&&p.lat!=null&&p.lng!=null) {
    statements.push({sql:"UPDATE riders SET profile_completed_at=datetime('now') WHERE user_id=?",args:[userId]});
  }
  if(input.accountType==='merchant') {
    const business=merchantBusinessStatements({ownerId:userId,legalName:p.legalName!,displayName:p.businessName!,businessKind:'business',categoryId:p.categoryId!,outletName:p.outletName!,phone:input.phone,address:p.address,lat:p.lat,lng:p.lng,environment:await getPlatformEnvironment()});
    statements.push(...business.statements);
    if(documents.ownerId||documents.businessDocument) statements.push({sql:'UPDATE merchant_kyc_cases SET owner_id_key=?, business_document_key=? WHERE merchant_id=?',args:[documents.ownerId??null,documents.businessDocument??null,business.created.merchantId]});
  }
  try{await executeBatch(statements);}catch(error){
    const concurrent=await db.execute({sql:'SELECT id FROM onboarding_accounts WHERE agent_id=? AND request_id=?',args:[agentId,input.requestId]});
    if(concurrent.rows[0])return {id:String(concurrent.rows[0].id),replayed:true};
    if(/unique/i.test(String(error)))throw new OnboardingError('account_exists',409,'An account already uses these contact details.');
    throw error;
  }
  return {id,replayed:false};
}
export async function invite(accountId:string):Promise<{sent:boolean;channel?:string}> {
  const settings=await onboardingSettings();
  if(!settings.enabled)throw new OnboardingError('onboarding_disabled',403,'Onboarding is paused by Admin.');
  const record=await db.execute({sql:'SELECT a.*,u.name,u.email,u.phone,u.status FROM onboarding_accounts a JOIN users u ON u.id=a.user_id WHERE a.id=?',args:[accountId]});
  const a=record.rows[0];
  if(!a||a.activated_at)throw new OnboardingError('already_activated',409,'This account is already activated.');
  if(a.status!=='active')throw new OnboardingError('account_suspended',403,'This account is suspended.');
  const lock=await db.execute({sql:"UPDATE onboarding_accounts SET last_invited_at=datetime('now') WHERE id=? AND activated_at IS NULL AND (last_invited_at IS NULL OR last_invited_at <= datetime('now',?))",args:[accountId,`-${settings.resendSeconds} seconds`]});
  if(!lock.rowsAffected)throw new OnboardingError('resend_cooldown',429,`Wait ${settings.resendSeconds} seconds before sending again.`);
  const preferred=a.preferred_channel as ActivationChannel;
  const channels=preferred==='auto'?settings.channels:[preferred,...settings.channels.filter(ch=>ch!==preferred)];
  for(const channel of channels) {
    if(!settings.channels.includes(channel))continue;
    const target=channel==='email'?a.email:a.phone;
    if(!target)continue;
    const deliveryId=newId('odl');
    if(!settings.providers[channel]) {
      await db.execute({sql:"INSERT INTO onboarding_deliveries (id,account_id,channel,status,error) VALUES (?,?,?,'unavailable','Provider is not configured')",args:[deliveryId,accountId,channel]});
      continue;
    }
    const token=randomBytes(32).toString('base64url'),invitationId=newId('oin');
    await executeBatch([
      {sql:'INSERT INTO onboarding_invitations (id,account_id,token_hash,channel,expires_at) VALUES (?,?,?,?,?)',args:[invitationId,accountId,tokenHash(token),channel,new Date(Date.now()+settings.activationHours*3600000).toISOString()]},
      {sql:"INSERT INTO onboarding_deliveries (id,account_id,channel,status) VALUES (?,?,?,'sending')",args:[deliveryId,accountId,channel]},
    ]);
    try {
      await sendActivation(channel,String(target),String(a.name),`${appUrl(String(a.account_type))}/activate#token=${token}`,settings);
      await db.execute({sql:"UPDATE onboarding_deliveries SET status='sent' WHERE id=?",args:[deliveryId]});
      return {sent:true,channel};
    }catch(error){
      // Never persist provider response bodies or URLs containing activation secrets.
      // A timeout may follow a successful send: stop automatic fallback/retry.
      if(!(error instanceof ActivationDeliveryRejected)&&!(error instanceof ResendDeliveryError)) {
        await db.execute({sql:"UPDATE onboarding_deliveries SET error='Delivery outcome unknown; check with the recipient before resending' WHERE id=?",args:[deliveryId]});
        return {sent:false};
      }
      await db.execute({sql:"UPDATE onboarding_deliveries SET status='failed',error='Provider did not confirm acceptance; retry or use another channel' WHERE id=?",args:[deliveryId]});
    }
  }
  return {sent:false};
}
export async function activationPreview(token:string) {
  const r=await db.execute({sql:`SELECT i.id AS invitation_id,i.channel,i.expires_at,i.consumed_at,a.id AS account_id,a.user_id,a.account_type,a.activated_at,u.name,u.email,u.phone,u.status
    FROM onboarding_invitations i JOIN onboarding_accounts a ON a.id=i.account_id JOIN users u ON u.id=a.user_id WHERE i.token_hash=?`,args:[tokenHash(token)]});
  const a=r.rows[0];
  if(!a||a.consumed_at||a.activated_at||Date.parse(String(a.expires_at))<=Date.now())throw new OnboardingError('invalid_activation',410,'This activation link has expired or was already used. Ask your sales agent for a new link.');
  if(a.status!=='active')throw new OnboardingError('account_suspended',403,'This account is suspended.');
  return a;
}
export async function activate(token:string,password:string) {
  const a=await activationPreview(token);
  const hash=await bcrypt.hash(password,10),claim=crypto.randomUUID();
  const results=await executeBatch([
    {sql:`UPDATE onboarding_invitations SET consumed_at=datetime('now'),claim_id=? WHERE id=? AND consumed_at IS NULL AND julianday(expires_at)>julianday('now')
      AND EXISTS (SELECT 1 FROM onboarding_accounts a JOIN users u ON u.id=a.user_id WHERE a.id=account_id AND a.activated_at IS NULL AND u.status='active')`,args:[claim,a.invitation_id]},
    {sql:`UPDATE users SET password_hash=?,password_set_at=datetime('now'),sessions_valid_from=datetime('now'),updated_at=datetime('now'),
      email_verified_at=CASE WHEN ?='email' THEN datetime('now') ELSE email_verified_at END,
      phone_verified_at=CASE WHEN ? IN ('sms','whatsapp') THEN datetime('now') ELSE phone_verified_at END
      WHERE id=? AND EXISTS (SELECT 1 FROM onboarding_invitations WHERE id=? AND claim_id=?)`,args:[hash,a.channel,a.channel,a.user_id,a.invitation_id,claim]},
    {sql:"UPDATE onboarding_accounts SET activated_at=datetime('now') WHERE id=? AND EXISTS (SELECT 1 FROM onboarding_invitations WHERE id=? AND claim_id=?)",args:[a.account_id,a.invitation_id,claim]},
  ]);
  if(results[0]!==1||results[1]!==1||results[2]!==1)throw new OnboardingError('invalid_activation',410,'This activation link was already used.');
  const user=(await db.execute({sql:'SELECT * FROM users WHERE id=?',args:[a.user_id]})).rows[0];
  const role=user.role==='rider'?'rider':user.role==='admin'?'admin':'customer';
  return {token:await signToken({sub:String(user.id),role,phone:user.phone?String(user.phone):undefined}),user:toAuthUser(user),accountType:String(a.account_type),appUrl:appUrl(String(a.account_type))};
}

/** Retry unsent invitations after a provider is configured. Sent/uncertain sends
 * are excluded so the heartbeat cannot repeatedly message the same recipient. */
export async function sweepActivationMessages():Promise<number> {
  if(!(await hasTable('onboarding_accounts')))return 0;
  const settings=await onboardingSettings();
  if(!settings.enabled||!settings.channels.some(ch=>settings.providers[ch]))return 0;
  const result=await db.execute({sql:`SELECT a.id FROM onboarding_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.activated_at IS NULL AND u.status='active'
      AND (a.last_invited_at IS NULL OR a.last_invited_at<=datetime('now',?))
      AND NOT EXISTS (SELECT 1 FROM onboarding_deliveries d WHERE d.account_id=a.id AND d.status IN ('sent','sending'))
      AND (SELECT COUNT(*) FROM onboarding_deliveries d WHERE d.account_id=a.id AND d.status='failed')<?
      AND (a.account_type<>'agent' OR EXISTS (SELECT 1 FROM sales_agents s WHERE s.user_id=a.user_id AND s.enabled=1))
    ORDER BY a.created_at LIMIT 10`,args:[`-${settings.resendSeconds} seconds`,settings.maxAttempts]});
  let sent=0;
  for(const row of result.rows){try{if((await invite(String(row.id))).sent)sent++;}catch(error){if(!(error instanceof OnboardingError))throw error;}}
  return sent;
}
