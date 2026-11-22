import assert from "node:assert/strict";
import test from "node:test";
import type { CustomerWallet, WalletShares } from "@peebee/shared";
import { homeWalletAccounts, walletDeckIndex } from "./home-wallet";
import { homeHeroImage } from "./personalized-home";

const wallet: CustomerWallet = { balance: 6000, cap: 2000000, verified: true, ledger: [] };
test("Home uses named accounts and routes funding into the correct existing flow", () => {
  const cards = homeWalletAccounts(wallet, [
    { id: "primary", name: "Main wallet", balance: 6000, isPrimary: true },
    { id: "savings & bills", name: "My savings", balance: 4000, isPrimary: false },
    { id: "frozen", name: "School", balance: 2000, isPrimary: false, frozen: true },
  ], null);
  assert.deepEqual(cards.map(card => [card.name, card.balance]), [["Personal", 6000], ["My savings", 4000], ["School", 2000]]);
  assert.equal(cards[0].fundHref, "/wallet?tab=topup");
  assert.equal(cards[1].fundHref, "/wallet?tab=accounts&account=savings%20%26%20bills&action=move");
  assert.equal(cards[2].fundHref, null);
  assert.equal(cards[2].frozen, true);
  assert.equal(cards[1].detailsHref, "/wallet?tab=accounts&account=savings%20%26%20bills");
});

test("unavailable multi-wallet schema falls back to primary; active shares preserve hidden balances", () => {
  const base = { owner_id: "owner", owner_name: "Amina", wallet_id: "school", wallet_name: "School fees", created_at: "2026-11-22", responded_at: null, owner_balance: null };
  const shares: WalletShares = { granted: [], received: [
    { ...base, id: "active", status: "active" },
    { ...base, id: "invite", status: "pending", owner_balance: 90000 },
    { ...base, id: "revoked", status: "revoked", owner_balance: 90000 },
  ] };
  const cards = homeWalletAccounts(wallet, [], shares);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].balance, 6000);
  assert.equal(cards[1].id, "shared:active");
  assert.equal(cards[1].balance, null);
  assert.equal(cards[1].fundHref, null);
  assert.equal(cards[1].verified, false);
  assert.equal(homeWalletAccounts({ ...wallet, verified: false }, [], null)[0].verified, false);
});

test("deck wraps both directions and hero assets leave other service artwork intact", () => {
  assert.equal(walletDeckIndex(0, -1, 3), 2);
  assert.equal(walletDeckIndex(2, 1, 3), 0);
  assert.equal(walletDeckIndex(0, 1, 1), 0);
  assert.equal(walletDeckIndex(0, -1, 0), 0);
  assert.equal(homeHeroImage("boda"), "/home-hero/morning-boda.webp");
  assert.equal(homeHeroImage("street-food"), "/home-hero/evening-rolex.webp");
  assert.equal(homeHeroImage("eat-hero"), "/home-hero/lunch-matooke.webp");
  assert.equal(homeHeroImage("clean"), "/home-hero/cleaning-laundry.webp");
  assert.equal(homeHeroImage("laundry"), "/home-hero/cleaning-laundry.webp");
  assert.equal(homeHeroImage("learn-hero"), "/home-screensaver/learn-hero.webp");
});
