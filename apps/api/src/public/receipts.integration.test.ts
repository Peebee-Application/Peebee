import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "../orders/routes.js";
import { relayRoutes } from "../relay/routes.js";
import { taxipressRoutes } from "../taxipress/routes.js";
import { publicReceiptRoutes, type PublicReceipt } from "./receipts.js";
import { receiptUrl } from "@peebee/shared";
import { codeFromScan } from "@peebee/shared/qr";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
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

const KAMPALA = { lat: 0.3136, lng: 32.5811 };
const ENTEBBE = { lat: 0.0512, lng: 32.4637 };

test("receipts: the QR on a receipt verifies it, for fuel and for a Taxipress seat", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "receipt-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  resetSchemaCache();
  try {
    const people = [["staff", "admin"], ["d1", "customer"], ["a", "customer"]];
    for (const [id, role] of people) await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)", args: [id, id, id, role] });
    await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('a')");
    await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'staff'");
    // Mounted first, as in app.ts, so no sub-app's sign-in middleware sits in front of it.
    const app = new Hono().route("/v1", publicReceiptRoutes).route("/v1", orderRoutes).route("/v1", relayRoutes).route("/v1", taxipressRoutes);
    const tokens = Object.fromEntries(await Promise.all(people.map(async ([sub, role]) => [sub, await signToken({ sub, role } as never)] as const)));
    const call = (who: string | null, path: string, body?: object, method?: string) => app.request(`/v1/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;

    await t.test("a fuel receipt verifies, with the plate masked and no names", async () => {
      await client.execute("INSERT INTO fuel_stations (id, brand_name, company_name) VALUES ('st1', 'TotalEnergies', 'Total Uganda')");
      await client.execute("INSERT INTO fuel_station_outlets (id, station_id, name, code) VALUES ('ou1', 'st1', 'Airport Road, Entebbe', 'OUT1')");
      await client.execute("INSERT INTO fuel_products (id, name, category) VALUES ('pr1', 'Unleaded Petrol', 'fuel')");
      await client.execute("INSERT INTO fuel_dispenses (id, outlet_id, rider_id, vehicle_plate, product_id, price_per_litre, litres_dispensed, total_ugx, pump_number, receipt_ref, environment) VALUES ('di1', 'ou1', 'd1', 'UFP 246P', 'pr1', 5450, 3.67, 20000, 2, 'RCP-GAS-MH3K9Z-4821', 'sandbox')");
      const res = await call(null, "public/receipts/RCP-GAS-MH3K9Z-4821");
      assert.equal(res.status, 200, "no sign-in needed");
      const receipt = await json<PublicReceipt>(res);
      assert.deepEqual([receipt.valid, receipt.kind, receipt.amountUgx, receipt.demo], [true, "fuel", 20000, true]);
      const text = JSON.stringify(receipt);
      assert.ok(text.includes("TotalEnergies") && text.includes("Unleaded Petrol") && text.includes("3.67"));
      assert.ok(!text.includes("UFP 246P"), "the full plate is not shown");
      assert.ok(text.includes("•••••6P") || text.includes("••••••6P") || /•+6P/.test(text), "only the end of the plate is");
      assert.equal(res.headers.get("cache-control"), "no-store");
      // The QR holds a link; the scanner takes the reference out of it, and it verifies.
      const ref = codeFromScan(receiptUrl("RCP-GAS-MH3K9Z-4821"));
      assert.equal(ref, "RCP-GAS-MH3K9Z-4821");
      assert.equal((await call(null, `public/receipts/${encodeURIComponent(ref.toLowerCase())}`)).status, 200, "case does not matter for fuel references");
    });

    await t.test("a disputed or reversed fuel receipt does not verify", async () => {
      await client.execute("UPDATE fuel_dispenses SET status = 'reversed' WHERE id = 'di1'");
      assert.equal((await call(null, "public/receipts/RCP-GAS-MH3K9Z-4821")).status, 404);
      await client.execute("UPDATE fuel_dispenses SET status = 'completed' WHERE id = 'di1'");
    });

    await t.test("anything else answers not found without saying why", async () => {
      for (const ref of ["RCP-GAS-NOSUCH-0000", "tps_00000000000000000000", "mpay_unknownunknown", "short", "../../etc/passwd", "x".repeat(80)]) {
        const res = await call(null, `public/receipts/${encodeURIComponent(ref)}`);
        assert.equal(res.status, 404, ref);
        assert.equal((await json<{ valid: boolean }>(res)).valid, false);
      }
    });

    await t.test("a Taxipress seat has a receipt only once it has boarded and been settled", async () => {
      const relay = await json<{ id: string }>(await call("staff", "admin/relay/routes", {
        name: "Kampala - Entebbe", stageAName: "Kampala Stage", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
        stageBName: "Entebbe Stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000,
      }));
      const route = await json<{ id: string }>(await call("staff", "admin/taxipress/routes", { relayRouteId: relay.id, direction: "a_to_b", farePerSeat: 5000, active: true }));
      assert.equal((await call("staff", "admin/taxipress/settings", { enabled: true, commissionDigitalPercent: 10, commissionCashPercent: 10 }, "PUT")).status, 200);
      assert.equal((await call("d1", "taxipress/taxi/apply", { relayRouteId: relay.id, plate: "uaz 111a", seatLayout: "14" })).status, 201);
      for (const taxi of (await json<{ taxis: Array<{ id: string }> }>(await call("staff", "admin/taxipress/taxis"))).taxis) await call("staff", `admin/taxipress/taxis/${taxi.id}`, { status: "approved" });
      assert.equal((await call("d1", "taxipress/driver/join", { routeId: route.id, ...KAMPALA })).status, 201);
      const van = (await json<{ line: Array<{ id: string }> }>(await call("a", `taxipress/routes/${route.id}/queue`))).line[0]!;

      const booked = await json<{ booking: { id: string; ticketCode: string; receiptRef: string | null }; order: { id: string } }>(await call("a", "taxipress/bookings", { queueId: van.id, seats: 2, payment: "app" }));
      assert.equal(booked.booking.receiptRef, null, "nothing to receipt yet");
      await client.execute("UPDATE users SET wallet_balance = wallet_balance + 100000 WHERE id = 'a'");
      assert.equal((await call("a", `orders/${booked.order.id}/fund`, { paymentMethod: "wallet", useWallet: true })).status, 200);
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal((await call("d1", "taxipress/driver/board", { code: booked.booking.ticketCode })).status, 200);

      const after = (await json<{ booking: { receiptRef: string | null } }>(await call("a", `taxipress/bookings/${booked.booking.id}`))).booking;
      assert.match(after.receiptRef ?? "", /^tps_[0-9a-f]{20}$/);
      const res = await call(null, `public/receipts/${after.receiptRef}`);
      assert.equal(res.status, 200);
      const receipt = await json<PublicReceipt>(res);
      assert.deepEqual([receipt.kind, receipt.amountUgx, receipt.demo], ["taxipress", 10000, false]);
      assert.ok(receipt.lines.some((l) => l.label === "Trip" && l.value === "Kampala Stage → Entebbe Stage"));
      assert.ok(receipt.lines.some((l) => l.label === "Seats" && l.value === "2"));
      assert.ok(!JSON.stringify(receipt).includes("uaz") && !JSON.stringify(receipt).includes("UAZ"), "no plate, driver or passenger identity");
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
