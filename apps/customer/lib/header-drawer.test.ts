import assert from "node:assert/strict";
import test from "node:test";
import { drawerSectionForPath, pathForDrawerSection } from "./header-drawer";

test("drawerSectionForPath maps live routes, including deep links", () => {
  assert.equal(drawerSectionForPath("/wallet"), "wallet");
  assert.equal(drawerSectionForPath("/wallet/foo"), "wallet");
  assert.equal(drawerSectionForPath("/account"), "profile");
  assert.equal(drawerSectionForPath("/notifications"), "notifications");
  assert.equal(drawerSectionForPath("/settings"), "settings");
  assert.equal(drawerSectionForPath("/"), null);
  assert.equal(drawerSectionForPath("/help"), null);
});

test("pathForDrawerSection keeps existing routes so deep links stay intact", () => {
  assert.equal(pathForDrawerSection("profile"), "/account");
  assert.equal(pathForDrawerSection("settings"), "/settings");
  assert.equal(pathForDrawerSection("wallet"), "/wallet");
  assert.equal(pathForDrawerSection("notifications"), "/notifications");
});
