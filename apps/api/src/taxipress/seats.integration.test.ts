import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient,type InArgs } from '@libsql/client/node';
import { Hono } from 'hono';
import { setD1Binding,type D1Database } from '../db/client.js';
import { splitSqlStatements } from '../db/split-sql.js';
import { resetSchemaCache } from '../lib/schema.js';
import { setPlatformEnvironment,setSetting } from '../lib/settings.js';
import { signToken } from '../auth/jwt.js';
import { orderRoutes } from '../orders/routes.js';
import { relayRoutes } from '../relay/routes.js';
import { publicTaxipressRoutes,taxipressRoutes } from './routes.js';
import { cleanupSeatHolds,SEAT_LABELS,reserveNumberedBooking } from './seats.js';

test('numbered seats: concurrent ownership, expiry and all booking paths',async t => {
  const client = createClient({ url: 'file::memory:' });
  const secret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'numbered-seat-integration-test-only';
  for (const f of readdirSync('src/db/migrations').filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join('src/db/migrations',f),'utf8'))) await client.execute(sql);
  }
  const prepare = (sql: string) => ({ sql,args: [] as unknown[],bind(...args: unknown[]) { this.args = args; return this; },
    async all() { const r = await client.execute({ sql: this.sql,args: this.args as InArgs }); return { results: r.rows,success: true,meta: { changes: r.rowsAffected,last_row_id: Number(r.lastInsertRowid ?? 0) } }; } });
  setD1Binding({ prepare,async batch(statements: ReturnType<typeof prepare>[]) {
    return (await client.batch(statements.map(s => ({ sql: s.sql,args: s.args as InArgs })),'write')).map(r => ({ results: r.rows,success: true,meta: { changes: r.rowsAffected,last_row_id: Number(r.lastInsertRowid ?? 0) } }));
  } } as unknown as D1Database);
  resetSchemaCache();
  try {
    const people = ['staff','d1','d2','d3','a','b','c'];
    const tokens: Record<string,string> = {};
    for (const id of people) {
      const role = id === 'staff' ? 'admin' : 'customer';
      await client.execute({ sql: "INSERT INTO users(id,name,phone,password_hash,role,admin_role) VALUES(?,?,?,'hash',?,?)",args: [id,id,id,role,id === 'staff' ? 'super_admin' : null] });
      tokens[id] = await signToken({ sub: id,role } as never);
    }
    await client.execute("INSERT INTO personal_wallets (user_id) SELECT id FROM users WHERE role='customer'");
    const app = new Hono().route('/v1',publicTaxipressRoutes).route('/v1',orderRoutes).route('/v1',relayRoutes).route('/v1',taxipressRoutes);
    const call = (who: string,path: string,body?: object,method = body ? 'POST' : 'GET') => app.request('/v1/'+path,{ method,headers: { ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}),'Content-Type': 'application/json' },...(body ? { body: JSON.stringify(body) } : {}) });
    const json = async (r: Response) => await r.json() as any;
    await setSetting('taxipress_enabled','1'); await setSetting('taxipress_numbered_seats_enabled','1');
    await setSetting('taxipress_seat_choice_fee_ugx','500'); await setSetting('taxipress_max_seats_per_booking','18');
    await setSetting('taxipress_stage_radius_m','0');
    const relay = await json(await call('staff','admin/relay/routes',{ name: 'Seat route',stageAName: 'Stage A',stageALat: 0,stageALng: 32,stageBName: 'Stage B',stageBLat: 1,stageBLng: 32,parcelFare: 5000 }));
    const route = await json(await call('staff','admin/taxipress/routes',{ relayRouteId: relay.id,direction: 'a_to_b',farePerSeat: 5000,active: true }));
    for (const [who,seatLayout] of [['d1','14'],['d2','14'],['d3','18']]) {
      assert.equal((await call(who,'taxipress/taxi/apply',{ relayRouteId: relay.id,plate: 'UBA '+who+'00',seatLayout })).status,201);
    }
    const taxis = (await json(await call('staff','admin/taxipress/taxis'))).taxis;
    for (const taxi of taxis) assert.equal((await call('staff',`admin/taxipress/taxis/${taxi.id}`,{ status: 'approved',numberedSeatsEnabled: true })).status,200);
    const queues: string[] = [];
    for (const who of ['d1','d2','d3']) {
      const response = await call(who,'taxipress/driver/join',{ routeId: route.id });
      assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
      const queueId = (await json(response)).entry.id;
      queues.push(queueId);
      await client.execute({ sql: "UPDATE taxipress_queue SET joined_at = datetime('now',?) WHERE id = ?",args: [`-${10-queues.length} minutes`,queueId] });
    }
    const [q1,q2,q3] = queues;
    const map = async (who: string,q = q1) => json(await call(who,`${who ? 'taxipress' : 'taxipress-public'}/queue/${q}/seats`));
    const hold = (who: string,seats: string[],q = q1) => call(who,`taxipress/queue/${q}/seat-holds`,{ seats });
    const release = (who: string,id: string) => call(who,`taxipress/seat-holds/${id}`,undefined,'DELETE');
    const book = (who: string,n: number,seatHoldId?: string,q = q1) => call(who,'taxipress/bookings',{ queueId: q,adults: n,...(seatHoldId ? { seatHoldId } : {}) });
    await t.test('saved departures sync to the owning customer and reject unavailable inventory',async()=>{
      assert.equal((await call('','taxipress/saved-departures')).status,401);
      assert.equal((await call('staff','taxipress/saved-departures')).status,403);
      assert.equal((await call('a',`taxipress/saved-departures/${q1}`,{},'PUT')).status,200);
      assert.equal((await call('a',`taxipress/saved-departures/${q1}`,{},'PUT')).status,200,'saving twice is idempotent');
      assert.deepEqual((await json(await call('a','taxipress/saved-departures'))).savedIds,[q1]);
      assert.deepEqual((await json(await call('b','taxipress/saved-departures'))).savedIds,[],'another account cannot read the saved departure');
      await setPlatformEnvironment('sandbox');assert.deepEqual((await json(await call('a','taxipress/saved-departures'))).savedIds,[],'saved departures never cross live/sandbox environments');await setPlatformEnvironment('live');
      assert.equal((await call('a','taxipress/saved-departures/not-a-queue',{},'PUT')).status,409);
      await call('b',`taxipress/saved-departures/${q1}`,undefined,'DELETE');
      assert.deepEqual((await json(await call('a','taxipress/saved-departures'))).savedIds,[q1],'another account cannot remove the saved departure');
      assert.equal((await call('a',`taxipress/saved-departures/${q1}`,undefined,'DELETE')).status,200);
      assert.deepEqual((await json(await call('a','taxipress/saved-departures'))).savedIds,[]);
      for(let i=0;i<30;i++)await client.execute({sql:'INSERT INTO taxipress_saved_departures(user_id,environment,departure_id) VALUES(?,?,?)',args:['a','live',`filler-${i}`]});
      assert.equal((await call('a',`taxipress/saved-departures/${q1}`,{},'PUT')).status,409,'customer save limit must be enforced server-side');
      await client.execute({sql:'DELETE FROM taxipress_saved_departures WHERE user_id=?',args:['a']});
    });
    await t.test('public maps describe real labels and availability without identities or capabilities',async () => {
      assert.deepEqual((await map('')).seats.map((s: any) => s.id),SEAT_LABELS['14']);
      assert.deepEqual((await map('',q3)).seats.map((s: any) => s.id),SEAT_LABELS['18']);
      assert.equal((await hold('', ['1A'])).status,401);
      assert.equal((await hold('a',['5D'])).status,409,'18-seat labels cannot be used on a 14-seat taxi');
      assert.equal((await hold('a',['1A','1A'])).status,400);
    });
    await t.test('only one racing customer acquires a seat and other accounts cannot consume or release it',async () => {
      const responses = await Promise.all([hold('a',['1A']),hold('b',['1A'])]);
      assert.deepEqual(responses.map(r => r.status).sort(),[201,409]);
      const winner = responses[0].status === 201 ? 'a' : 'b',other = winner === 'a' ? 'b' : 'a';
      const h = (await map(winner)).hold;
      assert.equal((await map('')).hold,null);
      assert.doesNotMatch(JSON.stringify(await map('')),new RegExp(h.id));
      assert.equal((await book(other,1,h.id)).status,409);
      await release(other,h.id); assert.equal((await map(winner)).hold.id,h.id);
      await release(winner,h.id); assert.equal((await map(winner)).hold,null);
    });
    await t.test('replacing a selection is atomic and does not lose the old hold on conflict',async () => {
      await hold('a',['1A']); const before = (await map('a')).hold;
      await hold('b',['1B']); assert.equal((await hold('a',['1B'])).status,409);
      assert.equal((await map('a')).hold.id,before.id);
      await release('a',before.id); await release('b',(await map('b')).hold.id);
    });
    await t.test('expiry frees seats and no client can renew an expired capability by booking',async () => {
      const h = (await json(await hold('a',['1A']))).hold;
      await client.execute({ sql: "UPDATE taxipress_seat_reservations SET expires_at = datetime('now','-1 second') WHERE id = ?",args: [h.id] });
      assert.equal((await book('a',1,h.id)).status,409);
      await cleanupSeatHolds(); assert.equal((await map('')).seats[0].status,'available');
    });
    await t.test('holds block walk-up sales and automatic booking without counting as sold seats',async () => {
      const h = (await json(await hold('a',SEAT_LABELS['14']))).hold;
      assert.equal((await book('b',1)).status,409);
      assert.equal((await call('d1','taxipress/driver/walk-up',{ delta: 1 })).status,409);
      assert.equal((await client.execute({ sql: 'SELECT seats_booked FROM taxipress_queue WHERE id = ?',args: [q1] })).rows[0].seats_booked,0);
      await release('a',h.id);
    });
    await t.test('confirmation checks quantity and charges the server fee once, then cancellation releases numbers',async () => {
      const h = (await json(await hold('a',['1A','1B']))).hold;
      assert.equal((await book('a',1,h.id)).status,409);
      const response = await book('a',2,h.id); assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
      const b = (await json(response)).booking;
      assert.deepEqual(b.seatNumbers,['1A','1B']); assert.equal(b.amount,11000); assert.equal(b.seatChoiceFee,1000);
      assert.equal((await book('a',2,h.id)).status,409,'A hold cannot create two bookings');
      const manifest = (await json(await call('d1','taxipress/taxi/me'))).bookings;
      assert.deepEqual(manifest.find((p: any) => p.id === b.id).seatNumbers,['1A','1B']);
      assert.equal((await call('a',`taxipress/bookings/${b.id}/cancel`,{})).status,200);
      assert.equal((await map('')).seats[0].status,'available');
    });
    await t.test('older clients receive real automatic seat assignments without choice fees',async () => {
      const response = await book('b',1); assert.equal(response.status,201);
      const b = (await json(response)).booking;
      assert.deepEqual(b.seatNumbers,['1A']); assert.equal(b.amount,5000); assert.equal(b.seatChoiceFee,0);
      assert.equal((await call('d1','taxipress/driver/walk-up',{ delta: 1 })).status,200);
      const occupied = (await map('')).seats.filter((s: any) => s.status === 'occupied'); assert.equal(occupied.length,2);
      assert.equal((await call('d1','taxipress/driver/walk-up',{ delta: 1 })).status,200);
      assert.deepEqual((await json(await call('d1','taxipress/taxi/me'))).walkUpSeatNumbers,['1B','2A']);
      assert.equal((await call('d1','taxipress/driver/walk-up',{ delta: -1,seat: '1A' })).status,409,'A driver cannot release a passenger booking as a stage sale');
      assert.equal((await call('d1','taxipress/driver/walk-up',{ delta: -1,seat: '1B' })).status,200);
      assert.deepEqual((await json(await call('d1','taxipress/taxi/me'))).walkUpSeatNumbers,['2A']);
      assert.equal((await call('d1','taxipress/driver/walk-up',{ delta: -1 })).status,200);
      await call('b',`taxipress/bookings/${b.id}/cancel`,{});
    });
    await t.test('taxi removal preserves the numbered seats on another taxi',async () => {
      const h = (await json(await hold('a',['2B']))).hold;
      const b = (await json(await book('a',1,h.id))).booking;
      assert.equal((await call('d1','taxipress/driver/leave',{})).status,200);
      const moved = (await json(await call('a',`taxipress/bookings/${b.id}`))).booking;
      assert.equal(moved.taxi.queueId,q2); assert.deepEqual(moved.seatNumbers,['2B']);
      await call('a',`taxipress/bookings/${b.id}/cancel`,{});
    });
    await t.test('crashed order preparation expires once and returns both capacity and numbered claims',async () => {
      const h = (await json(await hold('a',['1A'],q2))).hold;
      const reserved = await reserveNumberedBooking(q2,'a',1,h.id); assert.ok(reserved);
      assert.equal((await client.execute({ sql: 'SELECT seats_booked FROM taxipress_queue WHERE id = ?',args: [q2] })).rows[0].seats_booked,1);
      await client.execute({ sql: "UPDATE taxipress_seat_reservations SET expires_at = datetime('now','-1 second') WHERE id = ?",args: [h.id] });
      await cleanupSeatHolds(); await cleanupSeatHolds();
      assert.equal((await client.execute({ sql: 'SELECT seats_booked FROM taxipress_queue WHERE id = ?',args: [q2] })).rows[0].seats_booked,0);
      assert.equal((await map('',q2)).seats[0].status,'available');
    });
    await t.test('unpaid booking expiry releases its exact numbered seats',async () => {
      const h = (await json(await hold('a',['1A'],q2))).hold;
      const b = (await json(await book('a',1,h.id,q2))).booking;
      await client.execute({ sql: "UPDATE taxipress_bookings SET created_at = datetime('now','-60 minutes') WHERE id = ?",args: [b.id] });
      const expired = (await json(await call('a',`taxipress/bookings/${b.id}`))).booking;
      assert.equal(expired.status,'cancelled'); assert.equal((await map('',q2)).seats[0].status,'available');
    });
    await t.test('a paid chosen seat is fully refunded when no replacement can honour that number',async () => {
      const h = (await json(await hold('a',['2B'],q2))).hold;
      const b = (await json(await book('a',1,h.id,q2))).booking;
      await client.execute("UPDATE users SET wallet_balance = 100000 WHERE id = 'a'");
      assert.equal((await call('a',`orders/${b.orderId}/fund`,{ paymentMethod: 'wallet',useWallet: true })).status,200);
      await hold('b',['2B'],q3);
      assert.equal((await call('d2','taxipress/driver/leave',{})).status,200);
      const ended = (await json(await call('a',`taxipress/bookings/${b.id}`))).booking;
      assert.equal(ended.status,'cancelled'); assert.deepEqual(ended.outcome,{ kind: 'taxi_removed',refunded: 5500,fee: 0 });
      assert.equal((await client.execute("SELECT wallet_balance FROM users WHERE id = 'a'")).rows[0].wallet_balance,100000);
      assert.equal((await client.execute({ sql: 'SELECT seats_booked FROM taxipress_queue WHERE id = ?',args: [q3] })).rows[0].seats_booked,0,'A failed reassignment must roll the target counter back');
      await release('b',(await map('b',q3)).hold.id);
    });
    await t.test('existing unnumbered departures stay unchanged and receive automatic numbers when moved',async () => {
      await setSetting('taxipress_numbered_seats_enabled','0');
      const old = (await json(await call('d1','taxipress/driver/join',{ routeId: route.id }))).entry.id;
      await setSetting('taxipress_numbered_seats_enabled','1');
      assert.equal((await map('',old)).enabled,false,'Changing the switch must not renumber an existing departure');
      const b = (await json(await book('b',1,undefined,old))).booking;
      assert.deepEqual(b.seatNumbers,[]);
      assert.equal((await call('d1','taxipress/driver/leave',{})).status,200);
      const moved = (await json(await call('b',`taxipress/bookings/${b.id}`))).booking;
      assert.equal(moved.taxi.queueId,q3); assert.equal(moved.seatNumbers.length,1); assert.equal(moved.seatChoiceFee,0);
      await call('b',`taxipress/bookings/${b.id}/cancel`,{});
    });
    await t.test('open tickets use free automatic seating and can move to different available numbers at boarding',async () => {
      await setSetting('taxipress_open_tickets_enabled','1'); await setSetting('taxipress_departure_rule','driver_choice');
      const target = (await json(await call('d2','taxipress/driver/join',{ routeId: route.id }))).entry.id;
      const response = await call('c','taxipress/bookings',{ queueId: q3,adults: 1,openTicket: true });
      assert.equal(response.status,201);
      const b = (await json(response)).booking; assert.deepEqual(b.seatNumbers,['1A']);
      await client.execute("UPDATE users SET wallet_balance = 100000 WHERE id = 'c'");
      assert.equal((await call('c',`orders/${b.orderId}/fund`,{ paymentMethod: 'wallet',useWallet: true })).status,200);
      assert.equal((await call('d2','taxipress/driver/walk-up',{ delta: 1 })).status,200);
      assert.equal((await call('d3','taxipress/driver/boarding',{})).status,200);
      assert.equal((await call('d3','taxipress/driver/on-road',{})).status,200);
      assert.equal((await call('d2','taxipress/driver/boarding',{})).status,200);
      const boarded = await call('d2','taxipress/driver/board',{ code: b.ticketCode });
      assert.equal(boarded.status,200,JSON.stringify(await boarded.clone().json()));
      const used = (await json(await call('c',`taxipress/bookings/${b.id}`))).booking;
      assert.equal(used.status,'boarded'); assert.equal(used.taxi.queueId,target); assert.deepEqual(used.seatNumbers,['1B']);
    });
    await t.test('changing the vehicle clears layout approval until staff check it again',async () => {
      assert.equal((await call('d1','taxipress/taxi/apply',{ relayRouteId: relay.id,plate: 'UBA NEW1',seatLayout: '18' })).status,201);
      const taxi = (await json(await call('d1','taxipress/taxi/me'))).taxi;
      assert.equal(taxi.status,'pending'); assert.equal(taxi.numberedSeatsEnabled,false);
      assert.equal((await call('staff',`admin/taxipress/taxis/${taxi.id}`,{ status: 'approved' })).status,200);
      const q = (await json(await call('d1','taxipress/driver/join',{ routeId: route.id }))).entry.id;
      assert.equal((await map('',q)).enabled,false,'Ordinary taxi approval must not imply a verified numbered layout');
    });
  } finally {
    setD1Binding(undefined); resetSchemaCache(); client.close();
    if (secret == null) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  }
});
