import assert from "node:assert/strict";
import test from "node:test";
import { describeTxWhen } from "./wallet-when.js";

const now = new Date("2026-11-17T16:00:00Z");

test("wallet dates read as today, yesterday, a weekday, or a local date", () => {
  const today = describeTxWhen("2026-11-17T11:02:00Z", now);
  assert.equal(today.kind, "today");
  if (today.kind === "today") assert.match(today.time, /\d{2}:\d{2}/);

  assert.deepEqual(describeTxWhen("2026-11-16T08:00:00Z", now), { kind: "yesterday" });

  const weekday = describeTxWhen("2026-11-15T15:40:00Z", now);
  assert.equal(weekday.kind, "weekday");
  if (weekday.kind === "weekday") {
    assert.ok(weekday.day.length > 0);
    assert.match(weekday.time, /\d{2}:\d{2}/);
  }

  const older = describeTxWhen("2026-10-02T10:00:00Z", now);
  assert.equal(older.kind, "date");
  if (older.kind === "date") assert.doesNotMatch(older.label, /T\d{2}:/);

  assert.equal(describeTxWhen("2026-11-17 14:02:00", now).kind, "today");
});
