import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduledOpen } from "./hours.js";

test("Uganda working hours resume at the next boundary after a manual change", () => {
  const business = {status:"active", open_time:"09:00", close_time:"18:00", updated_at:"2026-10-06 05:00:00"};
  assert.equal(scheduledOpen(business, new Date("2026-10-06T06:00:00Z")), true);
  assert.equal(scheduledOpen({...business,updated_at:"2026-10-06 07:00:00"}, new Date("2026-10-06T08:00:00Z")), null);
  assert.equal(scheduledOpen({...business,updated_at:"2026-10-06 07:00:00"}, new Date("2026-10-06T15:00:00Z")), false);
  assert.equal(scheduledOpen({...business,status:"pending_approval"}, new Date("2026-10-06T06:00:00Z")), null);
  assert.equal(scheduledOpen({...business,open_time:null}, new Date("2026-10-06T06:00:00Z")), null);
});

test("overnight schedules open in the evening and close the next morning", () => {
  const business = {status:"active",open_time:"18:00",close_time:"02:00",updated_at:"2026-10-05 14:00:00"};
  assert.equal(scheduledOpen(business,new Date("2026-10-05T22:00:00Z")),true);
  assert.equal(scheduledOpen(business,new Date("2026-10-05T23:00:00Z")),false);
  assert.equal(scheduledOpen({...business,open_time:"00:00",close_time:"00:00"},new Date("2026-10-05T23:00:00Z")),null);
});
