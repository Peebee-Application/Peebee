import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import type { FoodSellerOrders } from "@peebee/shared";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setPlatformEnvironment, setServiceSwitches } from "../lib/settings.js";
import { sellerOrderRoutes } from "./seller-orders.js";
import { restaurantRoutes } from "./routes.js";
import { customerRestaurantRoutes } from "./customer.js";
import { reconcileFoodHours } from "./hours.js";

test("Food seller inbox isolates businesses/environments, paginates and excludes private order fields", async () => {
  process.env.JWT_SECRET = "seller-orders-test-only";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const sql of splitSqlStatements(
      readFileSync(join(migrations, file), "utf8"),
    ))
      await client.execute(sql);
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      const result = await client.execute({
        sql: this.sql,
        args: this.args as InArgs,
      });
      return {
        results: result.rows,
        success: true,
        meta: { changes: result.rowsAffected },
      };
    },
  });
  setD1Binding({ prepare } as unknown as D1Database);
  try {
    await setPlatformEnvironment("live");
    await client.execute(
      "INSERT INTO users (id,name,password_hash,role) VALUES ('owner-a','Owner A','h','customer'),('owner-b','Owner B','h','customer'),('alice','Alice','h','customer'),('bob','Bob','h','customer'),('rider','Rita','h','rider')",
    );
    await client.execute(
      "UPDATE users SET email='private@example.test',phone='PRIVATE_PHONE' WHERE id='alice'",
    );
    await client.execute(
      "INSERT INTO restaurants (id,owner_id,name,status) VALUES ('food-a','owner-a','Kitchen A','active'),('food-b','owner-b','Kitchen B','active')",
    );
    async function seed(
      id: string,
      business = "food-a",
      stage = "Shop",
      environment = "live",
    ) {
      const customer = business === "food-a" ? "alice" : "bob";
      await client.execute({
        sql: "INSERT INTO lists(id,customer_id,title) VALUES (?,?,?)",
        args: [`list-${id}`, customer, "Food order"],
      });
      await client.execute({
        sql: "INSERT INTO list_items(id,list_id,name,quantity,unit_price) VALUES (?,?,?,2,7000)",
        args: [`item-${id}`, `list-${id}`, "Rolex (Large)"],
      });
      await client.execute({
        sql: "INSERT INTO orders(id,list_id,customer_id,rider_id,restaurant_id,stage,environment,pin_code,share_token,destination_lat,rider_lat,created_at) VALUES (?,?,?,'rider',?,?,?,'SECRET_PIN',?,1.234,2.345,'2026-10-06 10:00:00')",
        args: [
          id,
          `list-${id}`,
          customer,
          business,
          stage,
          environment,
          `PRIVATE_TOKEN-${id}`,
        ],
      });
    }
    for (let i = 0; i < 51; i++)
      await seed(`active-${String(i).padStart(3, "0")}`);
    for (const stage of ["Handover", "Settle", "Cancelled"])
      await seed(`history-${stage}`, "food-a", stage);
    await seed("other-business", "food-b");
    await seed("sandbox-order", "food-a", "Shop", "sandbox");
    const ownerA = await signToken({ sub: "owner-a", role: "customer" });
    const ownerB = await signToken({ sub: "owner-b", role: "customer" });
    const genericCustomer = await signToken({ sub: "alice", role: "customer" });
    const rider = await signToken({ sub: "rider", role: "rider" });
    const app = new Hono()
      .route("/v1", sellerOrderRoutes)
      .route("/v1", restaurantRoutes)
      .route("/v1", customerRestaurantRoutes);
    const call = (query = "", token = ownerA) =>
      app.request(`/v1/restaurants/me/orders${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    assert.equal((await app.request("/v1/restaurants/me/orders")).status, 401);
    assert.equal((await call("", genericCustomer)).status, 404);
    assert.equal((await call("", rider)).status, 403);
    const firstResponse = await call("?restaurantId=food-b");
    assert.equal(firstResponse.status, 200);
    const first = (await firstResponse.json()) as FoodSellerOrders;
    assert.deepEqual(first.counts, { active: 51, history: 3 });
    assert.equal(first.orders.length, 50);
    assert.ok(first.nextCursor);
    assert(first.orders.every((order) => order.id.startsWith("active-")));
    assert.equal(first.orders[0].customerName, "Alice");
    assert.equal(first.orders[0].riderName, "Rita");
    assert.deepEqual(first.orders[0].items, [
      { name: "Rolex (Large)", quantity: 2, unitPrice: 7000 },
    ]);
    assert.equal(first.orders[0].itemsTotal, 14000);
    const payload = JSON.stringify(first);
    for (const secret of [
      "SECRET_PIN",
      "PRIVATE_TOKEN",
      "PRIVATE_PHONE",
      "private@example.test",
      "destination_lat",
      "rider_lat",
      "pin_code",
      "share_token",
    ])
      assert(!payload.includes(secret), `must not expose ${secret}`);
    const next = (await (
      await call(`?cursor=${encodeURIComponent(first.nextCursor!)}`)
    ).json()) as FoodSellerOrders;
    assert.equal(next.orders.length, 1);
    assert.equal(next.nextCursor, null);
    assert(!first.orders.some((order) => order.id === next.orders[0].id));
    const history = (await (
      await call("?view=history")
    ).json()) as FoodSellerOrders;
    assert.equal(history.orders.length, 3);
    assert(history.orders.some((order) => order.stage === "Handover"));
    const other = (await (await call("", ownerB)).json()) as FoodSellerOrders;
    assert.deepEqual(
      other.orders.map((order) => order.id),
      ["other-business"],
    );
    assert.equal((await call("?cursor=bad-json")).status, 400);
    assert.equal((await call("?view=all")).status, 400);
    const closed = await app.request("/v1/restaurants/me", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ownerA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isOpen: false }),
    });
    assert.equal(closed.status, 200);
    assert.equal(
      (
        await client.execute(
          "SELECT is_open FROM restaurants WHERE id='food-a'",
        )
      ).rows[0].is_open,
      0,
    );
    assert.equal(
      ((await (await call()).json()) as FoodSellerOrders).counts.active,
      51,
      "closing must retain existing orders",
    );
    await setServiceSwitches({ food: true });
    const blocked = await app.request("/v1/restaurants/food-a/order", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${genericCustomer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ menuItemId: "missing-item", quantity: 1 }],
      }),
    });
    assert.equal(blocked.status, 409);
    assert.equal(
      ((await blocked.json()) as { error: string }).error,
      "restaurant_closed",
    );
    await client.execute("UPDATE restaurants SET open_time='09:00',close_time='18:00',updated_at='2026-10-06 05:00:00' WHERE id='food-a'");
    const beforeHours = (await client.execute("SELECT * FROM restaurants WHERE id='food-a'")).rows[0];
    const openedByHours = await reconcileFoodHours(beforeHours, new Date("2026-10-06T06:00:00Z"));
    assert.equal(openedByHours.is_open, 1, "opening time persists an open business even without a seller session");
    const closedByHours = await reconcileFoodHours(openedByHours, new Date("2026-10-06T15:00:00Z"));
    assert.equal(closedByHours.is_open, 0, "closing time persists a closed business");
    assert.equal(((await (await call()).json()) as FoodSellerOrders).counts.active, 51);
    await setPlatformEnvironment("sandbox");
    const sandbox = (await (await call()).json()) as FoodSellerOrders;
    assert.deepEqual(
      sandbox.orders.map((order) => order.id),
      ["sandbox-order"],
    );
    await setPlatformEnvironment("live");
    await client.execute(
      "UPDATE restaurants SET status='suspended' WHERE id='food-a'",
    );
    assert.equal(
      (await call()).status,
      200,
      "owner can still view existing records while new ordering is unavailable",
    );
  } finally {
    setD1Binding(undefined);
    client.close();
  }
});
