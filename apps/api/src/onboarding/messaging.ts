import type { OnboardingSettings } from '@peebee/shared';
import { z } from 'zod';
import { db, executeBatch } from '../db/client.js';
import { decryptSecret, encryptSecret, isCredentialsEncryptionConfigured } from '../lib/crypto.js';
import { emailProviderConfigured, sendResendEmail } from '../verify/email-keys.js';

export const policySchema = z.object({
  enabled:z.boolean(), activationHours:z.number().int().min(1).max(720), resendSeconds:z.number().int().min(30).max(86400),
  maxAttempts:z.number().int().min(1).max(20),
  channels:z.array(z.enum(['email','sms','whatsapp'])).min(1).max(3).refine(a=>new Set(a).size===a.length),
});
export class ActivationDeliveryRejected extends Error {}
// Strings are stored through a closed schema below; credentials never leave the API.
export const settingsSchema = policySchema.extend({
  whatsappPhoneId:z.string().regex(/^\d*$/).max(30), whatsappTemplate:z.string().regex(/^[a-z0-9_]*$/).max(120),
  whatsappLanguage:z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/), whatsappVersion:z.string().regex(/^v\d+\.\d+$/),
  whatsappToken:z.string().max(4096).optional(), clearWhatsappToken:z.boolean().optional(),
  smsUsername:z.string().max(120), smsKey:z.string().max(4096).optional(), clearSmsKey:z.boolean().optional(),
});
async function read(key:string, fallback=''):Promise<string> {
  const r=await db.execute({sql:'SELECT value FROM settings WHERE key = ?',args:[`onboarding_${key}`]});
  return String(r.rows[0]?.value ?? fallback);
}
async function secret(key:string, env:string):Promise<string> {
  const stored=await read(key);
  if(stored) return decryptSecret(stored);
  return process.env[env] ?? '';
}
export async function onboardingSettings():Promise<OnboardingSettings> {
  const [enabled,hours,cooldown,channels,phone,template,language,version,username,waSet,smsSet,email,maxAttempts] = await Promise.all([
    read('enabled','1'),read('activation_hours','72'),read('resend_seconds','60'),read('channels','["email","sms","whatsapp"]'),
    read('whatsapp_phone_id'),read('whatsapp_template'),read('whatsapp_language','en'),read('whatsapp_version','v25.0'),
    read('sms_username',process.env.AFRICASTALKING_USERNAME ?? ''),read('whatsapp_token'),read('sms_key'),emailProviderConfigured(),read('max_attempts','5'),
  ]);
  const whatsappTokenSet=!!waSet || !!process.env.WHATSAPP_ACCESS_TOKEN;
  const smsKeySet=!!smsSet || !!process.env.AFRICASTALKING_API_KEY;
  return {enabled:enabled==='1',activationHours:Number(hours),resendSeconds:Number(cooldown),maxAttempts:Number(maxAttempts),channels:JSON.parse(channels),
    whatsappPhoneId:phone,whatsappTemplate:template,whatsappLanguage:language,whatsappVersion:version,
    whatsappTokenSet,smsUsername:username,smsKeySet,providers:{email,sms:!!username&&smsKeySet,whatsapp:!!phone&&!!template&&whatsappTokenSet}};
}
export async function saveOnboardingSettings(data:z.infer<typeof settingsSchema>):Promise<void> {
  const values:Record<string,string>={enabled:data.enabled?'1':'0',activation_hours:String(data.activationHours),resend_seconds:String(data.resendSeconds),max_attempts:String(data.maxAttempts),channels:JSON.stringify(data.channels),
    whatsapp_phone_id:data.whatsappPhoneId,whatsapp_template:data.whatsappTemplate,whatsapp_language:data.whatsappLanguage,whatsapp_version:data.whatsappVersion,sms_username:data.smsUsername};
  for(const [field,clear,value] of [['whatsapp_token',data.clearWhatsappToken,data.whatsappToken],['sms_key',data.clearSmsKey,data.smsKey]] as const) {
    if(clear) values[field]='';
    else if(value?.trim()) {
      if(!isCredentialsEncryptionConfigured()) throw new Error('Credential encryption is not configured.');
      values[field]=await encryptSecret(value.trim());
    }
  }
  await executeBatch(Object.entries(values).map(([key,value])=>({sql:"INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[`onboarding_${key}`,value]})));
}
const escape = (s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function sendActivation(channel:'email'|'sms'|'whatsapp',target:string,name:string,link:string,settings:OnboardingSettings):Promise<void> {
  if(channel==='email') {
    await sendResendEmail({to:[target],subject:'Activate your Peebee account',
      text:`Hello ${name}, your Peebee account has been registered. Activate it and choose your password: ${link}\nYour details are already saved. This link expires in ${settings.activationHours} hours. If you did not request this account, ignore this message.`,
      html:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px"><img src="https://peebee.online/brand/peebee-logo-light.png?v=logos-3" width="48" height="48" alt="Peebee"/><h1>Welcome to Peebee, ${escape(name)}</h1><p>Your account details are saved. Activate your account and choose your own password.</p><p><a href="${escape(link)}" style="background:#C9A227;color:#101828;padding:14px 24px;border-radius:24px;display:inline-block">Activate my account</a></p><p>This link expires in ${settings.activationHours} hours. If you did not request this account, ignore this message.</p></div>`});
    return;
  }
  if(channel==='sms') {
    const key=await secret('sms_key','AFRICASTALKING_API_KEY');
    const base=settings.smsUsername==='sandbox'?'https://api.sandbox.africastalking.com':'https://api.africastalking.com';
    const res=await fetch(`${base}/version1/messaging`,{method:'POST',headers:{apiKey:key,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({username:settings.smsUsername,to:target,message:`Welcome to Peebee. Your details are saved. Activate your account: ${link}`}),signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new ActivationDeliveryRejected('SMS provider rejected the message.');
    const data=await res.json() as {SMSMessageData?:{Recipients?:Array<{status?:string}>}};
    if(!data.SMSMessageData?.Recipients?.some(r=>r.status==='Success')) throw new ActivationDeliveryRejected('SMS provider did not accept the recipient.');
    return;
  }
  const token=await secret('whatsapp_token','WHATSAPP_ACCESS_TOKEN');
  const res=await fetch(`https://graph.facebook.com/${settings.whatsappVersion}/${settings.whatsappPhoneId}/messages`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
    body:JSON.stringify({messaging_product:'whatsapp',to:target.replace(/^\+/,''),type:'template',template:{name:settings.whatsappTemplate,language:{code:settings.whatsappLanguage},
      components:[{type:'body',parameters:[{type:'text',text:name},{type:'text',text:link}]}]}}),
  });
  if(!res.ok) throw new ActivationDeliveryRejected('WhatsApp provider rejected the message.');
  const data=await res.json() as {messages?:Array<{id?:string}>};
  if(!data.messages?.[0]?.id) throw new Error('WhatsApp provider did not accept the message.');
}
