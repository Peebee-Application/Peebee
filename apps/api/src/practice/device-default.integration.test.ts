import assert from "node:assert/strict";
import test from "node:test";
import { invalidateSettingsCache } from "../lib/settings.js";
import { practiceHarness } from "./world-test-helpers.js";

test("practice runs on each device by default; Admin can switch on the shared world", async () => {
  const { mainDb: db, tokens, call, json, post, start } = await practiceHarness();
  const setShared = async (value: string | null) => {
    await db.execute({ sql: "DELETE FROM settings WHERE key = 'practice_shared_world'", args: [] });
    if (value != null) await db.execute({ sql: "INSERT INTO settings (key, value) VALUES ('practice_shared_world', ?)", args: [value] });
    invalidateSettingsCache();
  };

  await setShared(null);
  const refused = await post(tokens.customer, "/practice/session", { role: "customer" });
  assert.equal(refused.status, 403, "no shared world until Admin turns it on");
  assert.equal((await json<{ error: string }>(refused)).error, "practice_on_device");
  assert.equal((await json<{ available: boolean }>(await call(tokens.customer, "/practice/world"))).available, false);

  const on = await call(tokens.admin, "/admin/modules", { method: "PUT", body: JSON.stringify({ practiceSharedWorld: true }) });
  assert.equal(on.status, 200);
  assert.equal((await json<{ practiceSharedWorld: boolean }>(on)).practiceSharedWorld, true);
  assert.equal((await json<{ available: boolean }>(await call(tokens.customer, "/practice/world"))).available, true);
  assert.equal((await start("customer")).user.id.startsWith("prac_"), true, "the shared world hands out a demo persona");

  const log = await db.execute("SELECT summary FROM admin_activity_log WHERE action = 'modules.update'");
  assert.ok(log.rows.some((r) => String(r.summary).includes("practice runs on the shared world")), "the change is in the activity log");

  await setShared("0");
  assert.equal((await post(tokens.customer, "/practice/session", { role: "customer" })).status, 403);
  await db.execute({ sql: "INSERT INTO settings (key, value) VALUES ('platform_environment', 'sandbox') ON CONFLICT(key) DO UPDATE SET value = 'sandbox'", args: [] });
  invalidateSettingsCache();
  assert.equal((await json<{ available: boolean }>(await call(tokens.customer, "/practice/world"))).available, true, "always on while the whole platform is in sandbox");
});
