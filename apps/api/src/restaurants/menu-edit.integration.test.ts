import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { menuRoutes } from "./menu.js";

test("menu edits clear optional fields without weakening ownership or value validation", async () => {
  process.env.JWT_SECRET = "menu-editor-test-only";
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    for (const sql of splitSqlStatements(
      readFileSync(join(migrations, file), "utf8"),
    ))
      await client.execute(sql);
  }
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
    await client.execute(
      "INSERT INTO users (id,name,password_hash,role) VALUES ('owner','Owner','h','customer'),('other','Other','h','customer')",
    );
    await client.execute(
      "INSERT INTO restaurants (id,owner_id,name,status) VALUES ('food','owner','Test kitchen','active'),('other-food','other','Other kitchen','active')",
    );
    const ownerToken = await signToken({ sub: "owner", role: "customer" });
    const otherToken = await signToken({ sub: "other", role: "customer" });
    const app = new Hono().route("/v1", menuRoutes);
    const call = (
      path: string,
      method: string,
      body: unknown,
      token = ownerToken,
    ) =>
      app.request(`/v1/restaurants/me/menu/items${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const created = await call("", "POST", {
      name: "Luwombo",
      price: 15000,
      description: "Chicken in banana leaves",
      prepTimeMinutes: 30,
    });
    assert.equal(created.status, 201);
    const { item } = (await created.json()) as { item: { id: string } };
    assert.equal(
      (
        await call(`/${item.id}`, "PATCH", {
          description: null,
          prepTimeMinutes: null,
        })
      ).status,
      200,
    );
    const row = (
      await client.execute({
        sql: "SELECT description,prep_time_minutes,price FROM menu_items WHERE id=?",
        args: [item.id],
      })
    ).rows[0];
    assert.equal(row.description, null);
    assert.equal(row.prep_time_minutes, null);
    assert.equal(row.price, 15000);
    assert.equal(
      (await call(`/${item.id}`, "PATCH", { prepTimeMinutes: 241 })).status,
      400,
    );
    assert.equal(
      (await call(`/${item.id}`, "PATCH", { price: -1 })).status,
      400,
    );
    assert.equal(
      (await call(`/${item.id}`, "PATCH", { description: null }, otherToken))
        .status,
      404,
    );
    assert.equal(
      (
        await call("", "POST", {
          name: "Invalid dish",
          price: 15000,
          prepTimeMinutes: null,
        })
      ).status,
      400,
    );
  } finally {
    setD1Binding(undefined);
    client.close();
  }
});
