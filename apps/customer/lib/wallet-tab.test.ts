import assert from "node:assert/strict";
import test from "node:test";
import { parseWalletTab, walletTabHref } from "./wallet-tab.js";

test("legacy home query and unknown values become Central", () => {
  assert.equal(parseWalletTab("home"), "central");
  assert.equal(parseWalletTab(null), "central");
  assert.equal(parseWalletTab("unknown"), "central");
  assert.equal(parseWalletTab("recipients"), "recipients");
});

test("wallet tab hrefs", () => {
  assert.equal(walletTabHref("central"), "/wallet");
  assert.equal(walletTabHref("home"), "/wallet");
  assert.equal(walletTabHref("accounts"), "/wallet?tab=accounts");
  assert.equal(walletTabHref("give"), "/give");
});
