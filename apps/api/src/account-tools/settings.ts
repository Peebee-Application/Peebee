import {z} from 'zod';
import {getSetting} from '../lib/settings.js';
export const customerToolsSchema=z.object({
 supportPhone:z.string().regex(/^(\+[1-9][0-9]{7,14})?$/),supportEmail:z.union([z.string().email(),z.literal('')]),safetyPhone:z.string().regex(/^(\+[1-9][0-9]{7,14})?$/),
 caseStaffAlertsEnabled:z.boolean(),sessionsEnabled:z.boolean(),contactChangesEnabled:z.boolean(),lostPropertyEnabled:z.boolean(),pushEnabled:z.boolean(),
 otpMinutes:z.number().int().min(1).max(30),otpAttempts:z.number().int().min(1).max(10),otpCooldownSeconds:z.number().int().min(30).max(3600),
 maxCasesPerDay:z.number().int().min(1).max(50),maxCaseAttachments:z.number().int().min(0).max(20),maxAttachmentMb:z.number().int().min(1).max(10),
 pollSeconds:z.number().int().min(3).max(300),sessionUpdateSeconds:z.number().int().min(30).max(3600),sessionRetentionDays:z.number().int().min(7).max(365)
}).strict();
export const DEFAULT_CUSTOMER_TOOLS={supportPhone:"",supportEmail:"",safetyPhone:"",caseStaffAlertsEnabled:true,sessionsEnabled:true,contactChangesEnabled:true,lostPropertyEnabled:true,pushEnabled:true,otpMinutes:10,otpAttempts:5,otpCooldownSeconds:30,maxCasesPerDay:5,maxCaseAttachments:5,maxAttachmentMb:4,pollSeconds:10,sessionUpdateSeconds:60,sessionRetentionDays:90};
export async function getCustomerTools(){try{return customerToolsSchema.parse({...DEFAULT_CUSTOMER_TOOLS,...JSON.parse(await getSetting('customer_tools'))});}catch{return DEFAULT_CUSTOMER_TOOLS;}}
export const pushPreferencesSchema=z.object({enabled:z.boolean(),journeys:z.boolean(),wallet:z.boolean(),messages:z.boolean(),calls:z.boolean(),marketing:z.boolean()}).strict();
export const DEFAULT_PUSH={enabled:true,journeys:true,wallet:true,messages:true,calls:true,marketing:false};
