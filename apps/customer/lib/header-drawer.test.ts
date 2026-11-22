import assert from "node:assert/strict";
import test from "node:test";
import { drawerSectionForPath, pathForDrawerSection, shouldAutoOpenDrawerSection } from "./header-drawer";

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

test("shouldAutoOpenDrawerSection opens Profile, Settings, and Notifications routes", () => {
  assert.equal(shouldAutoOpenDrawerSection("/account"), "profile");
  assert.equal(shouldAutoOpenDrawerSection("/account/foo"), "profile");
  assert.equal(shouldAutoOpenDrawerSection("/settings"), "settings");
  assert.equal(shouldAutoOpenDrawerSection("/notifications"), "notifications");
  assert.equal(shouldAutoOpenDrawerSection("/wallet"), null);
  assert.equal(shouldAutoOpenDrawerSection("/"), null);
  assert.equal(shouldAutoOpenDrawerSection("/food"), null);
});
