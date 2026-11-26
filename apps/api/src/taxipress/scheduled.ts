import type { Context } from "hono";
import { db, executeBatch } from "../db/client.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { newId } from "../lib/ids.js";
import { createOrderFromInput } from "../orders/routes.js";
import { refundOrderToWallet, refundToWallet } from "../wallet/service.js";
import { creditRiderWorkWallet } from "../wallet/rider-work-wallet.js";
import { notifyUser } from "../lib/webpush.js";
import { getTaxipressSettings, offeredLanguages } from "./settings.js";
import { joinLine, TaxipressError } from "./queue.js";
import { taxipressReady } from "./service.js";
import { seatingReady } from "./seats.js";
import { hasColumn } from "../lib/schema.js";
import { priceBooking, saveDetails, type BookingDetailsInput } from "./details.js";

type Row = Record<string, unknown>;
const isoDateTime = (value: string) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export async function scheduledDeparturesReady() {
  const row = await db.execute({sql:"SELECT 1 FROM sqlite_master WHERE type='table' AND name='taxipress_departures'",args:[]});
  return row.rows.length > 0;
}

async function expireUnpaidFutureTickets() {
  if (!(await scheduledDeparturesReady())) return;
  await db.execute({sql:`UPDATE taxipress_future_tickets SET state='cancelled',cancel_reason='payment_deadline'
    WHERE state='reserved' AND EXISTS (SELECT 1 FROM taxipress_departures d WHERE d.id=departure_id AND d.queue_id IS NULL
      AND (datetime(pay_by)<=datetime('now') OR datetime(d.departs_at,'-'||d.cutoff_minutes||' minutes')<=datetime('now')))
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=order_id AND p.type='collection' AND p.status IN ('pending','unknown','successful'))`,args:[]});
}

export async function departuresForCustomers(routeId: string | null, from: string | null, to: string | null) {
  const settings = await getTaxipressSettings();
  if (!settings.enabled || !settings.scheduledDeparturesEnabled || !(await taxipressReady()) || !(await scheduledDeparturesReady())) return [];
  await expireUnpaidFutureTickets();
  const env = await getPlatformEnvironment();
  const where = ["d.environment = ?", "d.state = 'published'", "d.departs_at > datetime('now')", "d.seats_reserved < d.capacity"];
  const args: (string | number | null)[] = [env === "sandbox" ? "sandbox" : "live"];
  if (routeId) { where.push("d.taxipress_route_id = ?"); args.push(routeId); }
  if (from) { where.push("d.departs_at >= ?"); args.push(from); }
  if (to) { where.push("d.departs_at < ?"); args.push(to); }
  const hasVip = await hasColumn("taxipress_departures", "service_class");
  const result = await db.execute({
    sql: `SELECT d.id,d.taxipress_route_id AS routeId,d.departs_at AS departsAt,d.capacity,d.seats_reserved AS seatsReserved,
      d.fare_per_seat AS farePerSeat,${hasVip ? "d.service_class" : "'standard' AS service_class"},t.plate,t.seat_layout AS seatLayout,rr.stage_a_name AS stageA,rr.stage_b_name AS stageB,r.direction
      FROM taxipress_departures d JOIN taxipress_routes r ON r.id=d.taxipress_route_id
      JOIN relay_routes rr ON rr.id=r.relay_route_id JOIN taxipress_taxis t ON t.id=d.taxi_id
      WHERE ${where.join(" AND ")} AND r.active=1 AND rr.active=1 AND t.status='approved' AND t.passengers_enabled=1
      ORDER BY d.departs_at LIMIT 100`, args,
  });
  return (result.rows as Row[]).map(r => ({
    id: String(r.id), routeId: String(r.routeId), departsAt: String(r.departsAt),
    seatsLeft: Math.max(0, Number(r.capacity) - Number(r.seatsReserved)),
    farePerSeat: Number(r.farePerSeat), plate: String(r.plate), seatLayout: String(r.seatLayout),
    serviceClass: r.service_class === "vip" ? "vip" : "standard",
    fromName: r.direction === "a_to_b" ? String(r.stageA) : String(r.stageB),
    toName: r.direction === "a_to_b" ? String(r.stageB) : String(r.stageA),
  }));
}

export async function adminDepartures() {
  if (!(await scheduledDeparturesReady())) return { departures: [], taxis: [], routes: [], ready: false };
  const taxiHasVip = await hasColumn("taxipress_taxis", "service_class");
  const [departures, taxis, routes] = await Promise.all([
    db.execute(`SELECT d.*,t.plate,r.direction,rr.stage_a_name,rr.stage_b_name,
      (SELECT COUNT(*) FROM taxipress_future_tickets f WHERE f.departure_id=d.id AND f.state='reserved') AS tickets
      FROM taxipress_departures d JOIN taxipress_taxis t ON t.id=d.taxi_id
      JOIN taxipress_routes r ON r.id=d.taxipress_route_id JOIN relay_routes rr ON rr.id=r.relay_route_id
      ORDER BY d.departs_at DESC LIMIT 200`),
    db.execute(`SELECT t.id,t.plate,t.seats,t.seat_layout,t.relay_route_id,${taxiHasVip ? "t.service_class" : "'standard' AS service_class"} FROM taxipress_taxis t WHERE t.status='approved' AND t.passengers_enabled=1 ORDER BY t.plate`),
    db.execute("SELECT r.id,r.relay_route_id,r.direction,r.fare_per_seat,rr.stage_a_name,rr.stage_b_name FROM taxipress_routes r JOIN relay_routes rr ON rr.id=r.relay_route_id WHERE r.active=1 AND rr.active=1 ORDER BY rr.name,r.direction"),
  ]);
  return { departures: departures.rows, taxis: taxis.rows, routes: routes.rows, ready: true };
}

export async function driverDepartures(driverId: string) {
  if (!(await scheduledDeparturesReady())) return [];
  const env = (await getPlatformEnvironment()) === "sandbox" ? "sandbox" : "live";
  const vipColumn = await hasColumn("taxipress_departures", "service_class");
  return (await db.execute({sql:`SELECT d.id,d.departs_at AS departsAt,d.seats_reserved AS seatsReserved,d.capacity,d.state,
    ${vipColumn ? "d.service_class" : "'standard' AS service_class"},r.id AS routeId,r.direction,rr.stage_a_name,rr.stage_b_name,t.plate
    FROM taxipress_departures d JOIN taxipress_taxis t ON t.id=d.taxi_id JOIN taxipress_routes r ON r.id=d.taxipress_route_id
    JOIN relay_routes rr ON rr.id=r.relay_route_id WHERE t.user_id=? AND d.environment=? AND d.state='published' AND d.queue_id IS NULL
    AND datetime(d.departs_at,'+'||d.grace_minutes||' minutes')>datetime('now') ORDER BY d.departs_at LIMIT 30`,args:[driverId,env]})).rows;
}

export async function publishDeparture(input: { routeId: string; taxiId: string; departsAt: string; capacity?: number }, actorId: string) {
  const settings = await getTaxipressSettings();
  if (!settings.enabled || !settings.scheduledDeparturesEnabled) throw new TaxipressError(409, "schedule_off", "Future departures are switched off in Taxipress settings.");
  if (!(await scheduledDeparturesReady()) || !(await taxipressReady())) throw new TaxipressError(503, "schedule_unavailable", "Apply the future-departure migration and ensure Taxipress is ready.");
  const at = isoDateTime(input.departsAt);
  if (!at) throw new TaxipressError(400, "invalid_departure_time", "Choose a valid departure date and time.");
  const lead = (Date.parse(at) - Date.now()) / 60_000;
  if (lead < settings.scheduleMinLeadMinutes || lead > settings.scheduleMaxAdvanceDays * 1440) throw new TaxipressError(400, "departure_window", "Choose a time within the configured advance booking window.");
  const env = await getPlatformEnvironment();
  const taxiHasVip = await hasColumn("taxipress_taxis", "service_class");
  const departureHasVip = await hasColumn("taxipress_departures", "service_class");
  const row = (await db.execute({
    sql: `SELECT t.id AS taxiId,t.seats,t.seat_layout,t.status,t.passengers_enabled,t.relay_route_id,${taxiHasVip ? "t.service_class" : "'standard' AS service_class"},r.id AS routeId,r.fare_per_seat
      FROM taxipress_taxis t JOIN taxipress_routes r ON r.relay_route_id=t.relay_route_id
      JOIN relay_routes rr ON rr.id=r.relay_route_id WHERE t.id=? AND r.id=? AND t.status='approved'
      AND t.passengers_enabled=1 AND r.active=1 AND rr.active=1`, args: [input.taxiId,input.routeId],
  })).rows[0] as Row | undefined;
  if (!row || Number(row.fare_per_seat) <= 0) throw new TaxipressError(409, "taxi_route_unavailable", "Select an approved passenger taxi and its active route.");
  const vip = row.service_class === "vip";
  if (vip && (!departureHasVip || !taxiHasVip)) throw new TaxipressError(503, "migration_pending", "Apply VIP Highroof migration 0174 first.");
  if (vip && row.seat_layout !== "18") throw new TaxipressError(409, "vip_requires_highroof", "VIP service is only available for a Highroof van.");
  if (vip && Number(row.seats) !== 13) throw new TaxipressError(409, "vip_capacity_invalid", "A VIP Highroof must be configured with 13 passenger seats.");
  const capacity = vip ? 13 : input.capacity ?? Number(row.seats);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > Number(row.seats) || (vip && input.capacity != null && input.capacity !== 13)) throw new TaxipressError(400, "invalid_capacity", "VIP Highroof departures must offer all 13 passenger seats; standard capacity must fit the taxi.");
  const fare = Math.round(Number(row.fare_per_seat) * (vip ? (100 + settings.vipFareMarkupPercent) / 100 : 1));
  const id = newId("tpd");
  try {
    await db.execute({ sql: `INSERT INTO taxipress_departures
      (id,taxipress_route_id,taxi_id,environment,departs_at,capacity,fare_per_seat,cutoff_minutes,checkin_minutes,grace_minutes,spacing_minutes,free_cancel_minutes,retention_percent,fee_to,created_by${departureHasVip ? ",service_class" : ""})
      VALUES (${Array.from({length:15+(departureHasVip?1:0)},()=>"?").join(",")})`,
      args: [id,input.routeId,input.taxiId,env === "sandbox" ? "sandbox" : "live",at,capacity,fare,settings.scheduleBookingCutoffMinutes,settings.scheduleCheckinMinutes,settings.scheduleGraceMinutes,settings.scheduleSpacingMinutes,settings.scheduleFreeCancelMinutes,settings.scheduleCancelRetentionPercent,settings.feeTo === "driver" ? "driver" : "platform",actorId,...(departureHasVip?[vip?"vip":"standard"]:[])] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("taxipress_schedule_overlap") || message.includes("UNIQUE constraint failed")) throw new TaxipressError(409,"taxi_schedule_conflict","This taxi already has a departure too close to that time.");
    throw e;
  }
  return id;
}

export async function cancelDeparture(id: string) {
  if (!(await scheduledDeparturesReady())) throw new TaxipressError(503,"schedule_unavailable","Future departure scheduling is not set up yet.");
  const changed = await db.execute({ sql: `UPDATE taxipress_departures SET state='cancelled'
    WHERE id=? AND state='published' AND queue_id IS NULL`, args: [id] });
  if (!changed.rowsAffected) throw new TaxipressError(409,"departure_not_cancellable","Only a published, not-yet-checked-in departure can be cancelled here.");
  await sweepScheduledDepartures();
}

export async function bookFutureDeparture(c: Context, input: { departureId: string; seats: number; requestId: string; details?: Partial<BookingDetailsInput> }) {
  const user = c.get("user");
  const settings = await getTaxipressSettings();
  if (!settings.enabled || !settings.scheduledDeparturesEnabled || !(await scheduledDeparturesReady())) throw new TaxipressError(409,"schedule_off","Future bookings are not available right now.");
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > settings.maxSeatsPerBooking) throw new TaxipressError(400,"invalid_seat_count",`Book between 1 and ${settings.maxSeatsPerBooking} seats.`);
  const prior = (await db.execute({ sql: "SELECT id,order_id FROM taxipress_future_tickets WHERE passenger_id=? AND environment=? AND request_id=?",args:[user.sub,(await getPlatformEnvironment()) === "sandbox" ? "sandbox" : "live",input.requestId] })).rows[0] as Row | undefined;
  if (prior) return { ticketId:String(prior.id),orderId:String(prior.order_id),reused:true };
  const d = (await db.execute({ sql: `SELECT d.*,r.direction,r.relay_route_id,r.fare_per_seat AS live_fare,
      rr.stage_a_name,rr.stage_a_lat,rr.stage_a_lng,rr.stage_b_name,rr.stage_b_lat,rr.stage_b_lng,
      t.user_id AS driver_id,t.plate,t.seat_layout
      FROM taxipress_departures d JOIN taxipress_routes r ON r.id=d.taxipress_route_id
      JOIN relay_routes rr ON rr.id=r.relay_route_id JOIN taxipress_taxis t ON t.id=d.taxi_id
      WHERE d.id=? AND d.state='published' AND d.environment=? AND r.active=1 AND rr.active=1 AND t.status='approved' AND t.passengers_enabled=1`,
    args:[input.departureId,(await getPlatformEnvironment()) === "sandbox" ? "sandbox" : "live"] })).rows[0] as Row | undefined;
  if (!d) throw new TaxipressError(404,"departure_unavailable","That departure is not available.");
  const minutes = (Date.parse(String(d.departs_at).replace(" ","T") + (String(d.departs_at).endsWith("Z") ? "" : "Z")) - Date.now()) / 60_000;
  if (minutes < Number(d.cutoff_minutes) || minutes > settings.scheduleMaxAdvanceDays * 1440) throw new TaxipressError(409,"booking_closed","Booking for that departure is closed.");
  const fare = Number(d.fare_per_seat);
  const raw=input.details ?? {};
  const details: BookingDetailsInput = {adults:raw.adults??input.seats,children:raw.children??0,childSeats:raw.childSeats,luggage:raw.luggage??{},assistance:settings.assistanceEnabled?raw.assistance??null:null,language:settings.languageEnabled?raw.language??null:null,forSomeoneElse:raw.forSomeoneElse===true,travellerName:raw.travellerName??null,travellerPhone:raw.travellerPhone??null,emergencyPhone:raw.emergencyPhone??null};
  if(details.language&&!offeredLanguages(settings).some(l=>l.code===details.language)) throw new TaxipressError(400,"language_not_offered","Choose a language offered for this departure.");
  const priced=priceBooking({adults:details.adults,children:details.children,childSeats:details.childSeats,luggage:details.luggage},fare,settings);
  if(priced.error||priced.seats!==input.seats) throw new TaxipressError(400,"invalid_passenger_details",priced.error||"Passenger count changed. Review your scheduled booking.");
  if(details.forSomeoneElse&&(!settings.bookForOthersEnabled||!details.travellerName||!details.travellerPhone||!details.emergencyPhone)) throw new TaxipressError(400,"traveller_missing","Add the traveller's name, phone and emergency contact.");
  const amount = priced.amount;
  const storedDetails={...details,childSeats:priced.childSeats,luggageAmount:priced.luggageAmount};
  const aToB = d.direction === "a_to_b";
  const from = { name:String(aToB ? d.stage_a_name : d.stage_b_name),lat:Number(aToB ? d.stage_a_lat : d.stage_b_lat),lng:Number(aToB ? d.stage_a_lng : d.stage_b_lng) };
  const to = { name:String(aToB ? d.stage_b_name : d.stage_a_name),lat:Number(aToB ? d.stage_b_lat : d.stage_a_lat),lng:Number(aToB ? d.stage_b_lng : d.stage_a_lng) };
  const env = (await getPlatformEnvironment()) === "sandbox" ? "sandbox" : "live";
  const listId = newId("list");
  await db.execute({sql:"INSERT INTO lists (id,customer_id,title,status,environment) VALUES (?,?,?,'draft',?)",args:[listId,user.sub,`Taxipress scheduled: ${from.name} → ${to.name}`,env]});
  let orderId: string | null = null;
  try {
    const response = await createOrderFromInput(c,{listId,type:"parcel",isRide:true,pickupAddress:from.name,pickupLat:from.lat,pickupLng:from.lng,destinationAddress:to.name,destinationLat:to.lat,destinationLng:to.lng,paymentRail:"escrow"},
      {fare:amount,matchingMode:"first_to_claim",allowConcurrent:true,deferredMatching:true});
    if (response.status >= 400) throw new TaxipressError(409,"order_unavailable","Could not create the scheduled booking. Try again.");
    const order = (await response.clone().json() as {order:Row}).order;
    orderId = String(order.id);
    const ticketId = newId("tpf");
    await db.execute({sql:`INSERT INTO taxipress_future_tickets
      (id,departure_id,passenger_id,environment,order_id,seats,fare_per_seat,amount,details_json,pay_by,ticket_code,request_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,args:[ticketId,input.departureId,user.sub,env,orderId,input.seats,fare,amount,JSON.stringify(storedDetails),
        new Date(Math.min(Date.parse(String(d.departs_at).replace(" ","T")+ (String(d.departs_at).endsWith("Z") ? "" : "Z"))-Number(d.cutoff_minutes)*60000,Date.now()+settings.payWithinMinutes*60000)).toISOString(),`TPF-${crypto.randomUUID().replace(/-/g,"").slice(0,8).toUpperCase()}`,input.requestId]});
    const attached = await db.execute({sql:"UPDATE orders SET rider_id=?,stage='Match',updated_at=datetime('now') WHERE id=? AND stage='Scheduled'",args:[String(d.driver_id),orderId]});
    if(!attached.rowsAffected) throw new TaxipressError(409,"order_changed","The scheduled order changed. Refresh your tickets before paying.");
    await db.execute({sql:"UPDATE chat_messages SET rider_id=? WHERE order_id=? AND rider_id IS NULL",args:[String(d.driver_id),orderId]});
    return { ticketId,orderId,reused:false,departure:{id:input.departureId,departsAt:String(d.departs_at),plate:String(d.plate),seatLayout:String(d.seat_layout),from:from.name,to:to.name,seats:input.seats,amount } };
  } catch (e) {
    if (orderId) await db.execute({sql:"UPDATE orders SET stage='Cancelled',updated_at=datetime('now') WHERE id=? AND stage IN ('Scheduled','Match')",args:[orderId]}).catch(()=>undefined);
    if (e instanceof TaxipressError) throw e;
    if (e instanceof Error && (e.message.includes("taxipress_future_capacity") || e.message.includes("UNIQUE constraint failed"))) throw new TaxipressError(409,"departure_full","Those seats are no longer available.");
    throw e;
  }
}

export async function customerFutureTickets(passengerId: string) {
  if (!(await scheduledDeparturesReady())) return [];
  await expireUnpaidFutureTickets();
  const env = (await getPlatformEnvironment()) === "sandbox" ? "sandbox" : "live";
  const vipColumn = await hasColumn("taxipress_departures", "service_class");
  return (await db.execute({sql:`SELECT f.id,f.order_id AS orderId,f.booking_id AS bookingId,f.seats,f.amount,f.state,f.ticket_code AS ticketCode,f.created_at AS createdAt,
    f.cancel_fee AS cancelFee,d.departs_at AS departsAt,d.state AS departureState,d.taxipress_route_id AS routeId,
    d.queue_id AS queueId,${vipColumn ? "d.service_class" : "'standard' AS service_class"},t.plate,t.seat_layout AS seatLayout,r.direction,
    CASE WHEN r.direction='a_to_b' THEN rr.stage_a_name ELSE rr.stage_b_name END AS fromName,
    CASE WHEN r.direction='a_to_b' THEN rr.stage_b_name ELSE rr.stage_a_name END AS toName,o.stage AS orderStage,
    EXISTS(SELECT 1 FROM payments p WHERE p.order_id=f.order_id AND p.type='collection' AND p.status='successful') AS paid
    ,EXISTS(SELECT 1 FROM payments p WHERE p.order_id=f.order_id AND p.type='collection' AND p.status IN ('pending','unknown')) AS pending
    FROM taxipress_future_tickets f JOIN taxipress_departures d ON d.id=f.departure_id
    JOIN taxipress_taxis t ON t.id=d.taxi_id JOIN taxipress_routes r ON r.id=d.taxipress_route_id
    JOIN relay_routes rr ON rr.id=r.relay_route_id JOIN orders o ON o.id=f.order_id
    WHERE f.passenger_id=? AND f.environment=? ORDER BY d.departs_at DESC LIMIT 100`,args:[passengerId,env]})).rows;
}

export async function cancelFutureTicket(passengerId: string, ticketId: string) {
  const row = (await db.execute({sql:`SELECT f.*,d.departs_at,d.free_cancel_minutes,d.retention_percent,d.fee_to,d.taxi_id,d.queue_id
    FROM taxipress_future_tickets f JOIN taxipress_departures d ON d.id=f.departure_id
    WHERE f.id=? AND f.passenger_id=? AND f.state='reserved' AND d.state='published' AND d.queue_id IS NULL`,args:[ticketId,passengerId]})).rows[0] as Row | undefined;
  if (!row) throw new TaxipressError(404,"ticket_not_cancellable","This scheduled ticket can no longer be cancelled here.");
  const departMs = Date.parse(String(row.departs_at).replace(" ","T") + (String(row.departs_at).endsWith("Z") ? "" : "Z"));
  const minutesLeft = (departMs-Date.now())/60000;
  if (!(minutesLeft > 0)) throw new TaxipressError(409,"departure_started","This departure has started.");
  const payments = await db.execute({sql:"SELECT type,status,amount FROM payments WHERE order_id=?",args:[String(row.order_id)]});
  if (payments.rows.some(p => p.type === "collection" && (p.status === "pending" || p.status === "unknown"))) throw new TaxipressError(409,"payment_pending","A payment is still being confirmed. Refresh its status before cancelling.");
  const collected = payments.rows.filter(p => p.type === "collection" && p.status === "successful").reduce((n,p)=>n+Number(p.amount),0);
  const previouslyRefunded = payments.rows.filter(p => p.type === "refund" && p.status === "successful").reduce((n,p)=>n+Number(p.amount),0);
  const free = minutesLeft >= Number(row.free_cancel_minutes);
  const fee = free ? 0 : Math.min(Math.max(0,collected-previouslyRefunded),Math.round(collected*Number(row.retention_percent)/100));
  const refund = Math.max(0,collected-previouslyRefunded-fee);
  const changed = await db.execute({sql:"UPDATE taxipress_future_tickets SET state='cancelled',cancel_fee=?,cancel_reason='customer_cancelled' WHERE id=? AND state='reserved'",args:[fee,ticketId]});
  if (!changed.rowsAffected) throw new TaxipressError(409,"ticket_changed","This ticket has changed. Refresh and try again.");
  if (refund > 0) {
    await db.execute({sql:"INSERT INTO payments (id,order_id,type,provider,amount,currency,status) VALUES (?,?,'refund','wallet',?,'UGX','successful')",args:[newId("pay"),String(row.order_id),refund]});
    await refundToWallet(passengerId,refund,{orderId:String(row.order_id),environment:String(row.environment)==="sandbox"?"sandbox":"live",note:"Scheduled departure cancellation",actorId:passengerId});
  }
  if (fee > 0 && row.fee_to === "driver") {
    const driver = (await db.execute({sql:"SELECT user_id FROM taxipress_taxis WHERE id=?",args:[String(row.taxi_id)]})).rows[0] as Row | undefined;
    if (driver?.user_id) {
      await creditRiderWorkWallet(String(driver.user_id), fee, String(row.environment) === "sandbox" ? "sandbox" : "live");
    }
  }
  return {ticketId,refunded:refund,fee,cancelled:true};
}

/** Cancel missed/operator-cancelled slots and refund every collected ticket through Peebee's normal wallet service. */
export async function sweepScheduledDepartures() {
  if (!(await scheduledDeparturesReady())) return { missed:0, cancelled:0, refunded:0 };
  const missed = await db.execute({sql:`UPDATE taxipress_departures SET state='cancelled'
    WHERE state='published' AND queue_id IS NULL AND datetime(departs_at,'+'||grace_minutes||' minutes')<=datetime('now')`,args:[]});
  const tickets=(await db.execute({sql:`SELECT f.id,f.order_id,f.passenger_id,f.environment,d.state AS departure_state
    FROM taxipress_future_tickets f JOIN taxipress_departures d ON d.id=f.departure_id
    WHERE f.state='reserved' AND d.state='cancelled' AND d.queue_id IS NULL ORDER BY f.created_at LIMIT 200`,args:[]})).rows as Row[];
  let cancelled=0,refunded=0;
  for(const t of tickets){
    const pending=(await db.execute({sql:"SELECT 1 FROM payments WHERE order_id=? AND type='collection' AND status IN ('pending','unknown') LIMIT 1",args:[String(t.order_id)]})).rows.length>0;
    if(pending) continue;
    const result=await refundOrderToWallet({orderId:String(t.order_id),customerId:String(t.passenger_id),actorId:String(t.passenger_id),environment:String(t.environment)==="sandbox"?"sandbox":"live",note:"Scheduled departure cancelled by Peebee"}).catch(()=>null);
    const amount=result&&"refunded" in result?result.refunded:0;
    const change=await db.execute({sql:`UPDATE taxipress_future_tickets SET state='cancelled',cancel_reason='departure_cancelled',cancel_fee=0
      WHERE id=? AND state='reserved'`,args:[String(t.id)]});
    if(change.rowsAffected){cancelled++;if(amount>0)refunded++;await notifyUser(String(t.passenger_id),{title:"Scheduled departure cancelled",body:amount>0?"Peebee cancelled this departure. Your payment was refunded to your wallet.":"Peebee cancelled this departure. Check your booking for the latest update.",url:"/ride/taxipress/ticket/"+String(t.id),tag:"taxipress-future-cancel-"+String(t.id)}).catch(()=>{});}
  }
  return {missed:missed.rowsAffected,cancelled,refunded};
}

export async function checkInForDeparture(driverId: string, id: string, lat?: number, lng?: number) {
  if (!(await scheduledDeparturesReady())) throw new TaxipressError(503,"schedule_unavailable","Future departure scheduling is not set up yet.");
  const d = (await db.execute({ sql: `SELECT d.*,t.user_id,r.id AS routeId FROM taxipress_departures d
    JOIN taxipress_taxis t ON t.id=d.taxi_id JOIN taxipress_routes r ON r.id=d.taxipress_route_id
    WHERE d.id=? AND t.user_id=? AND d.state='published' AND d.queue_id IS NULL`, args: [id,driverId] })).rows[0] as Row | undefined;
  if (!d) throw new TaxipressError(404,"departure_not_found","No open departure is assigned to your taxi.");
  const mins = (Date.parse(String(d.departs_at).replace(" ","T") + (String(d.departs_at).endsWith("Z") ? "" : "Z")) - Date.now()) / 60_000;
  if (mins > Number(d.checkin_minutes) || mins < -Number(d.grace_minutes)) throw new TaxipressError(409,"checkin_window","Driver check-in is not open for this departure.");
  const entry = await joinLine(driverId,String(d.routeId),{lat,lng});
  const tickets = (await db.execute({sql:"SELECT id,order_id,passenger_id,seats,fare_per_seat,amount,ticket_code,environment,details_json FROM taxipress_future_tickets WHERE departure_id=? AND state='reserved' ORDER BY created_at,id",args:[id]})).rows as Row[];
  const seatFeature = await seatingReady();
  const mapRow = seatFeature ? (await db.execute({sql:"SELECT labels FROM taxipress_seat_maps WHERE queue_id=?",args:[entry.id]})).rows[0] as Row | undefined : undefined;
  const useSeats = !!mapRow;
  const capacity = tickets.reduce((n,t)=>n+Number(t.seats),0);
  const statements: Array<{sql:string;args?:unknown[]}> = [
    {sql:"UPDATE taxipress_departures SET state='active',queue_id=? WHERE id=? AND state='published' AND queue_id IS NULL",args:[entry.id,id]},
    {sql:"UPDATE taxipress_queue SET seats_booked=seats_booked+?,updated_at=datetime('now') WHERE id=? AND status='in_line' AND seats_booked+walk_up_seats+?<=seats_total",args:[capacity,entry.id,capacity]},
  ];
  const ticketBookings: Array<{ticket:Row;bookingId:string}> = [];
  let labels: string[] = [];
  if (useSeats) {
    try { labels = JSON.parse(String(mapRow?.labels ?? "[]")); } catch { labels=[]; }
    const claimed = new Set<string>();
    for (const t of tickets) {
      const reservationId = `tp-scheduled-${String(t.id)}`;
      const chosen = labels.filter(label=>!claimed.has(label)).slice(0,Number(t.seats));
      if (chosen.length !== Number(t.seats)) throw new TaxipressError(409,"seat_map_full","The taxi seat map cannot fit the reserved passengers.");
      chosen.forEach(x=>claimed.add(x));
      statements.push({sql:"INSERT INTO taxipress_seat_reservations (id,queue_id,passenger_id,quantity,chosen,fee,state,expires_at) VALUES (?,?,?,?,0,0,'reserved',datetime('now','+2 hours'))",args:[reservationId,entry.id,String(t.passenger_id),Number(t.seats)]});
      for (const seat of chosen) statements.push({sql:"INSERT INTO taxipress_seat_claims (queue_id,seat,reservation_id,walk_up) VALUES (?,?,?,0)",args:[entry.id,seat,reservationId]});
    }
  }
  for (const t of tickets) {
    const bookingId = newId("tpb");
    ticketBookings.push({ticket:t,bookingId});
    statements.push({sql:`INSERT INTO taxipress_bookings
      (id,order_id,queue_id,taxipress_route_id,passenger_id,driver_id,seats,fare_per_seat,amount,payment_method,ticket_code,environment,future_ticket_id${useSeats ? ",seat_reservation_id" : ""})
      VALUES (?,?,?,?,?,?,?,?,?,'app',?,?,?${useSeats ? ",?" : ""})`,args:[bookingId,String(t.order_id),entry.id,String(d.routeId),String(t.passenger_id),driverId,Number(t.seats),Number(t.fare_per_seat),Number(t.amount),String(t.ticket_code),String(t.environment),String(t.id),...(useSeats ? [`tp-scheduled-${String(t.id)}`] : [])]});
    statements.push({sql:"UPDATE orders SET rider_id=?,updated_at=datetime('now') WHERE id=? AND stage IN ('Match','Shop','Fund')",args:[driverId,String(t.order_id)]});
  }
  try { await executeBatch(statements); }
  catch (e) {
    await db.execute({ sql: "UPDATE taxipress_queue SET status='cancelled',ended_reason='schedule_checkin_failed' WHERE id=? AND status='in_line'",args:[entry.id] }).catch(()=>undefined);
    if (e instanceof Error && e.message.includes("taxipress_future_capacity")) throw new TaxipressError(409,"checkin_conflict","The departure has already been activated.");
    throw e;
  }
  for(const {ticket:t,bookingId} of ticketBookings){
    try {
      const x=JSON.parse(String(t.details_json||"{}"));
      await saveDetails(bookingId,{
        adults:Number(x.adults)||Number(t.seats),children:Number(x.children)||0,childSeats:Number(x.childSeats)||0,
        luggage:x.luggage&&typeof x.luggage==="object"?x.luggage:{},luggageAmount:Number(x.luggageAmount)||0,
        assistance:x.assistance||null,language:x.language||null,forSomeoneElse:x.forSomeoneElse===true,
        travellerName:x.travellerName||null,travellerPhone:x.travellerPhone||null,emergencyPhone:x.emergencyPhone||null,
      },{customerId:String(t.passenger_id),environment:String(t.environment)});
    } catch { /* Details remain on the future ticket if an older detail store is unavailable. */ }
  }
  return entry;
}
