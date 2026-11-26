import type { Context } from 'hono';
import { db,executeBatch } from '../db/client.js';
import { hasTable,hasColumn } from '../lib/schema.js';
import { newId } from '../lib/ids.js';
import { getPlatformEnvironment,getMonetizationSettings } from '../lib/settings.js';
import { computeCheckoutFees } from '../lib/monetization.js';
import { bundleCheckoutQuote,fundBundle,type BundleGroup } from '../orders/bundle-funding.js';
import { getTaxipressSettings } from './settings.js';
import { listActiveTaxipressRoutes } from './service.js';
import { priceBooking } from './details.js';
import { bookSeats,bookingFor,type BookInput } from './bookings.js';
import { cancelBooking } from './cancellation.js';
type Row = Record<string,unknown>;
export class ReturnError extends Error {
  constructor(public status: 400 | 404 | 409 | 503,public code: string,message: string) { super(message); }
}
export const returnsReady = async () => await hasTable('taxipress_return_packages') && await hasColumn('taxipress_bookings','return_package_id');
export const kampalaDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala'}).format(new Date());
const dayMs = 86400000;
function validDate(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day; }
function dateTerms(mode: string,date: string | undefined,days: number) {
  const today = kampalaDate(),last = new Date(Date.parse(today)+days*dayMs).toISOString().slice(0,10);
  const chosen = mode === 'same-day' ? today : mode === 'date-specific' ? date : null;
  if (chosen && (!validDate(chosen) || chosen < today || chosen > last)) throw new ReturnError(400,'invalid_return_date',`Choose a return date between ${today} and ${last}.`);
  if (mode === 'date-specific' && !chosen) throw new ReturnError(400,'invalid_return_date','Choose your return date.');
  return { date: chosen || null,validUntil: (chosen || last)+' 20:59:59' }; // end of the Kampala travel day, in UTC
}
async function packageRow(id: string,who: string) {
  if (!(await returnsReady())) throw new ReturnError(503,'returns_unavailable','Return packages are not set up yet.');
  const p = (await db.execute({sql: 'SELECT * FROM taxipress_return_packages WHERE id = ? AND passenger_id = ? AND environment = ?',args:[id,who,await getPlatformEnvironment()]})).rows[0] as Row | undefined;
  if (!p) throw new ReturnError(404,'not_found','That return package was not found.');
  return p;
}
async function groupFor(p: Row): Promise<BundleGroup | null> {
  if (!p.outbound_order_id || !p.return_order_id) return null;
  const rows = (await db.execute({sql:'SELECT * FROM orders WHERE id IN (?,?)',args:[String(p.outbound_order_id),String(p.return_order_id)]})).rows as Row[];
  const lead = rows.find(o=>o.id === p.outbound_order_id),back = rows.find(o=>o.id === p.return_order_id);
  return lead && back ? {lead,members:[lead,back]} : null;
}
async function allocations(p: Row) {
  const ids=[p.outbound_order_id,p.return_order_id];
  return Promise.all(ids.map(async id => {
    if (!id) return 0;
    const row=(await db.execute({sql:"SELECT COALESCE(SUM(CASE WHEN type = 'collection' THEN amount ELSE -amount END),0) AS n FROM payments WHERE order_id = ? AND status = 'successful' AND type IN ('collection','refund')",args:[String(id)]})).rows[0];
    return Number(row.n);
  }));
}
export async function returnPackageView(id: string,who: string) {
  const p=await packageRow(id,who),[outboundPaid,returnPaid]=await allocations(p);
  const routes=await listActiveTaxipressRoutes(),r=routes.find(r=>r.id===p.return_route_id);
  const payment=p.outbound_order_id?(await db.execute({sql:"SELECT id,status FROM payments WHERE order_id = ? AND type = 'collection' ORDER BY created_at DESC,id DESC LIMIT 1",args:[String(p.outbound_order_id)]})).rows[0]:null;
  return {id:String(p.id),state:String(p.state),returnState:String(p.return_state),mode:String(p.mode),returnDate:p.return_date as string|null,
    validUntil:String(p.valid_until).replace(' ','T')+'Z',quoteUntil:String(p.quote_until).replace(' ','T')+'Z',
    outboundAmount:Number(p.outbound_amount),returnAmount:Number(p.return_amount),total:Number(p.outbound_amount)+Number(p.return_amount),
    discountPercent:Number(p.discount_percent),refundPercent:Number(p.refund_percent),refunded:Number(p.refunded),outboundPaid,returnPaid,
    outboundBookingId:p.outbound_booking_id as string|null,returnBookingId:p.return_booking_id as string|null,
    orderId:p.outbound_order_id as string|null,returnRouteId:String(p.return_route_id),
    payment:payment?{id:String(payment.id),status:String(payment.status)}:null,
    returnRoute:r ? {fromName:r.fromName,toName:r.toName} : null,
    checkout: await groupFor(p).then(g=>g ? bundleCheckoutQuote(g) : null)};
}
export async function quoteReturn(who: string,input: BookInput,mode: 'open'|'same-day'|'date-specific',date?: string) {
  const s=await getTaxipressSettings();
  if (!s.enabled || !s.returnPackagesEnabled || !(await returnsReady())) throw new ReturnError(409,'returns_off','Return packages are not available right now.');
  if (input.openTicket || input.payment === 'cash') throw new ReturnError(400,'return_prepay','Return packages are prepaid departure tickets.');
  const routes=await listActiveTaxipressRoutes();
  const vipColumnReady=await hasColumn('taxipress_taxis','service_class');
  const q=(await db.execute({sql:`SELECT q.taxipress_route_id, ${vipColumnReady?'x.service_class':"'standard'"} AS service_class FROM taxipress_queue q JOIN taxipress_taxis x ON x.id=q.taxi_id WHERE q.id = ? AND q.status = 'in_line'`,args:[input.queueId]})).rows[0] as Row|undefined;
  const route=routes.find(r=>r.id===q?.taxipress_route_id),back=routes.find(r=>r.relayRouteId===route?.relayRouteId && r.direction!==route?.direction);
  if (!route || !back || !route.farePerSeat || !back.farePerSeat) throw new ReturnError(409,'return_route_unavailable','Both directions of this route must be running with fares.');
  const serviceClass=q?.service_class==='vip'?'vip':'standard';
  const multiplier=serviceClass==='vip'?(100+s.vipFareMarkupPercent)/100:1;
  const adults=input.adults ?? input.seats ?? 1,children=input.children ?? 0;
  const baggage=input.luggage || {};
  const out=priceBooking({adults,children,childSeats:input.childSeats,luggage:baggage},Math.round(route.farePerSeat*multiplier),s);
  const ret=priceBooking({adults,children,childSeats:input.childSeats,luggage:baggage},Math.round(back.farePerSeat*multiplier),s);
  if (out.error || out.seats>s.maxSeatsPerBooking || adults+children>(serviceClass==='vip'?13:18)) throw new ReturnError(400,'invalid_passengers',out.error || `The passenger count exceeds the ${serviceClass==='vip'?'13-seat VIP Highroof':'taxi'} limit.`);
  let seatFee=0;
  if (input.seatHoldId) {
    const h=(await db.execute({sql:"SELECT fee FROM taxipress_seat_reservations WHERE id = ? AND passenger_id = ? AND queue_id = ? AND quantity = ? AND state = 'held' AND expires_at > datetime('now')",args:[input.seatHoldId,who,input.queueId,out.seats]})).rows[0];
    if (!h) throw new ReturnError(409,'hold_invalid','Select your outbound seats again.'); seatFee=Number(h.fee);
  }
  const discounted=(n:number)=>Math.max(1,n-Math.round(n*s.returnDiscountPercent/100));
  const outboundAmount=discounted(out.fareAmount)+out.luggageAmount+seatFee,returnAmount=discounted(ret.fareAmount)+ret.luggageAmount;
  const terms=dateTerms(mode,date,s.returnValidityDays),id=newId('tpr');
  const environment=await getPlatformEnvironment();
  const snapshot={...input,payment:'app',adults,children,childSeats:out.childSeats,serviceClass};
  await db.execute({sql:`INSERT INTO taxipress_return_packages(id,passenger_id,environment,outbound_route_id,return_route_id,queue_id,input_json,mode,return_date,valid_until,quote_until,outbound_amount,return_amount,discount_percent,refund_percent)
    VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now',?),?,?,?,?)`,args:[id,who,environment,route.id,back.id,input.queueId,JSON.stringify(snapshot),mode,terms.date,terms.validUntil,`+${s.seatHoldSeconds} seconds`,outboundAmount,returnAmount,s.returnDiscountPercent,s.returnRefundPercent]});
  const fees=await getMonetizationSettings();
  const total=(wallet:boolean)=>[outboundAmount,returnAmount].reduce((n,base)=>n+base+computeCheckoutFees(fees,{baseAmount:base,deliveryFee:base,orderType:'parcel',payingWithWallet:wallet}).totalSurcharge,0);
  return {...await returnPackageView(id,who),wallet:total(true),mobileMoney:total(false)};
}
export async function createReturnPackage(c: Context,id: string) {
  const who=c.get('user').sub,p=await packageRow(id,who);
  if (p.state === 'ready') return returnPackageView(id,who);
  if (!(await getTaxipressSettings()).returnPackagesEnabled) throw new ReturnError(409,'returns_off','New return packages are switched off.');
  const claimed=await db.execute({sql:"UPDATE taxipress_return_packages SET state = 'preparing' WHERE id = ? AND state = 'quoted' AND quote_until > datetime('now') AND valid_until > datetime('now')",args:[id]});
  if (!claimed.rowsAffected) throw new ReturnError(409,'quote_expired','The package quote expired or is already being prepared. Refresh your packages before retrying.');
  try {
    const res=await bookSeats(c,JSON.parse(String(p.input_json)),{packageId:id,leg:'outbound',amount:Number(p.outbound_amount)});
    if (res.status>=400) { const body=await res.json() as {message?:string}; throw new ReturnError(409,'outbound_unavailable',body.message || 'The outbound departure changed. Request a new quote.'); }
    const refreshed=await packageRow(id,who);
    const listId=newId('list'),orderId=newId('ord');
    await executeBatch([
      {sql:"INSERT INTO lists(id,customer_id,title,status,environment) VALUES(?,?,'TaxiPress prepaid return','active',?)",args:[listId,who,String(p.environment)]},
      {sql:"INSERT INTO orders(id,list_id,customer_id,type,stage,payment_rail,estimated_total,delivery_fee,environment,is_ride) VALUES(?,?,?,'parcel','Return','escrow',?,?,?,1)",args:[orderId,listId,who,Number(p.return_amount),Number(p.return_amount),String(p.environment)]},
      {sql:"UPDATE taxipress_return_packages SET return_order_id = ?,state = 'ready' WHERE id = ? AND state = 'preparing' AND outbound_booking_id = ?",args:[orderId,id,String(refreshed.outbound_booking_id)]},
    ]);
    return returnPackageView(id,who);
  } catch(e) {
    const failed=await packageRow(id,who);
    if (failed.outbound_booking_id) await cancelBooking(who,String(failed.outbound_booking_id)).catch(()=>undefined);
    await db.execute({sql:"UPDATE taxipress_return_packages SET state = 'failed' WHERE id = ? AND state = 'preparing'",args:[id]}); throw e;
  }
}
export async function returnGroupForOrder(orderId: string) {
  if (!(await returnsReady())) return null;
  const p=(await db.execute({sql:'SELECT * FROM taxipress_return_packages WHERE outbound_order_id = ? OR return_order_id = ?',args:[orderId,orderId]})).rows[0] as Row|undefined;
  return p ? {p,group:await groupFor(p)} : null;
}
export async function fundReturnOrder(c: Context,order: Row,body: Record<string,unknown>,deps: Parameters<typeof fundBundle>[0]['deps']) {
  const found=await returnGroupForOrder(String(order.id)); if (!found) return null;
  const {p,group}=found;
  if (p.return_state === 'redeemed' && order.id === p.return_order_id) return null;
  if (!group || order.id !== p.outbound_order_id || p.state !== 'ready' || p.return_state !== 'pending') return c.json({error:'return_package',message:'Pay for both journeys from the outbound ticket.'},409);
  if (body.paymentMethod==='cash' || body.offerCode) return c.json({error:'return_prepay',message:'Return packages are prepaid in the app. Their package discount cannot be combined with another offer.'},409);
  if (body.walletId || (body.walletOwnerId && body.walletOwnerId !== c.get('user').sub)) return c.json({error:'return_wallet',message:'Use your primary Peebee wallet for return packages so unused-return refunds go back to the same account.'},409);
  if (String(p.valid_until)<new Date().toISOString().slice(0,19).replace('T',' ')) return c.json({error:'return_expired',message:'The return validity has ended.'},409);
  if (!['Match'].includes(String(group.lead.stage)) || group.members[1].stage!=='Return') return c.json({error:'package_changed',message:'The package payment has already started or a journey changed.'},409);
  return fundBundle({c,user:c.get('user'),group,body:body as Parameters<typeof fundBundle>[0]['body'],taxipressReturn:true,deps});
}
export async function cancelUnusedReturn(id:string,who:string,expired=false) {
  const p=await packageRow(id,who);
  if (!expired && (await allocations(p))[1]<=0 && p.return_state==='pending') throw new ReturnError(409,'package_unpaid','Cancel the outbound booking to cancel an unpaid package.');
  try { await db.execute({sql:"UPDATE taxipress_return_packages SET return_state = ? WHERE id = ? AND passenger_id = ? AND state = 'ready' AND return_state = 'pending'",args:[expired?'expired':'cancelled',id,who]}); }
  catch { throw new ReturnError(409,'payment_pending','A payment is still pending. Refresh its status before cancelling.'); }
  return returnPackageView(id,who);
}
export async function redeemReturn(c:Context,id:string,queueId:string) {
  const who=c.get('user').sub,p=await packageRow(id,who);
  if (p.return_booking_id) return {package:await returnPackageView(id,who),booking:await bookingFor(String(p.return_booking_id),who)};
  const paid=await allocations(p),out=await bookingFor(String(p.outbound_booking_id),who);
  if (paid[1]<=0 || !out || !['boarded','completed'].includes(out.status)) throw new ReturnError(409,'outbound_first','Complete outbound boarding and package payment before using the return.');
  const today=kampalaDate();
  if (p.return_date && p.return_date!==today) throw new ReturnError(409,'return_date','This return is valid only on its selected travel date.');
  const q=(await db.execute({sql:'SELECT taxipress_route_id FROM taxipress_queue WHERE id = ?',args:[queueId]})).rows[0];
  if (q?.taxipress_route_id!==p.return_route_id) throw new ReturnError(409,'wrong_return_route','Choose a taxi in the return direction of this route.');
  const input=JSON.parse(String(p.input_json)) as BookInput & {serviceClass?:'standard'|'vip'};
  if (await hasColumn('taxipress_taxis','service_class')) {
    const taxi=(await db.execute({sql:'SELECT x.service_class FROM taxipress_queue q JOIN taxipress_taxis x ON x.id=q.taxi_id WHERE q.id=?',args:[queueId]})).rows[0] as Row|undefined;
    if ((taxi?.service_class==='vip'?'vip':'standard') !== (input.serviceClass ?? 'standard')) throw new ReturnError(409,'return_service_class','Choose a return taxi in the same service class as the outbound ticket.');
  }
  const redemptionToken=newId('rdr'),lease=`+${(await getTaxipressSettings()).seatHoldSeconds} seconds`;
  const claimed=await db.execute({sql:"UPDATE taxipress_return_packages SET return_state = 'redeeming',redeem_token = ?,redeem_until = datetime('now',?) WHERE id = ? AND state = 'ready' AND return_state = 'pending' AND valid_until > datetime('now') AND (return_date IS NULL OR return_date = ?)",args:[redemptionToken,lease,id,today]});
  if (!claimed.rowsAffected) throw new ReturnError(409,'return_unavailable','This return is expired, cancelled or being redeemed. Refresh before retrying.');
  delete input.seatHoldId; delete (input as BookInput & {serviceClass?:string}).serviceClass;
  try {
    const res=await bookSeats(c,{...input,queueId,openTicket:false},{packageId:id,leg:'return',amount:Number(p.return_amount),existingOrderId:String(p.return_order_id),redemptionToken});
    if (res.status>=400) { const body=await res.json() as {message?:string}; throw new ReturnError(409,'return_departure_unavailable',body.message || 'That return departure is unavailable.'); }
    return {package:await returnPackageView(id,who),booking:(await res.json() as {booking:unknown}).booking};
  } finally { await db.execute({sql:"UPDATE taxipress_return_packages SET return_state = 'pending',redeem_token = NULL,redeem_until = NULL WHERE id = ? AND return_state = 'redeeming' AND return_booking_id IS NULL AND redeem_token = ?",args:[id,redemptionToken]}); }
}
export async function changeReturnDate(id:string,who:string,mode:'open'|'same-day'|'date-specific',date?:string) {
  const p=await packageRow(id,who),s=await getTaxipressSettings();
  const terms=dateTerms(mode,date,s.returnValidityDays);
  // Changing a date cannot extend the prepaid entitlement's original deadline.
  if (terms.validUntil>String(p.valid_until)) throw new ReturnError(409,'return_validity','The new date must stay within the package validity.');
  const changed=await db.execute({sql:"UPDATE taxipress_return_packages SET mode = ?,return_date = ? WHERE id = ? AND return_state = 'pending' AND valid_until > datetime('now')",args:[mode,terms.date,id]});
  if(!changed.rowsAffected)throw new ReturnError(409,'return_unavailable','This return has expired or has already been used or cancelled.');
  return returnPackageView(id,who);
}
export async function listReturnPackages(who:string) {
  if (!(await returnsReady())) return [];
  await expireReturnPackages();
  const rows=(await db.execute({sql:"SELECT id FROM taxipress_return_packages WHERE passenger_id = ? AND environment = ? AND state = 'ready' ORDER BY created_at DESC LIMIT 50",args:[who,await getPlatformEnvironment()]})).rows;
  for (const r of rows) {
    const p=await packageRow(String(r.id),who);
    if (p.return_state==='pending' && String(p.valid_until)<new Date().toISOString().slice(0,19).replace('T',' ')) await cancelUnusedReturn(String(r.id),who,true).catch(()=>undefined);
  }
  return Promise.all(rows.map(r=>returnPackageView(String(r.id),who)));
}
export async function expireReturnPackages() {
  if (!(await returnsReady())) return;
  await db.execute("UPDATE taxipress_return_packages SET return_state = 'pending',redeem_token = NULL,redeem_until = NULL WHERE return_state = 'redeeming' AND return_booking_id IS NULL AND redeem_until <= datetime('now')");
  await db.execute(`UPDATE taxipress_return_packages SET return_state = 'cancelled' WHERE state = 'ready' AND return_state = 'pending'
    AND EXISTS (SELECT 1 FROM orders WHERE id = outbound_order_id AND stage = 'Cancelled')
    AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = return_order_id AND status IN ('pending','unknown') AND type = 'collection')`);
  const stale=`-${(await getTaxipressSettings()).payWithinMinutes} minutes`;
  await db.execute({sql:"UPDATE orders SET stage = 'Cancelled',updated_at = datetime('now') WHERE id IN (SELECT outbound_order_id FROM taxipress_return_packages WHERE state = 'preparing' AND quote_until < datetime('now',?)) AND stage IN ('Create','Match')",args:[stale]});
  await db.execute({sql:"UPDATE taxipress_return_packages SET state = 'failed' WHERE state = 'preparing' AND quote_until < datetime('now',?)",args:[stale]});
  await db.execute(`UPDATE taxipress_return_packages SET return_state = 'expired' WHERE state = 'ready' AND return_state = 'pending' AND valid_until <= datetime('now')
    AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = taxipress_return_packages.return_order_id AND status IN ('pending','unknown') AND type = 'collection')`);
}
