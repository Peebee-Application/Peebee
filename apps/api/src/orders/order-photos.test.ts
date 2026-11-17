import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setR2Binding, type R2Bucket } from "../storage/r2.js";

process.env.JWT_SECRET = "order-photos-test-only-secret";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

type Json = Record<string, any>;
const JPEG = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 64 }, (_, i) => i)]);

async function setup() {
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  setR2Binding({
    async put(key: string, value: any, options?: any) {
      objects.set(key, { bytes: new Uint8Array(value), contentType: options?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: new Response(o.bytes as unknown as BodyInit).body!, httpMetadata: { contentType: o.contentType } } : null;
    },
    async head(key: string) {
      const o = objects.get(key);
      return o ? { size: o.bytes.length } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as R2Bucket);

  const mkUser = async (id: string, role = "customer") => {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, role, password_hash) VALUES (?, ?, ?, ?, 'x')", args: [id, `+2567${Math.floor(10000000 + Math.random() * 89999999)}`, `User ${id}`, role] });
    return signToken({ sub: id, role: role as "customer" });
  };
  const call = async (path: string, opts: { method?: string; token?: string; body?: unknown; form?: FormData } = {}) => {
    const res = await app.request(`/v1${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
      headers: { ...(opts.form ? {} : { "Content-Type": "application/json" }), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, json: (type.includes("json") ? await res.json() : {}) as Json, raw: res };
  };
  const fileForm = (bytes: Uint8Array = JPEG(), type = "image/jpeg", extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("file", new File([bytes as unknown as BlobPart], "photo.jpg", { type }));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  };
  const customer = await mkUser("cust_a");
  const other = await mkUser("cust_b");
  const rider = await mkUser("rider_a", "rider");
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list_1', 'cust_a', 'Groceries')");
  for (const [id, name] of [["item_1", "Basmati rice"], ["item_2", "Fresh milk"], ["item_3", "Tomatoes"]]) {
    await client.execute({ sql: "INSERT INTO list_items (id, list_id, name) VALUES (?, 'list_1', ?)", args: [id, name] });
  }
  await client.execute("INSERT INTO orders (id, list_id, customer_id, rider_id, type) VALUES ('ord_1', 'list_1', 'cust_a', 'rider_a', 'shopping')");
  return { client, customer, other, rider, call, fileForm, objects };
}

test("order photos: upload, attach, view, limits and access", async () => {
  const { customer, other, rider, call, fileForm } = await setup();
  const config = await call("/order-photos/config", { token: customer });
  assert.equal(config.json.available, true);
  assert.equal(config.json.maxPhotos, 4);

  const up = await call("/order-photos/uploads", { token: customer, form: fileForm() });
  assert.equal(up.status, 201);
  assert.match(up.json.key, /^order-photos\/cust_a\/.+\.jpg$/);

  const fake = await call("/order-photos/uploads", { token: customer, form: fileForm(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "image/png") });
  assert.equal(fake.status, 400, "bytes decide the type");
  const big = await call("/order-photos/uploads", { token: customer, form: fileForm(new Uint8Array(6 * 1024 * 1024 + 10).fill(0xff)) });
  assert.equal(big.status, 400);
  const gif = await call("/order-photos/uploads", { token: customer, form: fileForm(JPEG(), "image/gif") });
  assert.equal(gif.status, 400);

  const theirs = await call("/order-photos/uploads", { token: other, form: fileForm() });
  assert.equal((await call("/orders/ord_1/photos", { token: customer, body: { photos: [{ key: theirs.json.key }] } })).status, 403, "can't attach someone else's upload");
  assert.equal((await call("/orders/ord_1/photos", { token: other, body: { photos: [{ key: theirs.json.key }] } })).status, 403, "only the order's customer attaches");

  const attached = await call("/orders/ord_1/photos", { token: customer, body: { photos: [{ key: up.json.key, note: "Same brand, the 5 kg bag", itemIndex: 0 }] } });
  assert.equal(attached.status, 201);
  assert.equal(attached.json.photos[0].list_item_id, "item_1");
  assert.equal(attached.json.photos[0].note, "Same brand, the 5 kg bag");

  const tooLong = await call("/orders/ord_1/photos", { token: customer, body: { photos: [{ key: up.json.key, note: "x".repeat(81) }] } });
  assert.equal(tooLong.status, 400);

  const seen = await call("/orders/ord_1/photos", { token: rider });
  assert.equal(seen.status, 200);
  assert.equal(seen.json.photos.length, 1);
  assert.equal((await call("/orders/ord_1/photos", { token: other })).status, 403);
  const image = await call(`/orders/ord_1/photos/${seen.json.photos[0].id}`, { token: rider });
  assert.equal(image.status, 200);
  assert.equal(image.raw.headers.get("content-type"), "image/jpeg");
  assert.equal((await call(`/orders/ord_1/photos/${seen.json.photos[0].id}`, { token: other })).status, 403);

  const keys: string[] = [];
  for (let i = 0; i < 4; i++) keys.push((await call("/order-photos/uploads", { token: customer, form: fileForm() })).json.key);
  const over = await call("/orders/ord_1/photos", { token: customer, body: { photos: keys.map((key) => ({ key })) } });
  assert.equal(over.status, 400, "no more than 4 per order");
  assert.equal(over.json.error, "too_many_photos");
});

test("order photos: a guest uploads straight onto their own order", async () => {
  const { client, call, fileForm } = await setup();
  await client.execute("INSERT INTO users (id, phone, name, role, password_hash) VALUES ('guest_1', '+256700000001', 'Guest', 'customer', 'x')");
  await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list_g', 'guest_1', 'Guest list')");
  await client.execute("INSERT INTO list_items (id, list_id, name) VALUES ('item_g', 'list_g', 'Rice')");
  await client.execute("INSERT INTO orders (id, list_id, customer_id, type) VALUES ('ord_g', 'list_g', 'guest_1', 'shopping')");
  const guest = await signToken({ sub: "guest_1", role: "customer", guestOrderId: "ord_g" });
  const res = await call("/orders/ord_g/photos", { token: guest, form: fileForm(JPEG(), "image/jpeg", { note: "This one", itemIndex: "0" }) });
  assert.equal(res.status, 201);
  assert.equal(res.json.photos[0].list_item_id, "item_g");
  assert.equal((await call("/orders/ord_g/photos", { token: guest })).json.photos.length, 1);
  assert.equal((await call("/order-photos/uploads", { token: guest, form: fileForm() })).status, 403, "guest scope stays narrow");
});

test("order photos: before migration 0163 the feature reports unavailable", async () => {
  const { client, customer, call, fileForm } = await setup();
  await client.execute("DROP TABLE order_photos");
  resetSchemaCache();
  assert.equal((await call("/order-photos/config", { token: customer })).json.available, false);
  assert.equal((await call("/order-photos/uploads", { token: customer, form: fileForm() })).status, 503);
  const list = await call("/orders/ord_1/photos", { token: customer });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.photos, []);
});
