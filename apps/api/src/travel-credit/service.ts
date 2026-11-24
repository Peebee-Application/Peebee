import {db,executeBatch,requireChangedRow,type DbStatement} from '../db/client.js';
import {hasTable} from '../lib/schema.js';
import {getSetting,getPlatformEnvironment,getMonetizationSettings} from '../lib/settings.js';
import {computeCheckoutFees} from '../lib/monetization.js';
import {newId} from '../lib/ids.js';
import {walletIsFrozen} from '../wallet/freeze.js';
import {returnGroupForOrder} from '../taxipress/returns.js';
import {unpaidBundleGroup} from '../orders/bundle-funding.js';
import {relayPaysBeforeRider} from '../relay/service.js';
type Row=Record<string,unknown>;
export class TravelError extends Error{constructor(public status:400|403|404|409|503,public code:string,message:string){super(message);}}
export const ready=()=>hasTable('travel_charges');
export async function config(){const installed=await ready();return {ready:installed,corporateEnabled:installed&&await getSetting('travel_corporate_enabled')==='1',vouchersEnabled:installed&&await getSetting('travel_vouchers_enabled')==='1',voucherMax:Number(await getSetting('travel_voucher_max_ugx'))||0,voucherDays:Number(await getSetting('travel_voucher_days'))||30};}
const need=async()=>{if(!await ready())throw new TravelError(503,'travel_upgrade_pending','Travel credit is not set up yet.');};
export async function closeExpired(){if(await ready())await db.execute("UPDATE travel_vouchers SET state='expired' WHERE state='active' AND expires_at<=datetime('now')");}
export async function overview(who:string,admin=false){
 const s=await config();if(!s.ready)return {...s,accounts:[],vouchers:[]};await closeExpired();const env=await getPlatformEnvironment();
 const accounts=(await db.execute({sql:`SELECT a.*,m.active member_active,m.per_booking,m.monthly_limit,
  (SELECT COALESCE(SUM(total-refunded),0) FROM travel_charges WHERE account_id=a.id AND customer_id=? AND created_at>=datetime('now','+3 hours','start of month','-3 hours')) monthly_used
  FROM travel_accounts a LEFT JOIN travel_members m ON m.account_id=a.id AND m.user_id=? WHERE a.environment=? ${admin?'':'AND (a.owner_id=? OR m.user_id=?)'} ORDER BY a.created_at DESC`,args:[who,who,env,...(admin?[]:[who,who])]})).rows;
 const vouchers=(await db.execute({sql:`SELECT id,issuer_id,recipient_id,amount,balance,state,expires_at,created_at,CASE WHEN issuer_id=? THEN request_id ELSE NULL END request_id FROM travel_vouchers WHERE environment=? ${admin?'':'AND (recipient_id=? OR issuer_id=?)'} ORDER BY created_at DESC LIMIT 100`,args:[who,env,...(admin?[]:[who,who])]})).rows;
 const visibleAccounts=accounts.map(a=>{
  const available=Math.max(0,Math.min(Number(a.credit_limit)-Number(a.outstanding),...(a.owner_id===who||admin?[]:[Number(a.per_booking),Number(a.monthly_limit)-Number(a.monthly_used)])));
  if(admin||a.owner_id===who)return {...a,available};
  // A traveller can see their usable budget, not the employer's receivable.
  return {id:a.id,name:a.name,owner_id:a.owner_id,active:a.active,member_active:a.member_active,per_booking:a.per_booking,monthly_limit:a.monthly_limit,monthly_used:a.monthly_used,available};
 });
 return {...s,accounts:visibleAccounts,vouchers};
}
export async function statement(id:string,who:string,admin=false){
 await need();const a=(await db.execute({sql:'SELECT * FROM travel_accounts WHERE id=? AND environment=?',args:[id,await getPlatformEnvironment()]})).rows[0];
 if(!a||(!admin&&a.owner_id!==who))throw new TravelError(404,'not_found','That corporate account was not found.');
 const ledger=(await db.execute({sql:'SELECT * FROM travel_ledger WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 500',args:[id]})).rows;
 const members=admin?(await db.execute({sql:'SELECT * FROM travel_members WHERE account_id=?',args:[id]})).rows:[];
 return {account:{...a,available:Math.max(0,Number(a.credit_limit)-Number(a.outstanding))},ledger,members};
}
export async function issueVoucher(who:string,input:{recipientId:string;amount:number;requestId:string}){
 await need();const s=await config(),env=await getPlatformEnvironment();if(!s.vouchersEnabled||input.amount>s.voucherMax)throw new TravelError(409,'vouchers_off','Vouchers are unavailable or the amount exceeds the staff limit.');
 const previous=(await db.execute({sql:'SELECT id,recipient_id,amount FROM travel_vouchers WHERE issuer_id=? AND environment=? AND request_id=?',args:[who,env,input.requestId]})).rows[0];if(previous){if(previous.recipient_id!==input.recipientId||Number(previous.amount)!==input.amount)throw new TravelError(409,'request_changed','This request reference was already used for a different voucher.');return {id:String(previous.id),replayed:true};}
 if(await walletIsFrozen(who))throw new TravelError(409,'wallet_frozen','Unfreeze your wallet to issue a voucher.');
 if(!(await db.execute({sql:"SELECT 1 FROM users WHERE id=? AND role='customer'",args:[input.recipientId]})).rows.length)throw new TravelError(404,'recipient_not_found','Choose a Peebee customer.');
 const id=newId('tv'),code='PBTV-'+crypto.randomUUID().replace(/-/g,'').slice(0,24).toUpperCase(),hash=await codeHash(code),col=env==='sandbox'?'wallet_balance_sandbox':'wallet_balance';
 try{await executeBatch([
  {sql:`UPDATE users SET ${col}=${col}-? WHERE id=? AND ${col}>=? AND primary_wallet_frozen_at IS NULL`,args:[input.amount,who,input.amount]},requireChangedRow,
  {sql:"INSERT INTO travel_vouchers(id,issuer_id,recipient_id,environment,code_hash,amount,balance,expires_at,request_id) VALUES(?,?,?,?,?,?,?,datetime('now',?),?)",args:[id,who,input.recipientId,env,hash,input.amount,input.amount,`+${s.voucherDays} days`,input.requestId]},
  {sql:`INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,environment) SELECT ?,id,'order_payment',?,${col},'Prepaid travel voucher issued',? FROM users WHERE id=?`,args:[newId('wl'),-input.amount,env,who]},
  {sql:"INSERT INTO travel_ledger(id,voucher_id,actor_id,environment,kind,amount,reference) VALUES(?,?,?,?,'voucher_issue',?,?)",args:[newId('tl'),id,who,env,input.amount,input.requestId]},
 ]);}catch{const saved=(await db.execute({sql:'SELECT id FROM travel_vouchers WHERE issuer_id=? AND environment=? AND request_id=?',args:[who,env,input.requestId]})).rows[0];if(saved)return {id:String(saved.id),replayed:true};throw new TravelError(409,'voucher_not_issued','No voucher was charged. Check your available wallet balance and retry.');}
 return {id,code,replayed:false};
}
export async function cancelVoucher(id:string,who:string){await need();await db.execute({sql:"UPDATE travel_vouchers SET state='cancelled' WHERE id=? AND issuer_id=? AND environment=? AND state='active'",args:[id,who,await getPlatformEnvironment()]});return overview(who);}
export async function repay(id:string,who:string,amount:number,requestId:string){
 await statement(id,who);const env=await getPlatformEnvironment(),col=env==='sandbox'?'wallet_balance_sandbox':'wallet_balance';
 const previous=(await db.execute({sql:"SELECT amount FROM travel_ledger WHERE account_id=? AND kind='repayment' AND reference=?",args:[id,requestId]})).rows[0];
 if(previous){if(Number(previous.amount)!==-amount)throw new TravelError(409,'request_changed','This reference was already used for a different repayment.');return statement(id,who);}
 if(await walletIsFrozen(who))throw new TravelError(409,'wallet_frozen','Unfreeze your wallet to repay this account.');
 try{await executeBatch([
  {sql:'UPDATE travel_accounts SET outstanding=outstanding-? WHERE id=? AND owner_id=? AND environment=? AND outstanding>=?',args:[amount,id,who,env,amount]},requireChangedRow,
  {sql:`UPDATE users SET ${col}=${col}-? WHERE id=? AND ${col}>=? AND primary_wallet_frozen_at IS NULL`,args:[amount,who,amount]},requireChangedRow,
  {sql:"INSERT INTO travel_ledger(id,account_id,actor_id,environment,kind,amount,reference) VALUES(?,?,?,?,'repayment',?,?)",args:[newId('tl'),id,who,env,-amount,requestId]},
  {sql:`INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,environment) SELECT ?,id,'order_payment',?,${col},'Corporate travel repayment',? FROM users WHERE id=?`,args:[newId('wl'),-amount,env,who]},
 ]);}catch{if(!(await db.execute({sql:"SELECT 1 FROM travel_ledger WHERE account_id=? AND kind='repayment' AND reference=?",args:[id,requestId]})).rows.length)throw new TravelError(409,'repayment_not_taken','Repayment was not taken. Check your wallet and the current outstanding amount.');}
 return statement(id,who);
}
export async function codeHash(code:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code.trim().toUpperCase())))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export type Source={accountId?:string;voucherId?:string;voucherCode?:string};
async function pricedOrders(id:string,who:string){
 await need();const env=await getPlatformEnvironment(),o=(await db.execute({sql:"SELECT o.* FROM orders o WHERE o.id=? AND o.customer_id=? AND o.environment=? AND o.type='parcel'",args:[id,who,env]})).rows[0] as Row|undefined;
 if(!o)throw new TravelError(404,'not_found','That travel order was not found.');
 const returns=await returnGroupForOrder(id),bundle=await unpaidBundleGroup(o);
 if(returns&&(returns.p.state!=='ready'||returns.p.return_state!=='pending'||returns.p.outbound_order_id!==id))throw new TravelError(409,'package_changed','Pay for the return package from its outbound ticket.');
 const group=returns?.group||bundle,orders=group?.members||[o];if(group&&group.lead.id!==id)throw new TravelError(409,'group_lead','Pay from the first order of this group.');
 if(!returns&&o.delivery_bundle_id&&!bundle)throw new TravelError(409,'group_changed','The grouped delivery changed. Refresh its payment status.');
 if(returns&&String(returns.p.valid_until)<=new Date().toISOString().slice(0,19).replace('T',' '))throw new TravelError(409,'expired','The return package expired.');
 for(const order of orders){
  const waitingReturn=returns&&order.id===returns.p.return_order_id;
  if(!waitingReturn&&!(order.stage==='Match'&&order.rider_id)&&!await relayPaysBeforeRider(order))throw new TravelError(409,'not_payable','This trip is not ready for payment.');
  if(waitingReturn&&order.stage!=='Return')throw new TravelError(409,'payment_started','Payment has already started.');
  const seat=(await db.execute({sql:'SELECT status FROM taxipress_bookings WHERE order_id=?',args:[String(order.id)]})).rows[0];
  if(seat&&seat.status!=='booked')throw new TravelError(409,'ticket_changed','That ticket is no longer awaiting payment.');
  if((await db.execute({sql:"SELECT 1 FROM payments WHERE order_id=? AND type='collection' AND status IN ('pending','unknown','successful')",args:[String(order.id)]})).rows.length)throw new TravelError(409,'already_paid','Payment already exists. Refresh the trip before retrying.');
 }
 const settings=await getMonetizationSettings();
 return orders.map(order=>{const base=Number(order.final_total??order.estimated_total??0),fees=computeCheckoutFees(settings,{baseAmount:base,deliveryFee:Number(order.delivery_fee??0),orderType:'parcel',payingWithWallet:true});return {order,base,fees,total:base+fees.totalSurcharge};});
}
export async function quote(id:string,who:string,source:Source){
 const s=await config(),env=await getPlatformEnvironment(),parts=await pricedOrders(id,who),total=parts.reduce((n,p)=>n+p.total,0);
 if(!Number.isSafeInteger(total)||total<=0)throw new TravelError(409,'invalid_fare','This travel order has no payable fare.');
 if(source.accountId){
  if(!s.corporateEnabled)throw new TravelError(409,'corporate_off','Corporate credit is switched off.');
  const a=(await db.execute({sql:"SELECT a.id,a.name,a.credit_limit-a.outstanding available,m.per_booking,m.monthly_limit FROM travel_accounts a JOIN travel_members m ON m.account_id=a.id WHERE a.id=? AND a.environment=? AND a.active=1 AND m.user_id=? AND m.active=1",args:[source.accountId,env,who]})).rows[0];
  if(!a)throw new TravelError(404,'account_unavailable','This account is not approved for your travel.');
  const used=Number((await db.execute({sql:"SELECT COALESCE(SUM(total-refunded),0) n FROM travel_charges WHERE account_id=? AND customer_id=? AND created_at>=datetime('now','+3 hours','start of month','-3 hours')",args:[source.accountId,who]})).rows[0].n);
  if(total>Number(a.available)||total>Number(a.per_booking)||used+total>Number(a.monthly_limit))throw new TravelError(409,'credit_limit','This booking exceeds the account or traveller budget.');
  return {parts,total,sponsored:total,walletAmount:0,accountId:String(a.id),voucherId:null,label:String(a.name)};
 }
 if(!s.vouchersEnabled)throw new TravelError(409,'vouchers_off','Travel vouchers are switched off.');
 const v=(await db.execute({sql:`SELECT * FROM travel_vouchers WHERE ${source.voucherCode?'code_hash':'id'}=? AND recipient_id=? AND environment=? AND state='active' AND expires_at>datetime('now') AND balance>0`,args:[source.voucherCode?await codeHash(source.voucherCode):source.voucherId||'',who,env]})).rows[0];
 if(!v)throw new TravelError(404,'voucher_unavailable','That voucher is unavailable for your account.');
 const sponsored=Math.min(total,Number(v.balance));return {parts,total,sponsored,walletAmount:total-sponsored,accountId:null,voucherId:String(v.id),label:'Prepaid travel voucher'};
}
export const quoteView=(q:Awaited<ReturnType<typeof quote>>)=>({total:q.total,sponsored:q.sponsored,walletAmount:q.walletAmount,label:q.label,allocations:q.parts.map(p=>({orderId:p.order.id,amount:p.total}))});
export async function fund(id:string,who:string,source:Source,acceptedAmount:number,acceptedSponsored:number){
 const q=await quote(id,who,source),env=await getPlatformEnvironment();if(q.total!==acceptedAmount||q.sponsored!==acceptedSponsored)throw new TravelError(409,'price_changed','Review the current total and funding split before paying.');
 let remaining=q.sponsored;const statements:DbStatement[]=[];const paymentIds:string[]=[];
 for(const p of q.parts){const orderId=String(p.order.id),paymentId=newId('pay'),sponsored=Math.min(remaining,p.total);remaining-=sponsored;paymentIds.push(paymentId);
  statements.push({sql:"UPDATE orders SET stage='Fund',payment_rail='escrow',updated_at=datetime('now') WHERE id=? AND customer_id=? AND environment=? AND stage=? AND rider_id IS ? AND COALESCE(final_total,estimated_total,0)=? AND NOT EXISTS(SELECT 1 FROM taxipress_bookings b WHERE b.order_id=orders.id AND b.status!='booked') AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=? AND type='collection' AND status IN ('pending','unknown','successful'))",args:[orderId,who,env,String(p.order.stage),p.order.rider_id??null,p.base,orderId]},requireChangedRow,
   {sql:"UPDATE taxipress_bookings SET payment_method='app' WHERE order_id=?",args:[orderId]},
   {sql:"INSERT INTO payments(id,order_id,type,provider,amount,currency,status) VALUES(?,?,'collection',?,?,'UGX','successful')",args:[paymentId,orderId,q.accountId?'corporate_credit':'travel_voucher',p.total]},
   {sql:'INSERT INTO travel_charges(order_id,payment_id,customer_id,environment,account_id,voucher_id,total,group_total,sponsored,wallet_amount) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[orderId,paymentId,who,env,q.accountId,q.voucherId,p.total,q.total,sponsored,p.total-sponsored]},
   {sql:"INSERT INTO order_fees(order_id,service_fee,processing_fee_customer,processing_fee_rider,delivery_commission) VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET service_fee=excluded.service_fee,processing_fee_customer=excluded.processing_fee_customer,processing_fee_rider=excluded.processing_fee_rider,delivery_commission=excluded.delivery_commission",args:[orderId,p.fees.serviceFee,p.fees.processingFeeCustomer,p.fees.processingFeeRider,p.fees.deliveryCommission]},
   {sql:"UPDATE orders SET stage=CASE WHEN rider_id IS NULL THEN 'Match' ELSE 'Shop' END WHERE id=?",args:[orderId]},
   {sql:"INSERT INTO order_events(id,order_id,stage,note,actor_id) VALUES(?,?,'Fund',?,?)",args:[newId('evt'),orderId,q.accountId?'Approved corporate credit charged; recorded as a receivable':'Funded travel voucher and primary-wallet remainder collected',who]},
  );
 }
 try{await executeBatch(statements);}catch{throw new TravelError(409,'funding_changed','No new payment was taken. The order, credit limit, voucher or wallet changed; refresh before retrying.');}
 return {payment:{id:paymentIds[0],status:'successful',network:null},funded:true,quote:quoteView(q)};
}
