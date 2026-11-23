import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { createClient,type InArgs } from '@libsql/client/node';
import { Hono } from 'hono';
import { setD1Binding,type D1Database } from '../db/client.js';
import { splitSqlStatements } from '../db/split-sql.js';
import { resetSchemaCache } from '../lib/schema.js';
import { setSetting } from '../lib/settings.js';
import { publicTaxipressRoutes } from './routes.js';
import { seatingReady,bookingSeats,cleanupSeatHolds,reserveNumberedBooking } from './seats.js';

test('before migration 0168, existing reads and automatic booking capacity do not touch new tables or columns',async () => {
  const client = createClient({url:'file::memory:'});
  for (const file of readdirSync('src/db/migrations').filter(f => f.endsWith('.sql') && !f.startsWith('0168_')).sort()) {
    for (const sql of splitSqlStatements(readFileSync('src/db/migrations/'+file,'utf8'))) await client.execute(sql);
  }
  const prepare = (sql: string) => ({ sql,args: [] as unknown[],bind(...args: unknown[]) { this.args = args; return this; },
    async all() { const r = await client.execute({sql:this.sql,args:this.args as InArgs}); return {results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid ?? 0)}}; } });
  setD1Binding({prepare} as unknown as D1Database); resetSchemaCache();
  try {
    await setSetting('taxipress_numbered_seats_enabled','1');
    assert.equal(await seatingReady(),false);
    await cleanupSeatHolds();
    assert.equal(await reserveNumberedBooking('old-departure','customer',1),null);
    assert.deepEqual(await bookingSeats('old-booking'),{seatNumbers:[],seatChoiceFee:0});
    const app = new Hono().route('/v1',publicTaxipressRoutes);
    const response = await app.request('/v1/taxipress-public/config');
    assert.equal(response.status,200); assert.equal((await response.json() as any).numberedSeatsEnabled,false);
    assert.equal((await app.request('/v1/taxipress-public/queue/old-departure/seats')).status,200);
  } finally { setD1Binding(undefined); resetSchemaCache(); client.close(); }
});
