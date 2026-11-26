import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { signToken } from "../auth/jwt.js";
import { orderRoutes } from "../orders/routes.js";
import { relayRoutes } from "../relay/routes.js";
import { publicTaxipressRoutes, taxipressRoutes } from "./routes.js";
import { sweepScheduledDepartures } from "./scheduled.js";

test("scheduled TaxiPress booking reserves separate capacity, funds and converts at driver check-in", async () => {
  const client = createClient({ url: "file::memory:" });
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "scheduled-taxipress-test-only";
  for (const f of readdirSync("src/db/migrations").filter(f => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(`src/db/migrations/${f}`, "utf8"))) await client.execute(sql);
  }
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[], bind(...args: unknown[]) { this.args = args; return this; },
    async all() { const r = await client.execute({ sql: this.sql, args: this.args as InArgs }); return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }; },
  });
  setD1Binding({ prepare, async batch(s: ReturnType<typeof prepare>[]) {
    return (await client.batch(s.map(x => ({ sql: x.sql, args: x.args as InArgs })), "write")).map(r => ({ results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }));
  } } as unknown as D1Database);
  resetSchemaCache();
  try {
    const tokens: Record<string, string> = {};
    for (const [index,id] of ["staff", "driver", "driver2", "driver3", "driver4", "customer"].entries()) {
      const role = id === "staff" ? "admin" : "customer";
      await client.execute({ sql: "INSERT INTO users(id,name,phone,password_hash,role,admin_role,wallet_balance) VALUES(?,?,?,'hash',?,?,?)", args: [id,id,`+2567000000${index}`,role,id === "staff" ? "super_admin" : null,id === "customer" ? 100_000 : 0] });
      tokens[id] = await signToken({ sub:id, role } as never);
    }
    await client.execute("INSERT INTO personal_wallets (user_id) SELECT id FROM users WHERE role='customer'");
    const app = new Hono().route("/v1",publicTaxipressRoutes).route("/v1",orderRoutes).route("/v1",relayRoutes).route("/v1",taxipressRoutes);
    const call = (who: string, path: string, body?: object, method = body ? "POST" : "GET") => app.request(`/v1/${path}`, { method, headers: { Authorization:`Bearer ${tokens[who]}`, "Content-Type":"application/json" }, ...(body ? { body:JSON.stringify(body) } : {}) });
    const json = async (r: Response) => await r.json() as Record<string, any>;
    await setSetting("taxipress_enabled","1");
    await setSetting("taxipress_scheduled_enabled","1");
    await setSetting("taxipress_numbered_seats_enabled","1");
    await setSetting("taxipress_stage_radius_m","0");
    await setSetting("taxipress_schedule_min_lead_minutes","0");
    await setSetting("taxipress_schedule_booking_cutoff_minutes","0");
    await setSetting("taxipress_schedule_checkin_minutes","30");
    await setSetting("service_ride_enabled","1");
    const relay = await json(await call("staff","admin/relay/routes",{name:"Scheduled test route",stageAName:"Stage A",stageALat:0,stageALng:32,stageBName:"Stage B",stageBLat:1,stageBLng:32,parcelFare:5000}));
    const route = await json(await call("staff","admin/taxipress/routes",{relayRouteId:relay.id,direction:"a_to_b",farePerSeat:5000,active:true}));
    assert.equal((await call("driver","taxipress/taxi/apply",{relayRouteId:relay.id,plate:"UAX 123K",seatLayout:"14"})).status,201);
    const taxis = await json(await call("staff","admin/taxipress/taxis"));
    const taxi = taxis.taxis[0];
    assert.equal((await call("staff",`admin/taxipress/taxis/${taxi.id}`,{status:"approved",numberedSeatsEnabled:true})).status,200);
    const departureTime = new Date(Date.now()+20*60_000).toISOString();
    const published = await call("staff","admin/taxipress/departures",{routeId:route.id,taxiId:taxi.id,departsAt:departureTime,capacity:1});
    assert.equal(published.status,201,JSON.stringify(await published.clone().json()));
    const departure = (await json(published)).id as string;
    const publicList = await json(await app.request(`/v1/taxipress-public/departures?routeId=${route.id}`));
    assert.equal(publicList.departures.length,1);
    assert.equal(publicList.departures[0].seatsLeft,1);
    const first = await call("customer","taxipress/departures/book",{departureId:departure,seats:1,requestId:"12345678-2942-4bf1-9999-9db2d223132f",details:{adults:1,children:0,childSeats:0}});
    assert.equal(first.status,201,JSON.stringify(await first.clone().json()));
    const firstTicket=(await json(first)).ticketId as string;
    const oversell=await call("customer","taxipress/departures/book",{departureId:departure,seats:1,requestId:"22345678-2942-4bf1-9999-9db2d223132f",details:{adults:1,children:0,childSeats:0}});
    assert.equal(oversell.status,409);
    const cancelled=await call("customer",`taxipress/departures/tickets/${firstTicket}/cancel`,{});
    assert.equal(cancelled.status,200,JSON.stringify(await cancelled.clone().json()));
    assert.equal(Number((await json(cancelled)).refunded),0);
    assert.equal(Number((await client.execute({sql:"SELECT seats_reserved FROM taxipress_departures WHERE id=?",args:[departure]})).rows[0].seats_reserved),0);
    const requestId = "b03dc5f4-2942-4bf1-9999-9db2d223132f";
    const booked = await call("customer","taxipress/departures/book",{departureId:departure,seats:1,requestId,details:{adults:1,children:0,childSeats:0}});
    assert.equal(booked.status,201,JSON.stringify(await booked.clone().json()));
    const reservation = await json(booked);
    const snapshot = await client.execute({sql:"SELECT stage,rider_id FROM orders WHERE id=?",args:[reservation.orderId]});
    assert.equal(snapshot.rows[0].stage,"Match");
    assert.equal(snapshot.rows[0].rider_id,"driver");
    const funded = await call("customer",`orders/${reservation.orderId}/fund`,{paymentMethod:"wallet",useWallet:true});
    assert.equal(funded.status,200,JSON.stringify(await funded.clone().json()));
    assert.equal((await call("driver",`taxipress/driver/departures`)).status,200);
    const checkedIn = await call("driver",`taxipress/driver/departures/${departure}/check-in`,{});
    assert.equal(checkedIn.status,200,JSON.stringify(await checkedIn.clone().json()));
    const future = await json(await call("customer",`taxipress/departures/tickets/${reservation.ticketId}`));
    assert.equal(future.ticket.state,"converted");
    assert.ok(future.ticket.bookingId);
    const normal = await json(await call("customer",`taxipress/bookings/${future.ticket.bookingId}`));
    assert.equal(normal.booking.paymentStatus,"paid");
    assert.equal(normal.booking.seatNumbers.length,1);
    assert.equal(normal.booking.details.adults,1);
    assert.equal((await client.execute({sql:"SELECT state FROM taxipress_departures WHERE id=?",args:[departure]})).rows[0].state,"active");

    assert.equal((await call("driver2","taxipress/taxi/apply",{relayRouteId:relay.id,plate:"UAY 456K",seatLayout:"14"})).status,201);
    const taxi2=(await json(await call("staff","admin/taxipress/taxis"))).taxis.find((t:Record<string,unknown>)=>t.plate==="UAY 456K");
    assert.equal((await call("staff",`admin/taxipress/taxis/${taxi2.id}`,{status:"approved"})).status,200);
    assert.equal((await call("staff",`admin/taxipress/taxis/${taxi2.id}`,{serviceClass:"vip"})).status,400);
    const secondDeparture=(await json(await call("staff","admin/taxipress/departures",{routeId:route.id,taxiId:taxi2.id,departsAt:new Date(Date.now()+120*60_000).toISOString(),capacity:2}))).id as string;
    const secondBooking=await call("customer","taxipress/departures/book",{departureId:secondDeparture,seats:1,requestId:"32345678-2942-4bf1-9999-9db2d223132f",details:{adults:1,children:0,childSeats:0}});
    assert.equal(secondBooking.status,201,JSON.stringify(await secondBooking.clone().json()));
    const paidCancellation=(await json(secondBooking));
    const secondFund=await call("customer",`orders/${paidCancellation.orderId}/fund`,{paymentMethod:"wallet",useWallet:true});
    assert.equal(secondFund.status,200,JSON.stringify(await secondFund.clone().json()));
    const cancelPaid=await call("customer",`taxipress/departures/tickets/${paidCancellation.ticketId}/cancel`,{});
    assert.equal(cancelPaid.status,200,JSON.stringify(await cancelPaid.clone().json()));
    assert.equal(Number((await json(cancelPaid)).refunded),5000);
    assert.equal(Number((await client.execute({sql:"SELECT seats_reserved FROM taxipress_departures WHERE id=?",args:[secondDeparture]})).rows[0].seats_reserved),0);

    const missedDeparture=(await json(await call("staff","admin/taxipress/departures",{routeId:route.id,taxiId:taxi2.id,departsAt:new Date(Date.now()+180*60_000).toISOString(),capacity:1}))).id as string;
    const missedBooking=(await json(await call("customer","taxipress/departures/book",{departureId:missedDeparture,seats:1,requestId:"42345678-2942-4bf1-9999-9db2d223132f",details:{adults:1,children:0,childSeats:0}})));
    assert.equal((await call("customer",`orders/${missedBooking.orderId}/fund`,{paymentMethod:"wallet",useWallet:true})).status,200);
    await client.execute({sql:"UPDATE taxipress_departures SET departs_at=datetime('now','-31 minutes') WHERE id=?",args:[missedDeparture]});
    const swept=await sweepScheduledDepartures();
    assert.equal(swept.missed,1);assert.equal(swept.cancelled,1);assert.equal(swept.refunded,1);
    assert.equal((await json(await call("customer",`taxipress/departures/tickets/${missedBooking.ticketId}`))).ticket.state,"cancelled");

    await setSetting("taxipress_vip_fare_markup_percent","50");
    assert.equal((await call("driver3","taxipress/taxi/apply",{relayRouteId:relay.id,plate:"UAV 789K",seatLayout:"18"})).status,201);
    const vipTaxi=(await json(await call("staff","admin/taxipress/taxis"))).taxis.find((t:Record<string,unknown>)=>t.plate==="UAV 789K");
    assert.equal((await call("staff",`admin/taxipress/taxis/${vipTaxi.id}`,{status:"approved"})).status,200);
    const designated=await call("staff",`admin/taxipress/taxis/${vipTaxi.id}`,{serviceClass:"vip"});
    assert.equal(designated.status,200,JSON.stringify(await designated.clone().json()));
    assert.equal((await json(designated)).taxi.seats,13);
    const vipTime=new Date(Date.now()+240*60_000).toISOString();
    assert.equal((await call("staff","admin/taxipress/departures",{routeId:route.id,taxiId:vipTaxi.id,departsAt:vipTime,capacity:12})).status,400);
    const vipPublished=await call("staff","admin/taxipress/departures",{routeId:route.id,taxiId:vipTaxi.id,departsAt:vipTime});
    assert.equal(vipPublished.status,201,JSON.stringify(await vipPublished.clone().json()));
    const vipDeparture=(await json(vipPublished)).id as string;
    const vipSnapshot=(await client.execute({sql:"SELECT capacity,fare_per_seat,service_class FROM taxipress_departures WHERE id=?",args:[vipDeparture]})).rows[0];
    assert.equal(Number(vipSnapshot.capacity),13);assert.equal(Number(vipSnapshot.fare_per_seat),7500);assert.equal(vipSnapshot.service_class,"vip");
    const vipPublic=(await json(await app.request(`/v1/taxipress-public/departures?routeId=${route.id}`))).departures.find((d:Record<string,unknown>)=>d.id===vipDeparture);
    assert.equal(vipPublic.serviceClass,"vip");
    const vipBooked=(await json(await call("customer","taxipress/departures/book",{departureId:vipDeparture,seats:1,requestId:"52345678-2942-4bf1-9999-9db2d223132f",details:{adults:1,children:0,childSeats:0}})));
    const vipTicket=(await json(await call("customer",`taxipress/departures/tickets/${vipBooked.ticketId}`))).ticket;
    assert.equal(vipTicket.service_class,"vip");assert.equal(vipTicket.amount,7500);
    await call("customer",`orders/${vipBooked.orderId}/fund`,{paymentMethod:"wallet",useWallet:true});
    await client.execute({sql:"UPDATE taxipress_departures SET departs_at=datetime('now','+15 minutes') WHERE id=?",args:[vipDeparture]});
    assert.equal((await call("driver3",`taxipress/driver/departures/${vipDeparture}/check-in`,{})).status,200);
    const vipLiveTicket=(await json(await call("customer",`taxipress/departures/tickets/${vipBooked.ticketId}`))).ticket;
    assert.equal(vipLiveTicket.state,"converted");assert.equal(vipLiveTicket.service_class,"vip");

    assert.equal((await call("driver4","taxipress/taxi/apply",{relayRouteId:relay.id,plate:"UAV 890K",seatLayout:"18"})).status,201);
    const liveVipTaxi=(await json(await call("staff","admin/taxipress/taxis"))).taxis.find((t:Record<string,unknown>)=>t.plate==="UAV 890K");
    assert.equal((await call("staff",`admin/taxipress/taxis/${liveVipTaxi.id}`,{status:"approved"})).status,200);
    assert.equal((await call("staff",`admin/taxipress/taxis/${liveVipTaxi.id}`,{serviceClass:"vip"})).status,200);
    const liveJoin=await call("driver4","taxipress/driver/join",{routeId:route.id});
    assert.equal(liveJoin.status,201,JSON.stringify(await liveJoin.clone().json()));
    const liveQueue=(await json(await app.request(`/v1/taxipress-public/routes/${route.id}/queue`))).line;
    const vipQueueEntry=liveQueue.find((e:Record<string,unknown>)=>e.plate==="UAV 890K");
    assert.equal(vipQueueEntry.serviceClass,"vip");
    assert.equal(vipQueueEntry.seatsLeft,13);
    const overCapacity=await call("customer","taxipress/bookings",{queueId:vipQueueEntry.id,adults:14,children:0,childSeats:0,payment:"app"});
    assert.equal(overCapacity.status,400,"VIP booking passenger count must never exceed 13");
    const vipLiveBooking=await call("customer","taxipress/bookings",{queueId:vipQueueEntry.id,adults:1,children:0,childSeats:0,payment:"app"});
    assert.equal(vipLiveBooking.status,201,JSON.stringify(await vipLiveBooking.clone().json()));
    const vipLiveBookingData=(await json(vipLiveBooking)).booking;
    assert.equal(vipLiveBookingData.amount,7500);
    assert.equal(vipLiveBookingData.farePerSeat,7500);
    assert.equal(vipLiveBookingData.taxi.serviceClass,"vip");
    assert.equal(vipLiveBookingData.taxi.seatsLeft,12);
  } finally {
    setD1Binding(undefined); resetSchemaCache();
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    await client.close();
  }
});
